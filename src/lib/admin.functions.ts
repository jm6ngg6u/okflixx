import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Returns whether current user is staff and which role. */
export const getMyStaffRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context as any;
    const firstAdminEmail = "antigremi31@gmail.com";
    const email = String(claims?.email ?? "").toLowerCase();
    const [{ data: isAdmin }, { data: isMod }, { data: profile }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
      supabase.from("admin_profiles").select("username, display_name, avatar_url").eq("user_id", userId).maybeSingle(),
    ]);
    const isFirstAdmin = email === firstAdminEmail;
    return {
      userId,
      isAdmin: !!isAdmin || isFirstAdmin,
      isModerator: !!isMod,
      isStaff: !!isAdmin || !!isMod || isFirstAdmin,
      profile: profile ?? null,
    };
  });

/** Dashboard stats: KPIs, time series, top countries. */
const StatsInput = z.object({
  windowHours: z.number().int().min(1).max(24 * 365).default(24),
});

export const getDashboardStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatsInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");

    const since = new Date(Date.now() - data.windowHours * 3600_000).toISOString();
    const { data: rows, error } = await supabase
      .from("activation_attempts")
      .select("result, country, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50000);
    if (error) throw error;

    const kpi = { total: 0, success: 0, rate_limited: 0, bot_detected: 0, invalid_code: 0, other: 0 };
    const countryMap = new Map<string, { total: number; success: number }>();
    const bucketMs = data.windowHours <= 48 ? 3600_000 : 86_400_000; // hourly ≤48h else daily
    const seriesMap = new Map<number, { total: number; success: number }>();

    for (const r of rows ?? []) {
      kpi.total++;
      if (r.result === "success") kpi.success++;
      else if (r.result === "rate_limited") kpi.rate_limited++;
      else if (r.result === "bot_detected") kpi.bot_detected++;
      else if (r.result === "invalid_code") kpi.invalid_code++;
      else kpi.other++;

      const c = r.country || "??";
      const cur = countryMap.get(c) ?? { total: 0, success: 0 };
      cur.total++;
      if (r.result === "success") cur.success++;
      countryMap.set(c, cur);

      const bucket = Math.floor(new Date(r.created_at).getTime() / bucketMs) * bucketMs;
      const s = seriesMap.get(bucket) ?? { total: 0, success: 0 };
      s.total++;
      if (r.result === "success") s.success++;
      seriesMap.set(bucket, s);
    }

    const countries = [...countryMap.entries()]
      .map(([country, v]) => ({ country, ...v, rate: v.total ? Math.round((v.success / v.total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    const series = [...seriesMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({ t, total: v.total, success: v.success }));

    return { kpi, countries, series, bucketMs };
  });

/** Paginated attempts log with filters. */
const AttemptsInput = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(10).max(200).default(50),
  /** Legacy single-result filter (kept for backwards compat). */
  result: z.string().optional(),
  /** New multi-select result filter (chips). */
  results: z.array(z.string()).optional(),
  country: z.string().optional(),
  q: z.string().optional(),
  /** Restrict to attempts newer than N minutes; omit for "all time". */
  sinceMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
});

export const listAttempts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AttemptsInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");

    // Base query — page slice with full detail columns.
    let q = supabase
      .from("activation_attempts")
      .select(
        "id, code, result, country, user_agent, created_at, ip_hash, cookie_id, proxy_id, proxy_mode, attempt_number, duration_ms, error_message",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.page * data.pageSize, data.page * data.pageSize + data.pageSize - 1);

    const results = data.results && data.results.length ? data.results : data.result ? [data.result] : null;
    if (results && results.length) q = q.in("result", results);
    if (data.country) q = q.eq("country", data.country);
    if (data.q) q = q.or(`code.ilike.%${data.q}%,user_agent.ilike.%${data.q}%,ip_hash.ilike.%${data.q}%`);
    let sinceIso: string | null = null;
    if (data.sinceMinutes) {
      sinceIso = new Date(Date.now() - data.sinceMinutes * 60_000).toISOString();
      q = q.gte("created_at", sinceIso);
    }

    const { data: rows, count, error } = await q;
    if (error) throw error;

    // Lightweight per-filter aggregate for the KPI strip. Pulls the same slice
    // of columns (only the small ones) for up to 5000 matching rows so we can
    // compute success rate, avg duration, and unique IP count without a second
    // paginated round-trip.
    let aggQuery = supabase
      .from("activation_attempts")
      .select("result, duration_ms, ip_hash")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (results && results.length) aggQuery = aggQuery.in("result", results);
    if (data.country) aggQuery = aggQuery.eq("country", data.country);
    if (data.q) aggQuery = aggQuery.or(`code.ilike.%${data.q}%,user_agent.ilike.%${data.q}%,ip_hash.ilike.%${data.q}%`);
    if (sinceIso) aggQuery = aggQuery.gte("created_at", sinceIso);
    const { data: aggRows } = await aggQuery;

    const summary = { success: 0, fail: 0, total: 0, avg_duration_ms: 0, unique_ips: 0, sampled: (aggRows ?? []).length };
    const ipSet = new Set<string>();
    let durSum = 0;
    let durN = 0;
    for (const r of aggRows ?? []) {
      summary.total++;
      if ((r as any).result === "success") summary.success++;
      else summary.fail++;
      const d = (r as any).duration_ms;
      if (typeof d === "number") { durSum += d; durN++; }
      const ip = (r as any).ip_hash;
      if (ip) ipSet.add(ip);
    }
    summary.avg_duration_ms = durN ? Math.round(durSum / durN) : 0;
    summary.unique_ips = ipSet.size;

    return { rows: rows ?? [], count: count ?? 0, summary };
  });


