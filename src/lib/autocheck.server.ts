// Shared logic for the cookie/proxy auto-check jobs.
// Used by both the /api/public/hooks/* cron routes and the admin "Run now" server fns.

import { recordJobStart, recordJobFinish, recordJobProgress, readJobControl, isJobRunning } from "@/lib/cron.server";

type CookieRunResult = {
  ok: boolean;
  skipped?: string;
  checked?: number;
  active?: number;
  invalid?: number;
  on_hold?: number;
  free?: number;
  transient?: number;
  deleted?: number;
  removed_invalid?: number;
  removed_free?: number;
  removed_on_hold?: number;
  removed_duplicates?: number;
  proxy_mode?: boolean;
  reasons?: Record<string, number>;
  error?: string;
};

type CookieSnapshot = {
  id: string;
  status: string | null;
  is_valid: boolean | null;
  email: string | null;
  country: string | null;
  plan_name: string | null;
  video_quality: string | null;
  name: string | null;
  member_since: string | null;
  max_streams: number | null;
  payment_method: string | null;
  last_checked_at: string | null;
  last_checked_mode: string | null;
  last_error: string | null;
};

type ProxySnapshot = {
  id: string;
  is_valid: boolean | null;
  last_error: string | null;
  last_latency_ms: number | null;
  country: string | null;
  last_checked_at: string | null;
};

async function restoreCookieSnapshots(supabaseAdmin: any, snapshots: CookieSnapshot[]) {
  for (const row of snapshots) {
    const { id, ...values } = row;
    await supabaseAdmin.from("cookie_pool").update(values).eq("id", id);
  }
}

async function restoreProxySnapshots(supabaseAdmin: any, snapshots: ProxySnapshot[]) {
  for (const row of snapshots) {
    const { id, ...values } = row;
    await supabaseAdmin.from("proxy_pool").update(values).eq("id", id);
  }
}

function watchJobControl(
  jobId: string | null,
  onSignal: (signal: "stop" | "cancel") => void,
  intervalMs = 1000,
) {
  if (!jobId) return () => {};
  let closed = false;
  const timer = setInterval(async () => {
    if (closed) return;
    const signal = await readJobControl(jobId);
    if (!signal) return;
    onSignal(signal);
    closed = true;
    clearInterval(timer);
  }, intervalMs);
  return () => {
    closed = true;
    clearInterval(timer);
  };
}

function bucketReason(msg: string | null | undefined): string {
  const s = String(msg ?? "").toLowerCase().trim();
  if (!s) return "unknown";
  if (s.includes("timeout") || s.includes("timed out")) return "timeout";
  if (s.includes("proxy")) return "proxy_error";
  if (s.includes("network") || s.includes("econn") || s.includes("fetch")) return "network";
  if (s.includes("expired") || s.includes("session")) return "session_expired";
  if (s.includes("challenge")) return "challenge_blocked";
  if (s.includes("forbidden") || s.includes("403")) return "forbidden";
  if (s.includes("unauth") || s.includes("401") || s.includes("login")) return "auth_failed";
  if (s.includes("hold")) return "on_hold";
  if (s.includes("free")) return "free_account";
  if (s.includes("invalid") || s.includes("cookie")) return "invalid_cookie";
  return s.slice(0, 40);
}

