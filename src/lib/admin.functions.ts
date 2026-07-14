import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FIRST_ADMIN_EMAIL = "antigremi31@gmail.com";

async function assertStaff(supabase: any, userId: string) {
  const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
  ]);
  if (!isAdmin && !isMod) throw new Error("Forbidden");
  return { isAdmin: !!isAdmin, isModerator: !!isMod };
}

/** Returns whether current user is staff and which role. */
export const getMyStaffRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context as any;
    const email = String(claims?.email ?? "").toLowerCase();
    const [{ data: isAdmin }, { data: isMod }, { data: profile }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
      supabase.from("admin_profiles").select("username, display_name, avatar_url").eq("user_id", userId).maybeSingle(),
    ]);
    const isFirstAdmin = email === FIRST_ADMIN_EMAIL;
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
    await assertStaff(supabase, userId);

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
    await assertStaff(supabase, userId);

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
    await assertStaff(supabase, userId);
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
