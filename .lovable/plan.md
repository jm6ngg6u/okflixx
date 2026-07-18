# Audio-Reactive Background — Deep Hardening Plan

Goal: make the reactive engine correct, safe, and scalable for 2000+ concurrent visitors, with a clear admin experience. No cosmetic bloat.

## Real issues found (grounded in code)

1. **Live slider = local state only.** In `admin.background-song.tsx` the "Beam intensity" and "Bass sensitivity" sliders update React state but never call `setIntensity()` / `setSensitivity()` from `src/lib/audio-reactive.ts`. Values only take effect after Save + reload. The card even claims "no reload needed" — currently false for these two controls.
2. **Sensitivity not read on public site.** `LiveBackground.tsx` reads `getIntensity()` per frame but never reads `getSensitivity()`; visitors' bass response is stuck at 1× regardless of the admin slider.
3. **Silence auto-fallback is one-way.** `BackgroundSong.tsx` calls `setReactiveEnabled(false)` on 3s silence, but never re-enables when the analyser recovers (e.g. after unmute / URL refresh). Reactive stays STATIC until page reload.
4. **AudioContext leak on iOS Safari.** `createMediaElementSource` throws if called twice on same element; try/catch swallows it but the graph then has no analyser — analyser stays silent, reactive silently dies. No `blocked` status is reported.
5. **No FPS/thermal guard.** On low-end phones the beam loop can drop below 20 fps; there is no auto-downshift (beam count, layer count, blur). At 2000+ users this shows up as janky first-paint on cheap Android.
6. **Tab hidden throttle correct, but `noteFrame()` still ticks at 8 fps hidden** → FPS meter shows misleading "8" in admin. Meter should freeze / mark "hidden".
7. **`reduced-motion` disables beam bob but still runs the loop at 6 fps forever** — fine, but analyser still hits `getByteFrequencyData` unnecessarily. Small CPU waste at scale.
8. **No visibility in admin of what visitors' engines are actually doing** (reactive on/off, silent-fallback rate, avg fps). The bg-heartbeat added last turn only tracks playback, not reactive health.
9. **Admin preview shares the global AudioContext** via `attachAudio(previewEl)` in Live Preview. If admin has main site open in another tab the same MediaElementSource error can fire. Preview should own its own context or be explicitly documented as sharing.
10. **`prefers-reduced-motion` ignored for admin preview** — preview keeps running full-frame even for accessibility users.

## Implementation (one file per fix, no skipped items)

### 1. Wire sliders to live engine (`admin.background-song.tsx`)
- On slider `onChange`, call `setIntensity(v)` / `setSensitivity(v)` from `@/lib/audio-reactive` so admin sees instant response in Live Preview and the change takes effect for visitors on next `getLevels()` tick (already imported client-side via the audio module).
- Keep `onCommit` → server save. No debounce change.

### 2. Public site reads sensitivity (`LiveBackground.tsx`)
- Import `getSensitivity` and multiply the bass/beat contributions by it inside the frame loop (single multiply — no extra allocations). This is the only change to the public renderer.

### 3. Silence recovery (`BackgroundSong.tsx`)
- Track `wantReactive` (admin setting). When `onSilenceChange(false)` fires and `wantReactive` is true, re-enable via `setReactiveEnabled(true)` and clear the "fell back to STATIC" toast state so it can fire again on the next real failure.
- Add a 10s cooldown to avoid oscillation.

### 4. Hardened AudioContext (`audio-reactive.ts`)
- If `new AudioContext()` throws (iOS lockdown / older Safari), set an internal `blocked=true` flag and expose `isAudioBlocked()`. `getLevels()` returns zero without touching a null analyser (already does — keep).
- On `createMediaElementSource` throw when the element already has a source in the WeakMap, reuse the cached node (already works) — but when the *context* is different (e.g. after a suspend/close cycle), rebuild the chain instead of leaving analyser=null.
- Add `detachAudio(el)` for preview unmount (`pause + src="" + disconnect source cleanly`).

