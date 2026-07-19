import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { listSettings, setSetting } from "@/lib/settings.functions";
import { getCookiePoolStats } from "@/lib/pool.functions";
import {
  getCookieEligibility, setCookieEligibility, previewCookieEligibility,
  simulateCookieSelection,
} from "@/lib/admin.functions";
import { Badge } from "@/components/ui/badge";
import { Shuffle, Repeat, Sparkles, CheckCircle2, Loader2, RefreshCw, Filter, Save, RotateCcw, FlaskConical, Trophy, Cookie, XCircle, Lock, Ban, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/rotation")({
  head: () => ({ meta: [{ title: "Rotation Policy — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: RotationPage,
});

type Policy = "round_robin" | "random" | "quality";

const POLICIES: { id: Policy; icon: any; title: string; emoji: string; subtitle: string; desc: string; tag: string; when: string }[] = [
  {
    id: "round_robin", icon: Repeat, emoji: "🔄", title: "Round Robin",
    subtitle: "Even distribution · least-used first",
    desc: "Picks the cookie that was used least recently. Load spreads evenly across the entire eligible pool.",
    tag: "Balanced",
    when: "Best when you have a large healthy pool and want to keep every cookie warm.",
  },
  {
    id: "random", icon: Shuffle, emoji: "🎲", title: "Random",
    subtitle: "Random selection each time",
    desc: "Chooses any eligible cookie at random. Unpredictable rotation makes traffic patterns harder to correlate.",
    tag: "Stealth",
    when: "Best when you want maximum variety and don't need strictly even wear.",
  },
  {
    id: "quality", icon: Sparkles, emoji: "⭐", title: "Quality",
    subtitle: "Highest success rate first",
    desc: "Prefers cookies with the best success-to-failure ratio. Recommended for peak TV-activation success.",
    tag: "Recommended",
    when: "Best for production traffic where success rate matters more than even wear.",
  },
];

const STATUS_OPTIONS: { id: "active" | "free" | "on_hold" | "unknown" | "invalid"; label: string; hint: string; tone: string }[] = [
  { id: "active", label: "Active", hint: "Verified working", tone: "emerald" },
  { id: "unknown", label: "Unknown", hint: "Not yet checked", tone: "sky" },
  { id: "free", label: "Free", hint: "Free-plan Netflix", tone: "amber" },
  { id: "on_hold", label: "On hold", hint: "Payment blocked", tone: "amber" },
  { id: "invalid", label: "Invalid", hint: "Known bad — usually skip", tone: "rose" },
];

function RotationPage() {
  const fetchSettings = useServerFn(listSettings);
  const fetchStats = useServerFn(getCookiePoolStats);
  const doSet = useServerFn(setSetting);
  const fetchElig = useServerFn(getCookieEligibility);
  const saveElig = useServerFn(setCookieEligibility);
  const previewElig = useServerFn(previewCookieEligibility);
  const simulate = useServerFn(simulateCookieSelection);
  const qc = useQueryClient();

  // Live-refresh SLA: ≤2s polling, paused when tab hidden, augmented by Realtime.
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      const v = document.visibilityState !== "hidden";
      setVisible(v);
      if (v) {
        qc.invalidateQueries({ queryKey: ["admin-settings"] });
        qc.invalidateQueries({ queryKey: ["cookie-pool-stats"] });
        qc.invalidateQueries({ queryKey: ["cookie-eligibility"] });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [qc]);

  const q = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => fetchSettings(),
    refetchInterval: visible ? 2000 : false,
    refetchIntervalInBackground: false,
  });
  const statsQ = useQuery({
    queryKey: ["cookie-pool-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: visible ? 2000 : false,
    refetchIntervalInBackground: false,
  });
  const eligQ = useQuery({
    queryKey: ["cookie-eligibility"],
    queryFn: () => fetchElig(),
    refetchInterval: visible ? 2000 : false,
    refetchIntervalInBackground: false,
  });

  // Realtime: cross-tab policy sync + live pool/attempt counters.
  useEffect(() => {
    const ch = supabase
      .channel("admin-rotation-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings", filter: "key=eq.cookie_rotation_policy" },
        () => qc.invalidateQueries({ queryKey: ["admin-settings"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cookie_pool" },
        () => {
          qc.invalidateQueries({ queryKey: ["cookie-pool-stats"] });
          qc.invalidateQueries({ queryKey: ["cookie-eligibility"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activation_attempts" },
        () => qc.invalidateQueries({ queryKey: ["cookie-pool-stats"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const [current, setCurrent] = useState<Policy>("round_robin");
  useEffect(() => {
    const v = q.data?.settings?.cookie_rotation_policy;
    if (v === "random" || v === "quality" || v === "round_robin") setCurrent(v);
  }, [q.data]);

  const pick = useMutation({
    mutationFn: async (v: Policy) => doSet({ data: { key: "cookie_rotation_policy", value: v } }),
    onSuccess: (_r, v) => {
      setCurrent(v);
      toast.success(`Rotation policy → ${v.replace("_", " ")}`, {
        description: "New activations will use this policy immediately.",
      });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update policy"),
  });

  // ---------- Eligibility draft state ----------
  const rules = eligQ.data?.rules;
  const [statuses, setStatuses] = useState<string[]>(["active"]);
  const [requireValid, setRequireValid] = useState(true);
  const [minRate, setMinRate] = useState(0); // percent 0..100
  const [minUses, setMinUses] = useState(0);

  useEffect(() => {
    if (!rules) return;
    setStatuses(rules.include_statuses);
    setRequireValid(rules.require_valid);
    setMinRate(Math.round(rules.min_success_rate * 100));
    setMinUses(rules.min_total_uses);
  }, [rules]);

  const draft = useMemo(() => ({
    include_statuses: statuses,
    require_valid: requireValid,
    min_success_rate: minRate / 100,
    min_total_uses: minUses,
  }), [statuses, requireValid, minRate, minUses]);

  const dirty = useMemo(() => {
    if (!rules) return false;
    return JSON.stringify(draft) !== JSON.stringify({
      include_statuses: rules.include_statuses,
      require_valid: rules.require_valid,
      min_success_rate: rules.min_success_rate,
      min_total_uses: rules.min_total_uses,
    });
  }, [draft, rules]);

  const previewQ = useQuery({
    queryKey: ["cookie-eligibility-preview", draft],
    queryFn: () => previewElig({ data: draft as any }),
    enabled: !!rules,
    staleTime: 3_000,
  });

  const save = useMutation({
    mutationFn: async () => saveElig({ data: draft as any }),
    onSuccess: (r: any) => {
      toast.success(`Eligibility rules saved`, {
        description: `${r.eligible} cookie${r.eligible === 1 ? "" : "s"} match right now.`,
      });
      qc.invalidateQueries({ queryKey: ["cookie-eligibility"] });
      qc.invalidateQueries({ queryKey: ["cookie-pool-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const sim = useMutation({
    mutationFn: async () => simulate({ data: { ...draft, policy: current, limit: 10 } as any }),
    onError: (e: any) => toast.error(e?.message ?? "Simulation failed"),
  });

  const resetDefaults = () => {
    const d = eligQ.data?.defaults;
    if (!d) return;
    setStatuses(d.include_statuses);
    setRequireValid(d.require_valid);
    setMinRate(Math.round(d.min_success_rate * 100));
    setMinUses(d.min_total_uses);
  };

  const stats = statsQ.data;
  const eligibleNow = previewQ.data?.eligible ?? eligQ.data?.eligible ?? 0;
  const successRate = stats?.successRate ?? null;

  const toggleStatus = (id: string) => {
    setStatuses((prev) => {
      const has = prev.includes(id);
      if (has && prev.length === 1) {
        toast.error("At least one status must be included");
        return prev;
      }
      return has ? prev.filter((s) => s !== id) : [...prev, id];
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
            <Shuffle className="w-5 h-5 text-[#ff2a3a]" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Cookie rotation</div>
            <h1 className="font-display text-3xl md:text-4xl leading-none">Rotation Policy</h1>
            <p className="text-sm text-white/50 mt-2 max-w-2xl">
              Choose how the pool picks the next cookie for every TV activation, and set the eligibility rules that decide which cookies are even considered.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/30 font-mono uppercase tracking-widest text-[10px]">
          Current: {current.replace("_", " ")}
        </Badge>
      </div>

      {/* Live pool stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Eligible cookies" value={eligibleNow} accent glow tone="emerald" hint="Match rotation + eligibility rules" />
        <StatTile label="Total pool" value={stats?.total ?? 0} tone="sky" hint="All cookies stored" />
        <StatTile label="Pool success rate" value={successRate != null ? `${successRate}%` : "—"} tone="rose" hint="Lifetime across the whole pool" />
        <StatTile label="Locked right now" value={stats?.locked ?? 0} tone="amber" hint="In-flight activations" />
      </div>

      {/* Policy cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {POLICIES.map((p) => {
          const isCurrent = current === p.id;
          const isPending = pick.isPending && pick.variables === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => !isCurrent && pick.mutate(p.id)}
              disabled={pick.isPending}
              className={`relative text-left rounded-2xl border p-5 transition-all group overflow-hidden ${
                isCurrent
                  ? "border-[#ff2a3a]/60 bg-gradient-to-br from-[#ff2a3a]/15 via-[#b0060f]/5 to-transparent shadow-[0_0_0_1px_rgba(255,42,58,0.35),0_20px_60px_-20px_rgba(255,42,58,0.6)]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05] hover:-translate-y-0.5"
              } ${pick.isPending && !isPending ? "opacity-50" : ""}`}
            >
              {isCurrent && (
                <div className="absolute top-4 right-4 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#ff2a3a]">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border text-2xl ${isCurrent ? "border-[#ff2a3a]/40 bg-[#ff2a3a]/15" : "border-white/10 bg-white/5"}`}>
                  <span>{p.emoji}</span>
                </div>
                <div>
                  <div className="font-display text-xl leading-tight">{p.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-white/50 mt-1">{p.subtitle}</div>
                </div>
              </div>
              <div className="mt-4 text-sm text-white/70 leading-relaxed">{p.desc}</div>
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="font-mono text-[9px] uppercase tracking-widest text-white/40">When to use</div>
                <div className="text-xs text-white/60 mt-1">{p.when}</div>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded-full border ${isCurrent ? "border-[#ff2a3a]/40 text-[#ff2a3a] bg-[#ff2a3a]/10" : "border-white/10 text-white/40"}`}>
                  {p.tag}
                </span>
                {isPending ? (
                  <span className="flex items-center gap-1.5 text-xs text-[#ff2a3a] font-mono">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…
                  </span>
                ) : isCurrent ? (
                  <span className="text-xs text-emerald-300 font-mono">In use</span>
                ) : (
                  <span className="text-xs text-white/40 font-mono group-hover:text-white transition">Select →</span>
                )}
              </div>
              <div className={`mt-4 h-1 rounded-full overflow-hidden bg-white/5`}>
                <div className={`h-full transition-all duration-500 ${isCurrent ? "w-full bg-gradient-to-r from-[#ff2a3a] via-[#ff5a4a] to-[#ffb199]" : "w-0"}`} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Eligibility rules */}
      <div className="glass p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 grid place-items-center text-emerald-300">
              <Filter className="w-4 h-4" />
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-300/80">// Cookie eligibility</div>
              <div className="font-display text-xl">Which cookies can be picked?</div>
              <div className="text-xs text-white/50 mt-1 max-w-xl">
                Filters run <span className="text-white/70">before</span> the rotation policy. Only cookies passing every rule below are ever handed to a TV activation.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">Eligible now</div>
              <div className={`font-display text-2xl ${eligibleNow === 0 ? "text-[#ff2a3a]" : "text-emerald-300"}`}>
                {previewQ.isFetching ? <Loader2 className="w-5 h-5 animate-spin inline" /> : eligibleNow}
              </div>
            </div>
          </div>
        </div>

        {/* Statuses */}
        <div className="mb-5">
          <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">Allowed cookie statuses</div>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => {
              const on = statuses.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStatus(s.id)}
                  className={`group flex flex-col items-start rounded-lg border px-3 py-2 min-w-[128px] transition ${
                    on
                      ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_20px_-8px_rgba(52,211,153,0.5)]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/5 opacity-70 hover:opacity-100"
                  }`}
                >
                  <span className={`text-[11px] font-mono uppercase tracking-widest ${on ? "text-emerald-300" : "text-white/50"}`}>
                    {on ? "✓ " : ""}{s.label}
                  </span>
                  <span className="text-[10px] text-white/40 mt-0.5">{s.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Require valid */}
        <div className="mb-5">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <span className={`relative w-10 h-5 rounded-full transition ${requireValid ? "bg-emerald-500/60" : "bg-white/10"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${requireValid ? "left-[22px]" : "left-0.5"}`} />
              <input
                type="checkbox" className="sr-only"
                checked={requireValid} onChange={(e) => setRequireValid(e.target.checked)}
              />
            </span>
            <span>
              <div className="text-sm">Require <span className="text-emerald-300">valid</span> flag</div>
              <div className="text-[11px] text-white/40">Skip cookies marked invalid by a recent check.</div>
            </span>
          </label>
        </div>

        {/* Sliders */}
        <div className="grid md:grid-cols-2 gap-5">
          <SliderField
            label="Minimum success rate"
            hint="Cookies below this success-to-failure ratio are skipped."
            unit="%"
            value={minRate} min={0} max={100} step={5}
            onChange={setMinRate}
            tone="emerald"
          />
          <SliderField
            label="Grace period (min total uses)"
            hint="Success-rate filter only applies once a cookie has been tried at least this many times."
            unit="uses"
            value={minUses} min={0} max={50} step={1}
            onChange={setMinUses}
            tone="sky"
          />
        </div>

        {/* Preview + actions */}
        <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-white/50">
            {eligibleNow === 0 ? (
              <span className="text-[#ff2a3a]">⚠ No cookies match these rules — activations will fail with <span className="font-mono">no_cookie</span>.</span>
            ) : (
              <>Rules will apply to the <span className="text-white">next</span> activation. Retry loop uses the same filters.</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetDefaults}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-white/10 bg-white/[0.02] text-white/60 hover:text-white hover:border-white/25 transition"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
            <button
              type="button"
              onClick={() => sim.mutate()}
              disabled={sim.isPending || eligibleNow === 0}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-3 py-1.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 hover:border-sky-500/50 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sim.isPending
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</>
                : <><FlaskConical className="w-3 h-3" /> Dry-run</>}
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={!dirty || save.isPending || eligibleNow === 0}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest px-4 py-1.5 rounded border border-[#ff2a3a]/40 bg-gradient-to-r from-[#ff2a3a]/20 to-[#b0060f]/10 text-[#ff8a90] hover:from-[#ff2a3a]/30 hover:border-[#ff2a3a]/60 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {save.isPending
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : <><Save className="w-3 h-3" /> Save rules</>}
            </button>
          </div>
        </div>

        {/* Dry-run result */}
        {sim.data && <SimResult sim={sim.data} draftPolicy={current} />}
      </div>

      {/* How it works */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-3">
          <RefreshCw className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">How rotation works</div>
            <div className="text-xs text-white/50 mt-1">Applied to every public TV activation and every admin retry.</div>
          </div>
        </div>
        <ol className="space-y-2 text-sm text-white/70 pl-4">
          <li><span className="text-[#ff2a3a] font-mono mr-2">01</span>User submits an 8-digit TV code.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">02</span>Pool narrows to cookies passing your <span className="text-emerald-300">eligibility rules</span> (status, valid flag, success rate).</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">03</span>The current <span className="text-white">rotation policy</span> picks one from that filtered set.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">04</span>Cookie is verified against Netflix, then the TV is activated.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">05</span>On transient failure, next eligible cookie is picked by the same policy — up to the max-attempts limit.</li>
        </ol>
      </div>
    </div>
  );
}

function SliderField({
  label, hint, unit, value, min, max, step, onChange, tone,
}: {
  label: string; hint: string; unit: string;
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
  tone: "emerald" | "sky";
}) {
  const toneMap = {
    emerald: { text: "text-emerald-300", bar: "from-emerald-500/70 to-emerald-300", ring: "accent-emerald-400" },
    sky: { text: "text-sky-300", bar: "from-sky-500/70 to-sky-300", ring: "accent-sky-400" },
  } as const;
  const t = toneMap[tone];
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm">{label}</div>
          <div className="text-[11px] text-white/40 mt-0.5">{hint}</div>
        </div>
        <div className={`font-display text-2xl ${t.text} tabular-nums`}>
          {value}<span className="text-xs text-white/40 ml-1">{unit}</span>
        </div>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full bg-gradient-to-r ${t.bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className={`mt-2 w-full ${t.ring} cursor-pointer`}
      />
    </div>
  );
}

function StatTile({
  label, value, hint, accent, glow, tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
  glow?: boolean;
  tone: "emerald" | "amber" | "rose" | "sky";
}) {
  const toneMap: Record<string, string> = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-[#ff2a3a]",
    sky: "text-sky-300",
  };
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-[#ff2a3a]/25 bg-[#ff2a3a]/[0.04]" : "border-white/10 bg-white/[0.02]"} ${glow ? "shadow-[0_0_40px_-20px_rgba(255,42,58,0.6)]" : ""}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/40">{label}</div>
      <div className={`mt-2 font-display text-3xl ${toneMap[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-white/40 mt-1">{hint}</div>}
    </div>
  );
}

function SimResult({ sim, draftPolicy }: { sim: any; draftPolicy: Policy }) {
  const winner = sim?.winner;
  const preview: any[] = sim?.preview ?? [];
  const skip = sim?.skipped ?? {};
  const total = sim?.total ?? 0;
  const elig = sim?.eligible ?? 0;

  const skipRows: { key: string; label: string; count: number; icon: any; tone: string }[] = [
    { key: "wrong_status", label: "Status not allowed", count: skip.wrong_status ?? 0, icon: Ban, tone: "text-white/60" },
    { key: "invalid_flag", label: "Marked invalid", count: skip.invalid_flag ?? 0, icon: XCircle, tone: "text-[#ff8a90]" },
    { key: "currently_locked", label: "Currently locked (in-flight)", count: skip.currently_locked ?? 0, icon: Lock, tone: "text-amber-300" },
    { key: "low_success_rate", label: "Below min success rate", count: skip.low_success_rate ?? 0, icon: TrendingDown, tone: "text-rose-300" },
  ];

  return (
    <div className="mt-5 pt-5 border-t border-white/10">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-sky-300/80">// Dry-run simulation</div>
          <div className="font-display text-lg mt-0.5">Selection preview</div>
          <div className="text-xs text-white/50 mt-0.5">
            Policy <span className="text-white font-mono">{draftPolicy.replace("_", " ")}</span> · {elig} of {total} cookies pass · nothing was locked
          </div>
        </div>
      </div>

      {/* Winner */}
      {winner ? (
        <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] via-emerald-500/[0.02] to-transparent p-4 mb-4 shadow-[0_0_40px_-20px_rgba(52,211,153,0.6)]">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/40 grid place-items-center text-emerald-300">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-300/80">Next pick would be</div>
              <div className="font-display text-lg text-emerald-100 truncate">{winner.email ?? winner.id?.slice(0, 8)}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] font-mono text-white/60">
                {winner.country && <span>🌍 {winner.country}</span>}
                <span>uses <span className="text-white">{winner.total_uses ?? 0}</span></span>
                <span>success <span className="text-emerald-300">{winner.success_count ?? 0}</span></span>
                <span>rate <span className="text-white">{winner.success_rate != null ? `${Math.round(winner.success_rate * 100)}%` : "—"}</span></span>
                {winner.last_used_at && <span>last {new Date(winner.last_used_at).toLocaleTimeString()}</span>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#ff2a3a]/40 bg-[#ff2a3a]/[0.05] p-4 mb-4 text-sm text-[#ff8a90]">
          No cookie would be picked with these rules.
        </div>
      )}

      {/* Preview table */}
      {preview.length > 1 && (
        <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
          <div className="px-3 py-2 border-b border-white/10 bg-white/[0.02] font-mono text-[10px] uppercase tracking-widest text-white/50">
            Top {preview.length} eligible cookies · in policy order
          </div>
          <div className="divide-y divide-white/5">
            {preview.map((c: any) => (
              <div key={c.id} className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-3 py-2 text-[11px] font-mono ${c.rank === 1 ? "bg-emerald-500/[0.04]" : ""}`}>
                <span className={`tabular-nums w-6 text-right ${c.rank === 1 ? "text-emerald-300" : "text-white/40"}`}>#{c.rank}</span>
                <span className="min-w-0 flex items-center gap-2">
                  <Cookie className="w-3 h-3 text-white/40" />
                  <span className="truncate text-white/80">{c.email ?? c.id.slice(0, 12)}</span>
                  {c.country && <span className="text-white/40">· {c.country}</span>}
                </span>
                <span className="text-white/50 tabular-nums">
                  {c.success_count}/{c.total_uses}
                </span>
                <span className={`tabular-nums ${(c.success_rate ?? 0) >= 0.7 ? "text-emerald-300" : (c.success_rate ?? 0) >= 0.3 ? "text-amber-300" : c.total_uses > 0 ? "text-rose-300" : "text-white/40"}`}>
                  {c.success_rate != null ? `${Math.round(c.success_rate * 100)}%` : "—"}
                </span>
                <span className="text-white/40 tabular-nums whitespace-nowrap">
                  {c.last_used_at ? relTime(c.last_used_at) : "never"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skip breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {skipRows.map((r) => (
          <div key={r.key} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <r.icon className={`w-3.5 h-3.5 ${r.tone}`} />
              <span className="font-mono text-[9px] uppercase tracking-widest text-white/40">{r.label}</span>
            </div>
            <div className={`mt-1 font-display text-xl ${r.count === 0 ? "text-white/30" : r.tone}`}>{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