/** Run the cookie auto-check. When `force=true`, ignores the enabled flag. */
export async function runCookiesAutocheck(force = false): Promise<CookieRunResult> {
  // Same-job single-instance guard. Different jobs still run in parallel.
  if (await isJobRunning("cookies-autocheck")) {
    return { ok: true, skipped: "already_running" };
  }
  const jobId = await recordJobStart("cookies-autocheck");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { checkCookieViaWorker } = await import("@/lib/worker.server");

  try {
    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select("key,value")
      .in("key", ["proxy_mode", "auto_check_enabled", "autocheck_cleanup", "cookies_autocheck_interval_hours", "cookies_last_run_at"]);
    const map: Record<string, string> = {};
    for (const s of settings ?? []) map[s.key] = s.value;
    if (!force && map.auto_check_enabled !== "1") {
      await recordJobFinish(jobId, true, { skipped: "auto_check_enabled=0" });
      return { ok: true, skipped: "auto_check_enabled=0" };
    }
    const intervalHours = Math.max(1, parseInt(map.cookies_autocheck_interval_hours ?? "24", 10) || 24);
    if (!force && map.cookies_last_run_at) {
      const last = new Date(map.cookies_last_run_at).getTime();
      const nextDue = last + intervalHours * 3600 * 1000;
      if (Date.now() < nextDue) {
        const skip = `interval_not_elapsed (next in ${Math.ceil((nextDue - Date.now()) / 60000)}m)`;
        await recordJobFinish(jobId, true, { skipped: skip });
        return { ok: true, skipped: skip };
      }
    }
    const proxyMode = map.proxy_mode === "1";

    const cutoff = new Date(Date.now() - intervalHours * 3600 * 1000).toISOString();
    const query = supabaseAdmin
      .from("cookie_pool")
      .select("id, cookies_json, status, is_valid, email, country, plan_name, video_quality, name, member_since, max_streams, payment_method, last_checked_at, last_checked_mode, last_error")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(200);
    const { data: rows } = force
      ? await query
      : await query.or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`);

    let checked = 0, active = 0, invalid = 0, on_hold = 0, free = 0, transient = 0, deleted = 0;
    const reasons: Record<string, number> = {};
    let control: "stop" | "cancel" | null = null;
    const snapshots: CookieSnapshot[] = [];
    const abortCurrentCheck = new AbortController();
    const stopWatchingControl = watchJobControl(jobId, (signal) => {
      control = signal;
      if (signal === "cancel") abortCurrentCheck.abort(signal);
    });

    for (const r of rows ?? []) {
      control = await readJobControl(jobId);
      if (control) break;

      snapshots.push({
        id: r.id,
        status: r.status ?? null,
        is_valid: r.is_valid ?? null,
        email: r.email ?? null,
        country: r.country ?? null,
        plan_name: r.plan_name ?? null,
        video_quality: r.video_quality ?? null,
        name: r.name ?? null,
        member_since: r.member_since ?? null,
        max_streams: r.max_streams ?? null,
        payment_method: r.payment_method ?? null,
        last_checked_at: r.last_checked_at ?? null,
        last_checked_mode: r.last_checked_mode ?? null,
        last_error: r.last_error ?? null,
      });

      let proxyPayload: any = null;
      let proxyId: string | null = null;
      if (proxyMode) {
        const { data: pr } = await supabaseAdmin.rpc("pick_next_proxy");
        const p = Array.isArray(pr) ? pr[0] : pr;
        if (p) {
          proxyPayload = { scheme: p.scheme, ip: p.ip, port: p.port, username: p.username, password: p.password };
          proxyId = p.id;
        } else {
          // Strict proxy mode: skip rather than silently going direct so the toggle is honoured.
          const b = "no_proxy_available";
          reasons[b] = (reasons[b] ?? 0) + 1;
          await supabaseAdmin.from("cookie_pool").update({
            last_checked_at: new Date().toISOString(),
            last_checked_mode: "proxy",
            last_error: "Proxy mode ON but no proxies available.",
          }).eq("id", r.id);
          checked++;
          await recordJobProgress(jobId, {
            phase: "checking", total: rows?.length ?? 0,
            checked, active, invalid, on_hold, free, transient, proxy_mode: proxyMode, reasons,
          });
          control = await readJobControl(jobId);
          if (control) break;
          continue;
        }
      }
      const out = await checkCookieViaWorker({
        cookies: r.cookies_json as any[],
        proxy: proxyPayload,
        signal: abortCurrentCheck.signal,
      });
      if (control === "cancel") {
        if (proxyId) {
          await supabaseAdmin.from("proxy_pool").update({ is_locked: false, locked_at: null }).eq("id", proxyId);
        }
        break;
      }
      if (proxyId) {
        await supabaseAdmin.rpc("release_proxy", {
          _id: proxyId,
          _success: true,
          _err: undefined,
        });
      }
      if (out.transient) {
        await supabaseAdmin.from("cookie_pool").update({
          last_checked_mode: proxyMode ? "proxy" : "direct",
          last_error: out.error ?? "Transient cookie check failure",
        }).eq("id", r.id);
      } else {
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
      }
      checked++;
      if (out.transient) { transient++; const b = bucketReason(out.error); reasons[b] = (reasons[b] ?? 0) + 1; }
      else if (out.status === "active") active++;
      else if (out.status === "invalid") { invalid++; const b = bucketReason(out.error); reasons[b] = (reasons[b] ?? 0) + 1; }
      else if (out.status === "on_hold") { on_hold++; const b = out.error ? bucketReason(out.error) : "on_hold"; reasons[b] = (reasons[b] ?? 0) + 1; }
      else if (out.status === "free") free++;
      if (checked % 5 === 0 || checked === (rows?.length ?? 0)) {
        await recordJobProgress(jobId, {
          phase: "checking", total: rows?.length ?? 0,
          checked, active, invalid, on_hold, free, transient, proxy_mode: proxyMode, reasons,
        });
      }
      // Cooperative stop/cancel: poll after every item so the admin control is immediate.
      control = await readJobControl(jobId);
      if (control) break;
    }
    stopWatchingControl();
    if (control === "cancel") {
      const summary = { checked, active, invalid, on_hold, free, transient, proxy_mode: proxyMode, reasons, cancelled: true };
      await recordJobProgress(jobId, { ...summary, phase: "rolling_back", total: rows?.length ?? 0 });
      await restoreCookieSnapshots(supabaseAdmin, snapshots);
      await recordJobFinish(jobId, false, summary, "Cancelled by admin");
      return { ok: false, error: "cancelled", ...summary };
    }
    await recordJobProgress(jobId, {
      phase: "cleanup", total: rows?.length ?? 0,
      checked, active, invalid, on_hold, free, transient, proxy_mode: proxyMode, reasons,
      stopped: control === "stop" || undefined,
    });

    // Cleanup is skipped when the admin pressed Stop mid-run — we save what
    // was checked but do not sweep the pool. Cancel already returned above.
    const cleanupOn = map.autocheck_cleanup !== "0" && control !== "stop";
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

    const summary = {
      checked, active, invalid, on_hold, free, transient, deleted,
      removed_invalid, removed_free, removed_on_hold, removed_duplicates,
      proxy_mode: proxyMode, reasons,
      stopped: control === "stop" || undefined,
    };
    await recordJobFinish(jobId, true, summary);
    // On stop, still advance the cursor: partial work counts as a run.
    await supabaseAdmin.from("app_settings").upsert({
      key: "cookies_last_run_at", value: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
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
  transient?: number;
  removed_invalid?: number;
  reasons?: Record<string, number>;
  error?: string;
};

export async function runProxiesAutocheck(force = false): Promise<ProxyRunResult> {
  // Same-job single-instance guard. Different jobs still run in parallel.
  if (await isJobRunning("proxies-autocheck")) {
    return { ok: true, skipped: "already_running" };
  }
  const jobId = await recordJobStart("proxies-autocheck");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { checkProxyViaWorker } = await import("@/lib/worker.server");

  try {
    const { data: settings } = await supabaseAdmin
      .from("app_settings").select("key,value")
      .in("key", ["proxy_auto_check_enabled", "proxy_autocheck_cleanup", "proxies_autocheck_interval_hours", "proxies_last_run_at"]);
    const map: Record<string, string> = {};
    for (const s of settings ?? []) map[s.key] = s.value;
    if (!force && map.proxy_auto_check_enabled === "0") {
      await recordJobFinish(jobId, true, { skipped: "proxy_auto_check_enabled=0" });
      return { ok: true, skipped: "proxy_auto_check_enabled=0" };
    }
    const intervalHours = Math.max(1, parseInt(map.proxies_autocheck_interval_hours ?? "20", 10) || 20);
    if (!force && map.proxies_last_run_at) {
      const last = new Date(map.proxies_last_run_at).getTime();
      const nextDue = last + intervalHours * 3600 * 1000;
      if (Date.now() < nextDue) {
        const skip = `interval_not_elapsed (next in ${Math.ceil((nextDue - Date.now()) / 60000)}m)`;
        await recordJobFinish(jobId, true, { skipped: skip });
        return { ok: true, skipped: skip };
      }
    }
    const { data: rows } = await supabaseAdmin
      .from("proxy_pool")
      .select("id, scheme, ip, port, username, password, is_valid, last_error, last_latency_ms, country, last_checked_at")
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(500);

    let ok = 0, dead = 0, transient = 0;
    const reasons: Record<string, number> = {};
    let control: "stop" | "cancel" | null = null;
    const snapshots: ProxySnapshot[] = [];
    const abortCurrentCheck = new AbortController();
    const stopWatchingControl = watchJobControl(jobId, (signal) => {
      control = signal;
      if (signal === "cancel") abortCurrentCheck.abort(signal);
    });
    for (const p of rows ?? []) {
      control = await readJobControl(jobId);
      if (control) break;

      snapshots.push({
        id: p.id,
        is_valid: p.is_valid ?? null,
        last_error: p.last_error ?? null,
        last_latency_ms: p.last_latency_ms ?? null,
        country: p.country ?? null,
        last_checked_at: p.last_checked_at ?? null,
      });

      const res = await checkProxyViaWorker({
        proxy: { scheme: p.scheme, ip: p.ip, port: p.port, username: p.username, password: p.password },
        signal: abortCurrentCheck.signal,
      });
      if (control === "cancel") break;
      if (res.transient) {
        await supabaseAdmin.from("proxy_pool").update({
          last_error: res.error ?? "Transient proxy check failure",
        }).eq("id", p.id);
        transient++;
        const b = bucketReason(res.error);
        reasons[b] = (reasons[b] ?? 0) + 1;
      } else {
        await supabaseAdmin.from("proxy_pool").update({
          is_valid: res.ok,
          last_error: res.error ?? null,
          last_latency_ms: res.latency_ms ?? null,
          country: res.country ?? null,
          last_checked_at: new Date().toISOString(),
        }).eq("id", p.id);
        if (res.ok) ok++;
        else { dead++; const b = bucketReason(res.error); reasons[b] = (reasons[b] ?? 0) + 1; }
      }
      const done = ok + dead + transient;
      if (done % 5 === 0 || done === (rows?.length ?? 0)) {
        await recordJobProgress(jobId, {
          phase: "checking", total: rows?.length ?? 0, checked: done, ok_count: ok, dead, transient, reasons,
        });
      }
      control = await readJobControl(jobId);
      if (control) break;
    }
    stopWatchingControl();
    if (control === "cancel") {
      const summary = { checked: ok + dead + transient, ok_count: ok, dead, transient, reasons, cancelled: true };
      await recordJobProgress(jobId, { ...summary, phase: "rolling_back", total: rows?.length ?? 0 });
      await restoreProxySnapshots(supabaseAdmin, snapshots);
      await recordJobFinish(jobId, false, summary, "Cancelled by admin");
      return { ok: false, error: "cancelled", ...summary };
    }
    await recordJobProgress(jobId, {
      phase: "cleanup", total: rows?.length ?? 0, checked: ok + dead + transient, ok_count: ok, dead, transient, reasons,
      stopped: control === "stop" || undefined,
    });

    let removed_invalid = 0;
    if (map.proxy_autocheck_cleanup !== "0" && control !== "stop") {
      const { count: c } = await supabaseAdmin
        .from("proxy_pool").select("id", { count: "exact", head: true }).eq("is_valid", false);
      await supabaseAdmin.from("proxy_pool").delete().eq("is_valid", false);
      removed_invalid = c ?? 0;
    }
    const summary = {
      checked: ok + dead + transient, ok_count: ok, dead, transient, removed_invalid, reasons,
      stopped: control === "stop" || undefined,
    };
    await recordJobFinish(jobId, true, summary);
    await supabaseAdmin.from("app_settings").upsert({
      key: "proxies_last_run_at", value: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return { ok: true, ...summary };
  } catch (e: any) {
    await recordJobFinish(jobId, false, {}, String(e?.message ?? e));
    return { ok: false, error: String(e?.message ?? e) };
  }
}