### 5. Adaptive quality guard (`LiveBackground.tsx`)
- Rolling 60-frame fps sample already exists via `noteFrame`. Add a lightweight quality controller:
  - fps < 30 for 3s → drop to 2 layers per beam (currently 4) and halve `beamsPerBand`
  - fps < 20 for 3s → freeze bob, keep only base line
  - fps recovers > 50 for 5s → restore
- Store level in a ref; no re-render.

### 6. FPS meter accuracy (`audio-reactive.ts` + admin)
- When `document.hidden` or `reduced-motion` throttled: `noteFrame` skips FPS averaging; getter returns last "active" fps and a flag. Admin card labels it "PAUSED (hidden)" or "REDUCED-MOTION" instead of showing 6/8.

### 7. Skip analyser reads when reactive off (`audio-reactive.ts`)
- Already short-circuits when `enabled=false`. Also short-circuit when `attachedEl.paused` — avoids one FFT copy per frame per visitor with reactive-on but paused audio. Big deal at 2000 concurrent tabs.

### 8. Reactive telemetry (piggyback existing heartbeat)
- Extend the `bgs-heartbeat` payload built last turn with `reactive: boolean`, `reactiveFps: number` (rounded), `analyserSilent: boolean`, `audioBlocked: boolean`. No new endpoint, no new table columns — write into the existing `error` JSON slot only when non-nominal (silent/blocked). Purely additive on the client; server just accepts extra fields.
- Admin card gains a compact "Reactive engine" strip below the master pill: Median FPS · Silent-fallback % · Blocked-context % · Reactive-on % (query already refetches every 2s).

### 9. Admin preview isolation (`admin.background-song.tsx`)
- Preview `<audio>` element stays on the shared context (documented), but on unmount call the new `detachAudio(el)` so leaving the page frees the source and stops analyser reads.
- Respect `prefers-reduced-motion` in preview: show "Reduced-motion active — meters paused" instead of running the analyser loop.

### 10. UI polish (only what improves signal, no bloat)
- The "REACTIVE / STATIC" pill picks up a third state "BLOCKED" when `audioBlocked` is true (iOS lockdown) and a fourth "FALLBACK" when silence auto-disabled. Same admin brand tokens, no new palette.
- Slider rows show a tiny live "×N applied" bubble that pulses when the value differs from the last saved value, so admins see local-vs-saved clearly.

## Not doing (explicitly rejected)
- Per-visitor waveform recording (privacy + bandwidth).
- Additional visualizers / presets (visual bloat, no operational value).
- WebGL/Shader rewrite (not warranted; 2D canvas is fine with the adaptive guard).
- Server-side FFT (unnecessary; browsers do this natively).

## Files touched
- `src/lib/audio-reactive.ts` — blocked flag, detach, paused-skip, FPS accuracy.
- `src/components/LiveBackground.tsx` — read sensitivity, adaptive quality guard.
- `src/components/BackgroundSong.tsx` — silence recovery, heartbeat payload extension.
- `src/routes/admin.background-song.tsx` — live slider wiring, preview detach, reactive telemetry strip, pill states.

## Verification (deep, one by one)
- Slider drag on `/admin/background-song` → beams visibly change in Live Preview within the same frame; visitors on `/` see the same change on next `getLevels()` frame.
- Mute the current track → after ~3s the pill shows FALLBACK; unmute → returns to REACTIVE within 10s cooldown.
- iOS Safari private mode (AudioContext blocked) → pill shows BLOCKED, no console errors, no retry storm.
- Chromium `--enable-features=LowEndDeviceMode` throttled 4x CPU → adaptive guard drops layers within 3s; fps recovers to 50+.
- Playwright script `scripts/reactive-engine-e2e.py` covering the four states above + heartbeat payload assertion.

Approve to start implementation.
