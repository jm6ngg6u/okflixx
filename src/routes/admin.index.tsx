import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboardStats } from "@/lib/admin.functions";
import { listSettings, toggleProxyMode } from "@/lib/settings.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Activity, CheckCircle2, ShieldOff, Bot, XCircle, TrendingUp, MapPin, Zap,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { toast } from "sonner";


export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Dashboard — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: DashboardPage,
});

const WINDOWS: { label: string; hours: number }[] = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
  { label: "All", hours: 24 * 365 * 5 },
];

function DashboardPage() {
  const [hours, setHours] = useState(24);
  const fetchStats = useServerFn(getDashboardStats);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats", hours],
    queryFn: () => fetchStats({ data: { windowHours: hours } }),
    refetchInterval: 30_000,
  });

  const kpi = data?.kpi ?? { total: 0, success: 0, rate_limited: 0, bot_detected: 0, invalid_code: 0, other: 0 };
  const successRate = kpi.total ? Math.round((kpi.success / kpi.total) * 1000) / 10 : 0;
  const series = (data?.series ?? []).map((s) => ({
    t: new Date(s.t).toLocaleString(undefined, hours <= 48 ? { hour: "2-digit", day: "2-digit", month: "short" } : { day: "2-digit", month: "short" }),
    Total: s.total,
    Success: s.success,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Activation dashboard</h1>
          <p className="text-sm text-muted-foreground">Live TV activation metrics {isLoading && "· loading…"}</p>
        </div>
        <Tabs value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
          <TabsList>
            {WINDOWS.map((w) => (
              <TabsTrigger key={w.hours} value={String(w.hours)}>{w.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={Activity} label="Total" value={kpi.total} tone="primary" />
        <Kpi icon={CheckCircle2} label="Success" value={kpi.success} sub={`${successRate}%`} tone="success" />
        <Kpi icon={ShieldOff} label="Rate limited" value={kpi.rate_limited} tone="warning" />
        <Kpi icon={Bot} label="Bot" value={kpi.bot_detected} tone="warning" />
        <Kpi icon={XCircle} label="Invalid" value={kpi.invalid_code} tone="muted" />
        <Kpi icon={TrendingUp} label="Success rate" value={`${successRate}%`} tone="success" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Attempts over time</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {series.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data in this window</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142 76% 45%)" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="hsl(142 76% 45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                  <Area type="monotone" dataKey="Total" stroke="hsl(var(--primary))" fill="url(#gTotal)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Success" stroke="hsl(142 76% 45%)" fill="url(#gSuccess)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Top countries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2">Country</th>
                  <th className="text-right px-4 py-2">Attempts</th>
                  <th className="text-right px-4 py-2">Success</th>
                  <th className="text-right px-4 py-2">Rate</th>
                </tr>
              </thead>
              <tbody>
                {(data?.countries ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-muted-foreground py-6">No data</td></tr>
                ) : (
                  data!.countries.map((c) => (
                    <tr key={c.country} className="border-b border-border/30 last:border-0">
                      <td className="px-4 py-2 font-mono">{c.country}</td>
                      <td className="px-4 py-2 text-right">{c.total}</td>
                      <td className="px-4 py-2 text-right">{c.success}</td>
                      <td className="px-4 py-2 text-right">
                        <Badge variant={c.rate >= 70 ? "default" : c.rate >= 30 ? "secondary" : "outline"}>{c.rate}%</Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: number | string; sub?: string; tone: "primary" | "success" | "warning" | "muted" }) {
  const toneMap: Record<string, string> = {
    primary: "text-primary",
    success: "text-emerald-500",
    warning: "text-amber-500",
    muted: "text-muted-foreground",
  };
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
          <Icon className={`w-3.5 h-3.5 ${toneMap[tone]}`} /> {label}
        </div>
        <div className="mt-2 text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}
