"""
netflix_adapter.py — Compatibility shim powered by netflix_session.py + fast_checker.py.

The bot structure expects a simple session module API, while Netflix needs full
cookie dictionaries and an 8-digit TV activation flow. This adapter normalizes
Netflix checker/session results for the rest of the bot.

Key mapping:
  legacy token field           →  Netflix cookie_json (JSON-encoded cookie dict)
  legacy short TV code         →  Netflix 8-digit numeric code
  legacy region routing        →  Netflix global pool + country metadata
"""

from __future__ import annotations
import json
import logging
import asyncio
import re
from typing import Any, Optional

import fast_checker
from netflix_session import NetflixSession, standardize_plan_details

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
#  COOKIE BLOB HELPERS  — cookies are stored in DB as JSON string
#  in the database compatibility columns.
# ─────────────────────────────────────────────────────────────
def _to_cookie_dict(blob) -> dict:
    """Accept dict, JSON-string, or None. Return dict."""
    if not blob:
        return {}
    if isinstance(blob, dict):
        return blob
    if isinstance(blob, (bytes, bytearray)):
        try:
            blob = blob.decode("utf-8", errors="replace")
        except Exception:
            return {}
    if isinstance(blob, str):
        s = blob.strip()
        if s.startswith("{"):
            try:
                data = json.loads(s)
                if isinstance(data, dict):
                    return data
            except Exception:
                return {}
        # Not JSON — treat as raw cookie text and parse
        return fast_checker._parse_cookies(s)
    return {}


def cookies_to_blob(cookie_dict: dict) -> str:
    """Serialize a cookie dict for DB storage."""
    return json.dumps(cookie_dict, separators=(",", ":"), ensure_ascii=False)


# ─────────────────────────────────────────────────────────────
#  NORMALIZED RETURN SHAPE
# ─────────────────────────────────────────────────────────────
def _country_flag(code: str) -> str:
    if not code or len(code) != 2:
        return code or "Unknown"
    try:
        OFFSET = 127397
        return chr(ord(code[0].upper()) + OFFSET) + chr(ord(code[1].upper()) + OFFSET)
    except Exception:
        return code


def _normalize_info(info: dict, status: str) -> dict:
    """Convert fast_checker info dict to the normalized shape used across the bot."""
    plan_raw = info.get("planName") or ""
    plan_norm, inferred_quality = standardize_plan_details(plan_raw) if plan_raw else ("Unknown", "Unknown")
    display_plan = plan_raw or plan_norm

    def _display_quality(value: Any, fallback: str = "Unknown") -> str:
        raw = str(value or "").strip()
        if not raw or raw.lower() in ("unknown", "none", "null"):
            raw = str(fallback or "").strip()
        marker = raw.upper()
        if not raw or marker in ("UNKNOWN", "NONE", "NULL"):
            return "Unknown"
        if "4K" in marker or "UHD" in marker or "ULTRA" in marker:
            return "UHD"
        if "SD" in marker or "480" in marker:
            return "SD"
        if "HD" in marker or "FHD" in marker or "720" in marker or "1080" in marker:
            return "HD"
        return raw

    vq_norm = _display_quality(info.get("videoQuality"), inferred_quality)

    country_code = (info.get("country") or "").upper()
    country_name = country_code  # keep 2-letter code — templates render it directly

    max_streams = info.get("maxStreams") or ""
    try:
        max_streams = int(max_streams)
    except Exception:
        max_streams = 0

    return {
        # Fields consumed by bot.py / admin_handlers.py:
        "email": info.get("email") or "Unknown",
        "first_name": info.get("firstName") or "",
        "country": country_name or "Unknown",
        "country_code": country_code,
        "country_flag": _country_flag(country_code),
        "region": "GLOBAL",
        "plan": display_plan,
        "plan_name": display_plan,
        "video_quality": vq_norm,
        "price": info.get("planPrice") or "N/A",
        "next_renewal": info.get("nextBillingDate") or info.get("memberSince") or "N/A",
        "member_since": info.get("memberSince") or "N/A",
        "payment_method": info.get("paymentMethod") or info.get("cardBrand") or "None",
        "profiles": 0,
        "max_profiles": max_streams or 5,
        "devices": 0,
        "max_streams": max_streams or 1,
        "has_active": status == "active",
        "category": "premium" if status == "active" else ("hold" if status == "on_hold" else "free"),
        "status": status,
    }


