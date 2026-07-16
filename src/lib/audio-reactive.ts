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
    // createMediaElementSource can be called only ONCE per element. If we've
    // already wired up this element previously, the analyser is still valid.
    if (attachedEl !== el) {
      source = ctx.createMediaElementSource(el);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      source.connect(analyser);
      analyser.connect(ctx.destination);
      attachedEl = el;
    }
  } catch {
    // Already-connected element or unsupported browser — leave prior graph intact.
  }
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
