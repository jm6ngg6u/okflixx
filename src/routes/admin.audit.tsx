import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAuthAudit } from "@/lib/auth-audit.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck, ShieldAlert, LogIn, UserPlus, KeyRound, MailCheck, RefreshCw,
  ChevronLeft, ChevronRight, Search,
} from "lucide-react";

export const Route = createFileRoute("/admin/audit")({
  head: () => ({ meta: [{ title: "Auth audit — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: AuditPage,
});

const EVENTS: Array<{ key: string; label: string; icon: any }> = [
  { key: "signin",         label: "Sign-in",        icon: LogIn },
  { key: "signup",         label: "Sign-up",        icon: UserPlus },
  { key: "otp_send",       label: "OTP send",       icon: MailCheck },
  { key: "otp_verify",     label: "OTP verify",     icon: ShieldCheck },
  { key: "password_reset", label: "Password reset", icon: KeyRound },
];

function fmt(v: string) {
  const d = new Date(v);
  return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", month: "short", day: "2-digit" });
}

function AuditPage() {
  const listFn = useServerFn(listAuthAudit);
  const [event, setEvent] = useState<string>("all");
  const [success, setSuccess] = useState<"all" | "success" | "failure">("all");
  const [q, setQ] = useState("");
  const [windowMinutes, setWindowMinutes] = useState<number>(60 * 24);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const query = useQuery({
    queryKey: ["auth-audit", event, success, q, windowMinutes, page],
    queryFn: () =>
      listFn({
        data: {
          page,
          pageSize,
          event: event === "all" ? undefined : event,
          success,
          q: q.trim() || undefined,
          windowMinutes,
        },
      }),
    refetchInterval: 5000,
    placeholderData: (prev) => prev,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? 0;
  const kpi = query.data?.kpi ?? { total: 0, signin_fail: 0, otp_fail: 0, signup: 0, resets: 0 };
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const windowLabel = useMemo(() => {
    if (windowMinutes <= 60) return `${windowMinutes} min`;
    if (windowMinutes <= 60 * 24) return `${Math.round(windowMinutes / 60)} h`;
    return `${Math.round(windowMinutes / (60 * 24))} d`;
  }, [windowMinutes]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">Security</div>
          <h1 className="font-display text-3xl mt-1">Auth audit log</h1>
          <p className="text-sm text-white/60 mt-1 max-w-2xl">
            Every sign-in, sign-up, OTP send, OTP verification and password-reset attempt — success or failure, with reason and hashed IP.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-white/70">
            <RefreshCw className={`w-3 h-3 mr-1 ${query.isFetching ? "animate-spin" : ""}`} /> Live · 5s
          </Badge>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label={`Events · ${windowLabel}`} value={kpi.total} tone="slate" icon={ShieldCheck} />
        <Kpi label="Failed sign-ins" value={kpi.signin_fail} tone="red" icon={ShieldAlert} />
        <Kpi label="Failed OTP" value={kpi.otp_fail} tone="amber" icon={ShieldAlert} />
        <Kpi label="Sign-ups" value={kpi.signup} tone="emerald" icon={UserPlus} />
        <Kpi label="Resets" value={kpi.resets} tone="sky" icon={KeyRound} />
      </div>

      {/* Filters */}
      <div className="glass p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-1">Search email</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
            <Input
              value={q}
              onChange={(e) => { setPage(0); setQ(e.target.value); }}
              placeholder="user@example.com"
              className="pl-8 bg-white/[0.03] border-white/10 text-white placeholder:text-white/30"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-1">Event</label>
          <Select value={event} onValueChange={(v) => { setPage(0); setEvent(v); }}>
            <SelectTrigger className="w-[170px] bg-white/[0.03] border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {EVENTS.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-1">Outcome</label>
          <Select value={success} onValueChange={(v) => { setPage(0); setSuccess(v as any); }}>
            <SelectTrigger className="w-[140px] bg-white/[0.03] border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/40 block mb-1">Window</label>
          <Select value={String(windowMinutes)} onValueChange={(v) => { setPage(0); setWindowMinutes(parseInt(v, 10)); }}>
            <SelectTrigger className="w-[140px] bg-white/[0.03] border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="15">Last 15 min</SelectItem>
              <SelectItem value="60">Last hour</SelectItem>
              <SelectItem value="1440">Last 24 h</SelectItem>
              <SelectItem value="10080">Last 7 d</SelectItem>
              <SelectItem value="43200">Last 30 d</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => { setQ(""); setEvent("all"); setSuccess("all"); setWindowMinutes(60 * 24); setPage(0); }}
          className="border-white/10 bg-white/[0.02] hover:bg-white/10"
        >
          Reset
        </Button>
      </div>

      {/* Table */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-sm">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event</th>
                <th>Email</th>
                <th>Outcome</th>
                <th>Reason</th>
                <th>IP hash</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && (
                <tr><td colSpan={6} className="text-center py-10 text-white/50">Loading…</td></tr>
              )}
              {!query.isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-white/50">No events match the current filters.</td></tr>
              )}
              {rows.map((r: any) => {
                const ev = EVENTS.find((e) => e.key === r.event);
                const Icon = ev?.icon ?? ShieldCheck;
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-white/70 whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <Icon className="w-3.5 h-3.5 text-white/60" />
                        {ev?.label ?? r.event}
                      </span>
                    </td>
                    <td className="font-mono text-xs text-white/80">{r.email ?? "—"}</td>
                    <td>
                      {r.success ? (
                        <Badge className="bg-emerald-500/15 text-emerald-200 border-emerald-500/30 border">Success</Badge>
                      ) : (
                        <Badge className="bg-red-500/15 text-red-200 border-red-500/30 border">Failure</Badge>
                      )}
                    </td>
                    <td className="text-xs text-white/70 max-w-[280px] truncate" title={r.reason ?? ""}>{r.reason ?? "—"}</td>
                    <td className="font-mono text-[10px] text-white/40">{(r.ip_hash ?? "").slice(0, 12)}…</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 text-xs text-white/60">
          <div>{total.toLocaleString()} events · page {page + 1} of {pages}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="border-white/10 bg-white/[0.02] hover:bg-white/10 h-7 px-2">
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="border-white/10 bg-white/[0.02] hover:bg-white/10 h-7 px-2">
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, icon: Icon }: { label: string; value: number; tone: string; icon: any }) {
  const toneMap: Record<string, string> = {
    slate: "border-white/10 text-white/80",
    red: "border-red-500/30 text-red-200",
    amber: "border-amber-500/30 text-amber-200",
    emerald: "border-emerald-500/30 text-emerald-200",
    sky: "border-sky-500/30 text-sky-200",
  };
  return (
    <div className={`glass p-3 flex items-center gap-3 border ${toneMap[tone]}`}>
      <Icon className="w-5 h-5 opacity-80" />
      <div>
        <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
        <div className="font-display text-xl mt-0.5">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}