/** Pool sizes for sidebar badges. */
export const getPoolSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const [cookies, proxies] = await Promise.all([
      supabase.from("cookie_pool").select("status", { count: "exact", head: false }),
      supabase.from("proxy_pool").select("is_valid", { count: "exact", head: false }),
    ]);
    const c = { active: 0, on_hold: 0, free: 0, invalid: 0, unknown: 0, total: 0 };
    for (const r of cookies.data ?? []) {
      c.total++;
      const s = (r as any).status as keyof typeof c;
      if (s in c) (c as any)[s]++;
    }
    const p = { valid: 0, invalid: 0, total: 0 };
    for (const r of proxies.data ?? []) {
      p.total++;
      if ((r as any).is_valid) p.valid++;
      else p.invalid++;
    }
    return { cookies: c, proxies: p };
  });

/** Live worker health probe. */
export const getWorkerHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    let url = (process.env.NETFLIX_WORKER_URL ?? "").trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    url = url.replace(/\/+$/, "");
    if (!url) return { ok: false, latency_ms: null as number | null, error: "NETFLIX_WORKER_URL not set" };
    const t0 = Date.now();
    try {
      const c = new AbortController();
      const to = setTimeout(() => c.abort(), 6000);
      const r = await fetch(`${url}/health`, { signal: c.signal, headers: { "X-Worker-Token": process.env.NETFLIX_WORKER_TOKEN ?? "" } });
      clearTimeout(to);
      return { ok: r.ok, latency_ms: Date.now() - t0, error: r.ok ? null : `HTTP ${r.status}` };
    } catch (e: any) {
      return { ok: false, latency_ms: Date.now() - t0, error: String(e?.message ?? e) };
    }
  });

/** Recent admin activity feed. */
export const getRecentActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { data } = await supabase
      .from("admin_activity_log")
      .select("id, action, details, created_at, admin_id")
      .order("created_at", { ascending: false })
      .limit(20);
    return { rows: data ?? [] };
  });

/** Recent activation pipelines: group attempt rows by (code + ip_hash) into
 *  ordered retry sequences so the dashboard can show queued → cookie → proxy → result
 *  timelines with per-attempt timing.
 *
 *  Groups within a 5-minute rolling window per (code, ip_hash). Returns the
 *  most recent N groups, newest first, with attempts inside each group ordered
 *  by attempt_number then created_at.
 */
const PipelinesInput = z.object({
  limit: z.number().int().min(1).max(30).default(10),
  windowMinutes: z.number().int().min(1).max(60).default(30),
});

