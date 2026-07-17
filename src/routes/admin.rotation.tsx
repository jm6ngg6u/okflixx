import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listSettings, setSetting } from "@/lib/settings.functions";
import { getCookiePoolStats } from "@/lib/pool.functions";
import { Badge } from "@/components/ui/badge";
import { Shuffle, Repeat, Sparkles, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/rotation")({
  head: () => ({ meta: [{ title: "Rotation Policy — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: RotationPage,
});

type Policy = "round_robin" | "random" | "quality";

const POLICIES: { id: Policy; icon: any; title: string; emoji: string; subtitle: string; desc: string; tag: string; when: string }[] = [
  {
    id: "round_robin",
    icon: Repeat,
    emoji: "🔄",
    title: "Round Robin",
    subtitle: "Even distribution · least-used first",
    desc: "Picks the cookie that was used least recently. Load spreads evenly across the entire active pool, so no single cookie gets burnt out or fingerprinted.",
    tag: "Balanced",
    when: "Best when you have a large healthy pool and want to keep every cookie warm.",
  },
  {
    id: "random",
    icon: Shuffle,
    emoji: "🎲",
    title: "Random",
    subtitle: "Random selection each time",
    desc: "Chooses any active cookie at random for every activation. Unpredictable rotation makes traffic patterns harder to correlate.",
    tag: "Stealth",
    when: "Best when you want maximum variety and don't need strictly even wear.",
  },
  {
    id: "quality",
    icon: Sparkles,
    emoji: "⭐",
    title: "Quality",
    subtitle: "Highest success rate first",
    desc: "Prefers cookies with the best success-to-failure ratio. The best-performing cookies always run first — recommended for peak TV-activation success.",
    tag: "Recommended",
    when: "Best for production traffic where success rate matters more than even wear.",
  },
];

function RotationPage() {
  const fetchSettings = useServerFn(listSettings);
  const fetchStats = useServerFn(getCookiePoolStats);
  const doSet = useServerFn(setSetting);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings() });
  const statsQ = useQuery({ queryKey: ["cookie-pool-stats"], queryFn: () => fetchStats(), refetchInterval: 10_000 });

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

  const stats = statsQ.data;
  const active = stats?.byStatus?.active ?? 0;
  const skipped = (stats?.byStatus?.free ?? 0) + (stats?.byStatus?.on_hold ?? 0) + (stats?.byStatus?.invalid ?? 0) + (stats?.byStatus?.unknown ?? 0);
  const successRate = stats?.successRate ?? null;

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
              Choose how the pool picks the next cookie for every TV activation. Only <span className="text-emerald-300">active + valid</span> cookies are ever picked — free, on-hold, invalid and expired cookies are hard-skipped.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="bg-[#ff2a3a]/15 text-[#ff2a3a] border-[#ff2a3a]/30 font-mono uppercase tracking-widest text-[10px]">
          Current: {current.replace("_", " ")}
        </Badge>
      </div>

      {/* Live pool stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Eligible cookies" value={active} accent glow tone="emerald" hint="Active + valid, ready for activation" />
        <StatTile label="Skipped by policy" value={skipped} tone="amber" hint="Free / on-hold / invalid — never picked" />
        <StatTile label="Pool success rate" value={successRate != null ? `${successRate}%` : "—"} tone="rose" hint="Lifetime across the whole pool" />
        <StatTile label="Locked right now" value={stats?.locked ?? 0} tone="sky" hint="In-flight activations" />
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

      {/* How it works */}
      <div className="glass p-5">
        <div className="flex items-start gap-3 mb-3">
          <RefreshCw className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">How rotation works</div>
            <div className="text-xs text-white/50 mt-1">Applied to every public TV activation, retry-loop included.</div>
          </div>
        </div>
        <ol className="space-y-2 text-sm text-white/70 pl-4">
          <li><span className="text-[#ff2a3a] font-mono mr-2">01</span>User submits an 8-digit TV code.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">02</span>Pool picks the next cookie by the current policy — only <span className="text-emerald-300">active + valid</span> cookies are considered.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">03</span>Cookie is verified against Netflix, then the TV is activated.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">04</span>On transient failure, next cookie is picked by the same policy — up to the max-attempts limit.</li>
          <li><span className="text-[#ff2a3a] font-mono mr-2">05</span>User sees the success screen with plan, quality, country and account details.</li>
        </ol>
      </div>
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
