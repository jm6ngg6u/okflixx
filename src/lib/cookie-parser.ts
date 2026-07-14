// Cookie blob parser — handles JSON exports (EditThisCookie, Cookie-Editor),
// Netscape tab-separated format, and header-style "a=b; c=d" strings.
// ZIP files must be extracted client-side before calling upload; jszip is available.

import { createHash } from "crypto";

export type CookiePair = { name: string; value: string; domain?: string };

const NETFLIX_COOKIE_KEYS = ["NetflixId", "SecureNetflixId", "nfvdid", "OptanonConsent"];

export function parseCookieBlob(raw: string): CookiePair[] {
  raw = raw.trim();
  if (!raw) return [];

  // JSON array (EditThisCookie / Cookie-Editor export) or bot-style cookie dict.
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw);
      if (j && !Array.isArray(j) && NETFLIX_COOKIE_KEYS.some((key) => typeof j[key] === "string")) {
        return NETFLIX_COOKIE_KEYS
          .map((key) => ({ name: key, value: String(j[key] ?? "") }))
          .filter((c) => c.value);
      }

      const arr = Array.isArray(j) ? j : Array.isArray(j.cookies) ? j.cookies : [];
      return arr
        .map((c: any) => ({
          name: String(c.name ?? c.Name ?? ""),
          value: String(c.value ?? c.Value ?? ""),
          domain: c.domain ?? c.Domain,
        }))
        .filter((c: CookiePair) => c.name && c.value);
    } catch {
      /* fall through */
    }
  }

  const out: CookiePair[] = [];
  const lines = raw.split(/\r?\n/);

  // Netscape: domain \t flag \t path \t secure \t expiry \t name \t value
  if (lines.some((l) => l.split("\t").length >= 7)) {
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      out.push({
        domain: parts[0],
        name: parts[5],
        value: parts.slice(6).join("\t"),
      });
    }
    return out.filter((c) => c.name && c.value);
  }

  // Header style: "a=1; b=2; c=3" (possibly multi-line)
  const flat = raw.replace(/\n/g, "; ");
  for (const seg of flat.split(";")) {
    const eq = seg.indexOf("=");
    if (eq < 1) continue;
    const name = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    if (name && value) out.push({ name, value });
  }
  return out;
}

export function fingerprintOf(pairs: CookiePair[]): string {
  // Mirrors netflix_adapter.py: dedupe by the "pg=" segment inside NetflixId,
  // which uniquely identifies the account. Falls back to a stable hash of all
  // pairs when NetflixId isn't present.
  const netflixId = pairs.find((c) => c.name === "NetflixId")?.value ?? "";
  let decoded = netflixId;
  try {
    decoded = decodeURIComponent(netflixId);
  } catch {
    decoded = netflixId;
  }
  const pg = decoded.match(/pg[=%3D]+([^&"'\s;]+)/i)?.[1] ?? netflixId.slice(0, 60);
  const key = pg
    ? `pg=${pg}`
    : pairs
        .map((c) => `${c.name}=${c.value}`)
        .sort()
        .join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function hasNetflixAuthCookie(pairs: CookiePair[]): boolean {
  return pairs.some((cookie) => cookie.name === "NetflixId" || cookie.name === "SecureNetflixId");
}
