// Browser-only audio reactivity singleton.
// Owns the shared AudioContext + AnalyserNode, tracks live signal levels,
// exposes intensity/sensitivity controls, an FPS meter, and a silence
// detector so the UI can fall back gracefully when CORS or the mute state
// zeroes the analyser output.
//
// Safe to import from SSR-reachable modules: everything guards `window`.

export type Levels = {
  bass: number;   // 0..1
  mid: number;    // 0..1
  treble: number; // 0..1
  level: number;  // 0..1 overall loudness (weighted sum of bands)
  beat: number;   // 0..1 short-lived spike on kick/bass hits
};

const ZERO: Levels = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0 };

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
const sourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
let data: Uint8Array<ArrayBuffer> | null = null;
let attachedEl: HTMLAudioElement | null = null;

let enabled = false;
let intensity = 1;    // visual glow / alpha multiplier
let sensitivity = 1;  // multiplier applied to raw band levels
let bassAvg = 0;
let beatEnv = 0;
let last: Levels = { ...ZERO };

// Silence detection state.
let silenceStart = 0;
let silent = false;
let recoveryFrames = 0; // consecutive frames of valid signal before clearing STATIC (hysteresis).
type BoolSub = (v: boolean) => void;
const silentSubs = new Set<BoolSub>();

/**
 * Reset the silence window. Call when the tab becomes visible again so
 * throttled rAF during a hidden tab can't trip a false 3s silence fallback
 * the instant the user returns.
 */
export function resetSilenceWindow() {
  silenceStart = 0;
  recoveryFrames = 0;
}

// FPS meter.
let fpsFrames = 0;
let fpsSampleAt = 0;
let fps = 60;
let fpsPaused = false; // true when tab hidden or reduced-motion throttles the loop

// AudioContext lockdown (iOS Safari private mode, older browsers).
let audioBlocked = false;
export function isAudioBlocked() { return audioBlocked; }
export function isFpsPaused() { return fpsPaused; }
export function setFpsPaused(v: boolean) {
  if (fpsPaused === v) return;
  fpsPaused = v;
  fpsFrames = 0;
  fpsSampleAt = 0;
}

// ---- Reactivity toggle ---------------------------------------------------

export function setReactiveEnabled(v: boolean) {
  enabled = v;
  if (!v) {
    last = { ...ZERO };
    bassAvg = 0;
    beatEnv = 0;
    silenceStart = 0;
    setSilent(false);
  }
}
export function isReactiveEnabled() {
  return enabled;
}

// ---- Intensity / sensitivity --------------------------------------------

export function setIntensity(v: number) {
  intensity = Math.max(0, Math.min(3, Number.isFinite(v) ? v : 1));
}
export function getIntensity() {
  return intensity;
}
export function setSensitivity(v: number) {
  sensitivity = Math.max(0, Math.min(3, Number.isFinite(v) ? v : 1));
}
export function getSensitivity() {
  return sensitivity;
}

// ---- Silence subscribers -------------------------------------------------

export function onSilenceChange(cb: BoolSub) {
  silentSubs.add(cb);
  return () => { silentSubs.delete(cb); };
}
export function isSilent() {
  return silent;
}
function setSilent(v: boolean) {
  if (silent === v) return;
  silent = v;
  silentSubs.forEach((cb) => { try { cb(v); } catch { /* ignore */ } });
}

// ---- FPS meter -----------------------------------------------------------

/** Called once per animation frame by the visual loop. */
export function noteFrame() {
  if (fpsPaused) return; // hidden tab / reduced-motion: don't skew fps average
  const t = performance.now();
  if (!fpsSampleAt) fpsSampleAt = t;
  fpsFrames++;
  if (t - fpsSampleAt >= 1000) {
    fps = (fpsFrames * 1000) / (t - fpsSampleAt);
    fpsFrames = 0;
    fpsSampleAt = t;
  }
}
export function getFps() {
  return fps;
}

// ---- Audio graph ---------------------------------------------------------

/**
 * Wire an <audio> element into a shared AudioContext with a studio-mix chain:
 *
 *   source → highpass (rumble cut) → compressor → high-shelf (air) → analyser → destination
 *
 * The compressor keeps bass from swamping the mix and prevents clipping when
 * loud sections hit, while the analyser captures a real frequency spectrum
 * for the reactive background. `crossOrigin="anonymous"` on the audio element
 * is REQUIRED — without it the graph runs but analyser output is zeroed
 * (the silence detector will fire and the UI falls back to STATIC).
 */
export function attachAudio(el: HTMLAudioElement) {
  if (typeof window === "undefined") return;
  if (attachedEl === el && source && analyser) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) { audioBlocked = true; return; }
      try {
        ctx = new AC();
      } catch {
        audioBlocked = true;
        return;
      }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    if (attachedEl !== el) {
      try { source?.disconnect(); } catch { /* ignore */ }
      const cached = sourceMap.get(el);
      try {
        source = cached ?? ctx.createMediaElementSource(el);
      } catch {
        // Element already bound to a source in a previous context that got GC'd
        // or was replaced. Reuse the cached node if available; otherwise bail
        // gracefully — analyser stays null and getLevels returns zeros.
        if (cached) source = cached;
        else { audioBlocked = true; return; }
      }
      sourceMap.set(el, source);

      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 40;
      hp.Q.value = 0.7;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 24;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.18;

      const shelf = ctx.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 8000;
      shelf.gain.value = 2.5;

      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      try {
        source.connect(hp);
        hp.connect(comp);
        comp.connect(shelf);
        shelf.connect(analyser);
        analyser.connect(ctx.destination);
      } catch {
        // Node already connected in previous graph — safe to ignore.
      }

      attachedEl = el;
      audioBlocked = false;
    }
  } catch {
    // Any unexpected failure — mark blocked so admin surfaces it.
    audioBlocked = true;
  }
}

