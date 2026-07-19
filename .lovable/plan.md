# Responsive & Consistency Hardening Plan

Five issues, tackled one by one. No skipped items.

## 1. Fluid icon + red-dot sizing (src/styles.css, src/routes/index.tsx)

Problem: red pulsing dot and card icons are hardcoded (`h-1.5 w-1.5`, fixed SVG sizes) so they don't scale with the kicker/text at TV or small mobile widths.

- Add utility classes in `src/styles.css`:
  - `.kicker-dot` — width/height `clamp(6px, 0.7vw, 10px)` for the solid dot; wrapper matches for the `animate-ping` layer.
  - `.icon-fluid` — `width/height: clamp(20px, 2.4vw, 32px)` for card icons (why-card, step icons, faq numerals).
  - `.icon-fluid-lg` — `clamp(28px, 3vw, 44px)` for hero/CTA icons.
- Swap all hardcoded `h-1.5 w-1.5` dot spans in `index.tsx` to `.kicker-dot`.
- Swap fixed `w-6 h-6` / `w-8 h-8` icon classes inside `.why-card`, step cards, FAQ number badges, and Final Step CTA to `.icon-fluid` / `.icon-fluid-lg`.

## 2. Consistent pulsing red dot on ALL kickers (src/routes/index.tsx)

Currently: Features, Step-by-Step Guide, and FAQ have the dot. Missing on **Live Activation Feed** and **Final Step** kickers (and re-verify Features).

- Insert the same `<span className="relative flex kicker-dot">…animate-ping…</span>` pattern into the LIVE and FINAL STEP kicker pills so all five kickers are visually identical.

## 3. Grid density tuning (src/routes/index.tsx, src/styles.css)

Problem: awkward wrapping — Features jumps 1→2→4 with no tablet step; Step-by-Step is 2→3→5 but the 3-col row on `md` leaves 2 orphan cards; FAQ list is single-column even on desktop where 2-col reads better.

- Features grid: `grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4` (unchanged if already good) — verify gutters use `gap-4 sm:gap-6 lg:gap-8`.
- Step-by-Step: switch to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-5` (drop the awkward 3-col md tier); on `md` keep 2-col but widen container.
- FAQ: `grid-cols-1 lg:grid-cols-2 gap-4` so long question list doesn't run 6-deep on desktop.
- Tighten `.why-card-inner` min-height on tablet with a mid clamp so tablet doesn't show excessive whitespace under short copy.

## 4. Accessibility: contrast + touch targets (src/styles.css, src/routes/index.tsx)

Audit and fix Features + Live Activation Feed:
- Body copy currently `text-white/60` on near-black — bump muted card text to `text-white/70` (WCAG AA at these sizes).
- Kicker `text-[#ff2a3a]` on `#0a0a0c` passes AA large; keep — but add `text-shadow: 0 0 12px rgba(255,42,58,0.35)` only when reduced-motion is off.
- Ensure every interactive element (FAQ accordion trigger, feed row, CTA button) has `min-height: 44px` via a `.tap-44` utility applied on mobile.
- Add `focus-visible` ring using existing red token for accordion triggers and CTA links.

## 5. Playwright responsive regression suite (scripts/responsive-regression.py)

New script covering four viewports:
- Mobile 390×844, Tablet 834×1194, Desktop 1440×900, TV 1920×1080.
- For each viewport: navigate to `/`, screenshot full sections (`#features`, `#how-it-works`, `#faq`, `#live`, `#final-step`), and assert:
  - kicker dot rendered on all five sections (`document.querySelectorAll('.kicker-dot').length >= 5`)
  - no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth + 1`)
  - card min-height within tolerance per breakpoint
  - computed font-size of section titles within expected clamp range
  - tap targets ≥ 44px on mobile only (query buttons + accordion triggers)
- Write `scripts/screenshots/responsive/` PNGs and `report.json` with pass/fail per assertion. Exit non-zero on failure so it can gate future changes.

## Verification

Run in this order after each fix:
1. Typecheck (auto by harness).
2. `python3 scripts/responsive-regression.py` — inspect `report.json` and the four screenshot sets.
3. Manual spot-check: kicker dots identical on all five sections, no orphan grid rows on tablet, FAQ reads as 2-col on desktop, muted body text passes visual contrast.

## Files touched
- `src/styles.css` — fluid icon utilities, tap target utility, muted text bump.
- `src/routes/index.tsx` — kicker dot on LIVE + FINAL STEP, class swaps, grid tier changes.
- `scripts/responsive-regression.py` — new.

Approve to start.