# ─────────────────────────────────────────────────────────────
#  PUBLIC API — stable names/signatures used by the bot
# ─────────────────────────────────────────────────────────────
def check_cookie_sync(cookie_blob, proxy_url: Optional[str] = None) -> dict:
    """
    Synchronous cookie check. Call via asyncio.to_thread().

    Accepts a JSON cookie blob (str), a raw cookie dict, or Netscape text.
    Returns normalized: {'valid', 'info', 'error', 'raw_data', 'status'}
    """
    cookie_dict = _to_cookie_dict(cookie_blob)
    if not cookie_dict:
        return {"valid": False, "info": None, "error": "Invalid or empty cookies",
                "raw_data": {}, "status": "invalid"}

    res = fast_checker.check_cookie_sync(cookie_dict, proxy_url)
    status = res.get("status", "invalid")
    info_raw = res.get("info") or {}

    if not res.get("valid"):
        return {
            "valid": False,
            "info": None,
            "error": res.get("error") or "Cookie invalid",
            "raw_data": {"netflix": info_raw},
            "status": status,
        }

    info = _normalize_info(info_raw, status)
    return {
        "valid": True,
        "info": info,
        "error": None,
        "raw_data": {"netflix": info_raw},
        "status": status,
    }


def activate_tv_code(cookie_blob, tv_code: str, region: Optional[str] = None,
                     proxy_url: Optional[str] = None) -> dict:
    """
    Activate a Netflix TV using an 8-digit code.
    `region` is accepted for compatibility and ignored (Netflix has no regions).
    Returns normalized result dict.
    """
    cookie_dict = _to_cookie_dict(cookie_blob)
    if not cookie_dict:
        return {"success": False, "error_type": "invalid_cookie",
                "error": "❌ Cookie is Dead or Expired.", "cookie_dead": True}

    # Step 1 — pre-validate & classify with fast_checker (proxy-aware, cheap)
    pre = fast_checker.check_cookie_sync(cookie_dict, proxy_url)
    status = pre.get("status", "invalid")

    if not pre.get("valid"):
        if pre.get("transient"):
            # BUG FIX: fast_checker flags rate-limited/no-response checks as
            # 'transient' — Netflix was never actually reached, so this is NOT
            # one of the real Netflix states (Active/On-Hold/Free/Invalid/
            # Duplicate); it just means the check itself failed. This used to
            # be returned identically to a confirmed-dead cookie
            # (error_type="invalid_cookie", cookie_dead=True), so bot.py would
            # permanently delete a perfectly good ACTIVE cookie from the pool
            # every time a proxy hiccup or Netflix rate-limit hit mid-activation
            # — happening on every live user's TV code attempt, not just the
            # 24h background sweep. Now returns a distinct flag so callers can
            # retry with another cookie without punishing this one.
            return {"success": False, "error_type": "check_failed",
                    "error": "❌ Could not verify cookie right now — retrying with another.",
                    "cookie_dead": False, "cookie_transient": True}
        return {"success": False, "error_type": "invalid_cookie",
                "error": "❌ Cookie is Dead or Expired.", "cookie_dead": True}

    if status != "active":
        # BUG FIX: this used to collapse "on_hold" and "free" into one identical
        # result (error_type="free_account", cookie_free=True), so the bot could
        # never tell a payment-hold account apart from a genuinely free/never-
        # subscribed one. Netflix cookie states are: Active, On-Hold, Free,
        # Invalid/Expired (handled above), and Duplicate (deduped on import in
        # fast_checker._parse_zip / database.remove_duplicate_cookies — never
        # reaches this function). cookie_free stays True for BOTH non-active
        # states so existing bot.py/bot_callbacks.py branches that only check
        # `result.get('cookie_free')` keep working unchanged (both states are
        # equally unusable for TV activation and must be pulled from rotation),
        # but callers can now check cookie_on_hold to log/report the real state.
        is_on_hold = (status == "on_hold")
        return {
            "success": False,
            "error_type": "on_hold_account" if is_on_hold else "free_account",
            "error": ("❌ Account is on hold (payment issue) — not usable for TV activation."
                      if is_on_hold else
                      "❌ Account is Free (no active subscription) — not usable for TV activation."),
            "cookie_dead": False,
            "cookie_free": True,
            "cookie_on_hold": is_on_hold,
            "info": _normalize_info(pre.get("info") or {}, status),
        }

    # Step 2 — activate via NetflixSession (async, hits /tv8)
    proxy_dict = None
    if proxy_url:
        proxy_dict = {"http://": proxy_url, "https://": proxy_url}

    async def _run():
        session = NetflixSession(cookie_dict=cookie_dict, proxy_dict=proxy_dict)
        try:
            return await session.activate_tv(tv_code)
        finally:
            try:
                await session.close()
            except Exception:
                pass

    try:
        # Called via asyncio.to_thread() → no running loop in this worker thread.
        res = asyncio.run(_run())
    except Exception as e:
        logger.error(f"activate_tv_code error: {e}")
        return {"success": False, "error_type": "error", "error": f"❌ Error: {e}"}

    if res.get("success"):
        info = _normalize_info(pre.get("info") or {}, status)
        details = res.get("details") or {}
        return {
            "success": True,
            "message": res.get("message", "✅ TV activated successfully!"),
            "email": info.get("email"),
            "region": "GLOBAL",
            "country": details.get("country") or info.get("country"),
            "country_code": info.get("country_code"),
            "plan_name": details.get("plan") or info.get("plan_name"),
            "video_quality": details.get("video_quality") or info.get("video_quality"),
            "first_name": info.get("first_name", ""),
            "profiles": info.get("profiles", 0),
            "max_profiles": info.get("max_profiles", 5),
            "devices": info.get("devices", 0),
            "category": info.get("category", "premium"),
            "has_active": True,
            "next_renewal": info.get("next_renewal", "N/A"),
        }

    err_type = res.get("error_type", "unknown")
    msg = res.get("message", "❌ Activation failed.")
    if err_type in ("invalid_code", "expired_code", "not_accepted"):
        return {"success": False, "error_type": "invalid_code",
                "error": msg, "cookie_dead": False}
    # BUG FIX: "tv8_unavailable" (was "auth") — /tv8 page failed to load (network
    # blip, rate-limit, slow Railway cold-start). The cookie account may be active;
    # the failure is Netflix/network-side. Skip this cookie, retry with another,
    # leave it in the pool for future activations.
    # BUG FIX: "auth_expired" (was "blocked") — 403 on the TV code POST. Caused by
    # the authURL CSRF token expiring between fetching /tv8 and submitting the code
    # (common on slow containers). Also a transient/infrastructure issue, not a dead
    # cookie. Same treatment: skip, retry, do not delete.
    # "timeout" / "error" — network-level failures, not confirmed cookie state.
    if err_type in ("tv8_unavailable", "auth_expired", "timeout", "error"):
        return {"success": False, "error_type": "check_failed",
                "error": msg, "cookie_dead": False, "cookie_transient": True}
    if err_type in ("session_expired", "blocked", "auth"):
        # "session_expired" = confirmed login redirect after code submission → dead.
        # "blocked"/"auth" kept for backward-compatibility with any cached error_type
        # values in flight, but new code no longer emits them for transient failures.
        return {"success": False, "error_type": "invalid_cookie",
                "error": msg, "cookie_dead": True}
    return {"success": False, "error_type": err_type, "error": msg,
            "cookie_dead": False}


# ─────────────────────────────────────────────────────────────
#  Cookie-file parsers
# ─────────────────────────────────────────────────────────────
def parse_cookie_text(text: str) -> Optional[str]:
    """
    Parse a raw cookie text file (Netscape / JSON / header-style).
    Returns a JSON-encoded cookie dict or None.
    """
    cookies = fast_checker._parse_cookies(text or "")
    if not cookies:
        return None
    if "NetflixId" not in cookies and "SecureNetflixId" not in cookies:
        return None
    return cookies_to_blob(cookies)


def extract_zip_cookies(zip_data: bytes):
    """
    Extract cookies from ZIP bytes.
    Returns list of (filename, cookie_blob_json_string).
    """
    raw = fast_checker.extract_zip_cookies(zip_data)
    return [(fn, cookies_to_blob(cd)) for fn, cd in raw]
