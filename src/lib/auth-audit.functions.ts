import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

/** SHA-256 hex hash. */
async function sha256Hex(v: string): Promise<string> {
  const enc = new TextEncoder().encode(v);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readIp(): string {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    getRequestIP({ xForwardedFor: true }) ??
    "0.0.0.0"
  );
}

// ---------------------------------------------------------------------------
// OTP rate limit — check + record.
// ---------------------------------------------------------------------------
const OtpCheckInput = z.object({
  email: z.string().email(),
  kind: z.enum(["signup", "recovery"]).default("signup"),
});

async function readOtpSettings(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["otp_resend_cooldown_seconds", "otp_max_per_window", "otp_window_minutes"]);
  const m = new Map<string, string>();
  for (const r of data ?? []) m.set(r.key, r.value);
  return {
    cooldown: parseInt(m.get("otp_resend_cooldown_seconds") ?? "60", 10),
    max: parseInt(m.get("otp_max_per_window") ?? "5", 10),
    windowMin: parseInt(m.get("otp_window_minutes") ?? "15", 10),
  };
}

export const checkOtpLimit = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => OtpCheckInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const s = await readOtpSettings(supabaseAdmin);
    const { data: res, error } = await supabaseAdmin.rpc("check_otp_rate_limit", {
      _email: data.email,
      _kind: data.kind,
      _cooldown_seconds: s.cooldown,
      _max_per_window: s.max,
      _window_minutes: s.windowMin,
    });
    if (error) throw error;
    return res as {
      allowed: boolean;
      reason: string;
      cooldown_remaining: number;
      sent_in_window: number;
      max_per_window: number;
      window_minutes: number;
      next_allowed_at: string | null;
    };
  });

export const recordOtpSent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => OtpCheckInput.parse(d))
  .handler(async ({ data }) => {
    const ipHash = await sha256Hex(readIp());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("record_otp_attempt", {
      _email: data.email,
      _kind: data.kind,
      _ip_hash: ipHash,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Auth audit — log an event from the client (public).
// ---------------------------------------------------------------------------
const AuthEventInput = z.object({
  event: z.enum(["signin", "signup", "otp_send", "otp_verify", "password_reset"]),
  email: z.string().email().optional(),
  success: z.boolean(),
  reason: z.string().max(200).optional(),
  metadata: z.record(z.any()).optional(),
});

export const logAuthEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => AuthEventInput.parse(d))
  .handler(async ({ data }) => {
    const ipHash = await sha256Hex(readIp());
    const userAgent = (getRequestHeader("user-agent") ?? "").slice(0, 300);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("auth_audit_log").insert({
      event: data.event,
      email: data.email ?? null,
      user_id: null,
      success: data.success,
      reason: data.reason ?? null,
      ip_hash: ipHash,
      user_agent: userAgent,
      metadata: data.metadata ?? {},
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Admin: list auth audit log (paginated).
// ---------------------------------------------------------------------------
const AuditListInput = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(10).max(200).default(50),
  event: z.string().optional(),
  success: z.enum(["all", "success", "failure"]).default("all"),
  q: z.string().optional(),
  windowMinutes: z.number().int().min(1).max(60 * 24 * 90).optional(),
});

export const listAuthAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AuditListInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");

    let q = supabase
      .from("auth_audit_log")
      .select("id, event, email, user_id, success, reason, ip_hash, user_agent, metadata, created_at", { count: "exact" })
      .order("created_at", { ascending: false });

    if (data.event) q = q.eq("event", data.event);
    if (data.success === "success") q = q.eq("success", true);
    if (data.success === "failure") q = q.eq("success", false);
    if (data.q) q = q.ilike("email", `%${data.q}%`);
    if (data.windowMinutes) {
      const since = new Date(Date.now() - data.windowMinutes * 60_000).toISOString();
      q = q.gte("created_at", since);
    }
    const from = data.page * data.pageSize;
    const to = from + data.pageSize - 1;
    const { data: rows, count, error } = await q.range(from, to);
    if (error) throw error;

    // Aggregate KPIs across the current filter window (no pagination).
    const kpiSince = new Date(Date.now() - (data.windowMinutes ?? 60 * 24) * 60_000).toISOString();
    const { data: kpiRows } = await supabase
      .from("auth_audit_log")
      .select("event, success")
      .gte("created_at", kpiSince);
    const kpi = { total: 0, signin_fail: 0, otp_fail: 0, signup: 0, resets: 0 };
    for (const r of (kpiRows ?? []) as any[]) {
      kpi.total++;
      if (r.event === "signin" && !r.success) kpi.signin_fail++;
      if (r.event === "otp_verify" && !r.success) kpi.otp_fail++;
      if (r.event === "signup" && r.success) kpi.signup++;
      if (r.event === "password_reset") kpi.resets++;
    }

    return { rows: rows ?? [], count: count ?? 0, kpi };
  });

// ---------------------------------------------------------------------------
// User: my activation status.
// ---------------------------------------------------------------------------
export const getMyActivationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: limitRow } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "user_daily_activation_limit")
      .maybeSingle();
    const dailyLimit = Math.max(1, parseInt(limitRow?.value ?? "10", 10));

    const { data: used } = await supabaseAdmin.rpc("count_user_recent_attempts", {
      _user_id: userId,
      _minutes: 24 * 60,
    });
    const usedCount = used ?? 0;
    const remaining = Math.max(0, dailyLimit - usedCount);

    // Recent attempts.
    const { data: recent } = await supabase
      .from("activation_attempts")
      .select("id, code, result, error_message, country, created_at, duration_ms")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);

    // Compute next-reset time = oldest attempt in the 24h window + 24h.
    const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: oldest } = await supabaseAdmin
      .from("activation_attempts")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since24)
      .order("created_at", { ascending: true })
      .limit(1);
    const nextResetAt = oldest?.[0]?.created_at
      ? new Date(new Date(oldest[0].created_at).getTime() + 24 * 3600_000).toISOString()
      : null;

    const lastBlocked = (recent ?? []).find((r: any) => r.result === "rate_limited");

    return {
      email: claims?.email ?? null,
      dailyLimit,
      used: usedCount,
      remaining,
      blocked: remaining === 0,
      nextResetAt,
      lastBlocked: lastBlocked
        ? {
            at: lastBlocked.created_at,
            code: lastBlocked.code,
            reason: `Daily limit reached — ${dailyLimit} activations per 24h.`,
          }
        : null,
      recent: recent ?? [],
    };
  });
