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
type BoolSub = (v: boolean) => void;
const silentSubs = new Set<BoolSub>();

// FPS meter.
let fpsFrames = 0;
let fpsSampleAt = 0;
let fps = 60;

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
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    if (attachedEl !== el) {
      source = ctx.createMediaElementSource(el);

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

      source.connect(hp);
      hp.connect(comp);
      comp.connect(shelf);
      shelf.connect(analyser);
      analyser.connect(ctx.destination);

      attachedEl = el;
    }
  } catch {
    // createMediaElementSource may only be called once per element; if we hit
    // that path the earlier graph is still valid — leave it alone.
  }
}

/** Resume the audio context on a user gesture (call from click handlers). */
export function resumeAudio() {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

// ---- Frame read ----------------------------------------------------------

/** Called every frame by the animation loop. Cheap when disabled. */
export function getLevels(): Levels {
  if (!enabled || !analyser || !data) return ZERO;
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

  // Silence detection — only meaningful while the audio is actually playing.
  const playing = !!attachedEl && !attachedEl.paused && !attachedEl.muted && attachedEl.volume > 0;
  const now = performance.now();
  if (playing && level < 0.002 && bass < 0.002) {
    if (!silenceStart) silenceStart = now;
    else if (now - silenceStart > 3000) setSilent(true);
  } else if (level > 0.01 || bass > 0.01) {
    silenceStart = 0;
    setSilent(false);
  }

  return last;
}
