// Access-gate system: admin key management + public redemption + gate config.
// Three key types: unlimited (bulk), single_use (one redeemer, IP+FP locked),
// session_24h (unlocks the browser for 24h via server-issued session token).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

// --- utilities (Web Crypto — works on Cloudflare Workers, Node, and won't
// pull node:crypto into the client bundle when this module is scanned by
// the server-fn plugin) ---
async function sha256(v: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function ipSalt(): string {
  return process.env.SUPABASE_PROJECT_ID ?? "emberlord";
}

// NFX-XXXX-XXXX-XXXX (20 chars incl. dashes). Alphabet excludes look-alikes.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateKeyCode(): string {
  const bytes = randomBytes(12);
  const chars: string[] = [];
  for (let i = 0; i < 12; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  return `NFX-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}


function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

async function requireAdmin(ctx: any): Promise<string> {
  const { supabase, userId } = ctx;
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Forbidden");
  return userId as string;
}

// ==========================================================================
// PUBLIC — gate config (safe to expose)
// ==========================================================================
export const getGateConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", [
      "access_key_required",
      "captcha_required",
      "login_required",
      "captcha_provider",
      "captcha_site_key",
      "maintenance_enabled",
      "maintenance_message",
    ]);
  const m: Record<string, string> = {};
  for (const row of data ?? []) m[row.key] = row.value;
  return {
    accessKeyRequired: m.access_key_required === "1",
    captchaRequired: m.captcha_required === "1",
    loginRequired: m.login_required === "1",
    captchaProvider: (m.captcha_provider || "turnstile") as "turnstile" | "hcaptcha",
    captchaSiteKey: m.captcha_site_key || "",
    maintenance: m.maintenance_enabled === "1",
    maintenanceMessage: m.maintenance_message || "",
  };
});

// ==========================================================================
// PUBLIC — redeem a key. Returns a session token if key_type is session_24h.
// ==========================================================================
const RedeemInput = z.object({
  code: z.string().min(4).max(64),
  fingerprint: z.string().min(4).max(256),
});

export const redeemAccessKey = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RedeemInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = normalizeCode(data.code);
    const codeHash = await sha256(code);
    const fpHash = await sha256(data.fingerprint);

    const rawIp =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      getRequestIP({ xForwardedFor: true }) ??
      "unknown";
    const ipHash = await sha256(`${ipSalt()}:${rawIp}`);
    const userAgent = getRequestHeader("user-agent")?.slice(0, 500) ?? null;

    const { data: rows, error } = await supabaseAdmin.rpc("consume_access_key", {
      _code_hash: codeHash,
      _ip_hash: ipHash,
      _fingerprint_hash: fpHash,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;

    await supabaseAdmin.from("access_key_redemptions").insert({
      key_id: row?.key_id ?? null,
      code_prefix: code.slice(0, 8),
      ip_hash: ipHash,
      fingerprint_hash: fpHash,
      user_agent: userAgent,
      success: !!row?.ok,
      reason: row?.reason ?? "unknown",
    });

    if (!row?.ok) {
      return { ok: false as const, reason: row?.reason ?? "invalid_key" };
    }

    // For session_24h keys, issue an opaque token bound to IP+FP.
    if (row.key_type === "session_24h") {
      const token = `sess_${toBase64Url(randomBytes(24))}`;
      const tokenHash = await sha256(token);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabaseAdmin.from("access_sessions").insert({
        session_token_hash: tokenHash,
        key_id: row.key_id,
        ip_hash: ipHash,
        fingerprint_hash: fpHash,
        expires_at: expiresAt,
      });

      return {
        ok: true as const,
        keyType: "session_24h" as const,
        sessionToken: token,
        expiresAt,
        remainingUses: row.remaining_uses ?? -1,
      };
    }

    return {
      ok: true as const,
      keyType: row.key_type as "unlimited" | "single_use",
      remainingUses: row.remaining_uses ?? -1,
    };
  });

// ==========================================================================
// INTERNAL — used by submitActivation. Verifies a key OR a live 24h session.
// Not exported as a server fn; call from server.
// ==========================================================================
export async function verifyAccessCredentials(
  supabaseAdmin: any,
  opts: {
    code?: string | null;
    sessionToken?: string | null;
    fingerprint: string;
    ipHash: string;
  },
): Promise<
  | { ok: true; keyId: string | null; via: "key" | "session" }
  | { ok: false; reason: string }
> {
  const fpHash = await sha256(opts.fingerprint);

  // Prefer session token if present (24h mode).
  if (opts.sessionToken) {
    const tokenHash = await sha256(opts.sessionToken);
    const { data: sess } = await supabaseAdmin
      .from("access_sessions")
      .select("id, key_id, ip_hash, fingerprint_hash, expires_at")
      .eq("session_token_hash", tokenHash)
      .maybeSingle();
    if (!sess) return { ok: false, reason: "session_invalid" };
    if (new Date(sess.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: "session_expired" };
    }
    if (sess.fingerprint_hash !== fpHash) return { ok: false, reason: "session_mismatch" };
    // NOTE: IP hash is NOT enforced strictly (mobile networks change IPs);
    // fingerprint match is the binding.
    await supabaseAdmin
      .from("access_sessions")
      .update({ uses_count: (sess as any).uses_count != null ? (sess as any).uses_count + 1 : 1 })
      .eq("id", sess.id);
    return { ok: true, keyId: sess.key_id, via: "session" };
  }

  if (opts.code) {
    const code = normalizeCode(opts.code);
    const { data: rows } = await supabaseAdmin.rpc("consume_access_key", {
      _code_hash: await sha256(code),
      _ip_hash: opts.ipHash,
      _fingerprint_hash: fpHash,
    });

    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.ok) return { ok: false, reason: row?.reason ?? "invalid_key" };
    return { ok: true, keyId: row.key_id, via: "key" };
  }

  return { ok: false, reason: "missing_credentials" };
}

// ==========================================================================
// INTERNAL — Cloudflare Turnstile / hCaptcha server-side verify.
// Returns detailed diagnostics AND writes a redacted log row so admins
// can inspect failure reasons in /admin/access without exposing the
// user's raw captcha token or the server-side secret.
// ==========================================================================
export type CaptchaVerifyResult = {
  ok: boolean;
  reason?: string;
  errorCodes?: string[];
  hostname?: string | null;
  challengeTs?: string | null;
  httpStatus?: number;
  latencyMs?: number;
};

export async function verifyCaptcha(
  provider: "turnstile" | "hcaptcha",
  token: string,
  remoteIp?: string,
  logMeta?: {
    purpose?: "activate" | "admin_test";
    ipHash?: string | null;
    userAgent?: string | null;
  },
): Promise<CaptchaVerifyResult> {
  const secret =
    provider === "hcaptcha"
      ? process.env.HCAPTCHA_SECRET
      : process.env.TURNSTILE_SECRET;
  const started = Date.now();
  const purpose = logMeta?.purpose ?? "activate";
  const tokenLen = token?.length ?? 0;
  const tokenPrefix = (token ?? "").slice(0, 6);

  const writeLog = async (row: {
    success: boolean;
    reason?: string;
    error_codes?: string[];
    http_status?: number | null;
    hostname?: string | null;
    challenge_ts?: string | null;
  }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("captcha_verify_log").insert({
        provider,
        purpose,
        success: row.success,
        error_codes: row.error_codes ?? [],
        reason: row.reason ?? null,
        http_status: row.http_status ?? null,
        latency_ms: Date.now() - started,
        token_length: tokenLen,
        token_prefix: tokenPrefix || null,
        hostname: row.hostname ?? null,
        challenge_ts: row.challenge_ts ?? null,
        ip_hash: logMeta?.ipHash ?? null,
        user_agent: logMeta?.userAgent ?? null,
      });
    } catch (e) {
      console.warn("[captcha] log insert failed", (e as any)?.message);
    }
  };

  if (!secret) {
    await writeLog({ success: false, reason: "captcha_secret_missing" });
    return { ok: false, reason: "captcha_secret_missing" };
  }
  if (!token) {
    await writeLog({ success: false, reason: "empty_token", error_codes: ["missing-input-response"] });
    return { ok: false, reason: "empty_token", errorCodes: ["missing-input-response"] };
  }

  const url =
    provider === "hcaptcha"
      ? "https://hcaptcha.com/siteverify"
      : "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetch(url, { method: "POST", body });
    const j = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
      hostname?: string;
      challenge_ts?: string;
    };
    const errorCodes = j["error-codes"] || [];
    const hostname = j.hostname ?? null;
    const challengeTs = j.challenge_ts ?? null;
    const latencyMs = Date.now() - started;
    if (!j.success) {
      const reason = errorCodes.join(",") || "captcha_failed";
      await writeLog({
        success: false,
        reason,
        error_codes: errorCodes,
        http_status: res.status,
        hostname,
        challenge_ts: challengeTs,
      });
      return { ok: false, reason, errorCodes, hostname, challengeTs, httpStatus: res.status, latencyMs };
    }
    await writeLog({
      success: true,
      reason: "ok",
      error_codes: [],
      http_status: res.status,
      hostname,
      challenge_ts: challengeTs,
    });
    return { ok: true, hostname, challengeTs, httpStatus: res.status, latencyMs };
  } catch (e: any) {
    const reason = `captcha_network:${e?.message ?? "err"}`;
    await writeLog({ success: false, reason });
    return { ok: false, reason };
  }
}

// Best-effort widget-token provider detection so we can reject requests
// where the client widget was rendered for one provider but the admin
// panel is configured for the other (a common cause of mysterious
// "captcha check failed" reports). Server continues to trust siteverify
// as the source of truth for authentication.
export function detectCaptchaTokenProvider(
  token: string | null | undefined,
): "turnstile" | "hcaptcha" | "unknown" {
  const t = (token ?? "").trim();
  if (!t) return "unknown";
  if (t.startsWith("P0_") || t.startsWith("P1_") || t.startsWith("P2_")) return "hcaptcha";
  if (t.startsWith("10000000-aaaa")) return "hcaptcha"; // hCaptcha test-key token
  if (t.startsWith("XXXX.DUMMY")) return "turnstile"; // Turnstile test-key dummy token
  if (t.startsWith("0.") || t.startsWith("1.") || t.startsWith("2.")) return "turnstile";
  return "unknown";
}

// ==========================================================================
// ADMIN — Test captcha keys with a synthetic siteverify probe.
// Providers return `invalid-input-response` for a dummy token when the
// secret is valid, and `invalid-input-secret` when the secret is bad.
// ==========================================================================
export const testCaptchaKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("app_settings")
      .select("key,value")
      .in("key", ["captcha_provider", "captcha_site_key"]);
    const m: Record<string, string> = {};
    for (const r of rows ?? []) m[r.key] = r.value;
    const provider = ((m.captcha_provider || "turnstile") as "turnstile" | "hcaptcha");
    const siteKey = m.captcha_site_key || "";
    const secretName = provider === "hcaptcha" ? "HCAPTCHA_SECRET" : "TURNSTILE_SECRET";
    const secretPresent =
      provider === "hcaptcha" ? !!process.env.HCAPTCHA_SECRET : !!process.env.TURNSTILE_SECRET;

    const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
    checks.push({
      label: "Site key configured",
      ok: !!siteKey,
      detail: siteKey ? `${siteKey.slice(0, 8)}…` : "empty",
    });
    checks.push({
      label: `${secretName} configured`,
      ok: secretPresent,
      detail: secretPresent ? "present" : "missing",
    });

    if (!secretPresent) {
      return { provider, siteKey, ok: false, summary: `Secret ${secretName} is not set.`, checks };
    }

    const probe = await verifyCaptcha(provider, "diagnostic-probe-token", undefined, {
      purpose: "admin_test",
    });
    const codes = probe.errorCodes ?? [];
    const invalidSecret = codes.includes("invalid-input-secret");
    const invalidToken =
      codes.includes("invalid-input-response") || codes.includes("missing-input-response");

    let ok = false;
    let summary = "";
    if (invalidSecret) {
      summary = `Secret ${secretName} was rejected by ${provider}. Rotate it in project secrets.`;
    } else if (invalidToken) {
      ok = true;
      summary = `Secret verified live with ${provider}. Site key '${siteKey.slice(0, 8)}…' — solve a widget to confirm end-to-end.`;
    } else if (probe.reason?.startsWith("captcha_network")) {
      summary = `Network error reaching ${provider}: ${probe.reason}`;
    } else {
      summary = `Unexpected response from ${provider}: ${probe.reason ?? "unknown"}`;
    }
    checks.push({
      label: "Live siteverify handshake",
      ok,
      detail: codes.length ? codes.join(", ") : probe.reason ?? "no response",
    });

    return {
      provider,
      siteKey,
      ok,
      summary,
      checks,
      errorCodes: codes,
      latencyMs: probe.latencyMs ?? null,
    };
  });

// ==========================================================================
// ADMIN — recent captcha verify log entries (already redacted).
// ==========================================================================
export const listCaptchaLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("captcha_verify_log")
      .select(
        "id, created_at, provider, purpose, success, error_codes, reason, http_status, latency_ms, token_length, token_prefix, hostname, challenge_ts",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return { rows: rows ?? [] };
  });

// ==========================================================================
// ADMIN — gate settings
// ==========================================================================
const GateSettingsInput = z.object({
  accessKeyRequired: z.boolean().optional(),
  captchaRequired: z.boolean().optional(),
  loginRequired: z.boolean().optional(),
  captchaProvider: z.enum(["turnstile", "hcaptcha"]).optional(),
  captchaSiteKey: z.string().max(200).optional(),
});

export const setGateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GateSettingsInput.parse(d))
  .handler(async ({ context, data }) => {
    const userId = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const rows: Array<{ key: string; value: string; updated_at: string; updated_by: string }> = [];
    if (data.accessKeyRequired !== undefined)
      rows.push({ key: "access_key_required", value: data.accessKeyRequired ? "1" : "0", updated_at: now, updated_by: userId });
    if (data.captchaRequired !== undefined)
      rows.push({ key: "captcha_required", value: data.captchaRequired ? "1" : "0", updated_at: now, updated_by: userId });
    if (data.loginRequired !== undefined)
      rows.push({ key: "login_required", value: data.loginRequired ? "1" : "0", updated_at: now, updated_by: userId });
    if (data.captchaProvider !== undefined)
      rows.push({ key: "captcha_provider", value: data.captchaProvider, updated_at: now, updated_by: userId });
    if (data.captchaSiteKey !== undefined)
      rows.push({ key: "captcha_site_key", value: data.captchaSiteKey, updated_at: now, updated_by: userId });
    if (rows.length > 0) {
      await supabaseAdmin.from("app_settings").upsert(rows);
      await supabaseAdmin.from("admin_activity_log").insert({
        admin_id: userId,
        action: "access_gates.update",
        details: data as any,
      });
    }
    return { ok: true };
  });

// ==========================================================================
// ADMIN — create / list / disable / delete keys, list redemptions
// ==========================================================================
const CreateKeysInput = z.object({
  keyType: z.enum(["unlimited", "single_use", "session_24h"]),
  quantity: z.number().int().min(1).max(200),
  label: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
});

export const createAccessKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateKeysInput.parse(d))
  .handler(async ({ context, data }) => {
    const userId = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const generated: { code: string; id: string }[] = [];
    for (let i = 0; i < data.quantity; i++) {
      const code = generateKeyCode();
      const codeHash = await sha256(code);
      const { data: row, error } = await supabaseAdmin
        .from("access_keys")
        .insert({
          code_hash: codeHash,
          code_prefix: code.slice(0, 8),
          key_type: data.keyType,
          label: data.label ?? null,
          notes: data.notes ?? null,
          expires_at: data.expiresAt ?? null,
          max_uses: data.keyType === "single_use" ? 1 : data.maxUses ?? null,
          created_by: userId,
        })
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (row) generated.push({ code, id: row.id });
    }
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "access_keys.create",
      details: { count: generated.length, type: data.keyType, label: data.label ?? null },
    });
    return { keys: generated };
  });

export const listAccessKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        keyType: z.enum(["all", "unlimited", "single_use", "session_24h"]).default("all"),
        status: z.enum(["all", "active", "disabled", "expired", "exhausted"]).default("all"),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("access_keys")
      .select(
        "id, code_prefix, key_type, label, notes, disabled, expires_at, max_uses, uses_count, first_redeemed_at, last_used_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.keyType !== "all") q = q.eq("key_type", data.keyType);
    if (data.status === "disabled") q = q.eq("disabled", true);
    if (data.status === "active") q = q.eq("disabled", false);
    const { data: rows, error } = await q;
    if (error) throw error;
    const now = Date.now();
    const filtered = (rows ?? []).filter((r: any) => {
      const isExpired = r.expires_at && new Date(r.expires_at).getTime() < now;
      const isExhausted =
        r.max_uses != null && r.uses_count >= r.max_uses;
      if (data.status === "expired") return isExpired;
      if (data.status === "exhausted") return isExhausted;
      return true;
    });
    return { rows: filtered };
  });

export const disableAccessKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), disabled: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const userId = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("access_keys").update({ disabled: data.disabled }).eq("id", data.id);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: data.disabled ? "access_keys.disable" : "access_keys.enable",
      target: data.id,
    });
    return { ok: true };
  });

export const deleteAccessKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const userId = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("access_keys").delete().in("id", data.ids);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "access_keys.delete",
      details: { count: data.ids.length },
    });
    return { ok: true, deleted: data.ids.length };
  });

export const listRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("access_key_redemptions")
      .select("id, code_prefix, ip_hash, fingerprint_hash, success, reason, created_at, key_id")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { rows: data ?? [] };
  });

export const getAccessStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: total }, { count: disabled }, { data: byType }, { count: red24h }] = await Promise.all([
      supabaseAdmin.from("access_keys").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("access_keys").select("*", { count: "exact", head: true }).eq("disabled", true),
      supabaseAdmin.from("access_keys").select("key_type"),
      supabaseAdmin
        .from("access_key_redemptions")
        .select("*", { count: "exact", head: true })
        .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    const typeCounts = { unlimited: 0, single_use: 0, session_24h: 0 };
    for (const r of (byType as any[]) ?? []) {
      if (r.key_type in typeCounts) (typeCounts as any)[r.key_type]++;
    }
    return {
      total: total ?? 0,
      disabled: disabled ?? 0,
      types: typeCounts,
      redemptions24h: red24h ?? 0,
    };
  });
