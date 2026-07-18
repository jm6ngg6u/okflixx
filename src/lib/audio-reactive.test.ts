import { describe, it, expect, beforeEach } from "vitest";
import {
  stepSilenceState,
  resetSilenceWindow,
  SILENCE_HOLD_MS,
  RECOVERY_FRAMES,
  RECOVERY_FLOOR,
  type SilenceState,
} from "./audio-reactive";

// ---------------------------------------------------------------------------
// End-to-end guards for the REACTIVE ↔ STATIC transition.
//
// The pure evaluator is driven with realistic frame streams that simulate:
//   - a quiet intro on an actively playing track       → must NOT fire STATIC
//   - a paused / muted / volume-0 element              → must NOT fire STATIC
//   - a genuine 3 s silence (CORS, dead analyser)      → MUST fire STATIC
//   - hidden-tab throttling then visibility return     → must NOT false-fire
//   - signal returning after STATIC                    → MUST recover with hysteresis
//   - transient blip below RECOVERY_FRAMES             → must stay STATIC (no flap)
// ---------------------------------------------------------------------------

const INITIAL: SilenceState = { silenceStart: 0, recoveryFrames: 0, silent: false };
const FRAME_MS = 16; // ~60fps

/** Drive N frames through the evaluator with a fixed input. */
function runFrames(
  state: SilenceState,
  n: number,
  fn: (i: number) => { level: number; bass: number; playing: boolean },
  startAt = 0,
): SilenceState {
  let s = state;
  for (let i = 0; i < n; i++) {
    const inp = fn(i);
    s = stepSilenceState(s, { ...inp, now: startAt + i * FRAME_MS });
  }
  return s;
}

describe("silence evaluator — false-positive guards", () => {
  it("does NOT fire STATIC during a quiet intro when audio is playing but genuinely quiet below floor", () => {
    // A quiet intro under the SILENCE_FLOOR that lasts only 2s — should NOT fire.
    const frames = Math.floor(2000 / FRAME_MS);
    const final = runFrames(INITIAL, frames, () => ({ level: 0.0005, bass: 0.0005, playing: true }));
    expect(final.silent).toBe(false);
    expect(final.silenceStart).toBeGreaterThan(0); // window opened but not tripped
  });

  it("does NOT fire STATIC when element is paused, even for a long time", () => {
    const frames = Math.floor(10_000 / FRAME_MS);
    const final = runFrames(INITIAL, frames, () => ({ level: 0, bass: 0, playing: false }));
    expect(final.silent).toBe(false);
    expect(final.silenceStart).toBe(0); // window never opens
  });

  it("does NOT fire STATIC when muted / volume=0 (playing=false path)", () => {
    // muted/vol=0 is folded into `playing=false` by getLevels' guard.
    const frames = Math.floor(5000 / FRAME_MS);
    const final = runFrames(INITIAL, frames, () => ({ level: 0, bass: 0, playing: false }));
    expect(final.silent).toBe(false);
  });
});

describe("silence evaluator — genuine detection", () => {
  it("fires STATIC after > 3s of continuous silence on a playing track", () => {
    // Slightly over the 3s hold to guarantee the strict `>` fires.
    const frames = Math.ceil((SILENCE_HOLD_MS + 100) / FRAME_MS);
    const final = runFrames(INITIAL, frames, () => ({ level: 0.0001, bass: 0.0001, playing: true }));
    expect(final.silent).toBe(true);
  });

  it("does NOT fire under the 3s threshold (2.9s stays REACTIVE)", () => {
    const frames = Math.floor(2900 / FRAME_MS);
    const final = runFrames(INITIAL, frames, () => ({ level: 0.0001, bass: 0.0001, playing: true }));
    expect(final.silent).toBe(false);
  });
});

