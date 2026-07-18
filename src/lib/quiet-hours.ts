// Quiet Hours helper — pure, no side effects.
//
// Rules (verified against 8 edge cases):
//   1. Blank start or blank end        → never quiet (always notify).
//   2. Invalid HH:MM                    → never quiet.
//   3. start == end                     → never quiet (zero-width window).
//   4. start < end (non-wrap)           → quiet when start <= now < end.
//   5. start > end (wraps midnight)     → quiet when now >= start OR now < end.
//   6. Boundary at start                → inclusive (quiet).
//   7. Boundary at end                  → exclusive (not quiet).
//   8. Midnight (00:00 inside wrap)     → correctly quiet when wrap covers it.

function parseHHMM(s: string | undefined | null): number | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export function isQuietHours(
  now: Date,
  start: string | undefined | null,
  end: string | undefined | null,
): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s == null || e == null) return false;
  if (s === e) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

export function isQuietHoursNow(
  start: string | undefined | null,
  end: string | undefined | null,
): boolean {
  return isQuietHours(new Date(), start, end);
}
