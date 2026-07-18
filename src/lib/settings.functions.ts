// Settings: proxy_mode toggle, maintenance banner, thresholds.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Return every setting as a plain map. Publicly readable subset only for anon,
 *  but this fn requires staff so all keys are returned. */
export const listSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: a }, { data: m }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!a && !m) throw new Error("Forbidden");
    const { data, error } = await supabase.from("app_settings").select("key,value,updated_at");
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.key] = row.value;
    return { settings: map, rows: data ?? [] };
  });

export const setSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string().min(1).max(64), value: z.string().max(4096) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: data.key, value: data.value, updated_at: new Date().toISOString(), updated_by: userId })
      .select();
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.update",
      target: data.key,
      details: { value: data.value },
    });
    return { ok: true };
  });

/** One-click proxy mode toggle. Returns the new value. */
export const toggleProxyMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cur } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "proxy_mode")
      .maybeSingle();
    const next = cur?.value === "1" ? "0" : "1";
    await supabaseAdmin
      .from("app_settings")
      .upsert({ key: "proxy_mode", value: next, updated_at: new Date().toISOString(), updated_by: userId });
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.toggle_proxy_mode",
      details: { new_value: next },
    });
    return { proxy_mode: next === "1" };
  });

// Strip control chars, collapse runs of whitespace, and trim.
const sanitizeMsg = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();

const MaintenanceInput = z.object({
  enabled: z.boolean().optional(),
  message: z.string().max(500).optional(),
  starts_at: z.string().max(64).nullable().optional(), // ISO-8601 or "" to clear
  ends_at: z.string().max(64).nullable().optional(),
}).refine((d) => {
  if (d.message === undefined) return true;
  const clean = sanitizeMsg(d.message);
  return clean.length === 0 || clean.length >= 8;
}, { message: "Message must be either empty (use default) or at least 8 characters.", path: ["message"] })
  .refine((d) => {
    // Both start and end must be provided together (or both cleared).
    const sSet = !!(d.starts_at && d.starts_at.length);
    const eSet = !!(d.ends_at && d.ends_at.length);
    if (sSet && !eSet) return false;
    if (eSet && !sSet) return false;
    return true;
  }, { message: "Set both start and end — the countdown needs both to render.", path: ["starts_at"] })
  .refine((d) => {
    if (!d.starts_at || !d.ends_at) return true;
    const a = Date.parse(d.starts_at); const b = Date.parse(d.ends_at);
    if (isNaN(a) || isNaN(b)) return true;
    return b > a;
  }, { message: "End time must be after start time.", path: ["ends_at"] });

export const setMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => MaintenanceInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const rows: Array<{ key: string; value: string; updated_at: string; updated_by: string }> = [];
    if (typeof data.enabled === "boolean") {
      rows.push({ key: "maintenance_enabled", value: data.enabled ? "1" : "0", updated_at: nowIso, updated_by: userId });
    }
    if (typeof data.message === "string") {
      rows.push({ key: "maintenance_message", value: sanitizeMsg(data.message), updated_at: nowIso, updated_by: userId });
    }
    const normDate = (v: string | null | undefined): string | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return "";
      const t = Date.parse(v);
      return isNaN(t) ? "" : new Date(t).toISOString();
    };
    const s = normDate(data.starts_at);
    const e = normDate(data.ends_at);
    if (s !== undefined) rows.push({ key: "maintenance_starts_at", value: s, updated_at: nowIso, updated_by: userId });
    if (e !== undefined) rows.push({ key: "maintenance_ends_at", value: e, updated_at: nowIso, updated_by: userId });
    if (rows.length) {
      const { error } = await supabaseAdmin.from("app_settings").upsert(rows);
      if (error) throw error;
    }
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.maintenance",
      details: data,
    });
    return { ok: true };
  });


/** Public getter for anon-safe subset (used by the landing page banner). */
/** Public contact channels (Telegram / Instagram / WhatsApp). Anon-safe. Only
 *  returns entries with a non-empty handle, and only when the master toggle
 *  is on. Empty channels are omitted so the UI hides them automatically. */
