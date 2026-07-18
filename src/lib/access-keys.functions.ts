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
      "user_daily_activation_limit",
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
    userDailyActivationLimit: Math.max(0, parseInt(m.user_daily_activation_limit || "10", 10) || 0),
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



// ==========================================================================
// ADMIN — gate settings
// ==========================================================================
const GateSettingsInput = z.object({
  accessKeyRequired: z.boolean().optional(),
  captchaRequired: z.boolean().optional(),
  loginRequired: z.boolean().optional(),
  captchaProvider: z.enum(["turnstile", "hcaptcha"]).optional(),
  captchaSiteKey: z.string().max(200).optional(),
  userDailyActivationLimit: z.number().int().min(0).max(10000).optional(),
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
    if (data.userDailyActivationLimit !== undefined)
      rows.push({ key: "user_daily_activation_limit", value: String(data.userDailyActivationLimit), updated_at: now, updated_by: userId });
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




// ==========================================================================
// ADMIN — per-user activation-limit overrides. `daily_limit = 0` means
// UNLIMITED for that specific user (bypasses the global cap). Admins can
// grant unlimited access to trusted accounts or tighten specific ones.
// ==========================================================================
async function findUserByEmail(
  supabaseAdmin: any,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  // Scan up to 3 pages of 1k users — plenty for this scale.
  for (let page = 1; page <= 3; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    const hit = users.find((u: any) => (u.email ?? "").toLowerCase() === target);
    if (hit) return { id: hit.id, email: hit.email ?? target };
    if (users.length < 1000) break;
  }
  return null;
}

export const listUserActivationOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("user_activation_overrides")
      .select("user_id, daily_limit, note, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const ids = new Set((rows ?? []).map((r: any) => r.user_id));
    const emailById = new Map<string, string>();
    if (ids.size > 0) {
      // One listUsers scan is enough — resolve emails for display.
      for (let page = 1; page <= 3; page++) {
        const { data: udata } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        for (const u of udata?.users ?? []) {
          if (ids.has(u.id)) emailById.set(u.id, u.email ?? "");
        }
        if ((udata?.users ?? []).length < 1000) break;
      }
    }
    return {
      rows: (rows ?? []).map((r: any) => ({
        ...r,
        email: emailById.get(r.user_id) ?? null,
      })),
    };
  });

export const setUserActivationOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email().max(320),
        dailyLimit: z.number().int().min(0).max(10000),
        note: z.string().max(200).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const userId = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const user = await findUserByEmail(supabaseAdmin, data.email);
    if (!user) throw new Error(`No signed-in user found with email "${data.email}"`);
    const { error } = await supabaseAdmin.from("user_activation_overrides").upsert({
      user_id: user.id,
      daily_limit: data.dailyLimit,
      note: data.note ?? null,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "user_override.set",
      target: user.email,
      details: { user_id: user.id, daily_limit: data.dailyLimit, note: data.note ?? null },
    });
    return { ok: true, userId: user.id, email: user.email };
  });

export const removeUserActivationOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const adminId = await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_activation_overrides")
      .delete()
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: adminId,
      action: "user_override.remove",
      target: data.userId,
    });
    return { ok: true };
  });


// ==========================================================================
// ADMIN — "last updated by/at" for gate settings. Powers the header strip
// on /admin/access so admins can see when (and by whom) settings changed.
// ==========================================================================
export const getGateLastUpdated = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const KEYS = [
      "access_key_required", "captcha_required", "login_required",
      "captcha_provider", "captcha_site_key", "user_daily_activation_limit",
    ];
    const { data: rows } = await supabaseAdmin
      .from("app_settings")
      .select("key,value,updated_at,updated_by")
      .in("key", KEYS);
    const list = rows ?? [];
    // Resolve editor emails for display (bounded scan).
    const ids = new Set(list.map((r: any) => r.updated_by).filter(Boolean));
    const emailById = new Map<string, string>();
    if (ids.size > 0) {
      for (let page = 1; page <= 2; page++) {
        const { data: udata } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        for (const u of udata?.users ?? []) if (ids.has(u.id)) emailById.set(u.id, u.email ?? "");
        if ((udata?.users ?? []).length < 1000) break;
      }
    }
    let latest: { key: string; updated_at: string; email: string | null } | null = null;
    for (const r of list as any[]) {
      const email = r.updated_by ? emailById.get(r.updated_by) ?? null : null;
      if (!latest || new Date(r.updated_at).getTime() > new Date(latest.updated_at).getTime()) {
        latest = { key: r.key, updated_at: r.updated_at, email };
      }
    }
    return {
      latest,
      perKey: list.map((r: any) => ({
        key: r.key, updated_at: r.updated_at,
        email: r.updated_by ? emailById.get(r.updated_by) ?? null : null,
      })),
    };
  });

