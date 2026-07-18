## Goal

Ship a single, coherent notification system across the admin panel and public site with consistent structure (title + description + icon + action), consistent tone/colors/typography, and admin-controllable toasts for scheduled/manual job completion with Quiet Hours.

Keep it focused — no useless additions. Only what the website actually needs.

---

## 1. Global toast contract (shared)

Formalize the branded shape all toasts already partially follow:

- Title: `font-display`, sentence case, ≤ 48 chars, one line.
- Description: `font-body`, ≤ 120 chars, secondary color, wrapped.
- Variant → color + icon:
  - `success` (emerald), `error` (red), `warning` (amber), `info` (sky), `loading` (neutral).
- Optional `action` (single button, brand red) — used for "View job", "Retry", "Undo".
- Duration: success 4s, info 5s, warning 6s, error 8s, loading = until resolved.
- Position: admin = `top-right`; public site = `top-center` (keep current).

Implementation: extend `src/lib/toast-format.ts` — it already normalizes capitalization and splits `Title · detail`. Add:
- `notify.success/error/warning/info/loading/promise` helpers with the contract above.
- Auto-dedup within 2s for identical `(variant,title,description)` pairs (prevents spam from realtime).
- Read a `quiet_hours` flag from a lightweight client store; when muted, drop `job:*` category toasts silently but still show user-triggered ones.

`Toaster` in `src/routes/__root.tsx` gains a second instance mounted only inside `/admin/*` at `top-right`, so admin/user toasts don't collide.

---

## 2. Audit & normalize every existing toast

Sweep all `toast.*` call sites listed below and rewrite them to `notify.*` with proper title + description + variant. No behavior changes — only structure/copy.

Files touched (already using sonner):
- Public: `routes/index.tsx`, `routes/login.tsx`, `routes/auth.tsx`, `routes/auth.mfa.tsx`, `components/BackgroundSong.tsx`.
- Admin: `routes/admin.index.tsx`, `admin.settings.tsx`, `admin.cookies.tsx`, `admin.proxies.tsx`, `admin.rotation.tsx`, `admin.access.tsx`, `admin.attempts.tsx`, `admin.staff.tsx`, `admin.security.tsx`, `admin.branding.tsx`, `admin.contact.tsx`, `admin.background-song.tsx`, `components/LiveJobsPanel.tsx`, `components/ActivationPipelines.tsx`.

For each: pick correct variant, add description where missing, tag with a category (`job`, `save`, `auth`, `activation`, `pool`, `system`) so Quiet Hours can filter.

---

## 3. Admin notification preferences (new)

New section in `admin.settings.tsx` → "Admin notifications":

Settings persisted in `app_settings`:
- `notify_cookie_check` (bool, default ON) — toast when cookie auto-check finishes.
- `notify_proxy_check` (bool, default ON) — toast when proxy auto-check finishes.
- `notify_nightly_cleanup` (bool, default ON) — toast when nightly cleanup finishes.
- `notify_quiet_start` / `notify_quiet_end` (HH:MM, local time, may wrap midnight; blank = always notify).

UI: three toggle rows + two time inputs with helper text "Leave blank to always notify. Window may wrap midnight." Optimistic save, same pattern as other settings.

---

## 4. Job completion toasts (wired end-to-end)

`src/components/LiveJobsPanel.tsx` already subscribes to `job_runs` realtime. Add a completion detector:

- Detect transition to a terminal state (`success`, `failed`, `cancelled`, `stopped`) for jobs `cookies-autocheck`, `proxies-autocheck`, `auto-cleanup`.
- Respect per-job admin toggle + Quiet Hours (client-side, using saved settings).
- Toast content:
  - Cookie check → title "Cookie auto-check finished", description "Checked N · Active A · Removed R · Took Ts".
  - Proxy check → title "Proxy auto-check finished", description "Checked N · Healthy H · Removed R".
  - Nightly cleanup → title "Nightly cleanup finished", description "Removed R rows".
  - Cancelled → warning variant "Cancelled — changes rolled back".
  - Stopped → info variant "Stopped — partial progress saved".
  - Failed → error variant + first error line + action "View job" (scrolls to job row).
- Dedup key = `job_run.id` so a single completion never fires twice across realtime + poll.

Manual runs go through the same path (they also produce `job_runs` rows), so no separate code path.

---

## 5. Quiet Hours logic

Small pure helper `src/lib/quiet-hours.ts`:
- `isQuiet(now, start, end)` — handles wrap-past-midnight (e.g. 22:00 → 07:00).
- Blank start or end = never quiet.
- Consumed by the notify helper for `category: "job"` toasts only. User actions (save, error, sign-in) always show.

---

## 6. Technical details

- No new tables — three toggles + two time strings in `app_settings`.
- No server changes required for delivery; toasts are client-driven off realtime `job_runs`.
- Types: extend `BrandingMap`/settings types if needed; otherwise plain `app_settings` reads.
- Fonts already global (`--brand-font-display`, `--brand-font-body`); toasts inherit.
- Colors already tokenized in `styles.css`; no new tokens.

---

## Out of scope (intentionally)

- Push/email/webhook notifications — website doesn't need them.
- Per-user notification prefs (single admin surface).
- Notification history/inbox page — realtime + audit logs already cover this.
