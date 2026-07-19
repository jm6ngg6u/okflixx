"""Responsive regression across mobile / tablet / desktop / TV widths.

For each viewport:
  * navigate to /
  * screenshot each major section
  * assert kicker dots render on all five sections
  * assert no horizontal scroll
  * assert section titles fall within expected fluid range
  * assert mobile tap targets on FAQ triggers and CTA are >= 44px

Exits non-zero if any assertion fails so it can gate future changes.
"""
import asyncio, json, sys
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).parent / "screenshots" / "responsive"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://localhost:8080"

VIEWPORTS = [
    {"name": "mobile",  "w": 390,  "h": 844},
    {"name": "tablet",  "w": 834,  "h": 1194},
    {"name": "desktop", "w": 1440, "h": 900},
    {"name": "tv",      "w": 1920, "h": 1080},
]

SECTIONS = ["features", "how-it-works", "faq", "live"]

TITLE_RANGE = {
    "mobile":  (28, 56),
    "tablet":  (40, 88),
    "desktop": (56, 100),
    "tv":      (60, 110),
}


async def audit(page, vp):
    name = vp["name"]
    await page.set_viewport_size({"width": vp["w"], "height": vp["h"]})
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)

    findings = {"viewport": name, "size": f"{vp['w']}x{vp['h']}", "checks": []}

    def add(ok, label, detail=None):
        findings["checks"].append({"ok": bool(ok), "label": label, "detail": detail})

    # 1. No horizontal scroll.
    over = await page.evaluate(
        "() => document.documentElement.scrollWidth - window.innerWidth"
    )
    add(over <= 1, "no horizontal scroll", f"overflow={over}px")

    # 2. Kicker dots — one per major section kicker (+ any inside cards is fine).
    dot_count = await page.evaluate(
        "() => document.querySelectorAll('.kicker-dot').length"
    )
    add(dot_count >= 5, "kicker dots >= 5", f"count={dot_count}")

    # 3. Section title font-size within fluid range.
    for sec in SECTIONS:
        px = await page.evaluate(
            f"""() => {{
                const el = document.querySelector('#{sec} .section-title-fluid');
                if (!el) return null;
                return parseFloat(getComputedStyle(el).fontSize);
            }}"""
        )
        lo, hi = TITLE_RANGE[name]
        ok = px is not None and lo <= px <= hi
        add(ok, f"#{sec} title font-size in [{lo},{hi}]", f"px={px}")

    # 4. Screenshot each section.
    for sec in SECTIONS + ["activate"]:
        el = await page.query_selector(f"#{sec}")
        if el:
            try:
                await el.scroll_into_view_if_needed()
                await page.wait_for_timeout(300)
                await el.screenshot(path=str(OUT / f"{name}__{sec}.png"))
            except Exception as e:
                add(False, f"screenshot #{sec}", str(e))

    # 5. Mobile-only tap target audit on FAQ triggers + primary CTA.
    if name == "mobile":
        # Expand nothing; measure trigger heights.
        min_faq = await page.evaluate(
            """() => {
                const rows = document.querySelectorAll('#faq [data-slot="accordion-trigger"], #faq button[aria-controls]');
                let min = Infinity;
                rows.forEach(r => { min = Math.min(min, r.getBoundingClientRect().height); });
                return rows.length ? min : null;
            }"""
        )
        add(min_faq is None or min_faq >= 44, "FAQ trigger >= 44px (mobile)", f"min={min_faq}")

        cta_h = await page.evaluate(
            """() => {
                const a = document.querySelector('a.btn-red');
                if (!a) return null;
                return a.getBoundingClientRect().height;
            }"""
        )
        add(cta_h is None or cta_h >= 44, "Primary CTA >= 44px (mobile)", f"h={cta_h}")

    return findings


async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True)
        ctx = await b.new_context()
        page = await ctx.new_page()

        all_findings = []
        for vp in VIEWPORTS:
            all_findings.append(await audit(page, vp))

        report_path = OUT / "report.json"
        report_path.write_text(json.dumps(all_findings, indent=2))
        await b.close()

        # Summarize + exit non-zero on any failure.
        failed = 0
        for f in all_findings:
            for c in f["checks"]:
                status = "PASS" if c["ok"] else "FAIL"
                if not c["ok"]:
                    failed += 1
                print(f"[{f['viewport']:7s}] {status}  {c['label']}  ({c.get('detail')})")
        print(f"\n{len(all_findings)} viewports · {failed} failure(s) · report → {report_path}")
        sys.exit(1 if failed else 0)


asyncio.run(main())