// ==========================================================================
// ADMIN — access-related audit timeline. Merges admin_activity_log entries
// prefixed with `access_gates`, `access_keys`, `captcha.`, `user_override.`
// with actor emails and target metadata. Read-only.
// ==========================================================================
export const listAccessAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(60) }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const PREFIXES = ["access_gates", "access_keys", "captcha", "user_override"];
    const orFilter = PREFIXES.map((p) => `action.like.${p}.%,action.like.${p}%`).join(",");
    const { data: rows, error } = await supabaseAdmin
      .from("admin_activity_log")
      .select("id, created_at, admin_id, actor_label, action, target, details")
      .or(orFilter)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    const list = rows ?? [];
    const ids = new Set(list.map((r: any) => r.admin_id).filter(Boolean));
    const emailById = new Map<string, string>();
    if (ids.size > 0) {
      for (let page = 1; page <= 2; page++) {
        const { data: udata } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        for (const u of udata?.users ?? []) if (ids.has(u.id)) emailById.set(u.id, u.email ?? "");
        if ((udata?.users ?? []).length < 1000) break;
      }
    }
    return {
      rows: list.map((r: any) => ({
        id: r.id,
        created_at: r.created_at,
        action: r.action,
        target: r.target,
        details: r.details,
        actor: r.admin_id ? emailById.get(r.admin_id) ?? r.actor_label ?? null : r.actor_label ?? null,
      })),
    };
  });

// ==========================================================================
// ADMIN — activation policy preview. Given an identity (email + credentials
// present), evaluates every gate in the same order the server does and
// returns per-gate PASS/BLOCK/N-A with the reason. Real-time dry-run.
// ==========================================================================
export const previewActivationPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      email: z.string().email().max(320).optional().nullable(),
      hasAccessKey: z.boolean().default(false),
      hasCaptchaPass: z.boolean().default(false),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: settingRows } = await supabaseAdmin
      .from("app_settings").select("key,value")
      .in("key", ["access_key_required", "captcha_required", "login_required", "user_daily_activation_limit", "maintenance_enabled"]);
    const s: Record<string, string> = {};
    for (const r of settingRows ?? []) s[r.key] = r.value;
    const loginRequired = s.login_required === "1";
    const captchaRequired = s.captcha_required === "1";
    const accessKeyRequired = s.access_key_required === "1";
    const maintenance = s.maintenance_enabled === "1";
    const globalCap = Math.max(0, parseInt(s.user_daily_activation_limit ?? "10", 10) || 0);

    // Resolve user identity (optional).
    let user: { id: string; email: string } | null = null;
    if (data.email) user = await findUserByEmail(supabaseAdmin, data.email);

    // Override + usage.
    let overrideCap: number | null = null;
    let used24h = 0;
    if (user) {
      const { data: ov } = await supabaseAdmin
        .from("user_activation_overrides").select("daily_limit").eq("user_id", user.id).maybeSingle();
      if (ov && typeof (ov as any).daily_limit === "number") overrideCap = (ov as any).daily_limit;
      const { data: n } = await supabaseAdmin.rpc("count_user_recent_attempts", {
        _user_id: user.id, _minutes: 24 * 60,
      });
      used24h = (n as number) ?? 0;
    }
    const effectiveCap = overrideCap !== null ? overrideCap : globalCap;
    const capUnlimited = effectiveCap === 0;
    const capExhausted = !capUnlimited && used24h >= effectiveCap;

    type Gate = { key: string; label: string; verdict: "pass" | "block" | "na"; reason: string };
    const gates: Gate[] = [];
    gates.push({
      key: "maintenance", label: "Maintenance mode",
      verdict: maintenance ? "block" : "pass",
      reason: maintenance ? "Site is in maintenance — nobody can activate." : "off",
    });
    gates.push({
      key: "login", label: "Login gate",
      verdict: !loginRequired ? "na" : user ? "pass" : "block",
      reason: !loginRequired ? "off"
        : user ? `Signed in as ${user.email}` : "Not signed in — visitor is blocked.",
    });
    gates.push({
      key: "captcha", label: "Captcha gate",
      verdict: !captchaRequired ? "na" : data.hasCaptchaPass ? "pass" : "block",
      reason: !captchaRequired ? "off"
        : data.hasCaptchaPass ? "Fresh captcha_pass token present." : "Must solve captcha (no pass token).",
    });
    gates.push({
      key: "access_key", label: "Access-key gate",
      verdict: !accessKeyRequired ? "na" : data.hasAccessKey ? "pass" : "block",
      reason: !accessKeyRequired ? "off"
        : data.hasAccessKey ? "Access key / session token present." : "Requires a valid access key.",
    });
    gates.push({
      key: "cap", label: "Daily activation cap",
      verdict: !user || capUnlimited ? "na" : capExhausted ? "block" : "pass",
      reason: !user ? "N/A — no user selected"
        : capUnlimited ? "Unlimited (cap = 0)"
        : `${used24h} / ${effectiveCap} used in last 24h`
          + (overrideCap !== null ? ` (per-user override)` : ` (global)`),
    });

    const allow = gates.every((g) => g.verdict !== "block");
    return {
      allow,
      user: user ? { id: user.id, email: user.email } : null,
      gates,
      config: { loginRequired, captchaRequired, accessKeyRequired, globalCap, maintenance },
      cap: { effective: effectiveCap, override: overrideCap, used24h, unlimited: capUnlimited },
    };
  });
