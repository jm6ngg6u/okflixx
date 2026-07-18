// Tiny pub/sub store for background song playback health. Read by the
// floating health panel and any admin/debug UI on the same page.

export type BgsStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "waiting"
  | "stalled"
  | "blocked"
  | "error"
  | "retrying"
  | "out_of_schedule";

export interface BgsHealthState {
  status: BgsStatus;
  currentTime: number;
  duration: number;
  stableUrlActive: boolean;
  stableUrl: string | null;
  lastError: string | null;
  lastErrorAt: number | null;
  retries: number;
  needsGesture: boolean;
  muted: boolean;
  activeIndex: 0 | 1;
  silent: boolean;
  updatedAt: number;
}

const initial: BgsHealthState = {
  status: "idle",
  currentTime: 0,
  duration: 0,
  stableUrlActive: false,
  stableUrl: null,
  lastError: null,
  lastErrorAt: null,
  retries: 0,
  needsGesture: false,
  muted: false,
  activeIndex: 0,
  silent: false,
  updatedAt: Date.now(),
};

let state: BgsHealthState = { ...initial };
const listeners = new Set<() => void>();

export function getBgsHealth(): BgsHealthState {
  return state;
}

export function subscribeBgsHealth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function updateBgsHealth(patch: Partial<BgsHealthState>) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  for (const l of listeners) l();
}

export function recordBgsError(err: unknown) {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : "Unknown error";
  updateBgsHealth({ lastError: msg, lastErrorAt: Date.now() });
}

export const MAX_BGS_RETRIES = 6;

export function bumpBgsRetries() {
  const next = Math.min(state.retries + 1, MAX_BGS_RETRIES + 1);
  state = { ...state, retries: next, updatedAt: Date.now() };
  for (const l of listeners) l();
}

export function resetBgsRetries() {
  if (state.retries === 0) return;
  state = { ...state, retries: 0, updatedAt: Date.now() };
  for (const l of listeners) l();
}

export function bgsRetryBackoffMs(): number {
  // 2s, 4s, 8s, 16s, 32s, 60s
  const seq = [2000, 4000, 8000, 16000, 32000, 60000];
  const idx = Math.min(state.retries, seq.length - 1);
  return seq[idx];
}

export function bgsRetriesExhausted(): boolean {
  return state.retries >= MAX_BGS_RETRIES;
}

