import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAttempts } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronLeft, ChevronRight, Search, ScrollText, Filter, X, Radio,
  Download, Rows3, Rows2, Copy, Cookie, Globe2, Clock, Timer, AlertCircle,
  CheckCircle2, RefreshCw, Pause, Play, Activity, Users, TrendingUp, Zap,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/attempts")({
  head: () => ({ meta: [{ title: "Attempts log — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: AttemptsPage,
});

type SelectionReason = {
  policy?: string;
  filters?: {
    include_statuses?: string[];
    require_valid?: boolean;
    min_success_rate?: number;
    min_total_uses?: number;
  };
  eligible_at_pick?: number | null;
  cookie?: {
    status?: string | null;
    is_valid?: boolean | null;
    total_uses?: number;
    success_count?: number;
    fail_count?: number;
    success_rate?: number | null;
    last_used_at?: string | null;
  };
  why?: string;
  outcome?: string;
};

type Attempt = {
  id: string;
  code: string | null;
  result: string | null;
  country: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  created_at: string;
  cookie_id: string | null;
  proxy_id: string | null;
  proxy_mode: boolean | null;
  attempt_number: number | null;
  duration_ms: number | null;
  error_message: string | null;
  selection_reason: SelectionReason | null;
};

const RESULTS = [
  { key: "success",       label: "Success",       tone: "emerald" },
  { key: "rate_limited",  label: "Rate limited",  tone: "amber"   },
  { key: "bot_detected",  label: "Bot detected",  tone: "red"     },
  { key: "invalid_code",  label: "Invalid code",  tone: "slate"   },
  { key: "expired_code",  label: "Expired code",  tone: "slate"   },
  { key: "maintenance",   label: "Maintenance",   tone: "sky"     },
  { key: "no_cookie",     label: "No cookie",     tone: "red"     },
  { key: "exhausted",     label: "Exhausted",     tone: "red"     },
  { key: "server_error",  label: "Server error",  tone: "red"     },
];

const RESULT_STYLE: Record<string, string> = {
  success:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rate_limited: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  bot_detected: "bg-red-500/15 text-red-300 border-red-500/30",
  invalid_code: "bg-white/10 text-white/60 border-white/15",
  expired_code: "bg-white/10 text-white/60 border-white/15",
  maintenance:  "bg-sky-500/15 text-sky-300 border-sky-500/30",
  no_cookie:    "bg-red-500/15 text-red-300 border-red-500/30",
  exhausted:    "bg-red-500/15 text-red-300 border-red-500/30",
  server_error: "bg-red-500/15 text-red-300 border-red-500/30",
};

const TIME_PRESETS: { label: string; minutes: number | null }[] = [
  { label: "15m", minutes: 15 },
  { label: "1h",  minutes: 60 },
  { label: "6h",  minutes: 60 * 6 },
  { label: "24h", minutes: 60 * 24 },
  { label: "7d",  minutes: 60 * 24 * 7 },
  { label: "All", minutes: null },
];

const PAGE_SIZE = 50;
const LIVE_POLL_MS = 2000; // user-requested cadence — see below for pause rules

function AttemptsPage() {
  const [page, setPage] = useState(0);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [sinceMinutes, setSinceMinutes] = useState<number | null>(60); // 1h default
  const [density, setDensity] = useState<"comfy" | "compact">("comfy");
  const [paused, setPaused] = useState(false);
  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [modalAttempt, setModalAttempt] = useState<Attempt | null>(null);
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set());
  const [tabVisible, setTabVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  const fetchList = useServerFn(listAttempts);
  const qc = useQueryClient();

  // Pause polling when tab is hidden — protects DB QPS with 2000+ concurrent admins.
  // Resume immediately on refocus with a forced refetch (no duplicate rows, react-query
  // dedupes on queryKey).
  useEffect(() => {
    const onVis = () => {
      const visible = document.visibilityState === "visible";
      setTabVisible(visible);
      if (visible) qc.invalidateQueries({ queryKey: ["attempts"] });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [qc]);

  // Only auto-refresh while on page 0, tab visible, and not manually paused.
  const shouldPoll = !paused && page === 0 && tabVisible;

  const query = useQuery({
    queryKey: ["attempts", page, selectedResults.join(","), country, q, sinceMinutes ?? "all"],
    queryFn: () =>
      fetchList({
        data: {
          page,
          pageSize: PAGE_SIZE,
          results: selectedResults.length ? selectedResults : undefined,
          country: country || undefined,
          q: q || undefined,
          sinceMinutes: sinceMinutes ?? undefined,
        },
      }),
    refetchInterval: shouldPoll ? LIVE_POLL_MS : false,
  });

  const rows = (query.data?.rows ?? []) as Attempt[];
  const total = query.data?.count ?? 0;
  const summary = query.data?.summary ?? { success: 0, fail: 0, total: 0, avg_duration_ms: 0, unique_ips: 0, sampled: 0 };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Realtime — flash inserted rows so they stand out from the polled refresh.
  const lastRowIdRef = useRef<string | null>(null);
  useEffect(() => {
    setRtStatus("connecting");
    const flash = (id: string) => {
      setNewRowIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      window.setTimeout(() => {
        setNewRowIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 2400);
    };
    const channel = supabase
      .channel("attempts-log-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activation_attempts" },
        (payload) => {
          const row = payload.new as Attempt;
          if (!row?.id) return;
          flash(row.id);
          if (shouldPoll) qc.invalidateQueries({ queryKey: ["attempts"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "activation_attempts" },
        (payload) => {
          const row = payload.new as Attempt;
          if (!row?.id) return;
          flash(row.id);
          if (shouldPoll) qc.invalidateQueries({ queryKey: ["attempts"] });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRtStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRtStatus("offline");
      });
    return () => { supabase.removeChannel(channel); };
  }, [qc, shouldPoll]);

  // Track top row so we can detect "new since last poll" purely from the
  // paginated response (fallback if realtime is offline).
  useEffect(() => {
    const top = rows[0]?.id ?? null;
    if (top && lastRowIdRef.current && top !== lastRowIdRef.current) {
      // Flash rows that appear above the previous top-of-list
      const idx = rows.findIndex((r) => r.id === lastRowIdRef.current);
      const freshCount = idx >= 0 ? idx : Math.min(rows.length, 5);
      if (freshCount > 0) {
        setNewRowIds((prev) => {
          const next = new Set(prev);
          for (let i = 0; i < freshCount; i++) if (rows[i]?.id) next.add(rows[i].id);
          return next;
        });
        window.setTimeout(() => {
          setNewRowIds(() => new Set());
        }, 2400);
      }
    }
    if (top) lastRowIdRef.current = top;
  }, [rows]);

  // Time bucket separators between rows
  const bucketed = useMemo(() => bucketRows(rows), [rows]);

  const activeFilterCount =
    (selectedResults.length ? 1 : 0) +
    (country ? 1 : 0) +
    (q ? 1 : 0) +
    (sinceMinutes !== null ? 1 : 0);

  const clearAll = () => {
    setSelectedResults([]); setCountry(""); setQ(""); setQInput(""); setSinceMinutes(null); setPage(0);
  };

  const toggleResult = (key: string) => {
    setSelectedResults((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
    setPage(0);
  };

  const exportCSV = () => {
    const header = [
      "time_iso", "attempt", "code", "result", "duration_ms",
      "country", "proxy_mode", "cookie_id", "proxy_id",
      "ip_hash", "error_message", "user_agent",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      const cells = [
        r.created_at,
        r.attempt_number ?? "",
        r.code ?? "",
        r.result ?? "",
        r.duration_ms ?? "",
        r.country ?? "",
        r.proxy_mode ? "true" : "false",
        r.cookie_id ?? "",
        r.proxy_id ?? "",
        r.ip_hash ?? "",
        csvSafe(r.error_message ?? ""),
        csvSafe(r.user_agent ?? ""),
      ];
      lines.push(cells.join(","));
    }
    downloadFile(
      `attempts-page${page + 1}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
      lines.join("\n"),
      "text/csv;charset=utf-8",
    );
    toast.success(`Exported ${rows.length} rows`);
  };

  const rowPad = density === "compact" ? "py-1.5" : "py-3";
  const rowText = density === "compact" ? "text-[11px]" : "text-xs";

  const successRate = summary.total ? Math.round((summary.success / summary.total) * 1000) / 10 : 0;

  return (
    <div className="space-y-6 font-ops">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
            <ScrollText className="w-5 h-5 text-[#ff2a3a]" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1 flex items-center gap-2">
              <Radio className={`w-3 h-3 ${rtStatus === "live" ? "text-[#ff2a3a] animate-pulse" : "text-white/30"}`} />
              // Attempts log · live stream
            </div>
            <h1 className="font-display text-3xl md:text-4xl leading-none">Activation attempts</h1>
            <p className="text-sm text-white/50 mt-2 flex items-center gap-2 flex-wrap font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${
                rtStatus === "live" ? "bg-emerald-400 animate-pulse"
                : rtStatus === "connecting" ? "bg-amber-400 animate-pulse"
                : "bg-[#ff2a3a]"
              }`} />
              <span className="text-white/70">
                {rtStatus === "live" ? "realtime + " : ""}poll every {LIVE_POLL_MS / 1000}s
                {!shouldPoll && <span className="text-amber-400"> · paused</span>}
              </span>
              <span className="text-white/30">·</span>
              <span className="tabular-nums text-white/70">{total.toLocaleString()} total match</span>
              {query.isFetching && <span className="text-emerald-400 tabular-nums">· syncing…</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setDensity((d) => d === "comfy" ? "compact" : "comfy")}
            title={density === "comfy" ? "Compact rows" : "Comfortable rows"}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-center"
          >
            {density === "comfy" ? <Rows2 className="w-3.5 h-3.5 text-white/70" /> : <Rows3 className="w-3.5 h-3.5 text-white/70" />}
          </button>
          <button
            onClick={exportCSV}
            disabled={!rows.length}
            title="Export current page as CSV"
            className="h-9 px-3 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-40 text-xs font-mono uppercase tracking-widest text-white/70 inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={() => setPaused((v) => !v)}
            title={paused ? "Resume live refresh" : "Pause live refresh"}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-center"
          >
            {paused ? <Play className="w-3.5 h-3.5 text-white/70" /> : <Pause className="w-3.5 h-3.5 text-white/70" />}
          </button>
          <button
            onClick={() => { qc.invalidateQueries({ queryKey: ["attempts"] }); toast.success("Refreshed"); }}
            title="Force refresh"
            className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-center"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-white/70 ${query.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Live KPI strip — reflects the active filter */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniStat icon={Activity} label="Matches"    value={total.toLocaleString()} tone="primary" sub={`${summary.sampled} sampled`} />
        <MiniStat icon={CheckCircle2} label="Success" value={summary.success.toLocaleString()} tone="success" sub={`${successRate}%`} />
        <MiniStat icon={AlertCircle} label="Failed"  value={summary.fail.toLocaleString()} tone="danger" sub={summary.total ? `${(100 - successRate).toFixed(1)}%` : "—"} />
        <MiniStat icon={Timer}       label="Avg latency" value={summary.avg_duration_ms ? fmtMs(summary.avg_duration_ms) : "—"} tone="muted" sub="worker time" />
        <MiniStat icon={Users}       label="Unique IPs"  value={summary.unique_ips.toLocaleString()} tone="muted" sub="hashed" />
      </div>

      {/* Filter surface */}
      <div className="glass p-5 space-y-4">
        {/* Time presets */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40 font-mono">
            <Clock className="w-3.5 h-3.5" /> Time window
          </div>
          <div className="flex items-center gap-1 p-1 rounded-full border border-white/10 bg-white/[0.02]">
            {TIME_PRESETS.map((t) => {
              const active = sinceMinutes === t.minutes;
              return (
                <button
                  key={t.label}
                  onClick={() => { setSinceMinutes(t.minutes); setPage(0); }}
                  className={`px-3 py-1 rounded-full text-[11px] font-mono uppercase tracking-widest transition ${
                    active
                      ? "bg-gradient-to-r from-[#ff2a3a] to-[#b0060f] text-white shadow-[0_0_16px_rgba(229,9,20,0.35)]"
                      : "text-white/50 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Result chips */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40 font-mono">
            <Filter className="w-3.5 h-3.5" /> Result
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {RESULTS.map((r) => {
              const on = selectedResults.includes(r.key);
              return (
                <button
                  key={r.key}
                  onClick={() => toggleResult(r.key)}
                  className={`h-7 px-2.5 rounded-md border text-[11px] font-mono transition ${
                    on
                      ? RESULT_STYLE[r.key] ?? "bg-white/10 text-white border-white/20"
                      : "border-white/10 bg-white/[0.02] text-white/40 hover:text-white/80 hover:bg-white/[0.06]"
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
            {selectedResults.length > 0 && (
              <button
                onClick={() => { setSelectedResults([]); setPage(0); }}
                className="h-7 px-2 rounded-md text-[10px] font-mono text-white/40 hover:text-white/80 inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Search + country */}
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Country (e.g. US)"
            value={country}
            onChange={(e) => { setCountry(e.target.value.toUpperCase().slice(0, 3)); setPage(0); }}
            className="w-[140px] bg-white/5 border-white/10 font-mono h-9 tabular-nums"
            maxLength={3}
          />
          <form
            onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(0); }}
            className="flex gap-2 flex-1 min-w-[240px]"
          >
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                placeholder="Search code · user-agent · IP hash"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                className="bg-white/5 border-white/10 h-9 pl-9 font-mono"
              />
              {qInput && (
                <button
                  type="button"
                  onClick={() => { setQInput(""); if (q) { setQ(""); setPage(0); } }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Button type="submit" className="btn-red h-9">
              <Search className="w-4 h-4 mr-1.5" /> Search
            </Button>
          </form>
          {activeFilterCount > 0 && (
            <Button variant="ghost" onClick={clearAll} className="text-white/60 h-9">
              Clear all ({activeFilterCount})
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/5 bg-white/[0.02] sticky top-0 backdrop-blur">
              <tr>
                <th className="text-left px-3 py-2.5 w-[150px]">Time</th>
                <th className="text-left px-3 py-2.5 w-[40px]">#</th>
                <th className="text-left px-3 py-2.5 w-[110px]">Code</th>
                <th className="text-left px-3 py-2.5 w-[130px]">Result</th>
                <th className="text-left px-3 py-2.5 w-[70px]">Latency</th>
                <th className="text-left px-3 py-2.5 w-[50px]">GEO</th>
                <th className="text-left px-3 py-2.5 w-[60px]">Route</th>
                <th className="text-left px-3 py-2.5">Trace</th>
                <th className="text-left px-3 py-2.5 w-[110px]">IP hash</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {query.isLoading ? (
                <tr><td colSpan={9} className="p-10 text-center text-white/40">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-14 text-center">
                    <div className="inline-flex flex-col items-center gap-2 text-white/40">
                      <ScrollText className="w-6 h-6" />
                      <div className="text-sm">No attempts match these filters</div>
                      {activeFilterCount > 0 && (
                        <button onClick={clearAll} className="text-xs text-[#ff8a90] hover:underline mt-1">
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : bucketed.map((item) => {
                if (item.kind === "header") {
                  return (
                    <tr key={`h-${item.label}`}>
                      <td colSpan={9} className="px-3 pt-4 pb-1 text-[9px] uppercase tracking-widest text-white/30 font-mono">
                        — {item.label}
                      </td>
                    </tr>
                  );
                }
                const r = item.row;
                const isNew = newRowIds.has(r.id);
                const isSuccess = r.result === "success";
                return (
                  <tr
                    key={r.id}
                    onClick={() => setModalAttempt(r)}
                    className={`border-b border-white/5 hover:bg-white/[0.04] transition cursor-pointer ${isNew ? "row-slide-in bg-[#ff2a3a]/[0.05]" : ""}`}
                  >
                    <td className={`px-3 ${rowPad} whitespace-nowrap ${rowText} text-white/60 tabular-nums`}>
                      {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      <div className="text-[9px] text-white/30">{new Date(r.created_at).toLocaleDateString()}</div>
                    </td>
                    <td className={`px-3 ${rowPad} ${rowText} text-white/40 tabular-nums`}>
                      {r.attempt_number ?? "—"}
                    </td>
                    <td className={`px-3 ${rowPad} ${rowText} text-[#ff8a90] tabular-nums`}>{r.code ?? "—"}</td>
                    <td className={`px-3 ${rowPad}`}>
                      <Badge variant="outline" className={`${RESULT_STYLE[r.result ?? ""] ?? "bg-white/5 text-white/50 border-white/10"} text-[10px] font-mono`}>
                        {(r.result ?? "unknown").replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className={`px-3 ${rowPad} ${rowText} tabular-nums ${
                      r.duration_ms == null ? "text-white/30"
                      : r.duration_ms < 1500 ? "text-emerald-400"
                      : r.duration_ms < 4000 ? "text-amber-400"
                      : "text-[#ff8a90]"
                    }`}>
                      {r.duration_ms == null ? "—" : fmtMs(r.duration_ms)}
                    </td>
                    <td className={`px-3 ${rowPad} ${rowText} text-white/70`}>{r.country ?? "—"}</td>
                    <td className={`px-3 ${rowPad} ${rowText}`}>
                      {r.proxy_mode
                        ? <span className="inline-flex items-center gap-1 text-sky-300"><Globe2 className="w-3 h-3" /> prx</span>
                        : <span className="inline-flex items-center gap-1 text-white/40"><Zap className="w-3 h-3" /> dir</span>}
                    </td>
                    <td className={`px-3 ${rowPad} ${rowText} text-white/50`}>
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        {r.selection_reason?.policy && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-widest bg-[#ff2a3a]/10 border border-[#ff2a3a]/30 text-[#ff8a90]"
                            title={r.selection_reason?.why ?? ""}
                          >
                            {r.selection_reason.policy.replace("_", " ")}
                          </span>
                        )}
                        {r.cookie_id && (
                          <span className="inline-flex items-center gap-1 text-white/40" title={`Cookie ${r.cookie_id}${r.selection_reason?.cookie?.total_uses != null ? ` · ${r.selection_reason.cookie.total_uses} uses` : ""}`}>
                            <Cookie className="w-3 h-3" /> {r.cookie_id.slice(0, 6)}
                          </span>
                        )}
                        {r.selection_reason?.eligible_at_pick != null && (
                          <span className="text-white/35 tabular-nums" title="Eligible cookies at pick time">
                            elig {r.selection_reason.eligible_at_pick}
                          </span>
                        )}
                        {r.proxy_id && (
                          <span className="inline-flex items-center gap-1 text-white/40" title={`Proxy ${r.proxy_id}`}>
                            <Globe2 className="w-3 h-3" /> {r.proxy_id.slice(0, 6)}
                          </span>
                        )}
                        {r.error_message && (
                          <span className="text-[#ff8a90]/80 truncate max-w-[220px]" title={r.error_message}>
                            · {r.error_message}
                          </span>
                        )}
                        {!r.cookie_id && !r.proxy_id && !r.error_message && !r.selection_reason && (
                          <span className="text-white/30">—</span>
                        )}
                      </div>
                    </td>
                    <td className={`px-3 ${rowPad} ${rowText} text-white/40`}>
                      {(r.ip_hash ?? "").slice(0, 10) || "—"}{r.ip_hash ? "…" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 text-xs text-white/50 font-mono">
          <Button
            variant="outline" size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="border-white/10 h-8"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <div className="flex items-center gap-2 tabular-nums">
            {page > 0 && (
              <button onClick={() => setPage(0)} className="text-[#ff8a90] hover:underline">
                ← back to live
              </button>
            )}
            <span className="text-white/50">Page {page + 1} / {pages}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">{rows.length} shown</span>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page + 1 >= pages}
            className="border-white/10 h-8"
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>

      <AttemptDetailModal attempt={modalAttempt} onClose={() => setModalAttempt(null)} />
    </div>
  );
}

/* ---------- helpers & subcomponents ---------- */

function MiniStat({
  icon: Icon, label, value, tone, sub,
}: {
  icon: any; label: string; value: string; sub?: string;
  tone: "primary" | "success" | "danger" | "muted";
}) {
  const toneMap = {
    primary: "text-[#ff2a3a]",
    success: "text-emerald-400",
    danger:  "text-[#ff8a90]",
    muted:   "text-white/50",
  } as const;
  return (
    <div className="glass glass-hover p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/40">
        <Icon className={`w-3.5 h-3.5 ${toneMap[tone]}`} /> {label}
      </div>
      <div className="mt-2 font-display text-2xl leading-none tabular-nums">{value}</div>
      {sub && <div className={`mt-1 text-[11px] font-mono ${toneMap[tone]} tabular-nums`}>{sub}</div>}
    </div>
  );
}

type BucketItem = { kind: "header"; label: string } | { kind: "row"; row: Attempt };
function bucketRows(rows: Attempt[]): BucketItem[] {
  const out: BucketItem[] = [];
  const now = Date.now();
  let lastBucket: string | null = null;
  for (const r of rows) {
    const age = now - new Date(r.created_at).getTime();
    let bucket: string;
    if (age < 60_000)          bucket = "Just now";
    else if (age < 300_000)    bucket = "Last 5 minutes";
    else if (age < 3_600_000)  bucket = "Last hour";
    else if (age < 86_400_000) bucket = "Today";
    else if (age < 604_800_000) bucket = "This week";
    else                        bucket = "Older";
    if (bucket !== lastBucket) {
      out.push({ kind: "header", label: bucket });
      lastBucket = bucket;
    }
    out.push({ kind: "row", row: r });
  }
  return out;
}

function AttemptDetailModal({ attempt, onClose }: { attempt: Attempt | null; onClose: () => void }) {
  const copy = (label: string, val: string) => {
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Copy failed"));
  };
  return (
    <Dialog open={!!attempt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-black/95 backdrop-blur border-white/10">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2 flex-wrap">
            Activation attempt
            {attempt?.result && (
              <span className={`ml-1 align-middle px-2 py-0.5 rounded border text-[11px] font-mono ${RESULT_STYLE[attempt.result] ?? "bg-white/5 text-white/40 border-white/10"}`}>
                {attempt.result.replace(/_/g, " ")}
              </span>
            )}
            {attempt?.attempt_number != null && (
              <span className="text-[11px] font-mono text-white/40 tabular-nums">#{attempt.attempt_number}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        {attempt && (
          <div className="space-y-2 text-sm mt-2">
            <Row label="Time" mono value={new Date(attempt.created_at).toLocaleString()} />
            <Row label="Code" mono value={attempt.code ?? "—"} onCopy={() => copy("Code", attempt.code ?? "")} />
            <Row label="Latency" mono value={attempt.duration_ms == null ? "—" : fmtMs(attempt.duration_ms)} />
            <Row label="Route" mono value={attempt.proxy_mode ? "Via proxy" : "Direct"} />
            <Row label="Country" mono value={attempt.country ?? "—"} />
            <Row label="Cookie ID" mono value={attempt.cookie_id ?? "—"} onCopy={attempt.cookie_id ? () => copy("Cookie ID", attempt.cookie_id!) : undefined} />
            <Row label="Proxy ID" mono value={attempt.proxy_id ?? "—"} onCopy={attempt.proxy_id ? () => copy("Proxy ID", attempt.proxy_id!) : undefined} />
            <Row label="IP hash" mono value={attempt.ip_hash ?? "—"} onCopy={attempt.ip_hash ? () => copy("IP hash", attempt.ip_hash!) : undefined} />
            <Row label="User agent" value={attempt.user_agent ?? "—"} multiline onCopy={attempt.user_agent ? () => copy("User agent", attempt.user_agent!) : undefined} />
            {attempt.selection_reason && <SelectionReasonBlock reason={attempt.selection_reason} />}
            {attempt.error_message && (
              <div className="mt-2 p-3 rounded border border-[#ff2a3a]/30 bg-[#ff2a3a]/[0.06]">
                <div className="text-[10px] uppercase tracking-widest text-[#ff8a90]/80 font-mono mb-1">Error</div>
                <div className="text-xs font-mono text-[#ff8a90] break-words">{attempt.error_message}</div>
              </div>
            )}
            <Row label="Attempt ID" mono value={attempt.id} onCopy={() => copy("ID", attempt.id)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SelectionReasonBlock({ reason }: { reason: SelectionReason }) {
  const c = reason.cookie ?? {};
  const f = reason.filters ?? {};
  return (
    <div className="mt-3 rounded border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-white/50 font-mono">Cookie selection</div>
        {reason.policy && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#ff2a3a]/10 border border-[#ff2a3a]/30 text-[#ff8a90] uppercase tracking-widest">
            {reason.policy.replace("_", " ")}
          </span>
        )}
      </div>
      {reason.why && <div className="text-xs text-white/80 leading-snug">{reason.why}</div>}
      {reason.outcome === "no_eligible_cookie" && (
        <div className="text-xs text-[#ff8a90]">RPC returned no eligible row — pool empty for current filters.</div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
        <span className="text-white/40">Eligible at pick</span>
        <span className="text-white/85 tabular-nums">{reason.eligible_at_pick ?? "—"}</span>
        <span className="text-white/40">Cookie status</span>
        <span className="text-white/85">{c.status ?? "—"}{c.is_valid === false ? " · invalid" : ""}</span>
        <span className="text-white/40">Uses (succ/fail)</span>
        <span className="text-white/85 tabular-nums">
          {c.total_uses ?? 0} <span className="text-white/40">·</span> {c.success_count ?? 0}/{c.fail_count ?? 0}
          {c.success_rate != null && <span className="text-white/40"> · {c.success_rate}%</span>}
        </span>
        <span className="text-white/40">Last used</span>
        <span className="text-white/85 tabular-nums">
          {c.last_used_at ? new Date(c.last_used_at).toLocaleString() : "never"}
        </span>
      </div>
      <div className="pt-2 border-t border-white/5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono">
        <span className="text-white/35">RPC filter · statuses</span>
        <span className="text-white/70">{(f.include_statuses ?? []).join(", ") || "—"}</span>
        <span className="text-white/35">require valid</span>
        <span className="text-white/70">{String(f.require_valid ?? true)}</span>
        <span className="text-white/35">min success rate</span>
        <span className="text-white/70 tabular-nums">{((f.min_success_rate ?? 0) * 100).toFixed(0)}%</span>
        <span className="text-white/35">min total uses</span>
        <span className="text-white/70 tabular-nums">{f.min_total_uses ?? 0}</span>
      </div>
    </div>
  );
}

function Row({ label, value, mono, multiline, onCopy }: {
  label: string; value: string; mono?: boolean; multiline?: boolean; onCopy?: () => void;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr_auto] gap-3 items-start">
      <div className="text-[10px] uppercase tracking-widest text-white/40 pt-1">{label}</div>
      <div className={`${mono ? "font-mono" : ""} text-white/80 ${multiline ? "break-all" : "truncate"} text-xs tabular-nums`}>{value}</div>
      {onCopy && (
        <button onClick={onCopy} className="text-white/40 hover:text-white transition" title="Copy">
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function csvSafe(v: string): string {
  const s = v.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}
function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
