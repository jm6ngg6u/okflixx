Goal: make Maintenance Mode unbypassable, instant on refresh, fully admin-controlled (copy/typography/effects/schedule/timezone), with high-fidelity previews. Ship each item; no filler features.

## 1. Backend enforcement (unbypassable)
- Add `src/lib/maintenance.server.ts`:
  - `assertServiceAvailable()` — reads `app_settings` (maintenance_enabled + scheduled window) via `supabaseAdmin`. If active → throw `Response('Service temporarily unavailable', { status: 503, headers: { 'Retry-After': <seconds-until-end-or-300>, 'Cache-Control': 'no-store' } })`.
- Call it at the top of every activation/renewal handler in `src/lib/activate.functions.ts` (activate, renew, status, key redemption) BEFORE cookie/proxy work, so no state is mutated.
- Public routes under `src/routes/api/public/hooks/*` are cron-only (auto-checks) → leave alone. Public activation server fns are the enforcement surface.
- Staff bypass: none. Admin routes are separate (`/admin/*`) and don't call these fns.

## 2. Kill cached UI flash on refresh
- `getGateConfig` server fn: `setResponseHeaders({ 'Cache-Control': 'no-store, must-revalidate' })` inside handler.
- `src/routes/__root.tsx`: SSR loader already prefetches gate (done last turn). Ensure `staleTime: 0` for `public-gate` query and pass `initialData` from loader so first paint is authoritative. Add `<meta http-equiv="Cache-Control" content="no-store">` to `__root` head for maintenance-affected pages.
- `MaintenanceGate`: render decision uses SSR-primed data synchronously; no `useEffect` gate.

## 3. Countdown w/ timezone + formatted window
- Extend branding keys: `maint_timezone` (IANA, default `UTC`), `maint_time_format` (`24h`|`12h`).
- Admin Branding → Maintenance tab: timezone select (common IANA list) + format toggle.
- `MaintenanceView`: show formatted "Ends: <date, time TZ>" line above/below the live countdown, using `Intl.DateTimeFormat` with the configured tz.
- Admin Settings scheduler already sets start/end (UTC). Display converts to configured tz.

## 4. Per-word font-size control
- Branding schema: add `maint_size_status`, `maint_size_wordmark`, `maint_size_headline`, `maint_size_message`, `maint_size_countdown`, `maint_size_contacts`, `maint_size_footer` (percent 60–160, default 100).
- `MaintenanceView`: multiply each element's base px by the per-element scale × global `maint_font_scale`.
- Admin Branding: one slider per element under "Maintenance → Typography sizes".

## 5. Preview toggles in Admin → Branding
- Identity toggle: Guest vs Signed-in Google user (mock chip: avatar placeholder + `you@gmail.com`).
- Viewport toggle: Mobile (390px) vs Desktop (1280px) frame with scaled iframe-like container using CSS transform + fixed width wrapper.
- Both toggles state-local to Branding page; feed props into `MaintenanceView`.

## 6. Confirm cleanup items already done
- "Staff bypass · open admin" link removed — verify no residual copy.
- Logo shine/flash + wordmark glow: keyframes always-on, toggles in admin already exist — verify defaults ON.
- Admin can edit all maintenance copy — already in `MAINT_MESSAGES`; add the 2 new keys (timezone, format) and 7 size keys.

## 7. Verification
- Typecheck (`tsgo --noEmit`) — must pass.
- Manual: enable maintenance → refresh public route → confirm no flash → confirm `/api/`-adjacent server fn calls throw 503 with the standard message → disable → recovers within poll.

## Technical notes
- Timezone list kept small (~30 common IANAs) to avoid a huge dropdown; free-text fallback allowed.
- 503 body is a stable JSON `{ error: 'service_unavailable', message: 'Service temporarily unavailable' }` so the client can render a consistent toast if a request slips through mid-flip.
- All new branding keys default sensibly so existing installs render unchanged.
- No new dependencies.
