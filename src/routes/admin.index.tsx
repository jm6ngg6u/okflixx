import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardStats,
  getPoolSummary,
  getWorkerHealth,
  getRecentActivity,
  listAttempts,
} from "@/lib/admin.functions";
import { listSettings, toggleProxyMode } from "@/lib/settings.functions";
import { checkAllCookies } from "@/lib/pool.functions";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity, CheckCircle2, ShieldOff, Bot, XCircle, TrendingUp, MapPin, Zap,
  Cookie, Globe2, Server, RefreshCw, Users, ScrollText, Sparkles, ArrowUpRight,
  Pause, Play, Radio, Gauge, Timer, Flame, ArrowUp, ArrowDown, Minus,
  Download, FileText, Bell, BellOff, AlertTriangle, X, Copy, Printer, Settings2,
  Layers, GitCompare,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Line, ComposedChart } from "recharts";
import { toast } from "sonner";
import { LiveJobsPanel } from "@/components/LiveJobsPanel";
import { AnomalyBanner } from "@/components/AnomalyBanner";
import { SLOPanel } from "@/components/SLOPanel";
import { ActivationPipelines } from "@/components/ActivationPipelines";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: DashboardPage,
});

const WINDOWS: { label: string; hours: number }[] = [
  { label: "1H", hours: 1 },
  { label: "24H", hours: 24 },
  { label: "7D", hours: 24 * 7 },
  { label: "30D", hours: 24 * 30 },
  { label: "ALL", hours: 24 * 365 * 5 },
];

// Aggregates poll fast enough to hit the ≤2s live-refresh SLA for KPIs,
// pool counts, worker health, and admin-driven settings (proxy mode,
// maintenance, gates). Realtime channels below push instant deltas on
// row-level events so this is a safety net, not the primary path.
const AGG_REFRESH_MS = 2_000;
const SETTINGS_REFRESH_MS = 2_000;


const RESULT_STYLE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rate_limited: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  bot_detected: "bg-red-500/15 text-red-300 border-red-500/30",
  invalid_code: "bg-white/10 text-white/60 border-white/15",
  server_error: "bg-red-500/15 text-red-300 border-red-500/30",
};

type Attempt = {
  id: string;
  code: string | null;
  result: string | null;
  country: string | null;
  user_agent: string | null;
  created_at: string;
  ip_hash: string | null;
};

type Thresholds = {
  failureRatePct: number; // e.g. 40 = 40% failures in recent window triggers alert
  failureWindowMin: number; // recent window size for failure rate
  runwayHours: number; // alert when runway drops under this
  alertsMuted: boolean;
};

const THRESHOLDS_KEY = "okflix.dashboard.alerts";
const DEFAULT_THRESHOLDS: Thresholds = {
  failureRatePct: 40,
  failureWindowMin: 10,
  runwayHours: 6,
  alertsMuted: false,
};

function loadThresholds(): Thresholds {
  if (typeof window === "undefined") return DEFAULT_THRESHOLDS;
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    return { ...DEFAULT_THRESHOLDS, ...JSON.parse(raw) };
  } catch { return DEFAULT_THRESHOLDS; }
}
function saveThresholds(t: Thresholds) {
  try { localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t)); } catch { /* noop */ }
}

