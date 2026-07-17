import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyActivationStatus } from "@/lib/auth-audit.functions";
import { supabase } from "@/integrations/supabase/client";
import { LiveBackground } from "@/components/LiveBackground";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  UserCircle2, ShieldCheck, Clock, AlertTriangle, LogOut, Home, Timer, CheckCircle2,
} from "lucide-react";

export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({ meta: [{ title: "My activations — Emberlord" }, { name: "robots", content: "noindex" }] }),
  component: AccountPage,
});

function AccountPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const statusFn = useServerFn(getMyActivationStatus);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      const ok = !!data.user;
      setAuthed(ok);
      setReady(true);
      if (!ok) navigate({ to: "/login" });
    });
  }, [navigate]);

  const query = useQuery({
    queryKey: ["my-activation-status"],
    queryFn: () => statusFn(),
    enabled: ready && authed,
    refetchInterval: 10_000,
  });

  if (!ready) return null;
  if (!authed) return null;

  const s = query.data;
  const pct = s ? Math.min(100, Math.round((s.used / Math.max(1, s.dailyLimit)) * 100)) : 0;
  const barTone = !s ? "bg-white/10" : s.blocked ? "bg-red-500" : pct > 70 ? "bg-amber-400" : "bg-emerald-400";

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen relative text-white font-ops">
      <LiveBackground />

      <div className="relative z-10 max-w-3xl mx-auto px-5 md:px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white uppercase tracking-widest">
            <Home className="w-3.5 h-3.5" /> Home
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-white/60 hover:text-white">
            <LogOut className="w-4 h-4 mr-1.5" /> Sign out
          </Button>
        </div>

        <header className="mb-8">
          <div className="text-[10px] uppercase tracking-widest text-white/40">My account</div>
          <h1 className="font-display text-3xl md:text-4xl mt-1">Activation status</h1>
          <p className="text-sm text-white/60 mt-2 max-w-xl">
            Your recent activations, remaining daily quota, and the exact reason if an activation is blocked.
          </p>
        </header>

        {/* Identity chip */}
        <div className="glass p-4 mb-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <UserCircle2 className="w-6 h-6 text-white/70" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-white/40">Signed in as</div>
            <div className="font-mono text-sm truncate">{s?.email ?? "…"}</div>
          </div>
          <Badge className="ml-auto bg-emerald-500/15 text-emerald-200 border-emerald-500/30 border">
            <ShieldCheck className="w-3 h-3 mr-1" /> Verified
          </Badge>
        </div>

        {/* Quota */}
        <div className="glass p-5 mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-widest text-white/40">Daily activation quota</div>
            <div className="text-xs font-mono text-white/70">
              {s ? `${s.used} / ${s.dailyLimit}` : "…"}
            </div>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full ${barTone} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-white/50">
            <span>
              {s?.blocked
                ? <span className="text-red-300 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Daily limit reached</span>
                : <span className="text-emerald-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {s?.remaining ?? 0} left today</span>}
            </span>
            {s?.nextResetAt && (
              <span className="inline-flex items-center gap-1 font-mono">
                <Timer className="w-3 h-3" /> Resets {new Date(s.nextResetAt).toLocaleString()}
              </span>
            )}
          </div>
          {s?.lastBlocked && (
            <div className="mt-4 rounded-md border border-red-500/25 bg-red-500/5 p-3 text-xs">
              <div className="uppercase tracking-widest text-red-300/80 text-[10px] mb-0.5">Last blocked attempt</div>
              <div className="text-white/80">
                Code <span className="font-mono">{s.lastBlocked.code}</span> was blocked at{" "}
                <span className="font-mono">{new Date(s.lastBlocked.at).toLocaleString()}</span>.
              </div>
              <div className="text-white/50 mt-1">{s.lastBlocked.reason}</div>
            </div>
          )}
        </div>

        {/* Recent attempts */}
        <div className="glass overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2">
            <Clock className="w-4 h-4 text-white/50" />
            <div className="text-[11px] uppercase tracking-widest text-white/60">Recent activations</div>
          </div>
          <div className="overflow-x-auto">
            <table className="admin-table w-full text-sm">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Code</th>
                  <th>Result</th>
                  <th>Country</th>
                  <th>Duration</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {(!s || s.recent.length === 0) && (
                  <tr><td colSpan={6} className="text-center py-10 text-white/50">
                    {s ? "No activations yet — enter a code on the home page to get started." : "Loading…"}
                  </td></tr>
                )}
                {s?.recent.map((r: any) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-white/70 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="font-mono text-xs">{r.code ?? "—"}</td>
                    <td>
                      {r.result === "success"
                        ? <Badge className="bg-emerald-500/15 text-emerald-200 border-emerald-500/30 border">Success</Badge>
                        : r.result === "rate_limited"
                        ? <Badge className="bg-amber-500/15 text-amber-200 border-amber-500/30 border">Rate limited</Badge>
                        : <Badge className="bg-red-500/15 text-red-200 border-red-500/30 border">{r.result ?? "unknown"}</Badge>}
                    </td>
                    <td className="text-xs text-white/70">{r.country ?? "—"}</td>
                    <td className="font-mono text-xs text-white/60">{r.duration_ms ? `${r.duration_ms}ms` : "—"}</td>
                    <td className="text-xs text-white/50 max-w-[240px] truncate" title={r.error_message ?? ""}>{r.error_message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
