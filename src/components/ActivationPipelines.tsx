import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getActivationPipelines, getRateLimitStatus, retryActivationAdmin, getRetryPrecheck } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ChevronDown, ChevronRight, Cookie, Globe2, ListChecks, PlayCircle, Server,
  CheckCircle2, XCircle, Clock, Zap, RefreshCw, ShieldAlert, Loader2, Gauge, Info, Filter,
} from "lucide-react";

type SelectionReason = {
  policy?: string;
  filters?: {
    include_statuses?: string[];
    require_valid?: boolean;
    min_success_rate?: number;
    min_total_uses?: number;
  };
  eligible_at_pick?: number | null;
  admin_retry?: boolean;
  outcome?: string;
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
};

type Attempt = {
  id: string;
  n: number;
  result: string | null;
  duration_ms: number | null;
  cookie_id: string | null;
  proxy_id: string | null;
  proxy_mode: boolean;
  error: string | null;
  at: string;
  selection_reason: SelectionReason | null;
};
type Pipeline = {
  key: string;
  code: string;
  country: string | null;
  ip_hash: string | null;
  started_at: string;
  ended_at: string;
  final_result: string | null;
  attempts: Attempt[];
  total_duration_ms: number;
};

const TERMINAL_SUCCESS = ["success"];
const TERMINAL_HARD_FAIL = ["invalid_code", "expired_code", "maintenance", "no_cookie", "exhausted"];

function isTerminal(result: string | null): boolean {
  if (!result) return false;
  return TERMINAL_SUCCESS.includes(result) || TERMINAL_HARD_FAIL.includes(result);
}

/**
 * Live Activation Pipeline panel.
 * ------------------------------------------------------------------
 * Each row is a real activation: the retry sequence for a single (code, ip)
 * played out through the queue → cookie → proxy → worker → result pipeline.
 * Attempts are stacked in order with per-attempt timing and cause-of-failure
 * badges. Supabase Realtime pushes new attempts as they land so the pipeline
 * animates in live.
 */
