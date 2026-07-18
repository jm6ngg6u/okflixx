// Post-login redirect: preserve intended destination across Google OAuth.
// The Google flow returns to `window.location.origin` (i.e. "/"), so the
// intended path is stashed in sessionStorage before sign-in and consumed
// on SIGNED_IN by a root-level listener.
import { z } from "zod";

const KEY = "emberlord.postLoginRedirect";

// Only allow same-origin absolute paths ("/foo/bar"). Reject external URLs,
// protocol-relative "//evil.com", and the login/auth pages themselves.
export function sanitizeRedirect(input: string | undefined | null): string | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//")) return null;
  if (v.startsWith("/login") || v.startsWith("/auth")) return null;
  // Keep it short; reject anything with a newline / control char.
  if (v.length > 512 || /[\r\n\t]/.test(v)) return null;
  return v;
}

export function stashRedirect(target: string | null | undefined) {
  const safe = sanitizeRedirect(target);
  if (typeof window === "undefined") return;
  try {
    if (safe) sessionStorage.setItem(KEY, safe);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function consumeRedirect(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return sanitizeRedirect(v);
  } catch {
    return null;
  }
}

export function peekRedirect(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeRedirect(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export const loginSearchSchema = z.object({
  redirect: z.string().optional().transform((v) => sanitizeRedirect(v) ?? undefined),
});
