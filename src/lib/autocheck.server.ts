// Shared logic for the cookie/proxy auto-check jobs.
// Used by both the /api/public/hooks/* cron routes and the admin "Run now" server fns.

import { recordJobStart, recordJobFinish, recordJobProgress } from "@/lib/cron.server";

type CookieRunResult = {
  ok: boolean;
  skipped?: string;
  checked?: number;
  active?: number;
  invalid?: number;
  on_hold?: number;
  free?: number;
  deleted?: number;
  removed_invalid?: number;
  removed_free?: number;
  removed_on_hold?: number;
  removed_duplicates?: number;
  proxy_mode?: boolean;
  reasons?: Record<string, number>;
  error?: string;
};

function bucketReason(msg: string | null | undefined): string {
  const s = String(msg ?? "").toLowerCase().trim();
  if (!s) return "unknown";
  if (s.includes("timeout") || s.includes("timed out")) return "timeout";
  if (s.includes("proxy")) return "proxy_error";
  if (s.includes("network") || s.includes("econn") || s.includes("fetch")) return "network";
  if (s.includes("expired") || s.includes("session")) return "session_expired";
  if (s.includes("captcha") || s.includes("challenge")) return "captcha";
  if (s.includes("forbidden") || s.includes("403")) return "forbidden";
  if (s.includes("unauth") || s.includes("401") || s.includes("login")) return "auth_failed";
  if (s.includes("hold")) return "on_hold";
  if (s.includes("free")) return "free_account";
  if (s.includes("invalid") || s.includes("cookie")) return "invalid_cookie";
  return s.slice(0, 40);
}