export const getPublicContacts = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const keys = [
    "contact_tg_enabled", "contact_tg_name", "contact_tg_username",
    "contact_ig_enabled", "contact_ig_name", "contact_ig_username",
    "contact_wa_enabled", "contact_wa_name", "contact_wa_number",
  ];
  const { data } = await supabaseAdmin.from("app_settings").select("key,value,updated_at").in("key", keys);
  const m: Record<string, string> = {};
  let updatedAt = 0;
  for (const r of data ?? []) {
    m[r.key] = r.value;
    const t = (r as any).updated_at ? Date.parse((r as any).updated_at) : 0;
    if (t > updatedAt) updatedAt = t;
  }
  // Per-channel enable: default ON when key absent (backward compat).
  const tgOn = (m.contact_tg_enabled ?? "1") === "1";
  const igOn = (m.contact_ig_enabled ?? "1") === "1";
  const waOn = (m.contact_wa_enabled ?? "1") === "1";

  const normUser = (v: string) => {
    let u = (v ?? "").trim();
    u = u.replace(/^https?:\/\/(t\.me|telegram\.me|instagram\.com|www\.instagram\.com)\//i, "");
    u = u.replace(/^@+/, "").replace(/\/+$/, "").split(/[?#/]/)[0];
    return u.replace(/[^A-Za-z0-9_.]/g, "");
  };
  const normPhone = (v: string) =>
    (v ?? "").trim().replace(/[^\d+]/g, "").replace(/\+/g, "");

  const tg = normUser(m.contact_tg_username ?? "");
  const ig = normUser(m.contact_ig_username ?? "");
  const wa = normPhone(m.contact_wa_number ?? "");

  const all = [
    { kind: "telegram", enabled: tgOn, name: (m.contact_tg_name ?? "").trim(), raw: m.contact_tg_username ?? "", handleNorm: tg, handle: tg ? `@${tg}` : "", href: tg ? `https://t.me/${tg}` : "" },
    { kind: "instagram", enabled: igOn, name: (m.contact_ig_name ?? "").trim(), raw: m.contact_ig_username ?? "", handleNorm: ig, handle: ig ? `@${ig}` : "", href: ig ? `https://instagram.com/${ig}` : "" },
    { kind: "whatsapp", enabled: waOn, name: (m.contact_wa_name ?? "").trim(), raw: m.contact_wa_number ?? "", handleNorm: wa, handle: wa ? `+${wa}` : "", href: wa ? `https://wa.me/${wa}` : "" },
  ];
  const channels = all
    .filter((c) => c.enabled && !!c.handleNorm)
    .map(({ kind, name, handle, href }) => ({ kind, name, handle, href }));

  return {
    enabled: channels.length > 0,
    channels,
    debug: {
      updatedAt: updatedAt || null,
      channels: all.map((c) => ({
        kind: c.kind,
        enabled: c.enabled,
        rawHandle: c.raw,
        normalizedHandle: c.handleNorm,
        display: c.handle,
        href: c.href,
        visible: c.enabled && !!c.handleNorm,
        reason: !c.enabled ? "channel_off" : !c.handleNorm ? "empty_or_invalid_handle" : "ok",
      })),
    },
  };
});


/**
 * Public pool-status snapshot for the landing page. Anon-safe — exposes only
 * counts and the currently-active rotation policy, never cookie contents or
 * emails. Uses the same RPCs and eligibility settings as the real activation
 * picker (`pick_next_cookie_filtered`), so what a user sees here is what the
 * server will actually consider when they submit a code.
 */
export const getPublicPoolStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { loadEligibility } = await import("@/lib/activate.functions");

  const [settingsRes, freshRes, usedRes, totalRes] = await Promise.all([
    supabaseAdmin
      .from("app_settings")
      .select("key,value")
      .in("key", ["cookie_rotation_policy", "max_activation_attempts"]),
    supabaseAdmin
      .from("cookie_pool")
      .select("id", { count: "exact", head: true })
      .eq("status", "active").eq("is_valid", true).eq("total_uses", 0),
    supabaseAdmin
      .from("cookie_pool")
      .select("id", { count: "exact", head: true })
      .eq("status", "active").eq("is_valid", true).gt("total_uses", 0),
    supabaseAdmin
      .from("cookie_pool")
      .select("id", { count: "exact", head: true }),
  ]);

  const map: Record<string, string> = {};
  for (const row of settingsRes.data ?? []) map[row.key] = row.value;
  const rawPolicy = (map.cookie_rotation_policy ?? "round_robin").toLowerCase();
  const policy: "round_robin" | "random" | "quality" =
    rawPolicy === "random" || rawPolicy === "quality" ? (rawPolicy as any) : "round_robin";
  const maxAttempts = Math.max(1, Math.min(10, parseInt(map.max_activation_attempts ?? "3", 10) || 3));

  const eligibility = await loadEligibility(supabaseAdmin);
  const { data: eligibleCount } = await supabaseAdmin.rpc("count_eligible_cookies", {
    _include_statuses: eligibility.include_statuses,
    _require_valid: eligibility.require_valid,
    _min_success_rate: eligibility.min_success_rate,
    _min_total_uses: eligibility.min_total_uses,
  });

  return {
    eligible: (eligibleCount as number | null) ?? 0,
    fresh: freshRes.count ?? 0,
    used: usedRes.count ?? 0,
    total: totalRes.count ?? 0,
    policy,
    maxAttempts,
    updatedAt: Date.now(),
  };
});

