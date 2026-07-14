"""FastAPI wrapper around the untouched Netflix Telegram-bot modules.

Exposes three endpoints called by the Emberlord website:

  POST /check         { cookies: [{name, value, domain?}], proxy?: {…} }
                       -> { status, is_valid, plan_name, country, ... }
  POST /activate      { code, cookies, proxy? }
                       -> { status, duration_ms, error? }
  POST /check-proxy   { proxy: {…} }
                       -> { ok, latency_ms, country?, error? }

Auth: header `X-Worker-Token` must equal env `WORKER_TOKEN`.

Deploy this folder on Railway / Fly / any VPS with `python 3.11` and the deps
in `requirements.txt`. See README.md for details.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

from netflix_adapter import activate_tv_code, check_cookie_sync

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("worker")

WORKER_TOKEN = os.getenv("WORKER_TOKEN", "")

app = FastAPI(title="Emberlord Netflix Worker")


def _require_auth(x_worker_token: str) -> None:
    if not WORKER_TOKEN:
        return  # dev fallback
    if not x_worker_token or x_worker_token != WORKER_TOKEN:
        raise HTTPException(status_code=401, detail="Bad worker token")


class CookiePair(BaseModel):
    name: str
    value: str
    domain: Optional[str] = None


class ProxyPayload(BaseModel):
    scheme: str = "http"
    ip: str
    port: str
    username: Optional[str] = None
    password: Optional[str] = None


class CheckRequest(BaseModel):
    cookies: list[CookiePair] = []
    cookie_text: Optional[str] = None
    proxy: Optional[ProxyPayload] = None


class ActivateRequest(BaseModel):
    code: str
    cookies: list[CookiePair] = []
    cookie_text: Optional[str] = None
    proxy: Optional[ProxyPayload] = None


class ProxyCheckRequest(BaseModel):
    proxy: ProxyPayload


def _cookie_dict(pairs: list[CookiePair]) -> dict[str, str]:
    """The uploaded bot modules work on {cookie_name: value} dictionaries."""
    return {c.name: c.value for c in pairs if c.name and c.value}


def _cookie_payload(pairs: list[CookiePair], cookie_text: Optional[str]) -> Any:
    """Accept website cookie pairs, pasted/header text, Netscape text, or JSON text."""
    if cookie_text and cookie_text.strip():
        return cookie_text
    return _cookie_dict(pairs)


def _proxy_url(p: Optional[ProxyPayload]) -> Optional[str]:
    if not p:
        return None
    auth = ""
    if p.username:
        auth = f"{p.username}:{p.password or ''}@"
    return f"{p.scheme}://{auth}{p.ip}:{p.port}"


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "service": "emberlord-netflix-worker"}


@app.post("/check")
async def check(
    body: CheckRequest, x_worker_token: str = Header(default="", alias="X-Worker-Token")
) -> dict:
    _require_auth(x_worker_token)
    cookie_payload = _cookie_payload(body.cookies, body.cookie_text)
    proxy = _proxy_url(body.proxy)
    try:
        result = check_cookie_sync(cookie_payload, proxy)
    except Exception as e:  # pragma: no cover
        log.exception("check_cookie failed")
        return {"status": "unknown", "is_valid": False, "transient": True, "error": str(e)}

    status = str(result.get("status", "invalid")).lower()
    transient = bool(result.get("transient"))
    if transient:
        status = "unknown"
    info = result.get("info") or {}

    return {
        "status": status,
        "is_valid": status == "active",
        "transient": transient,
        "email": info.get("email"),
        "country": info.get("country"),
        "plan_name": info.get("plan") or info.get("plan_name"),
        "video_quality": info.get("video_quality"),
        "name": info.get("name") or info.get("first_name"),
        "member_since": info.get("member_since"),
        "max_streams": info.get("max_streams"),
        "payment_method": info.get("payment_method") or info.get("cardBrand"),
        "error": result.get("error") or info.get("error"),
    }


@app.post("/activate")
async def activate(
    body: ActivateRequest, x_worker_token: str = Header(default="", alias="X-Worker-Token")
) -> dict:
    _require_auth(x_worker_token)
    cookie_payload = _cookie_payload(body.cookies, body.cookie_text)
    proxy = _proxy_url(body.proxy)
    t0 = time.time()
    try:
        # Reuse the exact adapter flow from the uploaded Telegram bot:
        # fast cookie pre-check, proxy-aware activation, and bot status mapping.
        res = activate_tv_code(cookie_payload, body.code, proxy_url=proxy)
    except Exception as e:  # pragma: no cover
        log.exception("activate_tv failed")
        return {
            "status": "worker_error",
            "duration_ms": int((time.time() - t0) * 1000),
            "error": str(e),
        }
    dur_ms = int((time.time() - t0) * 1000)
    if res.get("success"):
        return {"status": "success", "duration_ms": dur_ms}
    err_type = str(res.get("error_type") or "other")
    if err_type in ("invalid_cookie", "session_expired", "blocked", "auth"):
        err_type = "cookie_dead"
    elif err_type == "free_account":
        err_type = "free"
    elif err_type == "on_hold_account":
        err_type = "on_hold"
    elif err_type == "check_failed":
        err_type = "tv8_unavailable"
    elif err_type in ("not_accepted", "expired_code"):
        err_type = "invalid_code"
    return {
        "status": err_type,
        "duration_ms": dur_ms,
        "error": res.get("error") or res.get("message"),
    }


@app.post("/check-proxy")
async def check_proxy(
    body: ProxyCheckRequest, x_worker_token: str = Header(default="", alias="X-Worker-Token")
) -> dict:
    _require_auth(x_worker_token)
    url = _proxy_url(body.proxy)
    if not url:
        return {"ok": False, "error": "empty proxy"}
    t0 = time.time()
    try:
        import httpx

        async with httpx.AsyncClient(proxy=url, timeout=8.0, follow_redirects=True) as client:
            r = await client.get("https://api.ipify.org?format=json")
            data = r.json() if r.status_code == 200 else {}
        return {
            "ok": True,
            "latency_ms": int((time.time() - t0) * 1000),
            "country": None,
            "ip": data.get("ip"),
        }
    except Exception as e:
        return {"ok": False, "latency_ms": int((time.time() - t0) * 1000), "error": str(e)}
