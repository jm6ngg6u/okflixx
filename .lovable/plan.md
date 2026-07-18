## Branding Studio — new admin surface

A new **/admin/branding** menu that lets you rewrite every public string, swap fonts, and tune visual effects site-wide. Changes hit the live site within ~2 seconds (Supabase realtime + 2s poll fallback), no rebuild.

### What you can control

**Identity**
- Brand name (split into two parts, e.g. `EMBER` + `LORD`) — used in nav, footer, hero micro-label, browser tab
- Tagline / meta description
- Footer legal line

**Messages** (every headline and CTA on `/`)
- Hero headline + sub-headline
- "Enter TV Code" card title + helper text
- Section titles: *Built for 2026*, plan title + price line, *Every screen. One code.*, testimonials line, final CTA
- Success overlay title (`You're in.`) and receipt copy
- Generic error banner text (verification / activation failure)

**Typography**
- Display font, Body font, Mono font — pick from a curated Google Fonts list (Sora, Inter, Work Sans, Space Grotesk, Manrope, Outfit, Bricolage Grotesque, JetBrains Mono, IBM Plex Mono, etc.)
- Per-family weight (400 – 800)
- Global letter-spacing scale
- Font is loaded automatically via an injected `<link>` in `__root` head-content when the value changes

**Effects**
- Brand accent color (hex → CSS var `--brand-accent`, replaces the hard-coded `#ff2a3a`)
- Glow intensity 0–100 (drives `--brand-glow-strength` used by `.text-shine`, buttons, logo halo)
- Shine sweep speed (slow / medium / fast / off)
- Letter-spacing tightness (tight / normal / loose)
- Optional pulsing halo behind the wordmark

### How it works

```text
app_settings (branding_* keys)
     │
     ├─ getPublicBranding()  ── anon read, 2s cache
     │        │
     │        ▼
     │   BrandingProvider (root)
     │        ├─ writes CSS vars to :root  (accent, glow, spacing, --font-*)
     │        ├─ injects Google Fonts <link> for chosen families
     │        └─ exposes useBrand() → strings map with hard-coded fallbacks
     │
     └─ setBranding()  ── admin-only, per-key upsert + audit log
              │
              ▼
        realtime notify → all open tabs refetch instantly
```

- Fallback defaults live in code, so a wiped row never breaks the site.
- Admin edits are optimistic with rollback on error, mirroring the contact page.
- Live preview card on the admin page renders the hero, CTA and success overlay with the values you're typing before you save.

### Files

- **New** `src/lib/branding.functions.ts` — `getPublicBranding`, `listBranding` (admin), `setBranding` (admin), `resetBranding` (admin)
- **New** `src/lib/branding-context.tsx` — `<BrandingProvider>`, `useBrand()`, font-link injector, CSS-var applier, realtime subscription
- **New** `src/routes/admin.branding.tsx` — 4-tab UI (Identity · Messages · Typography · Effects) + live preview panel
- **Edit** `src/routes/__root.tsx` — mount `<BrandingProvider>` inside `RootComponent`
- **Edit** `src/routes/index.tsx` — swap hard-coded strings/accent for `useBrand()` values with fallbacks (nav wordmark, hero, sections, footer, success overlay)
- **Edit** `src/routes/admin.tsx` — add "Branding" entry to admin nav
- **Edit** `src/styles.css` — replace hard-coded `#ff2a3a` and glow constants with CSS vars, keep visual defaults identical when vars are unset

### Data model

No migration required. Uses existing `app_settings (key text pk, value text)` with keys prefixed `branding_*`:
`branding_name_prefix`, `branding_name_suffix`, `branding_tagline`, `branding_hero_headline`, … `branding_font_display`, `branding_font_body`, `branding_font_mono`, `branding_accent_hex`, `branding_glow`, `branding_shine_speed`, `branding_letter_spacing`.

### Guardrails

- Every string has a hard-coded default; missing/blank rows fall back automatically.
- Font family list is whitelisted; free-text is stripped to alphanumerics + spaces before injection.
- Accent hex is validated (`^#[0-9a-f]{6}$`) before being written to CSS vars.
- All writes go through an admin-only server fn and are recorded in `admin_activity_log` with prefix `branding.*`.
- Realtime + 2s polling; if realtime is unavailable the poll still catches changes.

### Out of scope for this pass

- Per-page/per-language variants (single global set for now)
- Rich-text/markdown for messages (plain text only, kept for safety)
- Image/logo swap (already covered by existing favicon flow)

Confirm and I'll build it end-to-end in the next turn.