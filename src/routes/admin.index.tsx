import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDashboardStats,
  getPoolSummary,
  getWorkerHealth,
  getRecentActivity,
} from "@/lib/admin.functions";
import { listSettings, toggleProxyMode } from "@/lib/settings.functions";
import { checkAllCookies } from "@/lib/pool.functions";
import { Switch } from "@/components/ui/switch";
import {
  Activity, CheckCircle2, ShieldOff, Bot, XCircle, TrendingUp, MapPin, Zap,
  Cookie, Globe2, Server, RefreshCw, Users, ScrollText, Sparkles, ArrowUpRight,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: DashboardPage,
});

const WINDOWS: { label: string; hours: number }[] = [
  { label: "24H", hours: 24 },
  { label: "7D", hours: 24 * 7 },
  { label: "30D", hours: 24 * 30 },
  { label: "ALL", hours: 24 * 365 * 5 },
];

function DashboardPage() {
  const [hours, setHours] = useState(24);
  const fetchStats = useServerFn(getDashboardStats);
  const fetchPool = useServerFn(getPoolSummary);
  const fetchHealth = useServerFn(getWorkerHealth);
  const fetchActivity = useServerFn(getRecentActivity);
  const fetchSettings = useServerFn(listSettings);
  const doToggle = useServerFn(toggleProxyMode);
  const doCheckAll = useServerFn(checkAllCookies);
  const qc = useQueryClient();

  const stats = useQuery({
    queryKey: ["dashboard-stats", hours],
    queryFn: () => fetchStats({ data: { windowHours: hours } }),
    refetchInterval: 30_000,
  });
  const pool = useQuery({ queryKey: ["pool-summary"], queryFn: () => fetchPool(), refetchInterval: 30_000 });
  const health = useQuery({ queryKey: ["worker-health"], queryFn: () => fetchHealth(), refetchInterval: 20_000 });
  const activity = useQuery({ queryKey: ["recent-activity"], queryFn: () => fetchActivity(), refetchInterval: 30_000 });
  const settingsQ = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings() });

  const proxyOn = settingsQ.data?.settings?.proxy_mode === "1";
  const maintOn = settingsQ.data?.settings?.maintenance_enabled === "1";

  const kpi = stats.data?.kpi ?? { total: 0, success: 0, rate_limited: 0, bot_detected: 0, invalid_code: 0, other: 0 };
  const successRate = kpi.total ? Math.round((kpi.success / kpi.total) * 1000) / 10 : 0;
  const series = (stats.data?.series ?? []).map((s) => ({
    t: new Date(s.t).toLocaleString(undefined, hours <= 48 ? { hour: "2-digit", day: "2-digit", month: "short" } : { day: "2-digit", month: "short" }),
    Total: s.total,
    Success: s.success,
  }));

  const c = pool.data?.cookies ?? { active: 0, on_hold: 0, free: 0, invalid: 0, unknown: 0, total: 0 };
  const p = pool.data?.proxies ?? { valid: 0, invalid: 0, total: 0 };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-2">// Control Room</div>
          <h1 className="font-display text-4xl md:text-5xl leading-none">
            Activation <span className="text-shine">Dashboard</span>
          </h1>
          <p className="text-white/50 text-sm mt-2">Live TV activation metrics · auto-refreshing every 30s</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-full border border-white/10 bg-white/[0.03] backdrop-blur">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              onClick={() => setHours(w.hours)}
              className={`px-4 py-1.5 rounded-full text-xs font-mono uppercase tracking-widest transition ${
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

      {/* System bar: worker health + proxy mode + maintenance */}
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
        <Kpi icon={Activity} label="Attempts" value={kpi.total} tone="primary" />
        <Kpi icon={CheckCircle2} label="Success" value={kpi.success} sub={`${successRate}%`} tone="success" />
        <Kpi icon={TrendingUp} label="Rate" value={`${successRate}%`} tone="success" />
        <Kpi icon={ShieldOff} label="Throttled" value={kpi.rate_limited} tone="warning" />
        <Kpi icon={Bot} label="Bot flags" value={kpi.bot_detected} tone="warning" />
        <Kpi icon={XCircle} label="Invalid" value={kpi.invalid_code} tone="muted" />
      </div>

      {/* Pool health + chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PoolCard
          icon={Cookie}
          title="Cookie pool"
          total={c.total}
          to="/admin/cookies"
          segments={[
            { label: "Active", value: c.active, color: "#22c55e" },
            { label: "On hold", value: c.on_hold, color: "#f59e0b" },
            { label: "Free", value: c.free, color: "#60a5fa" },
            { label: "Invalid", value: c.invalid, color: "#ff2a3a" },
            { label: "Unknown", value: c.unknown, color: "#64748b" },
          ]}
        />
        <PoolCard
          icon={Globe2}
          title="Proxy pool"
          total={p.total}
          to="/admin/proxies"
          segments={[
            { label: "Healthy", value: p.valid, color: "#22c55e" },
            { label: "Dead", value: p.invalid, color: "#ff2a3a" },
          ]}
        />

        {/* Quick actions */}
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
            <div className="font-display text-xl mt-1">Attempts over time</div>
          </div>
          <div className="text-xs font-mono text-white/40">
            {stats.isFetching ? "syncing…" : "live"}
          </div>
        </div>
        <div className="h-[280px]">
          {series.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-white/40 font-mono">No data in this window</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                <Tooltip
                  contentStyle={{
                    background: "rgba(0,0,0,0.85)",
                    border: "1px solid rgba(255,42,58,0.4)",
                    borderRadius: 12,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 11,
                  }}
                />
                <Area type="monotone" dataKey="Total" stroke="#ff2a3a" fill="url(#gTotal)" strokeWidth={2} />
                <Area type="monotone" dataKey="Success" stroke="#22c55e" fill="url(#gSuccess)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Countries + Activity feed */}
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
                    <div
                      className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#ff8a90]"
                      style={{ width: `${Math.min(100, (cn.total / (stats.data!.countries[0]?.total || 1)) * 100)}%` }}
                    />
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
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: number | string; sub?: string; tone: "primary" | "success" | "warning" | "muted" }) {
  const toneMap: Record<string, string> = {
    primary: "text-[#ff2a3a]",
    success: "text-emerald-400",
    warning: "text-amber-400",
    muted: "text-white/50",
  };
  return (
    <div className="glass glass-hover p-4">
      <div className={`flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/40`}>
        <Icon className={`w-3.5 h-3.5 ${toneMap[tone]}`} /> {label}
      </div>
      <div className="mt-2 font-display text-2xl">{value}</div>
      {sub && <div className={`text-xs font-mono mt-0.5 ${toneMap[tone]}`}>{sub}</div>}
    </div>
  );
}

function PoolCard({
  icon: Icon, title, total, to, segments,
}: {
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
    <Link
      to={to}
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] hover:border-[#ff2a3a]/50 hover:bg-[#ff2a3a]/5 transition p-3"
    >
      <Icon className="w-4 h-4 text-[#ff2a3a]" />
      <span className="text-xs text-white/70">{label}</span>
    </Link>
  );
}