export const getActivationPipelines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PipelinesInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");

    const since = new Date(Date.now() - data.windowMinutes * 60_000).toISOString();
    const { data: rows, error } = await supabase
      .from("activation_attempts")
      .select("id, code, result, country, ip_hash, cookie_id, proxy_id, proxy_mode, attempt_number, duration_ms, error_message, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(600);
    if (error) throw error;

    type Row = {
      id: string; code: string | null; result: string | null; country: string | null;
      ip_hash: string | null; cookie_id: string | null; proxy_id: string | null;
      proxy_mode: boolean | null; attempt_number: number | null;
      duration_ms: number | null; error_message: string | null; created_at: string;
    };

    // Group by (code, ip_hash). Rows are already newest-first; walk them and
    // start a new group when the gap exceeds 5 minutes for the same key.
    const CLUSTER_GAP_MS = 5 * 60_000;
    const groups = new Map<string, { key: string; rows: Row[]; last: number }>();
    const orderedKeys: string[] = [];

    for (const r of (rows ?? []) as Row[]) {
      const code = (r.code ?? "").trim();
      const ip = r.ip_hash ?? "";
      if (!code) continue;
      const baseKey = `${code}::${ip}`;
      const ts = new Date(r.created_at).getTime();
      const existing = groups.get(baseKey);
      let key = baseKey;
      if (existing && Math.abs(existing.last - ts) > CLUSTER_GAP_MS) {
        // Same code+ip but too far apart → separate pipeline.
        key = `${baseKey}::${ts}`;
      }
      let g = groups.get(key);
      if (!g) {
        g = { key, rows: [], last: ts };
        groups.set(key, g);
        orderedKeys.push(key);
      }
      g.rows.push(r);
      g.last = Math.min(g.last, ts); // track earliest ts for ordering inside a group
    }

    const pipelines = orderedKeys.slice(0, data.limit).map((k) => {
      const g = groups.get(k)!;
      const sorted = [...g.rows].sort((a, b) => {
        const an = a.attempt_number ?? 0;
        const bn = b.attempt_number ?? 0;
        if (an !== bn) return an - bn;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      const final = sorted[sorted.length - 1];
      const first = sorted[0];
      const totalDuration = sorted.reduce((acc, r) => acc + (r.duration_ms ?? 0), 0);
      return {
        key: k,
        code: final?.code ?? "",
        country: final?.country ?? null,
        ip_hash: final?.ip_hash ?? null,
        started_at: first?.created_at ?? final?.created_at,
        ended_at: final?.created_at,
        final_result: final?.result ?? null,
        attempts: sorted.map((r) => ({
          id: r.id,
          n: r.attempt_number ?? 1,
          result: r.result,
          duration_ms: r.duration_ms,
          cookie_id: r.cookie_id,
          proxy_id: r.proxy_id,
          proxy_mode: !!r.proxy_mode,
          error: r.error_message,
          at: r.created_at,
        })),
        total_duration_ms: totalDuration,
      };
    });

    return { pipelines };
  });

// -------------------- Rate-limit status --------------------

/**
 * Snapshot of activation traffic that got rate-limited or bot-blocked recently.
 * Powers the "rate-limit strip" on the activation pipeline panel so operators
 * can see when a spike is being shed rather than served.
 */
const RateLimitInput = z.object({
  windowMinutes: z.number().int().min(1).max(120).default(15),
});

export const getRateLimitStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RateLimitInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");

    const since = new Date(Date.now() - data.windowMinutes * 60_000).toISOString();
    const { data: rows, error } = await supabase
      .from("activation_attempts")
      .select("id, code, result, ip_hash, country, created_at")
      .in("result", ["rate_limited", "bot_detected"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const byIp = new Map<string, { ip_hash: string; count: number; last: string; countries: Set<string> }>();
    let rate_limited = 0;
    let bot_detected = 0;
    for (const r of (rows ?? []) as any[]) {
      if (r.result === "rate_limited") rate_limited++;
      else if (r.result === "bot_detected") bot_detected++;
      const key = r.ip_hash ?? "unknown";
      const b = byIp.get(key) ?? { ip_hash: key, count: 0, last: r.created_at, countries: new Set<string>() };
      b.count += 1;
      if (r.country) b.countries.add(r.country);
      if (new Date(r.created_at) > new Date(b.last)) b.last = r.created_at;
      byIp.set(key, b);
    }
    const top = Array.from(byIp.values())
      .map((b) => ({ ip_hash: b.ip_hash, count: b.count, last: b.last, countries: Array.from(b.countries) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      windowMinutes: data.windowMinutes,
      total: (rows ?? []).length,
      rate_limited,
      bot_detected,
      top,
    };
  });

// -------------------- Admin-triggered activation retry --------------------

const RetryInput = z.object({
  code: z.string().regex(/^[A-Z0-9]{8}$/i).transform((s) => s.toUpperCase()),
});

/**
 * Manually run one activation attempt for a given TV code, bypassing the
 * anti-bot honeypot + IP rate-limit (this is admin-triggered, not user
 * traffic). Uses the same cookie/proxy rotation policy as the public flow.
 * Marked with an "admin_retry" flag in the attempt row so it's distinguishable
 * from organic traffic.
 */
export const retryActivationAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RetryInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { activateTVViaWorker, isCookieDead } = await import("@/lib/worker.server");

    const code = data.code;
    const { data: policyRow } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "cookie_rotation_policy").maybeSingle();
    const rawPolicy = String(policyRow?.value ?? "round_robin").toLowerCase();
    const policy: "round_robin" | "random" | "quality" =
      rawPolicy === "random" || rawPolicy === "quality" ? (rawPolicy as any) : "round_robin";

    const { data: cookieRows, error: pickErr } = await supabaseAdmin.rpc(
      "pick_next_cookie_by_policy",
      { _policy: policy },
    );
    const cookie = Array.isArray(cookieRows) ? cookieRows[0] : cookieRows;
    if (pickErr || !cookie) {
      await supabaseAdmin.from("activation_attempts").insert({
        code, result: "no_cookie", ip_hash: `admin:${userId}`,
        user_agent: "admin-retry", country: null, proxy_mode: false, attempt_number: 1,
      });
      return { ok: false, status: "no_cookie" as const, message: "Cookie pool empty." };
    }

    const { data: proxyModeRow } = await supabaseAdmin
      .from("app_settings").select("value").eq("key", "proxy_mode").maybeSingle();
    const proxyMode = proxyModeRow?.value === "1";
    let proxyRow: any = null;
    if (proxyMode) {
      const { data: pr } = await supabaseAdmin.rpc("pick_next_proxy");
      proxyRow = Array.isArray(pr) ? pr[0] : pr;
    }
    const proxyPayload = proxyRow ? {
      scheme: proxyRow.scheme, ip: proxyRow.ip, port: proxyRow.port,
      username: proxyRow.username ?? null, password: proxyRow.password ?? null,
    } : null;

    const t0 = Date.now();
    const outcome = await activateTVViaWorker({
      code,
      cookies: cookie.cookies_json as { name: string; value: string; domain?: string }[],
      proxy: proxyPayload,
    });
    const dur = Date.now() - t0;

    await supabaseAdmin.from("activation_attempts").insert({
      code, result: outcome.status, ip_hash: `admin:${userId}`,
      user_agent: "admin-retry", country: null,
      cookie_id: cookie.id, proxy_id: proxyRow?.id ?? null,
      proxy_mode: proxyMode, attempt_number: 1,
      duration_ms: outcome.duration_ms ?? dur,
      error_message: (outcome as any).error ?? null,
    });

    const success = outcome.status === "success";
    if (isCookieDead(outcome.status)) {
      await supabaseAdmin.rpc("mark_cookie_invalid", {
        _id: cookie.id, _reason: ((outcome as any).error ?? outcome.status) as string,
      });
    } else if (outcome.status === "free" || outcome.status === "on_hold") {
      await supabaseAdmin.from("cookie_pool").update({
        status: outcome.status, is_valid: false, is_locked: false, locked_at: null,
        last_used_at: new Date().toISOString(),
        last_error: ((outcome as any).error ?? outcome.status) as string,
      }).eq("id", cookie.id);
    } else {
      await supabaseAdmin.rpc("release_cookie", {
        _id: cookie.id, _success: success,
        _outcome: success ? undefined : outcome.status,
      });
    }
    if (proxyRow) {
      await supabaseAdmin.rpc("release_proxy", {
        _id: proxyRow.id,
        _success: outcome.status !== "worker_error",
        _err: outcome.status === "worker_error" ? ((outcome as any).error as string) : undefined,
      });
    }

    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "activation.admin_retry",
      details: { code, status: outcome.status, cookie_id: cookie.id, proxy_id: proxyRow?.id ?? null, duration_ms: dur, policy },
    });

    return { ok: success, status: outcome.status, policy, duration_ms: dur };
  });