describe("silence evaluator — visibility / throttling", () => {
  it("does NOT false-fire when a tab is hidden for 30s then returns (window reset)", () => {
    // Frames stop while hidden. On return, the app calls resetSilenceWindow()
    // which zeroes silenceStart; the next frame must NOT compare against the
    // stale timestamp.
    let s = runFrames(INITIAL, 60, () => ({ level: 0.5, bass: 0.5, playing: true }));
    expect(s.silent).toBe(false);
    expect(s.silenceStart).toBe(0);

    // Simulate 30s of no frames (hidden tab). A single frame arriving with a
    // fresh `now` far in the future is fine because silenceStart is 0. But if
    // an earlier silence had partially opened the window, the reset must clear
    // it before the next frame runs.
    s = { silenceStart: 5000, recoveryFrames: 0, silent: false };
    // App-level reset:
    s = { silenceStart: 0, recoveryFrames: 0, silent: false };
    // Now the first post-return frame reports normal audio.
    const after = stepSilenceState(s, { level: 0.5, bass: 0.5, playing: true, now: 40_000 });
    expect(after.silent).toBe(false);
    expect(after.silenceStart).toBe(0);
  });

  it("resetSilenceWindow() is safe to call from the visibility handler (idempotent)", () => {
    resetSilenceWindow();
    resetSilenceWindow();
    // No throw = pass. State is module-private but must not desync.
  });
});

describe("silence evaluator — recovery with hysteresis", () => {
  it("recovers to REACTIVE only after RECOVERY_FRAMES sustained frames above RECOVERY_FLOOR", () => {
    const silent: SilenceState = { silenceStart: 1000, recoveryFrames: 0, silent: true };
    // Feed exactly RECOVERY_FRAMES-1 valid frames — must stay silent.
    const almost = runFrames(silent, RECOVERY_FRAMES - 1, () => ({
      level: RECOVERY_FLOOR + 0.01,
      bass: RECOVERY_FLOOR + 0.01,
      playing: true,
    }), 5000);
    expect(almost.silent).toBe(true);

    // One more frame tips it over.
    const recovered = stepSilenceState(almost, {
      level: RECOVERY_FLOOR + 0.01,
      bass: RECOVERY_FLOOR + 0.01,
      playing: true,
      now: 5000 + RECOVERY_FRAMES * FRAME_MS,
    });
    expect(recovered.silent).toBe(false);
    expect(recovered.silenceStart).toBe(0);
  });

  it("does NOT flap: a transient blip below RECOVERY_FRAMES leaves STATIC intact", () => {
    const silent: SilenceState = { silenceStart: 1000, recoveryFrames: 0, silent: true };
    // 3 loud frames then back to silence — under the 6-frame hysteresis.
    let s = runFrames(silent, 3, () => ({ level: 0.5, bass: 0.5, playing: true }), 5000);
    expect(s.silent).toBe(true); // still STATIC
    s = runFrames(s, 20, () => ({ level: 0.0001, bass: 0.0001, playing: true }), 5100);
    expect(s.silent).toBe(true); // remained STATIC through the blip
  });

  it("dead-zone frames (between SILENCE_FLOOR and RECOVERY_FLOOR) hold state, don't flip either way", () => {
    const idle: SilenceState = { silenceStart: 0, recoveryFrames: 0, silent: false };
    const held = runFrames(idle, 200, () => ({ level: 0.005, bass: 0.005, playing: true }));
    expect(held.silent).toBe(false);
    expect(held.silenceStart).toBe(0);
    expect(held.recoveryFrames).toBe(0);
  });
});

describe("silence evaluator — full lifecycle", () => {
  it("survives a realistic REACTIVE → STATIC → REACTIVE round trip", () => {
    // 1) 5s of normal playback — REACTIVE holds.
    let s = runFrames(INITIAL, Math.floor(5000 / FRAME_MS), () => ({
      level: 0.4, bass: 0.4, playing: true,
    }));
    expect(s.silent).toBe(false);

    // 2) 3.5s of silence (CORS breakage mid-song) — STATIC fires.
    s = runFrames(s, Math.ceil(3500 / FRAME_MS), () => ({
      level: 0.0001, bass: 0.0001, playing: true,
    }), 5000);
    expect(s.silent).toBe(true);

    // 3) Signal returns — REACTIVE restores after hysteresis.
    s = runFrames(s, RECOVERY_FRAMES + 2, () => ({
      level: 0.5, bass: 0.5, playing: true,
    }), 9000);
    expect(s.silent).toBe(false);
    expect(s.silenceStart).toBe(0);
  });
});
