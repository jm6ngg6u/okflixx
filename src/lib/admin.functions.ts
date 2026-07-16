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
  result: z.string().optional(),
  country: z.string().optional(),
  q: z.string().optional(),
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

    let q = supabase
      .from("activation_attempts")
      .select("id, code, result, country, user_agent, created_at, ip_hash", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * data.pageSize, data.page * data.pageSize + data.pageSize - 1);

    if (data.result) q = q.eq("result", data.result);
    if (data.country) q = q.eq("country", data.country);
    if (data.q) q = q.or(`code.ilike.%${data.q}%,user_agent.ilike.%${data.q}%,ip_hash.ilike.%${data.q}%`);

    const { data: rows, count, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [], count: count ?? 0 };
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