function DashboardPage() {
  const [hours, setHours] = useState(24);
  const [paused, setPaused] = useState(false);
  const [modalAttempt, setModalAttempt] = useState<Attempt | null>(null);
  const [liveRows, setLiveRows] = useState<Attempt[]>([]);
  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [thresholds, setThresholds] = useState<Thresholds>(() => loadThresholds());
  const [activeAlerts, setActiveAlerts] = useState<{ id: string; kind: "failure" | "runway"; msg: string; at: number }[]>([]);
  const [clusterFailures, setClusterFailures] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  const fetchStats = useServerFn(getDashboardStats);
  const fetchPool = useServerFn(getPoolSummary);
  const fetchHealth = useServerFn(getWorkerHealth);
  const fetchActivity = useServerFn(getRecentActivity);
  const fetchSettings = useServerFn(listSettings);
  const fetchAttempts = useServerFn(listAttempts);
  const doToggle = useServerFn(toggleProxyMode);
  const doCheckAll = useServerFn(checkAllCookies);
  const qc = useQueryClient();

  // Pause polling when the tab is hidden so we don't burn DB QPS at 2s
  // cadence on backgrounded windows. Realtime channels stay subscribed and
  // will push any deltas immediately when the tab is refocused.
  const [tabVisible, setTabVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const aggInterval = paused || !tabVisible ? false : AGG_REFRESH_MS;
  const settingsInterval = paused || !tabVisible ? false : SETTINGS_REFRESH_MS;

  const stats = useQuery({
    queryKey: ["dashboard-stats", hours],
    queryFn: () => fetchStats({ data: { windowHours: hours } }),
    refetchInterval: aggInterval,
  });
  const prevStats = useQuery({
    queryKey: ["dashboard-stats-prev", hours],
    queryFn: () => fetchStats({ data: { windowHours: hours * 2 } }),
    refetchInterval: aggInterval === false ? false : aggInterval * 3,
  });
  const pool = useQuery({ queryKey: ["pool-summary"], queryFn: () => fetchPool(), refetchInterval: aggInterval });
  const health = useQuery({ queryKey: ["worker-health"], queryFn: () => fetchHealth(), refetchInterval: aggInterval });
  const activity = useQuery({ queryKey: ["recent-activity"], queryFn: () => fetchActivity(), refetchInterval: aggInterval });
  const settingsQ = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings(), refetchInterval: settingsInterval });

  // Seed the live ticker on mount / hours change; realtime keeps it fresh after.
  const initialAttempts = useQuery({
    queryKey: ["dashboard-live-attempts-seed"],
    queryFn: () => fetchAttempts({ data: { page: 0, pageSize: 20 } }),
    staleTime: 60_000,
  });

  // Merge seed into liveRows once
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const rows = initialAttempts.data?.rows;
    if (rows && rows.length) {
      setLiveRows(rows.slice(0, 20));
      seededRef.current = true;
    }
  }, [initialAttempts.data]);

  // Supabase Realtime — instant push on new attempts
  useEffect(() => {
    setRtStatus("connecting");
    const channel = supabase
      .channel("dashboard-attempts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activation_attempts" },
        (payload) => {
          const row = payload.new as Attempt;
          if (!row?.id) return;
          setLiveRows((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            return [row, ...prev].slice(0, 20);
          });
          setPulseKey((k) => k + 1);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("offline");
      });
    return () => { supabase.removeChannel(channel); };
  }, []);

  const proxyOn = settingsQ.data?.settings?.proxy_mode === "1";
  const maintOn = settingsQ.data?.settings?.maintenance_enabled === "1";

  const kpi = stats.data?.kpi ?? { total: 0, success: 0, rate_limited: 0, bot_detected: 0, invalid_code: 0, other: 0 };
  const successRate = kpi.total ? Math.round((kpi.success / kpi.total) * 1000) / 10 : 0;

  const prevKpi = useMemo(() => {
    const full = prevStats.data?.kpi;
    if (!full) return null;
    return {
      total: Math.max(0, full.total - kpi.total),
      success: Math.max(0, full.success - kpi.success),
      rate_limited: Math.max(0, full.rate_limited - kpi.rate_limited),
      bot_detected: Math.max(0, full.bot_detected - kpi.bot_detected),
      invalid_code: Math.max(0, full.invalid_code - kpi.invalid_code),
    };
  }, [prevStats.data, kpi]);
  const prevRate = prevKpi && prevKpi.total ? (prevKpi.success / prevKpi.total) * 100 : null;

  const throughputPerMin = kpi.total / Math.max(1, hours * 60);
  const activeCookies = pool.data?.cookies.active ?? 0;
  const burntPerHour = ((pool.data?.cookies.invalid ?? 0) + (pool.data?.cookies.on_hold ?? 0)) / Math.max(1, hours);
  const runwayHours = burntPerHour > 0.05 ? activeCookies / burntPerHour : Infinity;

  // Raw numeric series (for anomaly detection — needs actual timestamps + counts)
  const rawSeries = stats.data?.series ?? [];

  // Compare overlay: prevStats fetches window*2, so buckets whose timestamp is
  // older than (now - hours) belong to the previous window. Shift them forward
  // by exactly `hours` so they align on the same X-axis as the current series.
  const compareSeries = useMemo(() => {
    if (!compareMode) return null;
    const prevAll = prevStats.data?.series ?? [];
    if (!prevAll.length) return null;
    const cutoff = Date.now() - hours * 3600_000;
    const shifted = new Map<number, { total: number; success: number }>();
    for (const s of prevAll) {
      if (s.t >= cutoff) continue; // this bucket is in the current window
      const shiftedT = s.t + hours * 3600_000;
      shifted.set(shiftedT, { total: s.total, success: s.success });
    }
    return shifted;
  }, [compareMode, prevStats.data, hours]);

  const series = rawSeries.map((s) => {
    const prev = compareSeries?.get(s.t);
    return {
      t: new Date(s.t).toLocaleString(undefined, hours <= 48 ? { hour: "2-digit", day: "2-digit", month: "short" } : { day: "2-digit", month: "short" }),
      Total: s.total,
      Success: s.success,
      PrevTotal: prev?.total ?? null,
    };
  });

  const c = pool.data?.cookies ?? { active: 0, on_hold: 0, free: 0, invalid: 0, unknown: 0, total: 0 };
  const p = pool.data?.proxies ?? { valid: 0, invalid: 0, total: 0 };

  const lastSyncTs = Math.max(stats.dataUpdatedAt || 0, pool.dataUpdatedAt || 0, health.dataUpdatedAt || 0);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const secSinceSync = lastSyncTs ? Math.max(0, Math.floor((nowTick - lastSyncTs) / 1000)) : 0;
  const anyFetching = stats.isFetching || pool.isFetching || health.isFetching;

  const [pulseKey, setPulseKey] = useState(0);

  // Failure clustering: collapse repeat failures from the same IP+result into
  // one row (with count) to keep the ticker readable during abuse waves.
  type TickerItem = { kind: "row"; row: Attempt } | { kind: "cluster"; rows: Attempt[]; ip: string; result: string };
  const tickerItems: TickerItem[] = useMemo(() => {
    if (!clusterFailures) return liveRows.map((row) => ({ kind: "row", row }));
    const CLUSTER_WINDOW_MS = 10 * 60_000;
    const out: TickerItem[] = [];
    const openClusters = new Map<string, { rows: Attempt[]; lastTs: number }>();
    for (const r of liveRows) {
      const isFail = r.result && r.result !== "success" && r.result !== "invalid_code";
      if (!isFail || !r.ip_hash || !r.result) {
        out.push({ kind: "row", row: r });
        continue;
      }
      const key = `${r.ip_hash}::${r.result}`;
      const ts = new Date(r.created_at).getTime();
      const existing = openClusters.get(key);
      if (existing && Math.abs(existing.lastTs - ts) <= CLUSTER_WINDOW_MS) {
        existing.rows.push(r);
        existing.lastTs = ts;
      } else {
        const bag = { rows: [r], lastTs: ts };
        openClusters.set(key, bag);
        out.push({ kind: "cluster", rows: bag.rows, ip: r.ip_hash, result: r.result });
      }
    }
    // Drop clusters of 1 back down to a plain row.
    return out.map((it) => (it.kind === "cluster" && it.rows.length === 1 ? { kind: "row", row: it.rows[0] } : it));
  }, [liveRows, clusterFailures]);

  // Failure share (from aggregate window)
  const failures = [
    { key: "rate_limited", label: "Rate limited", value: kpi.rate_limited, color: "#f59e0b" },
    { key: "bot_detected", label: "Bot detected", value: kpi.bot_detected, color: "#ff2a3a" },
    { key: "invalid_code", label: "Invalid code", value: kpi.invalid_code, color: "#94a3b8" },
    { key: "other", label: "Other", value: kpi.other, color: "#64748b" },
  ];
  const failTotal = failures.reduce((a, b) => a + b.value, 0);

  // ---------- Real-time alerting ----------
  const lastToastRef = useRef<{ failure: number; runway: number }>({ failure: 0, runway: 0 });
  useEffect(() => {
    if (thresholds.alertsMuted) return;
    const now = Date.now();
    const nextAlerts: typeof activeAlerts = [];

    // Failure spike in recent window from live ticker
    const cutoff = now - thresholds.failureWindowMin * 60_000;
    const recent = liveRows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
    if (recent.length >= 5) {
      const fails = recent.filter((r) => r.result && r.result !== "success").length;
      const rate = (fails / recent.length) * 100;
      if (rate >= thresholds.failureRatePct) {
        const id = "failure-spike";
        nextAlerts.push({
          id, kind: "failure", at: now,
          msg: `Failure rate ${rate.toFixed(0)}% over last ${thresholds.failureWindowMin}m (${fails}/${recent.length}). Threshold ${thresholds.failureRatePct}%.`,
        });
        if (now - lastToastRef.current.failure > 60_000) {
          toast.error(`Failure spike: ${rate.toFixed(0)}% fails in ${thresholds.failureWindowMin}m`, { duration: 6000 });
          lastToastRef.current.failure = now;
        }
      }
    }

    // Runway
    if (Number.isFinite(runwayHours) && runwayHours < thresholds.runwayHours && (pool.data?.cookies.total ?? 0) > 0) {
      const id = "runway-low";
      nextAlerts.push({
        id, kind: "runway", at: now,
        msg: `Cookie runway ${runwayHours.toFixed(1)}h — under ${thresholds.runwayHours}h threshold (${activeCookies} active).`,
      });
      if (now - lastToastRef.current.runway > 300_000) {
        toast.error(`Cookie runway low: ${runwayHours.toFixed(1)}h left`, { duration: 6000 });
        lastToastRef.current.runway = now;
      }
    }

    setActiveAlerts(nextAlerts);
  }, [liveRows, runwayHours, activeCookies, thresholds, pool.data?.cookies.total]);

  // ---------- Export ----------
  const exportCSV = () => {
    const lines: string[] = [];
    lines.push("# OKFLIX Activation Dashboard export");
    lines.push(`# Exported at: ${new Date().toISOString()}`);
    lines.push(`# Window: ${hours}h`);
    lines.push("");
    lines.push("## KPI");
    lines.push("metric,value");
    lines.push(`total,${kpi.total}`);
    lines.push(`success,${kpi.success}`);
    lines.push(`success_rate_pct,${successRate}`);
    lines.push(`rate_limited,${kpi.rate_limited}`);
    lines.push(`bot_detected,${kpi.bot_detected}`);
    lines.push(`invalid_code,${kpi.invalid_code}`);
    lines.push(`other,${kpi.other}`);
    lines.push(`throughput_per_min,${throughputPerMin.toFixed(3)}`);
    lines.push(`runway_hours,${Number.isFinite(runwayHours) ? runwayHours.toFixed(2) : "inf"}`);
    lines.push("");
    lines.push("## Failure breakdown");
    lines.push("reason,count,share_pct");
    for (const f of failures) {
      const share = failTotal ? (f.value / failTotal) * 100 : 0;
      lines.push(`${f.label},${f.value},${share.toFixed(1)}`);
    }
    lines.push("");
    lines.push("## Live ticker");
    lines.push("time,code,result,country,ip_hash,user_agent");
    for (const r of liveRows) {
      const ua = (r.user_agent ?? "").replace(/"/g, '""');
      lines.push(`${r.created_at},${r.code ?? ""},${r.result ?? ""},${r.country ?? ""},${r.ip_hash ?? ""},"${ua}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activation-dashboard-${hours}h-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const exportPDF = () => {
    const win = window.open("", "_blank", "width=900,height=1000");
    if (!win) { toast.error("Pop-up blocked — allow pop-ups to print"); return; }
    const rows = liveRows.map((r) => `
      <tr>
        <td>${new Date(r.created_at).toLocaleString()}</td>
        <td>${escapeHtml(r.code ?? "")}</td>
        <td>${escapeHtml(r.result ?? "")}</td>
        <td>${escapeHtml(r.country ?? "")}</td>
      </tr>`).join("");
    const failRows = failures.map((f) => {
      const share = failTotal ? (f.value / failTotal) * 100 : 0;
      return `<tr><td>${f.label}</td><td>${f.value}</td><td>${share.toFixed(1)}%</td></tr>`;
    }).join("");
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
      <title>Activation Dashboard — ${hours}h</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:32px;max-width:820px;margin:auto}
        h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:24px 0 8px;color:#e5091b;letter-spacing:.1em;text-transform:uppercase}
        .meta{color:#666;font-size:12px;margin-bottom:24px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
        th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
        th{background:#fafafa;font-weight:600;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#666}
        .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
        .kpi>div{border:1px solid #eee;padding:10px;border-radius:6px}
        .kpi .lbl{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#888}
        .kpi .val{font-size:20px;font-weight:600;margin-top:4px}
        @media print{@page{margin:.5in}}
      </style></head><body>
      <h1>OKFLIX — Activation Dashboard</h1>
      <div class="meta">Window: ${hours}h · Exported ${new Date().toLocaleString()}</div>
      <h2>KPI</h2>
      <div class="kpi">
        <div><div class="lbl">Attempts</div><div class="val">${kpi.total}</div></div>
        <div><div class="lbl">Success</div><div class="val">${kpi.success} · ${successRate}%</div></div>
        <div><div class="lbl">Throughput</div><div class="val">${throughputPerMin.toFixed(2)}/min</div></div>
        <div><div class="lbl">Runway</div><div class="val">${Number.isFinite(runwayHours) ? runwayHours.toFixed(1) + "h" : "∞"}</div></div>
      </div>
      <h2>Failure breakdown</h2>
      <table><thead><tr><th>Reason</th><th>Count</th><th>Share</th></tr></thead><tbody>${failRows}</tbody></table>
      <h2>Live ticker (${liveRows.length})</h2>
      <table><thead><tr><th>Time</th><th>Code</th><th>Result</th><th>Country</th></tr></thead><tbody>${rows}</tbody></table>
      <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
      </body></html>`);
    win.document.close();
    toast.success("Print dialog opened — save as PDF");
  };

  return (
    <div className="space-y-8 font-ops">
      {/* Adaptive anomaly banner (rolling z-score on failure rate) */}
      <AnomalyBanner series={rawSeries} />

      {/* Alert banner */}
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          {activeAlerts.map((a) => (
            <div key={a.id} className="glass border-[#ff2a3a]/40 bg-[#ff2a3a]/[0.06] p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-[#ff2a3a] mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="font-display text-sm text-[#ff8a90]">
                  {a.kind === "failure" ? "Failure spike detected" : "Cookie runway low"}
                </div>
                <div className="text-xs text-white/70 font-mono mt-0.5">{a.msg}</div>
              </div>
              <button
                onClick={() => setActiveAlerts((prev) => prev.filter((x) => x.id !== a.id))}
                className="text-white/40 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-2 flex items-center gap-2">
            <Radio className={`w-3 h-3 ${rtStatus === "live" ? "text-[#ff2a3a] animate-pulse" : "text-white/30"}`} />
            // Control Room
          </div>
          <h1 className="font-display text-4xl md:text-5xl leading-none">
            Activation <span className="text-shine">Dashboard</span>
          </h1>
          <p className="text-white/50 text-sm mt-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                rtStatus === "live" ? "bg-emerald-400 animate-pulse"
                : rtStatus === "connecting" ? "bg-amber-400 animate-pulse"
                : "bg-[#ff2a3a]"
              }`} />
              Realtime {rtStatus === "live" ? "connected" : rtStatus === "connecting" ? "connecting…" : "offline (polling)"}
            </span>
            <span className="font-mono text-xs text-white/40">
              aggregates · {AGG_REFRESH_MS / 1000}s · last {secSinceSync}s ago{anyFetching ? " · syncing" : ""}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportCSV}
            title="Export current window as CSV"
            className="h-9 px-3 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs font-mono uppercase tracking-widest text-white/70 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={exportPDF}
            title="Print-ready PDF export"
            className="h-9 px-3 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs font-mono uppercase tracking-widest text-white/70 inline-flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> PDF
          </button>
          <AlertsSettings thresholds={thresholds} onChange={(t) => { setThresholds(t); saveThresholds(t); }} />
          <button
            onClick={() => setCompareMode((v) => !v)}
            title={compareMode ? "Hide previous-window overlay" : "Compare with previous window"}
            className={`h-9 px-3 rounded-full border text-xs font-mono uppercase tracking-widest inline-flex items-center gap-1.5 transition ${
              compareMode
                ? "border-[#ff2a3a]/40 bg-[#ff2a3a]/[0.08] text-[#ff8a90]"
                : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" /> Compare
          </button>
          <button
            onClick={() => setPaused((v) => !v)}
            title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-center"
          >
            {paused ? <Play className="w-3.5 h-3.5 text-white/70" /> : <Pause className="w-3.5 h-3.5 text-white/70" />}
          </button>
          <button
            onClick={() => { qc.invalidateQueries(); toast.success("Refreshed"); }}
            title="Force refresh"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-center"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-white/70 ${anyFetching ? "animate-spin" : ""}`} />
          </button>
          <div className="flex items-center gap-1 p-1 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur">
            {WINDOWS.map((w) => (
              <button
                key={w.hours}
                onClick={() => setHours(w.hours)}
                className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase tracking-widest transition ${
                  hours === w.hours
                    ? "bg-gradient-to-r from-[#ff2a3a] to-[#b0060f] text-white shadow-[0_0_20px_rgba(229,9,20,0.4)]"
                    : "text-white/50 hover:text-white"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* System bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass glass-hover p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40">
              <Server className="w-3.5 h-3.5" /> Worker
            </div>
            <span className={`w-2 h-2 rounded-full ${health.data?.ok ? "bg-emerald-400 animate-pulse" : "bg-[#ff2a3a] animate-pulse"}`} />
          </div>
          <div className="mt-3 font-display text-2xl">
            {health.data?.ok ? <span className="text-emerald-400">Online</span> : <span className="text-[#ff2a3a]">Offline</span>}
          </div>
          <div className="text-xs font-mono text-white/40 mt-1">
            {health.data?.latency_ms != null ? `${health.data.latency_ms}ms` : "—"}
            {health.data?.error && <span className="ml-2 text-[#ff8a90]">· {health.data.error}</span>}
          </div>
        </div>

        <div className="glass glass-hover p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40">
              <Zap className="w-3.5 h-3.5" /> Proxy mode
            </div>
            <Switch
              checked={proxyOn}
              onCheckedChange={async () => {
                try {
                  const r = await doToggle();
                  toast.success(`Proxy mode ${r.proxy_mode ? "enabled" : "disabled"}`);
                  qc.invalidateQueries({ queryKey: ["admin-settings"] });
                } catch (e: any) { toast.error(e?.message ?? "Toggle failed"); }
              }}
            />
          </div>
          <div className="mt-3 font-display text-2xl">{proxyOn ? "Proxied" : "Direct"}</div>
          <div className="text-xs text-white/40 mt-1">{proxyOn ? "Routing via proxy pool" : "Direct edge connections"}</div>
        </div>

        <div className={`glass glass-hover p-5 ${maintOn ? "border-[#ff2a3a]/40" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40">
              <ShieldOff className="w-3.5 h-3.5" /> Public site
            </div>
            <span className={`w-2 h-2 rounded-full ${maintOn ? "bg-[#ff2a3a] animate-pulse" : "bg-emerald-400"}`} />
          </div>
          <div className="mt-3 font-display text-2xl">
            {maintOn ? <span className="text-[#ff2a3a]">Maintenance</span> : <span className="text-emerald-400">Live</span>}
          </div>
          <Link to="/admin/settings" className="text-xs text-white/40 hover:text-white mt-1 inline-flex items-center gap-1">
            Manage <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Activity} label="Attempts" value={kpi.total.toLocaleString()} tone="primary"
          delta={prevKpi ? deltaPct(kpi.total, prevKpi.total) : null} />
        <Kpi icon={CheckCircle2} label="Success" value={kpi.success.toLocaleString()} sub={`${successRate}%`} tone="success"
          delta={prevKpi ? deltaPct(kpi.success, prevKpi.success) : null} />
        <Kpi icon={TrendingUp} label="Rate" value={`${successRate}%`} tone="success"
          delta={prevRate != null ? Math.round((successRate - prevRate) * 10) / 10 : null} deltaSuffix="pp" />
        <Kpi icon={Gauge} label="Per min" value={throughputPerMin < 1 ? throughputPerMin.toFixed(2) : throughputPerMin.toFixed(1)} tone="primary" sub="throughput" />
        <Kpi icon={Bot} label="Bot flags" value={kpi.bot_detected.toLocaleString()} tone="warning"
          delta={prevKpi ? deltaPct(kpi.bot_detected, prevKpi.bot_detected) : null} invertDelta />
        <Kpi icon={Flame} label="Runway" value={
          runwayHours === Infinity ? "∞" : runwayHours >= 48 ? `${Math.round(runwayHours / 24)}d` : `${runwayHours.toFixed(1)}h`
        } tone={runwayHours < thresholds.runwayHours ? "warning" : "success"} sub={`${activeCookies} active`} />
      </div>

      <LiveJobsPanel />

      {/* Live activation pipelines — queue → cookie → proxy → worker → result */}
      <ActivationPipelines />

      {/* SLO · Live ticker · Failure breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass p-5 lg:col-span-2 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Radio className="w-4 h-4 text-[#ff2a3a]" />
                <span key={pulseKey} className="absolute inset-0 rounded-full bg-[#ff2a3a]/40 animate-ping" />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Live feed · realtime</div>
                <div className="font-display text-lg">Latest activations</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setClusterFailures((v) => !v)}
                title={clusterFailures ? "Show all rows" : "Group repeat failures by IP + reason"}
                className={`h-7 px-2.5 rounded-md border text-[10px] font-mono uppercase tracking-widest inline-flex items-center gap-1 transition ${
                  clusterFailures
                    ? "border-[#ff2a3a]/40 bg-[#ff2a3a]/10 text-[#ff8a90]"
                    : "border-white/10 bg-white/[0.03] text-white/50 hover:bg-white/[0.06]"
                }`}
              >
                <Layers className="w-3 h-3" /> Cluster
              </button>
              <Link to="/admin/attempts" className="text-xs font-mono text-white/40 hover:text-white inline-flex items-center gap-1">
                Open log <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
          <div className="space-y-1.5">
            {tickerItems.length === 0 ? (
              <div className="text-sm text-white/40 font-mono py-6 text-center">
                {initialAttempts.isLoading ? "Warming up…" : "No activations yet"}
              </div>
            ) : (
              tickerItems.map((it, idx) => {
                if (it.kind === "cluster") {
                  const rep = it.rows[0];
                  return (
                    <button
                      type="button"
                      key={`c-${it.ip}-${it.result}-${rep.id}`}
                      onClick={() => setModalAttempt(rep)}
                      className="row-slide-in w-full grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 text-xs font-mono py-1.5 px-2 rounded border border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] transition text-left tabular-nums"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="text-amber-200 truncate inline-flex items-center gap-1.5">
                        <Layers className="w-3 h-3" />
                        <span>{it.rows.length}× repeats · IP {it.ip.slice(0, 10)}…</span>
                      </span>
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${RESULT_STYLE[it.result] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                        {it.result.replace(/_/g, " ")}
                      </span>
                      <span className="text-white/50 w-8 text-right">{rep.country ?? "—"}</span>
                      <span className="text-white/30 w-14 text-right">{relTime(rep.created_at, nowTick)}</span>
                    </button>
                  );
                }
                const r = it.row;
                return (
                  <button
                    type="button"
                    key={r.id}
                    onClick={() => setModalAttempt(r)}
                    className={`row-slide-in w-full grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 text-xs font-mono py-1.5 px-2 rounded border transition text-left tabular-nums ${
                      idx === 0 ? "bg-[#ff2a3a]/5 border-[#ff2a3a]/20" : "border-transparent hover:bg-white/[0.04] hover:border-white/10"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      r.result === "success" ? "bg-emerald-400" :
                      r.result === "rate_limited" ? "bg-amber-400" :
                      r.result === "bot_detected" ? "bg-[#ff2a3a]" : "bg-white/30"
                    }`} />
                    <span className="text-[#ff8a90] truncate">{r.code}</span>
                    <span className={`px-1.5 py-0.5 rounded border text-[10px] ${RESULT_STYLE[r.result ?? ""] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                      {(r.result ?? "unknown").replace(/_/g, " ")}
                    </span>
                    <span className="text-white/50 w-8 text-right">{r.country ?? "—"}</span>
                    <span className="text-white/30 w-14 text-right">{relTime(r.created_at, nowTick)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4">
          <SLOPanel successCount={kpi.success} totalCount={kpi.total} windowHours={hours} />

          <div className="glass p-5">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-4 h-4 text-[#ff2a3a]" />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Breakdown</div>
                <div className="font-display text-lg">Failure share</div>
              </div>
            </div>
            {failTotal === 0 ? (
              <div className="text-sm text-white/40 font-mono py-6 text-center">Zero failures 🎉</div>
            ) : (
              <div className="space-y-3">
                {failures.map((f) => {
                  const pct = failTotal ? (f.value / failTotal) * 100 : 0;
                  return (
                    <div key={f.key}>
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-white/70">{f.label}</span>
                        <span className="font-mono text-white/50 tabular-nums">{f.value} · {pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: f.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>


      {/* Pool + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PoolCard
          icon={Cookie} title="Cookie pool" total={c.total} to="/admin/cookies"
          segments={[
            { label: "Active", value: c.active, color: "#22c55e" },
            { label: "On hold", value: c.on_hold, color: "#f59e0b" },
            { label: "Free", value: c.free, color: "#60a5fa" },
            { label: "Invalid", value: c.invalid, color: "#ff2a3a" },
            { label: "Unknown", value: c.unknown, color: "#64748b" },
          ]}
        />
        <PoolCard
          icon={Globe2} title="Proxy pool" total={p.total} to="/admin/proxies"
          segments={[
            { label: "Healthy", value: p.valid, color: "#22c55e" },
            { label: "Dead", value: p.invalid, color: "#ff2a3a" },
          ]}
        />
        <div className="glass p-5 flex flex-col">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40 mb-4">
            <Sparkles className="w-3.5 h-3.5" /> Quick actions
          </div>
          <div className="grid grid-cols-2 gap-2 flex-1">
            <QuickBtn to="/admin/cookies" icon={Cookie} label="Cookies" />
            <QuickBtn to="/admin/proxies" icon={Globe2} label="Proxies" />
            <QuickBtn to="/admin/attempts" icon={ScrollText} label="Attempts" />
            <QuickBtn to="/admin/staff" icon={Users} label="Staff" />
          </div>
          <button
            onClick={async () => {
              const id = toast.loading("Rechecking cookie pool…");
              try {
                const r = await doCheckAll();
                toast.success(`Rechecked ${r.checked} · active ${r.active} · invalid ${r.invalid}`, { id });
                qc.invalidateQueries({ queryKey: ["pool-summary"] });
              } catch (e: any) { toast.error(e?.message ?? "Recheck failed", { id }); }
            }}
            className="btn-red mt-3 w-full text-sm inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Recheck all cookies
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="glass p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Timeline</div>
            <div className="font-display text-xl mt-1">
              Attempts over time
              {compareMode && (
                <span className="ml-3 align-middle text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border border-[#ff2a3a]/30 bg-[#ff2a3a]/10 text-[#ff8a90]">
                  vs previous {hours}h
                </span>
              )}
            </div>
          </div>
          <div className="text-xs font-mono text-white/40 inline-flex items-center gap-2">
            <Timer className="w-3.5 h-3.5" /> {stats.isFetching ? "syncing…" : `refreshed ${secSinceSync}s ago`}
          </div>
        </div>
        <div className="h-[280px]">
          {series.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-white/40 font-mono">No data in this window</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff2a3a" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#ff2a3a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="t" stroke="rgba(255,255,255,0.4)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={10} allowDecimals={false} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,42,58,0.4)", borderRadius: 12, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }} />
                <Area type="monotone" dataKey="Total" stroke="#ff2a3a" fill="url(#gTotal)" strokeWidth={2} />
                <Area type="monotone" dataKey="Success" stroke="#22c55e" fill="url(#gSuccess)" strokeWidth={2} />
                {compareMode && (
                  <Line
                    type="monotone"
                    dataKey="PrevTotal"
                    name={`Prev ${hours}h`}
                    stroke="#ff8a90"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Countries + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass p-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-4 h-4 text-[#ff2a3a]" />
            <div className="font-display text-lg">Top countries</div>
          </div>
          <div className="space-y-2">
            {(stats.data?.countries ?? []).length === 0 ? (
              <div className="text-sm text-white/40 font-mono py-6 text-center">No activity yet</div>
            ) : (
              stats.data!.countries.slice(0, 8).map((cn) => (
                <div key={cn.country} className="flex items-center gap-3 text-sm">
                  <div className="font-mono text-white/70 w-10">{cn.country}</div>
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#ff8a90]"
                      style={{ width: `${Math.min(100, (cn.total / (stats.data!.countries[0]?.total || 1)) * 100)}%` }} />
                  </div>
                  <div className="font-mono text-xs text-white/50 w-16 text-right">{cn.total}</div>
                  <div className={`font-mono text-xs w-14 text-right ${cn.rate >= 70 ? "text-emerald-400" : cn.rate >= 30 ? "text-amber-400" : "text-white/40"}`}>
                    {cn.rate}%
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="glass p-6">
          <div className="flex items-center gap-2 mb-4">
            <ScrollText className="w-4 h-4 text-[#ff2a3a]" />
            <div className="font-display text-lg">Recent admin activity</div>
          </div>
          <div className="space-y-3 max-h-[320px] overflow-y-auto pr-2">
            {(activity.data?.rows ?? []).length === 0 ? (
              <div className="text-sm text-white/40 font-mono py-6 text-center">No activity yet</div>
            ) : (
              activity.data!.rows.map((r: any) => (
                <div key={r.id} className="flex items-start gap-3 text-sm border-l-2 border-[#ff2a3a]/40 pl-3 py-1">
                  <div className="flex-1">
                    <div className="font-mono text-xs text-white/80">{r.action}</div>
                    {r.details && (
                      <div className="text-[11px] text-white/40 font-mono mt-0.5 truncate">
                        {JSON.stringify(r.details).slice(0, 100)}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-white/30 font-mono whitespace-nowrap">
                    {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Attempt detail modal */}
      <AttemptModal attempt={modalAttempt} onClose={() => setModalAttempt(null)} />
    </div>
  );
}

function AlertsSettings({ thresholds, onChange }: { thresholds: Thresholds; onChange: (t: Thresholds) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title="Alert thresholds"
          className={`h-9 w-9 rounded-full border inline-flex items-center justify-center transition ${
            thresholds.alertsMuted
              ? "border-white/10 bg-white/[0.03] text-white/40"
              : "border-[#ff2a3a]/30 bg-[#ff2a3a]/[0.08] text-[#ff8a90] hover:bg-[#ff2a3a]/[0.12]"
          }`}
        >
          {thresholds.alertsMuted ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] bg-black/95 backdrop-blur border-white/10">
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Settings2 className="w-3.5 h-3.5 text-[#ff2a3a]" />
              <div className="font-display text-sm">Alert thresholds</div>
            </div>
            <div className="text-[10px] text-white/40 font-mono">Stored locally · toast + banner</div>
          </div>
          <div className="space-y-3">
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-white/50">Failure rate %</Label>
              <Input
                type="number" min={5} max={100}
                value={thresholds.failureRatePct}
                onChange={(e) => onChange({ ...thresholds, failureRatePct: Math.max(5, Math.min(100, Number(e.target.value) || 0)) })}
                className="bg-white/5 border-white/10 font-mono h-8 mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-white/50">Window (minutes)</Label>
              <Input
                type="number" min={1} max={60}
                value={thresholds.failureWindowMin}
                onChange={(e) => onChange({ ...thresholds, failureWindowMin: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                className="bg-white/5 border-white/10 font-mono h-8 mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-widest text-white/50">Runway floor (hours)</Label>
              <Input
                type="number" min={1} max={168}
                value={thresholds.runwayHours}
                onChange={(e) => onChange({ ...thresholds, runwayHours: Math.max(1, Math.min(168, Number(e.target.value) || 1)) })}
                className="bg-white/5 border-white/10 font-mono h-8 mt-1"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
              <Switch
                checked={!thresholds.alertsMuted}
                onCheckedChange={(v) => onChange({ ...thresholds, alertsMuted: !v })}
              />
              Alerts enabled
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AttemptModal({ attempt, onClose }: { attempt: Attempt | null; onClose: () => void }) {
  const copy = (label: string, val: string) => {
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Copy failed"));
  };
  return (
    <Dialog open={!!attempt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-black/95 backdrop-blur border-white/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Activation attempt
            {attempt?.result && (
              <span className={`ml-3 align-middle px-2 py-0.5 rounded border text-[11px] font-mono ${RESULT_STYLE[attempt.result] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                {attempt.result.replace("_", " ")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {attempt && (
          <div className="space-y-3 text-sm mt-2">
            <DetailRow label="Code" value={attempt.code ?? "—"} mono copy={() => copy("Code", attempt.code ?? "")} />
            <DetailRow label="Time" value={new Date(attempt.created_at).toLocaleString()} mono />
            <DetailRow label="Country" value={attempt.country ?? "—"} mono />
            <DetailRow label="IP hash" value={attempt.ip_hash ?? "—"} mono copy={() => copy("IP hash", attempt.ip_hash ?? "")} />
            <DetailRow label="User agent" value={attempt.user_agent ?? "—"} multiline copy={() => copy("User agent", attempt.user_agent ?? "")} />
            <DetailRow label="Attempt ID" value={attempt.id} mono copy={() => copy("ID", attempt.id)} />
            <div className="pt-3 border-t border-white/5 text-[11px] font-mono text-white/40 leading-relaxed">
              Note · this is a completed historical record. Per-step logs, retry, and cancel require an in-flight activation orchestrator; no such flow exists for finished attempts.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value, mono, multiline, copy }: { label: string; value: string; mono?: boolean; multiline?: boolean; copy?: () => void }) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto] gap-3 items-start">
      <div className="text-[10px] uppercase tracking-widest text-white/40 pt-1">{label}</div>
      <div className={`${mono ? "font-mono" : ""} text-white/80 ${multiline ? "break-all" : "truncate"} text-xs`}>{value}</div>
      {copy && (
        <button onClick={copy} className="text-white/40 hover:text-white transition" title="Copy">
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function deltaPct(cur: number, prev: number) {
  if (!prev) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function relTime(iso: string, now: number) {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Kpi({
  icon: Icon, label, value, sub, tone, delta, deltaSuffix, invertDelta,
}: {
  icon: any; label: string; value: number | string; sub?: string;
  tone: "primary" | "success" | "warning" | "muted";
  delta?: number | null; deltaSuffix?: string; invertDelta?: boolean;
}) {
  const toneMap: Record<string, string> = {
    primary: "text-[#ff2a3a]", success: "text-emerald-400", warning: "text-amber-400", muted: "text-white/50",
  };
  const showDelta = delta != null && Number.isFinite(delta);
  const good = showDelta && (invertDelta ? delta! < 0 : delta! > 0);
  const bad = showDelta && (invertDelta ? delta! > 0 : delta! < 0);
  const DeltaIcon = !showDelta ? Minus : delta! > 0 ? ArrowUp : delta! < 0 ? ArrowDown : Minus;
  return (
    <div className="glass glass-hover p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/40">
        <Icon className={`w-3.5 h-3.5 ${toneMap[tone]}`} /> {label}
      </div>
      <div className="mt-2 font-display text-2xl leading-none">{value}</div>
      <div className="flex items-center gap-2 mt-1.5 h-4">
        {sub && <span className={`text-[11px] font-mono ${toneMap[tone]}`}>{sub}</span>}
        {showDelta && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono ml-auto ${
            good ? "text-emerald-400" : bad ? "text-[#ff8a90]" : "text-white/30"
          }`}>
            <DeltaIcon className="w-3 h-3" />
            {Math.abs(delta!).toFixed(delta! % 1 === 0 ? 0 : 1)}{deltaSuffix ?? "%"}
          </span>
        )}
      </div>
    </div>
  );
}

function PoolCard({ icon: Icon, title, total, to, segments }: {
  icon: any; title: string; total: number; to: string;
  segments: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(total, 1);
  return (
    <Link to={to} className="glass glass-hover p-5 block">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40">
          <Icon className="w-3.5 h-3.5" /> {title}
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-white/30" />
      </div>
      <div className="font-display text-3xl">{total}</div>
      <div className="mt-4 flex h-1.5 rounded-full overflow-hidden bg-white/5">
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
            <span className="text-white/60">{s.label}</span>
            <span className="ml-auto font-mono text-white/50">{s.value}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function QuickBtn({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link to={to} className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] hover:border-[#ff2a3a]/50 hover:bg-[#ff2a3a]/5 transition p-3">
      <Icon className="w-4 h-4 text-[#ff2a3a]" />
      <span className="text-xs text-white/70">{label}</span>
    </Link>
  );
}