export function ActivationPipelines() {
  const fetchPipelines = useServerFn(getActivationPipelines);
  const fetchRateLimit = useServerFn(getRateLimitStatus);
  const retryFn = useServerFn(retryActivationAdmin);
  const precheckFn = useServerFn(getRetryPrecheck);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["activation-pipelines"],
    queryFn: () => fetchPipelines({ data: { limit: 8, windowMinutes: 30 } }),
    refetchInterval: 15_000,
  });
  const rl = useQuery({
    queryKey: ["rate-limit-status"],
    queryFn: () => fetchRateLimit({ data: { windowMinutes: 15 } }),
    refetchInterval: 20_000,
  });
  const pc = useQuery({
    queryKey: ["retry-precheck"],
    queryFn: () => precheckFn(),
    refetchInterval: 15_000,
  });

  const retryMut = useMutation({
    mutationFn: async (code: string) => {
      const pre = await precheckFn();
      if (!pre.can_retry) throw new Error(pre.reason ?? "Retry blocked");
      return retryFn({ data: { code } });
    },
    onSuccess: (r: any) => {
      if (r?.ok) toast.success(`Retry succeeded · ${r.status} · ${r.duration_ms}ms`);
      else if (r?.status === "no_cookie") toast.error(`Retry blocked · ${r.message ?? "No eligible cookie"}`);
      else toast.error(`Retry → ${r?.status ?? "error"}`);
      qc.invalidateQueries({ queryKey: ["activation-pipelines"] });
      qc.invalidateQueries({ queryKey: ["retry-precheck"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Retry failed"),
  });

  // Nudge a refetch whenever a new attempt is inserted anywhere (cheap: one
  // debounced invalidation) so the pipeline reflects the retry loop in ~real-time.
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    const ch = supabase
      .channel("pipelines-attempts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activation_attempts" },
        () => {
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["activation-pipelines"] });
          }, 350);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const pipelines = q.data?.pipelines ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Auto-expand the newest active (non-terminal) pipeline
  const newestKey = pipelines[0]?.key;
  useEffect(() => {
    if (!newestKey) return;
    setExpanded((e) => (e[newestKey] === undefined ? { ...e, [newestKey]: true } : e));
  }, [newestKey]);

  const rlData = rl.data as any;
  const rlBusy = !!rlData && rlData.total > 0;

  // Live-tick the countdown once per second when there is any active throttle.
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!rlBusy) return;
    const iv = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, [rlBusy]);

  // Decrement server-reported cooldown by the client-side drift.
  const lastFetchedAt = rl.dataUpdatedAt || nowTick;
  const drift = Math.max(0, Math.floor((nowTick - lastFetchedAt) / 1000));
  const liveCooldown = Math.max(0, (rlData?.cooldown_seconds ?? 0) - drift);
  const worstCountdown = fmtCountdown(liveCooldown);

  return (
    <div className="glass p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-[#ff2a3a]" />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
              // Pipeline · queue → cookie → proxy → worker → result
            </div>
            <div className="font-display text-lg">Live activation runs</div>
          </div>
        </div>
        <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
          {q.isFetching ? "syncing…" : `${pipelines.length} recent`}
        </div>
      </div>

      {/* Rate-limit strip with live countdown */}
      <div className={`mb-4 rounded-lg border px-3 py-2 flex items-center gap-3 flex-wrap ${
        rlBusy
          ? "border-amber-500/30 bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.03] to-transparent"
          : "border-white/10 bg-white/[0.02]"
      }`}>
        <div className={`w-7 h-7 rounded-md grid place-items-center ${
          rlBusy ? "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                 : "bg-white/5 border border-white/10 text-white/40"
        }`}>
          <Gauge className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">
            rate-limit · {rlData?.rateLimitPer10Min ?? 10}/10m per IP · window {rlData?.windowMinutes ?? 15}m
          </div>
          <div className="text-xs text-white/80 truncate">
            {rlBusy ? (
              <>
                <span className="text-amber-300 font-medium">{rlData.total}</span> blocked ·
                <span className="text-amber-300 ml-1">{rlData.rate_limited}</span> throttled ·
                <span className="text-[#ff8a90] ml-1">{rlData.bot_detected}</span> bot ·
                <span className="text-white/50 ml-1">{rlData.top.length} unique IP hash{rlData.top.length === 1 ? "" : "es"}</span>
              </>
            ) : (
              <span className="text-emerald-300/80">All clear · no blocked traffic in window</span>
            )}
          </div>
        </div>
        {rlBusy && liveCooldown > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/15 text-amber-100 tabular-nums shadow-[0_0_20px_-8px_rgba(251,191,36,0.6)]">
            <Clock className="w-3 h-3 animate-pulse" />
            cools in {worstCountdown}
          </span>
        )}
        {rlBusy && rlData.top.slice(0, 3).map((ip: any) => {
          const ipCd = Math.max(0, (ip.cooldown_seconds ?? 0) - drift);
          const isBot = ip.result === "bot_detected";
          return (
            <span key={ip.ip_hash}
              className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border tabular-nums ${
                isBot
                  ? "border-[#ff2a3a]/40 bg-[#ff2a3a]/10 text-[#ff8a90]"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-100"
              }`}
              title={`IP ${ip.ip_hash.slice(0, 16)}… · last ${new Date(ip.last).toLocaleTimeString()}`}>
              <ShieldAlert className="w-3 h-3" />
              {ip.ip_hash.slice(0, 8)} · ×{ip.count}
              {ipCd > 0 && <span className="text-white/50">· {fmtCountdown(ipCd)}</span>}
            </span>
          );
        })}
      </div>

      {pipelines.length === 0 ? (
        <div className="text-sm text-white/40 font-mono py-8 text-center">
          {q.isLoading ? "Loading pipelines…" : "No activation runs in the last 30 minutes"}
        </div>
      ) : (
        <div className="space-y-2">
          {pipelines.map((p) => (
            <PipelineRow
              key={p.key}
              pipeline={p}
              expanded={!!expanded[p.key]}
              onToggle={() => setExpanded((e) => ({ ...e, [p.key]: !e[p.key] }))}
              onRetry={() => retryMut.mutate(p.code)}
              retrying={retryMut.isPending && retryMut.variables === p.code}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineRow({
  pipeline, expanded, onToggle, onRetry, retrying,
}: { pipeline: Pipeline; expanded: boolean; onToggle: () => void; onRetry: () => void; retrying: boolean }) {
  const final = pipeline.final_result;
  const isSuccess = final === "success";
  const finalIsTerminal = isTerminal(final);
  // "In-flight" = last attempt is recent AND final result is not terminal.
  // Because the activate loop retries synchronously, "in-flight" is short-lived
  // (usually seconds); we still show a live badge if we're inside that window.
  const lastAt = new Date(pipeline.ended_at).getTime();
  const isInflight = !finalIsTerminal && Date.now() - lastAt < 12_000;

  const stateTone = isSuccess
    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.06]"
    : finalIsTerminal
      ? "text-[#ff8a90] border-[#ff2a3a]/30 bg-[#ff2a3a]/[0.06]"
      : "text-amber-300 border-amber-500/30 bg-amber-500/[0.06]";

  const startedAgo = timeAgo(pipeline.started_at);
  const durationText = fmtMs(pipeline.total_duration_ms);

  return (
    <div className="row-slide-in border border-white/10 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition">
      {/* Summary strip */}
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="text-white/40">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        <span className={`w-2 h-2 rounded-full ${
          isSuccess ? "bg-emerald-400"
          : isInflight ? "bg-amber-400 animate-pulse pipe-step-active"
          : finalIsTerminal ? "bg-[#ff2a3a]"
          : "bg-white/30"
        }`} />
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[#ff8a90] text-sm tabular-nums">{pipeline.code}</span>
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
            {pipeline.country ?? "—"}
          </span>
          <span className="text-[10px] font-mono text-white/40">
            {pipeline.attempts.length} attempt{pipeline.attempts.length > 1 ? "s" : ""}
          </span>
          {isInflight && (
            <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 animate-pulse">
              in-flight
            </span>
          )}
        </div>
        <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border ${stateTone}`}>
          {(final ?? "pending").replace(/_/g, " ")}
        </span>
        <span className="font-mono text-[10px] text-white/40 tabular-nums whitespace-nowrap">
          {durationText} · {startedAgo}
        </span>
      </button>

      {/* Expanded: pipeline stages */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/5">
          {/* Stage rail */}
          <StageRail attempts={pipeline.attempts} isInflight={isInflight} final={final} />

          {/* Per-attempt breakdown */}
          <div className="mt-4 space-y-1.5">
            {pipeline.attempts.map((a) => (
              <AttemptRow key={a.id} attempt={a} totalAttempts={pipeline.attempts.length} />
            ))}
          </div>

          {/* Meta footer */}
          <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px] font-mono text-white/40">
            <Meta label="Started" value={new Date(pipeline.started_at).toLocaleTimeString()} />
            <Meta label="Ended" value={finalIsTerminal ? new Date(pipeline.ended_at).toLocaleTimeString() : "—"} />
            <Meta label="Total time" value={fmtMs(pipeline.total_duration_ms)} />
            <Meta label="IP hash" value={pipeline.ip_hash ? pipeline.ip_hash.slice(0, 10) + "…" : "—"} />
          </div>

          {/* Retry action */}
          <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[10px] font-mono text-white/40">
              admin retry uses the current rotation policy · logged as <span className="text-white/60">activation.admin_retry</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              disabled={retrying}
              className="group inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-[#ff2a3a]/40 bg-[#ff2a3a]/10 text-[#ff8a90] hover:bg-[#ff2a3a]/20 hover:border-[#ff2a3a]/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {retrying
                ? <><Loader2 className="w-3 h-3 animate-spin" /> retrying…</>
                : <><RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-300" /> retry {pipeline.code}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StageRail({
  attempts, isInflight, final,
}: { attempts: Attempt[]; isInflight: boolean; final: string | null }) {
  // The visible pipeline: [Queued] → [Cookie] → [Proxy?] → [Worker] → [Result]
  // Deduce status per stage from the LAST attempt.
  const last = attempts[attempts.length - 1];
  const proxyUsed = attempts.some((a) => a.proxy_id) || (last?.proxy_mode ?? false);

  type StageState = "done" | "active" | "fail" | "skip" | "pending";
  const stages: { label: string; icon: any; state: StageState; hint?: string }[] = [
    { label: "Queued", icon: PlayCircle, state: "done", hint: `${attempts.length} attempt${attempts.length > 1 ? "s" : ""}` },
    { label: "Cookie", icon: Cookie, state: last?.cookie_id ? "done" : "pending", hint: last?.cookie_id ? "picked" : "waiting" },
    proxyUsed
      ? { label: "Proxy", icon: Globe2, state: last?.proxy_id ? "done" : "skip", hint: last?.proxy_id ? "locked" : "direct" }
      : { label: "Direct", icon: Zap, state: "done", hint: "no proxy" },
    { label: "Worker", icon: Server, state: last?.result ? (last.result === "success" ? "done" : "fail") : (isInflight ? "active" : "pending"), hint: last?.result ?? "…" },
    {
      label: "Result",
      icon: final === "success" ? CheckCircle2 : XCircle,
      state: final === "success" ? "done" : isTerminal(final) ? "fail" : isInflight ? "active" : "pending",
      hint: final ?? "pending",
    },
  ];

  return (
    <div className="mt-4">
      <div className="grid grid-cols-5 gap-1 items-center">
        {stages.map((s, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className={`relative w-9 h-9 rounded-full grid place-items-center border ${
              s.state === "done" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : s.state === "fail" ? "border-[#ff2a3a]/50 bg-[#ff2a3a]/10 text-[#ff8a90]"
              : s.state === "active" ? "border-amber-500/50 bg-amber-500/10 text-amber-300 pipe-step-active"
              : s.state === "skip" ? "border-white/10 bg-white/[0.02] text-white/30"
              : "border-white/10 bg-white/[0.02] text-white/40"
            }`}>
              <s.icon className="w-4 h-4" />
            </div>
            <div className="text-[9px] font-mono uppercase tracking-widest text-white/50">{s.label}</div>
            <div className="text-[9px] font-mono text-white/30 truncate max-w-[80px]">{s.hint}</div>
          </div>
        ))}
      </div>
      {/* Connector line under the row */}
      <div className="grid grid-cols-4 -mt-14 mb-14 px-[18px]">
        {[0, 1, 2, 3].map((i) => {
          const left = stages[i];
          const right = stages[i + 1];
          let cls = "pipe-line-static";
          if (left.state === "fail" || right.state === "fail") cls = "pipe-line-fail";
          else if (left.state === "done" && right.state === "done") cls = "pipe-line-success";
          else if (right.state === "active") cls = "pipe-line";
          return <div key={i} className={`h-[2px] mx-2 rounded ${cls}`} />;
        })}
      </div>
    </div>
  );
}

function AttemptRow({ attempt, totalAttempts }: { attempt: Attempt; totalAttempts: number }) {
  const isSuccess = attempt.result === "success";
  const tone = isSuccess ? "text-emerald-400" : "text-[#ff8a90]";
  return (
    <div className="grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 text-[11px] font-mono px-2 py-1.5 rounded bg-white/[0.02] border border-white/5">
      <span className="text-white/40 tabular-nums">#{attempt.n}/{totalAttempts}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${isSuccess ? "bg-emerald-400" : "bg-[#ff2a3a]"}`} />
      <span className="min-w-0 flex items-center gap-2 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
          isSuccess
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            : "bg-[#ff2a3a]/10 text-[#ff8a90] border-[#ff2a3a]/30"
        }`}>
          {(attempt.result ?? "pending").replace(/_/g, " ")}
        </span>
        {attempt.cookie_id && (
          <span className="text-white/40 inline-flex items-center gap-1">
            <Cookie className="w-3 h-3" /> {attempt.cookie_id.slice(0, 8)}
          </span>
        )}
        {attempt.proxy_id ? (
          <span className="text-white/40 inline-flex items-center gap-1">
            <Globe2 className="w-3 h-3" /> {attempt.proxy_id.slice(0, 8)}
          </span>
        ) : attempt.proxy_mode ? (
          <span className="text-white/30 inline-flex items-center gap-1">
            <Globe2 className="w-3 h-3" /> proxy fallback → direct
          </span>
        ) : null}
        {attempt.error && (
          <span className="text-[#ff8a90]/70 truncate max-w-[240px]" title={attempt.error}>
            · {attempt.error}
          </span>
        )}
      </span>
      <span className={`tabular-nums ${tone}`}>
        {fmtMs(attempt.duration_ms)}
      </span>
      <span className="text-white/30 inline-flex items-center gap-1 tabular-nums">
        <Clock className="w-3 h-3" />
        {new Date(attempt.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-widest text-white/30">{label}</div>
      <div className="text-white/70 truncate tabular-nums">{value}</div>
    </div>
  );
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function fmtCountdown(sec: number): string {
  if (sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
