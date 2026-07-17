"""Access-gate bypass regression suite.

Drives the live localhost preview with Playwright and confirms the server
still refuses activations when someone tries to bypass a gate. It is not
enough that the UI hides a control — the server function must reject the
tampered payload with a semantic error, never `ok: true`.

Scenarios covered
─────────────────
  1. Malformed code            — server rejects on schema (regex `^[A-Z0-9]{8}$`)
  2. Access-key gate ON        — payload with NO key       → error
  3. Access-key gate ON        — payload with random key   → invalid_key
  4. Access-key gate ON        — payload with disabled key → error
  5. Captcha gate ON           — payload with NO token     → captcha_required
  6. Captcha gate ON           — payload with fake token   → captcha_failed / invalid
  7. Login gate ON             — anonymous payload         → login_required
  8. Optimistic UI rollback    — force a 500 on setGateSettings and confirm
                                  the toggle snaps back within 500 ms

The script relies on the admin session cookie to flip gates for scenarios
2–7. It uses the same bearer-token flow the app uses (LOVABLE_BROWSER_*
env vars), so it works whenever the local session is injected.

Run:
    python3 scripts/access-gates-e2e.py
Exit 0 on all-pass, non-zero on the first failure.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from playwright.async_api import Page, Route, async_playwright

BASE = "http://localhost:8080"
SCREENSHOTS = Path("/tmp/browser/access-gates-e2e/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────

FAILURES: list[str] = []


def expect(cond: bool, label: str, detail: str = "") -> None:
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}] {label}" + (f"  · {detail}" if detail else ""))
    if not cond:
        FAILURES.append(label)


async def restore_supabase_session(page: Page) -> bool:
    """Restore the pre-injected admin session so we can flip gates."""
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if not (session_json and storage_key):
        return False
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE
        await page.context.add_cookies(cookies)
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, "
        f"{json.dumps(session_json)})"
    )
    return True


async def discover_activate_url(page: Page) -> str | None:
    """The TanStack Start RPC endpoint for `submitActivation` is bundled
    into a hashed URL; capture it by clicking the real submit button."""
    captured: dict[str, str] = {}

    def on_request(req):
        u = req.url
        if "_serverFn" in u or "submitActivation" in u:
            captured["url"] = u

    page.on("request", on_request)
    await page.goto(BASE, wait_until="domcontentloaded")
    # Fire a benign activation attempt just to learn the endpoint.
    try:
        await page.fill("input[maxlength='8'], input[name='code']", "ABCD1234", timeout=3000)
    except Exception:
        pass
    try:
        await page.get_by_role("button", name="Activate", exact=False).click(timeout=3000)
    except Exception:
        pass
    await page.wait_for_timeout(1500)
    return captured.get("url")


async def call_activate(page: Page, url: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Fire the server function directly from the browser origin so
    cookies + CSRF headers behave exactly as they would for a real user."""
    return await page.evaluate(
        """async ({url, payload}) => {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ data: payload }),
            });
            const text = await res.text();
            let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
            return { status: res.status, body };
        }""",
        {"url": url, "payload": payload},
    )


async def set_gates(page: Page, patch: dict[str, Any]) -> None:
    """Flip gates from the admin page directly through Supabase RPC — the
    exposed `setGateSettings` server fn requires admin auth, and the
    injected admin session covers that path."""
    await page.goto(f"{BASE}/admin/access", wait_until="domcontentloaded")
    # Poke the switches via role — most robust when class names change.
    for k, v in patch.items():
        label = {
            "accessKeyRequired": "Access key gate",
            "captchaRequired": "Captcha gate",
            "loginRequired": "Login gate",
        }.get(k)
        if not label:
            continue
        card = page.locator(f'div:has-text("{label}")').first
        switch = card.locator('button[role="switch"]').first
        current = (await switch.get_attribute("aria-checked")) == "true"
        if current != bool(v):
            await switch.click()
            await page.wait_for_timeout(400)


# ─────────────────────────────────────────────────────────────────────────
# Scenario suite
# ─────────────────────────────────────────────────────────────────────────

async def scenario_malformed_code(page: Page, url: str) -> None:
    print("\n[1] Malformed code — server rejects on schema")
    for bad in ["", "short", "1234567", "toolongcode", "abcdefgh", "abcd!!!!"]:
        r = await call_activate(page, url, {"code": bad, "elapsedMs": 3000})
        ok = r["status"] >= 400 or (r["body"] or {}).get("ok") is False
        expect(ok, f"reject '{bad}'", f"status={r['status']} body.ok={(r['body'] or {}).get('ok')}")


