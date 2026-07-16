// Browser-only audio reactivity singleton.
// Attaches an HTMLAudioElement once to a shared AudioContext + AnalyserNode
// and exposes cheap per-frame frequency band readings for visual effects.
//
// Safe to import from SSR-reachable modules: everything guards `window`.

export type Levels = {
  bass: number;   // 0..1
  mid: number;    // 0..1
  treble: number; // 0..1
  level: number;  // 0..1 overall loudness
  beat: number;   // 0..1 short-lived spike on kick/bass hits
};

const ZERO: Levels = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0 };

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let data: Uint8Array<ArrayBuffer> | null = null;
let attachedEl: HTMLAudioElement | null = null;

let enabled = false;
let bassAvg = 0;
let beatEnv = 0;
let last: Levels = { ...ZERO };

export function setReactiveEnabled(v: boolean) {
  enabled = v;
  if (!v) {
    last = { ...ZERO };
    bassAvg = 0;
    beatEnv = 0;
  }
}

export function isReactiveEnabled() {
  return enabled;
}

/**
 * Wire the audio element into a shared AudioContext with a studio-mix chain:
 *
 *   source → highpass (rumble cut) → compressor → high-shelf (air) → analyser → destination
 *
 * The compressor keeps bass from swamping the mix and prevents clipping when
 * loud sections hit, while the analyser captures a real frequency spectrum
 * for the reactive background. `crossOrigin="anonymous"` on the audio element
 * is REQUIRED — without it the graph runs but analyser output is zeroed.
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

      // Rumble cut — sub-bass below 40Hz that only muddies the mix.
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 40;
      hp.Q.value = 0.7;

      // Compressor — tames peaks so bass hits punch without distorting.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 24;
      comp.ratio.value = 4;
      comp.attack.value = 0.005;
      comp.release.value = 0.18;

      // High-shelf "air" boost for crisp top-end without hyping the bass.
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
    // createMediaElementSource can only be called once per element; if we hit
    // that path the earlier graph is still valid — leave it alone.
  }
}

/** Resume the audio context on a user gesture (call from click handlers). */
export function resumeAudio() {
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

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
  const bass = b / (bEnd * 255);
  const mid = m / ((mEnd - bEnd) * 255);
  const treble = t / ((bins - mEnd) * 255);
  const level = bass * 0.55 + mid * 0.3 + treble * 0.15;

  // Simple beat detection: bass energy above running average.
  bassAvg = bassAvg * 0.92 + bass * 0.08;
  const spike = Math.max(0, bass - bassAvg - 0.05);
  beatEnv = Math.max(beatEnv * 0.88, spike * 4.5);

  last = { bass, mid, treble, level, beat: Math.min(1, beatEnv) };
  return last;
}
