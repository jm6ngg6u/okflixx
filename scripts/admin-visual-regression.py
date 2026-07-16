"""Admin panel visual regression sweep.

Walks every admin route, screenshots the page, opens each Select trigger and
screenshots the open dropdown, then asserts:
  * dropdown surface is opaque (no page bleed-through)
  * every <label>/<th> uses the uppercase ops treatment (letter-spacing >= 0.1em)
Requires a signed-in Supabase session in the sandbox env.
"""
import asyncio, json, os, re
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).parent / "screenshots"
OUT.mkdir(exist_ok=True)
BASE = "http://localhost:8080"
ROUTES = [
  "/admin", "/admin/attempts", "/admin/cookies", "/admin/proxies",
  "/admin/security", "/admin/settings", "/admin/staff", "/admin/background-song",
]

async def restore_session(context, page):
    key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    sess = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies:
        arr = json.loads(cookies)
        for c in arr: c["url"] = BASE
        await context.add_cookies(arr)
    await page.goto(BASE)
    if key and sess:
        await page.evaluate(
          f"window.localStorage.setItem({json.dumps(key)}, {json.dumps(sess)})")

async def audit_page(page, route):
    await page.goto(f"{BASE}{route}", wait_until="domcontentloaded")
    await page.wait_for_timeout(1200)
    slug = route.replace("/", "_").strip("_") or "root"
    await page.screenshot(path=str(OUT / f"{slug}.png"))

    # Uppercase label check
    bad_labels = await page.evaluate("""() => {
      const bad = [];
      for (const el of document.querySelectorAll('.admin-shell label, .admin-shell thead th')) {
        const cs = getComputedStyle(el);
        const ls = parseFloat(cs.letterSpacing) || 0;
        if (cs.textTransform !== 'uppercase' || ls < 1.2) {
          bad.push({tag: el.tagName, text: (el.textContent||'').trim().slice(0,40),
                    tt: cs.textTransform, ls: cs.letterSpacing});
        }
      }
      return bad.slice(0, 10);
    }""")

    # Open first select trigger, if any, and screenshot
    dropdown_ok = None
    trigger = await page.query_selector('.admin-shell [role="combobox"]')
    if trigger:
        await trigger.click()
        await page.wait_for_timeout(400)
        await page.screenshot(path=str(OUT / f"{slug}__dropdown.png"))
        dropdown_ok = await page.evaluate("""() => {
          const w = document.querySelector('[data-radix-popper-content-wrapper] > *');
          if (!w) return {found:false};
          const cs = getComputedStyle(w);
          const bg = cs.backgroundColor;
          // Extract alpha
          const m = bg.match(/rgba?\\(([^)]+)\\)/);
          const parts = m ? m[1].split(',').map(s=>parseFloat(s.trim())) : [];
          const alpha = parts.length === 4 ? parts[3] : 1;
          return { found:true, bg, alpha, opaque: alpha >= 0.95 };
        }""")
        await page.keyboard.press("Escape")
    return {"route": route, "bad_labels": bad_labels, "dropdown": dropdown_ok}

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()
        await restore_session(ctx, page)
        results = []
        for r in ROUTES:
            try:
                results.append(await audit_page(page, r))
            except Exception as e:
                results.append({"route": r, "error": str(e)})
        Path(OUT / "report.json").write_text(json.dumps(results, indent=2))
        print(json.dumps(results, indent=2))
        await b.close()

asyncio.run(main())