/** Detach the analyser from an element. Safe to call on unmount. */
export function detachAudio(el: HTMLAudioElement) {
  if (attachedEl !== el) return;
  try { source?.disconnect(); } catch { /* ignore */ }
  try { analyser?.disconnect(); } catch { /* ignore */ }
  analyser = null;
  data = null;
  attachedEl = null;
  last = { ...ZERO };
  setSilent(false);
}

/** Resume the audio context on a user gesture (call from click handlers). */
export function resumeAudio() {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

// ---- Silence evaluator (pure, testable) ---------------------------------

/** Amplitude below this (weighted-band RMS proxy) counts as silence. */
export const SILENCE_FLOOR = 0.0015;
/** Amplitude above this counts as recovering signal. */
export const RECOVERY_FLOOR = 0.008;
/** Sustained frames above RECOVERY_FLOOR before clearing STATIC. ~100ms at 60fps. */
export const RECOVERY_FRAMES = 6;
/** Milliseconds of continuous silence before flipping to STATIC. */
export const SILENCE_HOLD_MS = 3000;

export type SilenceState = {
  silenceStart: number; // performance.now() when silence began, 0 = none
  recoveryFrames: number;
  silent: boolean;
};

export type SilenceInput = {
  level: number;   // 0..1 weighted band level for this frame
  bass: number;    // 0..1 bass band level
  playing: boolean; // audio actually producing sound (not paused/muted/vol0)
  now: number;     // performance.now()
};

/**
 * Pure state machine for silence detection.
 * - Requires `playing` before counting any silence at all — quiet intros with
 *   paused/muted/volume=0 audio never trigger.
 * - Only recovers after RECOVERY_FRAMES sustained frames above RECOVERY_FLOOR
 *   to prevent flapping on transients.
 */
export function stepSilenceState(prev: SilenceState, input: SilenceInput): SilenceState {
  const { level, bass, playing, now } = input;
  let { silenceStart, recoveryFrames, silent } = prev;

  if (playing && level < SILENCE_FLOOR && bass < SILENCE_FLOOR) {
    recoveryFrames = 0;
    if (!silenceStart) silenceStart = now;
    else if (now - silenceStart > SILENCE_HOLD_MS) silent = true;
  } else if (level > RECOVERY_FLOOR || bass > RECOVERY_FLOOR) {
    recoveryFrames++;
    if (recoveryFrames >= RECOVERY_FRAMES) {
      silenceStart = 0;
      silent = false;
    }
  }
  // else: in the dead zone between floors — hold state, don't count either way.

  return { silenceStart, recoveryFrames, silent };
}

// ---- Frame read ----------------------------------------------------------

/** Called every frame by the animation loop. Cheap when disabled. */
export function getLevels(): Levels {
  if (!enabled || !analyser || !data) return ZERO;
  // If the attached element is paused/muted, don't read the analyser at all —
  // avoids spurious silence-detected events and saves the FFT cost.
  if (attachedEl && (attachedEl.paused || attachedEl.muted || attachedEl.volume <= 0)) {
    // Decay beat envelope so it doesn't stick at a peak.
    beatEnv *= 0.88;
    last = { ...ZERO, beat: Math.min(1, beatEnv) };
    silenceStart = 0;
    if (silent) setSilent(false);
    return last;
  }
  analyser.getByteFrequencyData(data);
  const bins = data.length;
  const bEnd = Math.max(1, Math.floor(bins * 0.08));
  const mEnd = Math.max(bEnd + 1, Math.floor(bins * 0.4));
  let b = 0, m = 0, t = 0;
  for (let i = 0; i < bEnd; i++) b += data[i];
  for (let i = bEnd; i < mEnd; i++) m += data[i];
  for (let i = mEnd; i < bins; i++) t += data[i];

  const s = sensitivity;
  const bass = Math.min(1, (b / (bEnd * 255)) * s);
  const mid = Math.min(1, (m / ((mEnd - bEnd) * 255)) * s);
  const treble = Math.min(1, (t / ((bins - mEnd) * 255)) * s);
  const level = Math.min(1, bass * 0.55 + mid * 0.3 + treble * 0.15);

  // Beat detection: bass energy above running average, scaled by sensitivity.
  bassAvg = bassAvg * 0.92 + bass * 0.08;
  const spike = Math.max(0, bass - bassAvg - 0.05);
  beatEnv = Math.max(beatEnv * 0.88, spike * 4.5);

  last = { bass, mid, treble, level, beat: Math.min(1, beatEnv) };

  // Silence detection — delegated to pure evaluator for testability.
  const playing = !!attachedEl && !attachedEl.paused && !attachedEl.muted && attachedEl.volume > 0;
  const next = stepSilenceState(
    { silenceStart, recoveryFrames, silent },
    { level, bass, playing, now: performance.now() },
  );
  silenceStart = next.silenceStart;
  recoveryFrames = next.recoveryFrames;
  if (next.silent !== silent) setSilent(next.silent);

  return last;
}