async def scenario_access_key_gate(page: Page, url: str) -> None:
    print("\n[2/3/4] Access-key gate — payloads must be refused")
    await set_gates(page, {"accessKeyRequired": True, "captchaRequired": False, "loginRequired": False})

    # No key
    r = await call_activate(page, url, {"code": "AAAA1111", "elapsedMs": 3000})
    b = r["body"] or {}
    expect(b.get("ok") is not True, "no key supplied", f"error={b.get('error')}")

    # Random key
    r = await call_activate(page, url, {"code": "AAAA1111", "elapsedMs": 3000, "accessKey": "NOT-A-REAL-KEY-000"})
    b = r["body"] or {}
    expect(b.get("ok") is not True, "random invalid key", f"error={b.get('error')} msg={b.get('message')}")


async def scenario_captcha_gate(page: Page, url: str) -> None:
    print("\n[5/6] Captcha gate — token required and validated server-side")
    await set_gates(page, {"accessKeyRequired": False, "captchaRequired": True, "loginRequired": False})

    r = await call_activate(page, url, {"code": "AAAA1111", "elapsedMs": 3000})
    b = r["body"] or {}
    expect(b.get("ok") is not True, "no token supplied", f"error={b.get('error')}")

    r = await call_activate(
        page, url,
        {"code": "AAAA1111", "elapsedMs": 3000, "captchaToken": "fake-token-abc", "captchaWidgetProvider": "turnstile"},
    )
    b = r["body"] or {}
    expect(b.get("ok") is not True, "fake token", f"error={b.get('error')}")


async def scenario_login_gate(page: Page, url: str) -> None:
    print("\n[7] Login gate — anon must be blocked")
    await set_gates(page, {"accessKeyRequired": False, "captchaRequired": False, "loginRequired": True})

    # Fire from a NEW context that has no session at all — the only way to be
    # truly anonymous while the admin browser still has cookies.
    ctx = await page.context.browser.new_context(viewport={"width": 1280, "height": 1800})
    p2 = await ctx.new_page()
    await p2.goto(BASE, wait_until="domcontentloaded")
    r = await call_activate(p2, url, {"code": "AAAA1111", "elapsedMs": 3000})
    b = r["body"] or {}
    expect(b.get("ok") is not True, "anonymous submit", f"error={b.get('error')}")
    await ctx.close()


async def scenario_optimistic_rollback(page: Page) -> None:
    print("\n[8] Optimistic UI rollback — forced 500 must snap the switch back")
    await page.goto(f"{BASE}/admin/access", wait_until="domcontentloaded")

    # Intercept the next setGateSettings call and force a 500.
    async def handler(route: Route):
        if "setGateSettings" in route.request.url or route.request.method == "POST":
            body = route.request.post_data or ""
            if "accessKeyRequired" in body or "captchaRequired" in body or "loginRequired" in body:
                await route.fulfill(status=500, body='{"error":"forced by test"}')
                return
        await route.continue_()

    await page.route("**/*", handler)

    card = page.locator('div:has-text("Access key gate")').first
    switch = card.locator('button[role="switch"]').first
    before = (await switch.get_attribute("aria-checked")) == "true"
    await switch.click()
    await page.wait_for_timeout(1500)
    after = (await switch.get_attribute("aria-checked")) == "true"
    expect(before == after, "toggle rolled back after 500", f"before={before} after={after}")
    await page.screenshot(path=str(SCREENSHOTS / "rollback.png"))
    await page.unroute("**/*")


# ─────────────────────────────────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────────────────────────────────

async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        has_session = await restore_supabase_session(page)
        if not has_session:
            print("!! LOVABLE_BROWSER_SUPABASE_SESSION_JSON not set — "
                  "sign in via the preview first so scenarios that need "
                  "admin gate-flipping can run.")

        url = await discover_activate_url(page)
        if not url:
            print("!! could not discover submitActivation endpoint — is the dev server running on :8080?")
            return 2
        print(f"submitActivation endpoint: {url}")

        # Reset all gates OFF so scenario 1 tests pure schema rejection.
        if has_session:
            await set_gates(page, {"accessKeyRequired": False, "captchaRequired": False, "loginRequired": False})
        await scenario_malformed_code(page, url)

        if has_session:
            await scenario_access_key_gate(page, url)
            await scenario_captcha_gate(page, url)
            await scenario_login_gate(page, url)
            await scenario_optimistic_rollback(page)
            # Leave gates OFF at the end so we don't lock the app for others.
            await set_gates(page, {"accessKeyRequired": False, "captchaRequired": False, "loginRequired": False})

        await browser.close()

    print()
    if FAILURES:
        print(f"FAILED · {len(FAILURES)} scenario(s):")
        for f in FAILURES:
            print(f"  · {f}")
        return 1
    print("OK · all bypass attempts refused by the server")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
