import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { listRecentJobRuns, listSettings, listCronSchedules, requestJobControl } from "@/lib/settings.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Activity, CheckCircle2, XCircle, Loader2, Cookie, Globe2, Sparkles, RefreshCw, Square, Ban, OctagonAlert, CalendarClock, Timer } from "lucide-react";
import { toast } from "sonner";
import { isQuietHoursNow } from "@/lib/quiet-hours";



type JobRow = {
  id: string;
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  summary: any;
  progress: any;
  error: string | null;
  control?: "stop" | "cancel" | null;
};

const JOB_META: Record<string, { label: string; icon: any }> = {
  "cookies-autocheck": { label: "Cookie auto-check", icon: Cookie },
  "proxies-autocheck": { label: "Proxy auto-check", icon: Globe2 },
  "proxy_recheck": { label: "Proxy recheck", icon: RefreshCw },
  "auto-cleanup": { label: "Nightly cleanup", icon: Sparkles },
};


function fmtDuration(a: string, b: string | null) {
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

function cookieSummaryLine(s: any) {
  if (!s) return "";
  if (s.skipped) return `Skipped (${s.skipped})`;
  const parts = [
    `${s.checked ?? 0} checked`,
    `${s.active ?? 0} active`,
    `${s.invalid ?? 0} invalid`,
    `${s.on_hold ?? 0} on-hold`,
    `${s.free ?? 0} free`,
  ];
  return parts.join(" · ");
}
function cookieCleanupLine(s: any) {
  if (!s || s.skipped) return "";
  const bits: string[] = [];
  if (s.removed_invalid) bits.push(`${s.removed_invalid} invalid removed`);
  if (s.removed_free) bits.push(`${s.removed_free} free removed`);
  if (s.removed_on_hold) bits.push(`${s.removed_on_hold} on-hold removed`);
  if (s.removed_duplicates) bits.push(`${s.removed_duplicates} duplicates removed`);
  return bits.join(" · ");
}
function proxySummaryLine(s: any) {
  if (!s) return "";
  if (s.skipped) return `Skipped (${s.skipped})`;
  const parts = [
    `${s.checked ?? 0} checked`,
    `${s.ok_count ?? 0} valid`,
    `${s.dead ?? 0} invalid`,
  ];
  if (s.removed_invalid) parts.push(`${s.removed_invalid} removed`);
  return parts.join(" · ");
}
function reasonsLine(s: any): string {
  const r = s?.reasons;
  if (!r || typeof r !== "object") return "";
  const entries = Object.entries(r as Record<string, number>)
    .filter(([, n]) => (n as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 4);
  if (!entries.length) return "";
  return "Reasons: " + entries.map(([k, n]) => `${k.replace(/_/g, " ")} ×${n}`).join(", ");
}
function cleanupSummaryLine(s: any) {
  if (!s) return "";
  const parts: string[] = [];
  if (s.dead_cookies) parts.push(`${s.dead_cookies} dead cookies`);
  if (s.free_hold) parts.push(`${s.free_hold} free/hold`);
  if (s.dead_proxies) parts.push(`${s.dead_proxies} dead proxies`);
  if (s.old_attempts) parts.push(`${s.old_attempts} old attempts`);
  if (s.old_log) parts.push(`${s.old_log} log rows`);
  return parts.length ? parts.join(" · ") + " pruned" : "Nothing to prune";
}

// ---- Minimal cron parser: supports *, */N, N, a,b,c, a-b in 5-field expressions.
function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const stepIdx = p.indexOf("/");
    const step = stepIdx >= 0 ? Math.max(1, parseInt(p.slice(stepIdx + 1), 10) || 1) : 1;
    const range = stepIdx >= 0 ? p.slice(0, stepIdx) : p;
    let lo = min, hi = max;
    if (range === "*" || range === "") { /* full range */ }
    else if (range.includes("-")) {
      const [a, b] = range.split("-").map((n) => parseInt(n, 10));
      if (!Number.isNaN(a) && !Number.isNaN(b)) { lo = a; hi = b; }
    } else {
      const n = parseInt(range, 10);
      if (!Number.isNaN(n)) { lo = n; hi = n; }
    }
    for (let v = lo; v <= hi; v += step) if (v >= min && v <= max) out.add(v);
  }
  return out;
}
function nextCronRun(expr: string, from: Date = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const mM = parseField(parts[0], 0, 59);
  const hM = parseField(parts[1], 0, 23);
  const dM = parseField(parts[2], 1, 31);
  const moM = parseField(parts[3], 1, 12);
  const dwM = parseField(parts[4], 0, 6);
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const maxIter = 366 * 24 * 60;
  for (let i = 0; i < maxIter; i++) {
    if (
      moM.has(d.getMonth() + 1) &&
      dM.has(d.getDate()) &&
      dwM.has(d.getDay()) &&
      hM.has(d.getHours()) &&
      mM.has(d.getMinutes())
    ) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}
function fmtCountdown(target: Date | null, now: number): string {
  if (!target) return "—";
  let s = Math.max(0, Math.floor((target.getTime() - now) / 1000));
  if (s <= 0) return "due now";
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return `in ${d}d ${h}h ${m}m`;
  if (h > 0) return `in ${h}h ${m}m ${s}s`;
  if (m > 0) return `in ${m}m ${s}s`;
  return `in ${s}s`;
}
function humanCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [mn, hr, dm, mo, dw] = parts;
  if (mn.startsWith("*/") && hr === "*" && dm === "*" && mo === "*" && dw === "*") return `Every ${mn.slice(2)}m`;
  if (hr.startsWith("*/") && mn === "0" && dm === "*" && mo === "*" && dw === "*") return `Every ${hr.slice(2)}h`;
  if (dm === "*" && mo === "*" && dw === "*" && /^\d+$/.test(mn) && /^\d+$/.test(hr)) {
    const H = hr.padStart(2, "0"), M = mn.padStart(2, "0");
    return `Daily @ ${H}:${M} UTC`;
  }
  return expr;
}