/** Latest scheduled-job runs, for the admin live-jobs panel. */
export const listRecentJobRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { data, error } = await supabase
      .from("job_runs")
      .select("id, job, started_at, finished_at, ok, summary, progress, error, control")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return { rows: data ?? [] };
  });

/**
 * Live proxy-mode health summary. Exposes whether strict proxy mode has any
 * usable proxies right now so the settings toggle can show real state.
 */
export const getProxyModeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: a }, { data: m }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!a && !m) throw new Error("Forbidden");
    const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "proxy_mode").maybeSingle();
    const proxy_mode = setting?.value === "1";
    const { data: stats } = await supabase.rpc("get_proxy_stats");
    const s: any = stats ?? {};
    return {
      proxy_mode,
      usable: (s.valid ?? 0) as number,
      total: (s.total ?? 0) as number,
      quarantined: (s.quarantined ?? 0) as number,
      stuck_locked: (s.stuck_locked ?? 0) as number,
      avg_latency_ms: (s.avg_latency_ms ?? 0) as number,
    };
  });

/** Admin: kick off cookie auto-check immediately (ignores enabled flag). */
export const runCookiesAutocheckNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { runCookiesAutocheck } = await import("@/lib/autocheck.server");
    return await runCookiesAutocheck(true);
  });

/** Admin: kick off proxy auto-check immediately (ignores enabled flag). */
export const runProxiesAutocheckNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { runProxiesAutocheck } = await import("@/lib/autocheck.server");
    return await runProxiesAutocheck(true);
  });

/**
 * Admin: signal a running job to stop (save partial results) or cancel (discard).
 * Stop => the loop finishes the current item, runs cleanup, and persists a summary
 * with `stopped: true`. Cancel => the loop aborts, cleanup is skipped, and the
 * run cursor (`*_last_run_at`) is NOT updated so the job re-runs at the next tick.
 */
export const requestJobControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["stop", "cancel"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("job_runs").select("id, job, finished_at").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Job not found");
    if (row.finished_at) throw new Error("Job already finished");
    await supabaseAdmin.from("job_runs").update({ control: data.action }).eq("id", data.id);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: data.action === "stop" ? "job.stop_requested" : "job.cancel_requested",
      target: row.job,
      details: { job_id: data.id },
    });
    return { ok: true, action: data.action };
  });

/** Admin: fire a synthetic pool-alert payload at the configured webhook so
 *  admins can confirm the URL is reachable and the receiver parses the body. */
export const testPoolAlertWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "pool_alert_webhook").maybeSingle();
    const url = (row?.value ?? "").trim();
    if (!url) throw new Error("Webhook URL is empty");
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("Webhook URL is not a valid URL"); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Webhook URL must start with http(s)");
    const started = Date.now();
    let status = 0; let bodyText = ""; let error: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "pool_alert.test",
          message: "Test payload from Emberlord admin — the pool alert webhook is reachable.",
          fired_at: new Date().toISOString(),
          site: "emberlord",
        }),
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      bodyText = (await res.text()).slice(0, 200);
    } catch (e: any) {
      error = e?.message ?? "Request failed";
    }
    const duration_ms = Date.now() - started;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "settings.test_webhook",
      target: parsed.host,
      details: { status, duration_ms, error, snippet: bodyText },
    });
    return { ok: !error && status >= 200 && status < 300, status, duration_ms, error, snippet: bodyText };
  });