/** Run the cookie auto-check. When `force=true`, ignores the enabled flag. */
export async function runCookiesAutocheck(force = false): Promise<CookieRunResult> {
  const jobId = await recordJobStart("cookies-autocheck");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { checkCookieViaWorker } = await import("@/lib/worker.server");

  try {
    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select("key,value")
      .in("key", ["proxy_mode", "auto_check_enabled", "autocheck_cleanup"]);
    const map: Record<string, string> = {};
    for (const s of settings ?? []) map[s.key] = s.value;
    if (!force && map.auto_check_enabled !== "1") {
      await recordJobFinish(jobId, true, { skipped: "auto_check_enabled=0" });
      return { ok: true, skipped: "auto_check_enabled=0" };
    }
    const proxyMode = map.proxy_mode === "1";

    const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const query = supabaseAdmin
      .from("cookie_pool")
      .select("id, cookies_json")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(200);
    const { data: rows } = force
      ? await query
      : await query.or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`);

    let checked = 0, active = 0, invalid = 0, on_hold = 0, free = 0, deleted = 0;

    for (const r of rows ?? []) {
      let proxyPayload: any = null;
      if (proxyMode) {
        const { data: pr } = await supabaseAdmin.rpc("pick_next_proxy");
        const p = Array.isArray(pr) ? pr[0] : pr;
        if (p) {
          proxyPayload = { scheme: p.scheme, ip: p.ip, port: p.port, username: p.username, password: p.password };
          await supabaseAdmin.rpc("release_proxy", { _id: p.id, _success: true });
        }
      }
      const out = await checkCookieViaWorker({ cookies: r.cookies_json as any[], proxy: proxyPayload });
      await supabaseAdmin.from("cookie_pool").update({
        status: out.status,
        is_valid: out.is_valid,
        email: out.email ?? null,
        country: out.country ?? null,
        plan_name: out.plan_name ?? null,
        video_quality: out.video_quality ?? null,
        name: out.name ?? null,
        member_since: out.member_since ?? null,
        max_streams: out.max_streams ?? null,
        payment_method: out.payment_method ?? null,
        last_checked_at: new Date().toISOString(),
        last_checked_mode: proxyMode ? "proxy" : "direct",
        last_error: out.error ?? null,
      }).eq("id", r.id);
      checked++;
      if (out.status === "active") active++;
      else if (out.status === "invalid") invalid++;
      else if (out.status === "on_hold") on_hold++;
      else if (out.status === "free") free++;
      if (checked % 5 === 0 || checked === (rows?.length ?? 0)) {
        await recordJobProgress(jobId, {
          phase: "checking", total: rows?.length ?? 0,
          checked, active, invalid, on_hold, free, proxy_mode: proxyMode,
        });
      }
    }
    await recordJobProgress(jobId, {
      phase: "cleanup", total: rows?.length ?? 0,
      checked, active, invalid, on_hold, free, proxy_mode: proxyMode,
    });

    const cleanupOn = map.autocheck_cleanup !== "0";
    let removed_invalid = 0, removed_free = 0, removed_on_hold = 0, removed_duplicates = 0;
    if (cleanupOn) {
      const { count: invCount } = await supabaseAdmin
        .from("cookie_pool").select("id", { count: "exact", head: true })
        .or("status.eq.invalid,is_valid.eq.false");
      await supabaseAdmin.from("cookie_pool").delete().or("status.eq.invalid,is_valid.eq.false");
      removed_invalid = invCount ?? 0;

      const { count: freeC } = await supabaseAdmin.from("cookie_pool").select("id", { count: "exact", head: true }).eq("status", "free");
      const { count: holdC } = await supabaseAdmin.from("cookie_pool").select("id", { count: "exact", head: true }).eq("status", "on_hold");
      await supabaseAdmin.from("cookie_pool").delete().in("status", ["free", "on_hold"]);
      removed_free = freeC ?? 0;
      removed_on_hold = holdC ?? 0;

      const { data: allRows } = await supabaseAdmin
        .from("cookie_pool").select("id,email,fingerprint,created_at")
        .order("created_at", { ascending: false });
      const seenE = new Set<string>(), seenF = new Set<string>();
      const dupIds: string[] = [];
      for (const r of allRows ?? []) {
        const em = (r.email ?? "").trim().toLowerCase();
        const fp = (r.fingerprint ?? "").trim();
        let dup = false;
        if (em) { if (seenE.has(em)) dup = true; else seenE.add(em); }
        if (!dup && fp) { if (seenF.has(fp)) dup = true; else seenF.add(fp); }
        if (dup) dupIds.push(r.id);
      }
      for (let i = 0; i < dupIds.length; i += 200) {
        await supabaseAdmin.from("cookie_pool").delete().in("id", dupIds.slice(i, i + 200));
      }
      removed_duplicates = dupIds.length;
      deleted = removed_invalid + removed_free + removed_on_hold + removed_duplicates;
    }

    const summary = { checked, active, invalid, on_hold, free, deleted, removed_invalid, removed_free, removed_on_hold, removed_duplicates, proxy_mode: proxyMode };
    await recordJobFinish(jobId, true, summary);
    return { ok: true, ...summary };
  } catch (e: any) {
    await recordJobFinish(jobId, false, {}, String(e?.message ?? e));
    return { ok: false, error: String(e?.message ?? e) };
  }
}

type ProxyRunResult = {
  ok: boolean;
  skipped?: string;
  checked?: number;
  ok_count?: number;
  dead?: number;
  removed_invalid?: number;
  error?: string;
};

export async function runProxiesAutocheck(force = false): Promise<ProxyRunResult> {
  const jobId = await recordJobStart("proxies-autocheck");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { checkProxyViaWorker } = await import("@/lib/worker.server");

  try {
    const { data: settings } = await supabaseAdmin
      .from("app_settings").select("key,value")
      .in("key", ["proxy_auto_check_enabled", "proxy_autocheck_cleanup"]);
    const map: Record<string, string> = {};
    for (const s of settings ?? []) map[s.key] = s.value;
    if (!force && map.proxy_auto_check_enabled === "0") {
      await recordJobFinish(jobId, true, { skipped: "proxy_auto_check_enabled=0" });
      return { ok: true, skipped: "proxy_auto_check_enabled=0" };
    }
    const { data: rows } = await supabaseAdmin
      .from("proxy_pool")
      .select("id, scheme, ip, port, username, password")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(500);

    let ok = 0, dead = 0;
    for (const p of rows ?? []) {
      const res = await checkProxyViaWorker({
        proxy: { scheme: p.scheme, ip: p.ip, port: p.port, username: p.username, password: p.password },
      });
      await supabaseAdmin.from("proxy_pool").update({
        is_valid: res.ok,
        last_error: res.error ?? null,
        last_latency_ms: res.latency_ms ?? null,
        country: res.country ?? null,
        last_checked_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (res.ok) ok++;
      else dead++;
      const done = ok + dead;
      if (done % 5 === 0 || done === (rows?.length ?? 0)) {
        await recordJobProgress(jobId, {
          phase: "checking", total: rows?.length ?? 0, checked: done, ok_count: ok, dead,
        });
      }
    }
    await recordJobProgress(jobId, {
      phase: "cleanup", total: rows?.length ?? 0, checked: (rows ?? []).length, ok_count: ok, dead,
    });

    let removed_invalid = 0;
    if (map.proxy_autocheck_cleanup !== "0") {
      const { count: c } = await supabaseAdmin
        .from("proxy_pool").select("id", { count: "exact", head: true }).eq("is_valid", false);
      await supabaseAdmin.from("proxy_pool").delete().eq("is_valid", false);
      removed_invalid = c ?? 0;
    }
    const summary = { checked: (rows ?? []).length, ok_count: ok, dead, removed_invalid };
    await recordJobFinish(jobId, true, summary);
    return { ok: true, ...summary };
  } catch (e: any) {
    await recordJobFinish(jobId, false, {}, String(e?.message ?? e));
    return { ok: false, error: String(e?.message ?? e) };
  }
}