const JOBNAME_TO_JOB: Record<string, string> = {
  "emberlord-cookies-autocheck": "cookies-autocheck",
  "emberlord-proxies-autocheck": "proxies-autocheck",
  "emberlord-auto-cleanup": "auto-cleanup",
};

export function LiveJobsPanel() {
  const fetchRuns = useServerFn(listRecentJobRuns);
  const fetchSettings = useServerFn(listSettings);
  const fetchSchedules = useServerFn(listCronSchedules);
  const qc = useQueryClient();
  const anyRunning = (rows: JobRow[]) => rows.some((r) => !r.finished_at);

  const q = useQuery({
    queryKey: ["job-runs"],
    queryFn: () => fetchRuns(),
    refetchInterval: (query: any) => (anyRunning(query.state.data?.rows ?? []) ? 2_000 : 15_000),
  });
  const settingsQ = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
  });
  const schedulesQ = useQuery({
    queryKey: ["cron-schedules"],
    queryFn: () => fetchSchedules(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const settings = settingsQ.data?.settings ?? {};


  // Toast notifications on completion (respect notify_* + quiet hours).
  const seen = useRef<Set<string>>(new Set());
  const initialised = useRef(false);
  useEffect(() => {
    const rows: JobRow[] = q.data?.rows ?? [];
    if (!initialised.current) {
      for (const r of rows) if (r.finished_at) seen.current.add(r.id);
      initialised.current = true;
      return;
    }
    for (const r of rows) {
      if (!r.finished_at || seen.current.has(r.id)) continue;
      seen.current.add(r.id);

      // Invalidate lists so the admin sees removed counts immediately.
      if (r.job === "cookies-autocheck") {
        qc.invalidateQueries({ queryKey: ["cookies"] });
        qc.invalidateQueries({ queryKey: ["cookie-countries"] });
      } else if (r.job === "proxies-autocheck") {
        qc.invalidateQueries({ queryKey: ["proxies"] });
      }

      // Notification filters
      const notifyCookies = settings.notify_cookies !== "0";
      const notifyProxies = settings.notify_proxies !== "0";
      const notifyCleanup = settings.notify_cleanup !== "0";
      if (r.job === "cookies-autocheck" && !notifyCookies) continue;
      if (r.job === "proxies-autocheck" && !notifyProxies) continue;
      if (r.job === "auto-cleanup" && !notifyCleanup) continue;
      if (isQuietHoursNow(settings.notify_quiet_start, settings.notify_quiet_end)) continue;

      const meta = JOB_META[r.job] ?? { label: r.job };
      const dur = fmtDuration(r.started_at, r.finished_at);
      let desc = "";
      const rl = reasonsLine(r.summary);
      if (r.job === "cookies-autocheck") {
        const a = cookieSummaryLine(r.summary);
        const b = cookieCleanupLine(r.summary);
        desc = [a, b, rl].filter(Boolean).join(" • ") + ` • ${dur}`;
      } else if (r.job === "proxies-autocheck") {
        desc = [proxySummaryLine(r.summary), rl].filter(Boolean).join(" • ") + ` • ${dur}`;
      } else if (r.job === "proxy_recheck") {
        const s = r.summary ?? {};
        const parts = [
          `${s.total ?? 0} checked`,
          `${s.valid ?? 0} valid`,
          `${s.invalid ?? 0} invalid`,
        ];
        desc = `${parts.join(" • ")} • ${dur}`;
      } else if (r.job === "auto-cleanup") {
        desc = `${cleanupSummaryLine(r.summary)} • ${dur}`;
      } else {
        desc = `Completed in ${dur}`;
      }
      const label = meta.label.charAt(0).toUpperCase() + meta.label.slice(1);
      const s = r.summary ?? {};
      if (r.ok === false && String(r.error ?? "").toLowerCase().includes("cancel")) {
        toast.warning(`${label} cancelled`, { description: "Changes were rolled back." });
      } else if (r.ok === false) {
        toast.error(`${label} failed`, { description: r.error ?? desc });
      } else if (s.stopped) {
        toast.info(`${label} stopped`, { description: `Partial progress saved · ${desc}` });
      } else if (s.skipped) {
        toast.info(`${label} skipped`, { description: String(s.skipped) });
      } else {
        toast.success(`${label} complete`, { description: desc });
      }

    }
  }, [q.data, qc, settings.notify_cookies, settings.notify_proxies, settings.notify_cleanup, settings.notify_quiet_start, settings.notify_quiet_end]);

  // Quiet Hours — pure helper (see src/lib/quiet-hours.ts).


  const rows: JobRow[] = q.data?.rows ?? [];
  const active = rows.filter((r) => !r.finished_at);
  const history = rows.filter((r) => r.finished_at).slice(0, 6);

  // Live 1s tick for countdowns.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const scheduleRows = schedulesQ.data?.rows ?? [];
  const scheduleItems = useMemo(() => {
    const items = scheduleRows
      .map((s) => {
        const job = JOBNAME_TO_JOB[s.jobname];
        if (!job) return null;
        const meta = JOB_META[job] ?? { label: job, icon: Activity };
        const next = s.active ? nextCronRun(s.schedule, new Date(now)) : null;
        return { job, jobname: s.jobname, schedule: s.schedule, active: s.active, next, label: meta.label, Icon: meta.icon };
      })
      .filter(Boolean) as Array<{
        job: string; jobname: string; schedule: string; active: boolean;
        next: Date | null; label: string; Icon: any;
      }>;
    items.sort((a, b) => {
      if (!a.next && !b.next) return 0;
      if (!a.next) return 1;
      if (!b.next) return -1;
      return a.next.getTime() - b.next.getTime();
    });
    return items;
  }, [scheduleRows, now]);

  return (
    <div className="glass p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <Activity className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Live scheduled jobs</div>
            <div className="text-xs text-white/50 mt-1">Auto-refreshes every 2 seconds while a job is running.</div>
          </div>
        </div>
        <Badge variant="outline" className={active.length
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/10 text-white/60 border-white/15"}>
          {active.length ? `${active.length} running` : "Idle"}
        </Badge>
      </div>

      {/* Next scheduled runs — pulled live from pg_cron */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <CalendarClock className="w-3.5 h-3.5 text-white/50" />
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
            Next scheduled runs
          </div>
        </div>
        {schedulesQ.isLoading && scheduleItems.length === 0 ? (
          <div className="text-xs text-white/40 py-2 font-mono">Loading schedules…</div>
        ) : scheduleItems.length === 0 ? (
          <div className="text-xs text-white/40 py-2 font-mono">No scheduled jobs registered.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {scheduleItems.map((it) => {
              const paused = !it.active;
              const overdue = it.next && it.next.getTime() < now - 60_000;
              return (
                <div
                  key={it.jobname}
                  className={`rounded-md border p-3 flex items-start gap-3 ${
                    paused
                      ? "border-white/10 bg-white/[0.02] opacity-70"
                      : overdue
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  }`}
                >
                  <it.Icon className="w-3.5 h-3.5 text-white/60 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-sm font-medium truncate">{it.label}</div>
                      {paused && (
                        <Badge variant="outline" className="bg-white/5 border-white/15 text-white/60 text-[10px] uppercase">
                          Paused
                        </Badge>
                      )}
                      {overdue && !paused && (
                        <Badge variant="outline" className="bg-amber-500/15 border-amber-500/40 text-amber-200 text-[10px] uppercase">
                          Overdue
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/70 font-mono">
                      <Timer className="w-3 h-3 text-emerald-300/80 shrink-0" />
                      <span className={overdue ? "text-amber-200" : "text-emerald-300/90"}>
                        {paused ? "—" : fmtCountdown(it.next, now)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/50 font-mono truncate">
                      {it.next
                        ? it.next.toLocaleString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/40 font-mono truncate" title={it.schedule}>
                      {humanCron(it.schedule)} · <span className="text-white/30">{it.schedule}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {active.length > 0 && (
        <div className="space-y-3 mb-5">
          {active.map((r) => <RunningRow key={r.id} row={r} />)}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Recent runs</div>
        {history.length === 0 && (
          <div className="text-sm text-white/40 py-3">No completed runs yet.</div>
        )}
        {history.map((r) => <HistoryRow key={r.id} row={r} />)}
      </div>
    </div>
  );
}


function RunningRow({ row }: { row: JobRow }) {
  const meta = JOB_META[row.job] ?? { label: row.job, icon: Activity };
  const Icon = meta.icon;
  const p = row.progress ?? {};
  const total = p.total ?? 0;
  const done = p.checked ?? p.done ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const control = useServerFn(requestJobControl);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | "stop" | "cancel">(null);
  const [pending, setPending] = useState<null | "stop" | "cancel">(null);
  const requested: "stop" | "cancel" | null =
    (row as any).control === "stop" || (row as any).control === "cancel"
      ? (row as any).control
      : null;

  async function submit(action: "stop" | "cancel") {
    setConfirm(null);
    setPending(action);
    try {
      await control({ data: { id: row.id, action } });
      toast.message(action === "stop" ? "Stop requested" : "Cancel requested", {
        description: action === "stop"
          ? "Job will finish the current item and save progress."
          : "Job will abort, roll back checked rows, and discard progress.",
      });
      qc.invalidateQueries({ queryKey: ["job-runs"] });
    } catch (e: any) {
      toast.error("Could not send signal", { description: String(e?.message ?? e) });
      setPending(null);
    }
  }

  const stopColor = "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20";
  const cancelColor = "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20";
  const disabled = !!pending || !!requested;

  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="w-3.5 h-3.5 text-emerald-300 animate-spin shrink-0" />
          <Icon className="w-3.5 h-3.5 text-white/60 shrink-0" />
          <span className="text-sm font-medium truncate">{meta.label}</span>
          {p.phase && (
            <Badge variant="outline" className="bg-white/5 border-white/10 text-[10px] uppercase text-white/60">
              {p.phase}
            </Badge>
          )}
          {requested && (
            <Badge variant="outline" className={requested === "stop"
              ? "bg-amber-500/15 border-amber-500/40 text-amber-200 text-[10px] uppercase"
              : "bg-red-500/15 border-red-500/40 text-red-200 text-[10px] uppercase"}>
              {requested === "stop" ? "Stopping…" : "Cancelling…"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-white/50 font-mono">{fmtDuration(row.started_at, null)}</span>
          <Button
            size="sm" variant="outline" disabled={disabled}
            onClick={() => setConfirm("stop")}
            className={`h-7 px-2 text-[11px] gap-1 ${stopColor} disabled:opacity-40`}
            title="Stop and save partial progress"
          >
            <Square className="w-3 h-3" /> Stop
          </Button>
          <Button
            size="sm" variant="outline" disabled={disabled}
            onClick={() => setConfirm("cancel")}
            className={`h-7 px-2 text-[11px] gap-1 ${cancelColor} disabled:opacity-40`}
            title="Cancel and discard progress"
          >
            <Ban className="w-3 h-3" /> Cancel
          </Button>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full transition-all ${requested === "cancel"
            ? "bg-gradient-to-r from-red-400 to-red-500"
            : requested === "stop"
              ? "bg-gradient-to-r from-amber-400 to-amber-500"
              : "bg-gradient-to-r from-emerald-400 to-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-white/60 font-mono">
        <span>{done}/{total} • {pct}%</span>
        <span className="truncate ml-3">{row.job === "cookies-autocheck" ? cookieSummaryLine(p) : row.job.startsWith("prox") ? proxySummaryLine(p) : ""}</span>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="bg-[#0b0b0d] border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-display">
              <OctagonAlert className={`w-5 h-5 ${confirm === "cancel" ? "text-red-400" : "text-amber-400"}`} />
              {confirm === "stop" ? "Stop and save progress?" : "Cancel and discard progress?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/70 leading-relaxed">
              {confirm === "stop" ? (
                <>The job will finish the current item, skip the cleanup sweep, and save everything that was checked so far. Safe to resume later.</>
              ) : (
                <>The job will abort immediately, skip cleanup, roll back checked row changes from this run, keep the run cursor unchanged, and mark the run <span className="text-red-300">cancelled</span>.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm && submit(confirm)}
              className={confirm === "cancel"
                ? "bg-red-500/90 hover:bg-red-500 text-white border-0"
                : "bg-amber-500/90 hover:bg-amber-500 text-black border-0"}
            >
              {confirm === "stop" ? "Stop and save" : "Cancel run"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HistoryRow({ row }: { row: JobRow }) {
  const meta = JOB_META[row.job] ?? { label: row.job, icon: Activity };
  const Icon = meta.icon;
  const cancelled = !!row.summary?.cancelled;
  const stopped = !!row.summary?.stopped;
  const ok = row.ok !== false && !cancelled;
  let a = "";
  let b = "";
  if (row.job === "cookies-autocheck") {
    a = cookieSummaryLine(row.summary);
    b = cookieCleanupLine(row.summary);
  } else if (row.job === "proxies-autocheck") {
    a = proxySummaryLine(row.summary);
  } else if (row.job === "auto-cleanup") {
    a = cleanupSummaryLine(row.summary);
  }
  const StatusIcon = cancelled ? Ban : stopped ? Square : ok ? CheckCircle2 : XCircle;
  const statusColor = cancelled ? "text-red-300" : stopped ? "text-amber-300" : ok ? "text-emerald-300" : "text-red-300";
  return (
    <div className="flex items-start gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3">
      <StatusIcon className={`w-4 h-4 mt-0.5 shrink-0 ${statusColor}`} />
      <Icon className="w-3.5 h-3.5 text-white/50 mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-medium truncate">{meta.label}</div>
            {cancelled && (
              <Badge variant="outline" className="bg-red-500/15 border-red-500/40 text-red-200 text-[10px] uppercase">Cancelled</Badge>
            )}
            {stopped && !cancelled && (
              <Badge variant="outline" className="bg-amber-500/15 border-amber-500/40 text-amber-200 text-[10px] uppercase">Stopped</Badge>
            )}
          </div>
          <div className="text-[11px] text-white/40 font-mono shrink-0">
            {new Date(row.finished_at ?? row.started_at).toLocaleString()} · {fmtDuration(row.started_at, row.finished_at)}
          </div>
        </div>
        {a && <div className="text-xs text-white/60 mt-0.5 font-mono">{a}</div>}
        {b && <div className="text-xs text-emerald-300/80 mt-0.5 font-mono">{b}</div>}
        {(() => { const rl = reasonsLine(row.summary); return rl ? <div className="text-[11px] text-amber-300/80 mt-0.5 font-mono truncate" title={rl}>{rl}</div> : null; })()}
        {!ok && row.error && <div className="text-xs text-red-300 mt-0.5 font-mono truncate">{row.error}</div>}
      </div>
    </div>
  );
}
