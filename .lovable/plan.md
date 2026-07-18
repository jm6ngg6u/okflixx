# Playback Status — Deep Hardening Plan

The admin "Playback status" card currently just mirrors the `enabled` toggle (`PLAYING` / `OFF`). It does not reflect what 2000+ real visitors' browsers are doing. This plan fixes correctness end-to-end and adds only the signals that matter.

## Problems found

1. **Fake status** — `PLAYING` shows even when zero visitors can play (autoplay blocked, 404 signed URL, silent analyser, out-of-schedule). No admin ever learns their song is dead.
2. **No aggregated telemetry** — `background-song-health.ts` is per-tab only; nothing reaches the admin.
3. **Signed URL expiry** — `/api/public/background-song-audio` returns a 10-min signed URL; long listeners get 403 mid-song. No refresh path recorded.
4. **Retry storm risk** — `bumpBgsRetries` has no backoff cap; a broken track could hammer the endpoint from every visitor.
5. **Quiet-hours edge** — `out_of_schedule` status is not surfaced in admin; admins think playback is broken.
6. **Preview `<audio>` double-fetch** — admin preview and background song may both open a MediaElementSource on the same element on re-render, throwing (currently swallowed but leaves preview mute).
7. **No error visibility** — `recordBgsError` is only in the floating debug panel behind `?bgs-health=1`.
8. **UI/UX** — status pill is a single color; no distinction between "playing muted (autoplay-block)", "playing audible", "waiting for gesture", "quiet hours", "error".

## Implementation (one file per step, no skipped items)

### 1. Backend telemetry endpoint
- New public route `src/routes/api/public/hooks/bgs-heartbeat.ts` — accepts POST `{ status, muted, needsGesture, silent, retries, lastError, activeIndex, duration, currentTime }` from visitors (rate-limited, no PII).
- Aggregates into new table `background_song_events` (existing) via `supabaseAdmin`. Add small migration ONLY if missing columns (`status`, `muted`, `needs_gesture`, `silent`, `error`, `created_at`).
- Admin server fn `getPlaybackTelemetry` in `src/lib/background-song.functions.ts` — returns last 5 min aggregate: total sessions, playing_audible, playing_muted, gesture_wait, quiet_hours, error_rate, top 3 errors.

### 2. Client beacon
- In `src/components/BackgroundSong.tsx`, on every status change (throttled 15s, dedup identical payload), send `navigator.sendBeacon` to the heartbeat endpoint. No cookies, no user id.
- Cap `bumpBgsRetries` at 6 with exponential backoff (2s, 4s, 8s, 16s, 32s, 60s) then park in `error` state until visibility change.
- Refresh signed URL proactively: when `currentTime > duration - 30s` OR every 8 minutes, re-`load()` from `/api/public/background-song-audio` (server already returns a fresh signed URL each hit). Uses the standby `<audio>` element already in the component to avoid an audible gap.

### 3. Fix preview double-source
- `previewRef` audio: guard `attachAudio` so it is never called on the admin preview element (it currently isn't, but add an explicit "no analyser for preview" comment + assert).
- Make preview element unmount cleanly (`pause() + src=""`) when navigating away to avoid orphaned MediaElementSource on the shared context.

### 4. Real "Playback status" card
Replace the single `PLAYING/OFF` pill in `src/routes/admin.background-song.tsx` with:
- **Master state pill**: `OFF` / `SCHEDULED-OFF` (quiet hours active) / `LIVE` (≥1 audible session in last 60s) / `MUTED-ONLY` (all sessions muted / needs gesture) / `DEGRADED` (>20% error rate) / `DOWN` (0 sessions in 5 min while enabled).
- **6 stat tiles** (2s live refresh via `useQuery` refetchInterval): Active listeners, Audible %, Gesture-wait %, Error rate %, Signed-URL refreshes (last hour), Avg current-time drift.
- **Error strip**: top 3 error messages with counts and last-seen; empty state when clean.
- **Quiet-hours banner** when schedule is currently silencing playback (uses existing `isQuietHoursNow`), so admins know PLAYING=SCHEDULED-OFF is intentional.
- Reuse `--brand-*` tokens, uppercase mono labels matching the rest of admin. No new colors invented.

### 5. Resilience hardening in `BackgroundSong.tsx`
- Add `AbortController` around fetch-based checks so a page unload cannot leak.
- Handle `MediaError` code 4 (SRC_NOT_SUPPORTED) by switching to `audio/mpeg` fallback then giving up gracefully (not retrying forever).
- Respect `prefers-reduced-motion` for reactive analyser only, keep audio playing.
- Guard against `AudioContext` failure on iOS Safari — surface `blocked` status instead of throwing.

### 6. Deduplication & rate limits
- Heartbeat endpoint: per-IP 1 request / 10s (leaky bucket in `job_runs`-style memory table `bgs_heartbeat_rate` or reuse existing `activation_attempts` pattern — pick lighter option: in-memory `Map` per worker + `X-Forwarded-For` sample cap of 500/min global).
- Drop payloads if body > 1 KB.

### 7. Verification (deep, one by one)
- Playwright script `scripts/bgs-status-e2e.py` covering: enabled+song present → LIVE, toggled off → OFF within 3s, delete song → DOWN, quiet-hours active → SCHEDULED-OFF, force 404 on audio → DEGRADED and error strip populated, autoplay blocked (Chromium `--autoplay-policy=user-required`) → MUTED-ONLY then LIVE after synthetic click.
- Build + typecheck + `bunx tsgo --noEmit`.

## Not doing (explicitly rejected as low-value)
- Per-user playback history (privacy + noise).
- Waveform preview in admin (visual bloat, no operational value).
- Client-side crossfade between tracks (only one background song supported).
- Volume master slider in admin (browser autoplay policy overrides it anyway).

## Files touched
- `src/routes/api/public/hooks/bgs-heartbeat.ts` (new)
- `src/lib/background-song.functions.ts` (add `getPlaybackTelemetry`)
- `src/lib/background-song-health.ts` (backoff cap, type additions)
- `src/components/BackgroundSong.tsx` (beacon, signed-URL refresh, backoff, error handling)
- `src/routes/admin.background-song.tsx` (new status card + tiles + error strip)
- `scripts/bgs-status-e2e.py` (new)
- Migration: extend `background_song_events` columns if missing.

Approve to start implementation.
