import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listSettings, setSetting, toggleProxyMode, setMaintenance,
  runCookiesAutocheckNow, runProxiesAutocheckNow, getProxyModeStatus,
  getGithubInfo,
} from "@/lib/settings.functions";
import { Github, ExternalLink, GitBranch } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Zap, ShieldAlert, Bell, RefreshCw, Timer, Save, Play, Loader2, Download, Search, Send, RotateCcw, CheckCircle2, AlertTriangle, Calendar, X } from "lucide-react";
import brandLogo from "@/assets/brand-logo.png";
import { MaintenanceView } from "@/components/MaintenanceScreen";
import { useBrand } from "@/lib/branding-context";


import { toast } from "sonner";
import { LiveJobsPanel } from "@/components/LiveJobsPanel";
import { listRecentJobRuns } from "@/lib/settings.functions";


export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const fetchSettings = useServerFn(listSettings);
  const doSet = useServerFn(setSetting);
  const doToggle = useServerFn(toggleProxyMode);
  const doMaint = useServerFn(setMaintenance);
  const qc = useQueryClient();

  const doRunCookies = useServerFn(runCookiesAutocheckNow);
  const doRunProxies = useServerFn(runProxiesAutocheckNow);
  const fetchProxyStatus = useServerFn(getProxyModeStatus);
  const proxyStatusQ = useQuery({
    queryKey: ["admin-proxy-status"],
    queryFn: () => fetchProxyStatus(),
    refetchInterval: 2000,
  });

  // Live poll every 2s so job "next-run" ticks down and remote edits appear.
  const q = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => fetchSettings(),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });
  const [local, setLocal] = useState<Record<string, string>>({});
  // Track which keys the admin is editing so the 2s poll doesn't wipe them.
  const dirtyRef = useRef<Set<string>>(new Set());
  // Per-key busy flag → Save button spinner, disabled state.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Free-text filter across all setting labels.
  const [filter, setFilter] = useState("");
  

  const fetchRuns = useServerFn(listRecentJobRuns);

  const reasonsDesc = (r: any) => {
    const rr = r?.reasons;
    if (!rr) return "";
    const es = Object.entries(rr as Record<string, number>)
      .filter(([, n]) => (n as number) > 0)
      .sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 4);
    return es.length ? ` · Reasons: ${es.map(([k, n]) => `${k.replace(/_/g, " ")} ×${n}`).join(", ")}` : "";
  };

  const runCookiesMut = useMutation({
    mutationFn: () => doRunCookies(),
    onSuccess: (r: any) => {
      toast.success("Cookie check finished", {
        description: r?.skipped
          ? `Skipped (${r.skipped})`
          : `${r.checked ?? 0} checked · ${r.active ?? 0} active · ${r.invalid ?? 0} invalid · ${r.on_hold ?? 0} on-hold · ${r.free ?? 0} free${r.transient ? ` · ${r.transient} transient` : ""}${reasonsDesc(r)}`,
      });
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
      qc.invalidateQueries({ queryKey: ["job-runs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Run failed"),
  });
  const runProxiesMut = useMutation({
    mutationFn: () => doRunProxies(),
    onSuccess: (r: any) => {
      toast.success("Proxy check finished", {
        description: r?.skipped
          ? `Skipped (${r.skipped})`
          : `${r.checked ?? 0} checked · ${r.ok_count ?? 0} valid · ${r.dead ?? 0} invalid${r.transient ? ` · ${r.transient} transient` : ""}${r.removed_invalid ? ` · ${r.removed_invalid} removed` : ""}${reasonsDesc(r)}`,
      });
      qc.invalidateQueries({ queryKey: ["proxies"] });
      qc.invalidateQueries({ queryKey: ["job-runs"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Run failed"),
  });

  const exportRunsCSV = async () => {
    try {
      const res = await fetchRuns();
      const rows = res.rows ?? [];
      const cols = ["job", "started_at", "finished_at", "ok", "duration_s", "checked", "active", "invalid", "on_hold", "free", "ok_count", "dead", "transient", "removed_invalid", "removed_free", "removed_on_hold", "removed_duplicates", "reasons", "error"];
      const esc = (v: any) => {
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const body = rows.map((r: any) => {
        const s = r.summary ?? {};
        const dur = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : "";
        return [r.job, r.started_at, r.finished_at ?? "", r.ok ?? "", dur, s.checked ?? "", s.active ?? "", s.invalid ?? "", s.on_hold ?? "", s.free ?? "", s.ok_count ?? "", s.dead ?? "", s.transient ?? "", s.removed_invalid ?? "", s.removed_free ?? "", s.removed_on_hold ?? "", s.removed_duplicates ?? "", s.reasons ? JSON.stringify(s.reasons) : "", r.error ?? ""].map(esc).join(",");
      });
      const csv = [cols.join(","), ...body].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `job-runs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length} runs to CSV`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  const exportRunsPDF = async () => {
    try {
      const res = await fetchRuns();
      const rows = res.rows ?? [];
      const w = window.open("", "_blank");
      if (!w) { toast.error("Popup blocked — allow popups to export PDF"); return; }
      const fmt = (v: any) => v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      const style = `<style>body{font-family:ui-sans-serif,system-ui,sans-serif;color:#111;padding:24px}h1{font-size:18px;margin:0 0 4px}small{color:#666}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:11px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f4f4f5}tr.bad td{background:#fef2f2}code{font-family:ui-monospace,monospace;font-size:10px;color:#374151}</style>`;
      const body = rows.map((r: any) => {
        const s = r.summary ?? {};
        const dur = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) + "s" : "—";
        const parts: string[] = [];
        if (r.job === "cookies-autocheck") {
          if (s.skipped) parts.push(`Skipped: ${s.skipped}`);
          else parts.push(`${s.checked ?? 0} checked, ${s.active ?? 0} active, ${s.invalid ?? 0} invalid, ${s.on_hold ?? 0} on-hold, ${s.free ?? 0} free, ${s.transient ?? 0} transient`);
          if (s.removed_invalid || s.removed_free || s.removed_on_hold || s.removed_duplicates)
            parts.push(`Removed: ${s.removed_invalid ?? 0} invalid, ${s.removed_free ?? 0} free, ${s.removed_on_hold ?? 0} on-hold, ${s.removed_duplicates ?? 0} duplicates`);
        } else if (r.job === "proxies-autocheck") {
          if (s.skipped) parts.push(`Skipped: ${s.skipped}`);
          else parts.push(`${s.checked ?? 0} checked, ${s.ok_count ?? 0} valid, ${s.dead ?? 0} invalid, ${s.transient ?? 0} transient`);
          if (s.removed_invalid) parts.push(`Removed: ${s.removed_invalid} invalid`);
        } else {
          parts.push(fmt(s));
        }
        const reasons = s.reasons ? `<div><code>Reasons: ${fmt(s.reasons)}</code></div>` : "";
        const err = r.error ? `<div style="color:#b91c1c"><code>${fmt(r.error)}</code></div>` : "";
        return `<tr class="${r.ok === false ? "bad" : ""}"><td>${r.job}</td><td>${new Date(r.started_at).toLocaleString()}</td><td>${r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}</td><td>${dur}</td><td>${r.ok === false ? "FAIL" : r.ok === true ? "OK" : "…"}</td><td>${parts.join("<br/>")}${reasons}${err}</td></tr>`;
      }).join("");
      w.document.write(`<!doctype html><html><head><title>Job runs report</title>${style}</head><body><h1>Job runs report</h1><small>Generated ${new Date().toLocaleString()} · ${rows.length} runs</small><table><thead><tr><th>Job</th><th>Started</th><th>Finished</th><th>Duration</th><th>Status</th><th>Summary</th></tr></thead><tbody>${body}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
      w.document.close();
      toast.success(`Prepared ${rows.length} runs for print/PDF`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    }
  };

  // Merge-preserving sync: never overwrite fields the admin is actively editing.
  useEffect(() => {
    const remote = q.data?.settings;
    if (!remote) return;
    setLocal((prev) => {
      const next: Record<string, string> = { ...remote };
      for (const k of dirtyRef.current) {
        if (prev[k] !== undefined) next[k] = prev[k];
      }
      return next;
    });
  }, [q.data]);

  const set = (k: string, v: string) => {
    dirtyRef.current.add(k);
    setLocal((s) => ({ ...s, [k]: v }));
  };

  // Optimistic save with rollback. Pass an explicit value to bypass stale-closure
  // bugs from toggles that fire immediately after setState.
  const save = async (k: string, valueOverride?: string) => {
    if (busy[k]) return;
    const value = valueOverride ?? local[k] ?? "";
    const prev = q.data?.settings?.[k];
    setLocal((s) => ({ ...s, [k]: value }));
    setBusy((b) => ({ ...b, [k]: true }));
    try {
      await doSet({ data: { key: k, value } });
      dirtyRef.current.delete(k);
      toast.success(`Saved ${k.replace(/_/g, " ")}`);
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["public-contacts"] });
      qc.invalidateQueries({ queryKey: ["public-gate"] });
    } catch (e: any) {
      // Rollback local optimistic value.
      setLocal((s) => ({ ...s, [k]: prev ?? "" }));
      dirtyRef.current.delete(k);
      toast.error(`Couldn't save ${k.replace(/_/g, " ")}`, {
        description: e?.message ?? "Reverted to previous value.",
      });
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[k]; return n; });
    }
  };

  const proxyOn = local.proxy_mode === "1";
  const maintOn = local.maintenance_enabled === "1";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <SettingsIcon className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Config</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Settings</h1>
          <p className="text-sm text-white/50 mt-2">Global toggles and thresholds. Changes take effect immediately.</p>
        </div>
      </div>

      {/* Proxy mode */}
      <Section
        icon={Zap}
        title="Proxy mode"
        subtitle="Route every cookie check and TV activation through the proxy pool. Auto-check jobs use whichever mode is active when they run."
        pill={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={proxyOn
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : "bg-white/10 text-white/60 border-white/15"}>{proxyOn ? "PROXIED" : "DIRECT"}</Badge>
            {proxyOn && proxyStatusQ.data && (
              <Badge variant="outline" className={
                (proxyStatusQ.data.usable ?? 0) > 0
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25 font-mono text-[10px]"
                  : "bg-rose-500/15 text-rose-300 border-rose-500/30 font-mono text-[10px]"
              }>
                {proxyStatusQ.data.usable}/{proxyStatusQ.data.total} USABLE
              </Badge>
            )}
          </div>
        }
      >
        <div className="flex items-center gap-4">
          <Switch checked={proxyOn} disabled={!!busy["proxy_mode"]} onCheckedChange={async () => {
            setBusy((b) => ({ ...b, proxy_mode: true }));
            try {
              const r = await doToggle();
              const nv = r.proxy_mode ? "1" : "0";
              setLocal((s) => ({ ...s, proxy_mode: nv }));
              dirtyRef.current.delete("proxy_mode");
              toast.success(`Proxy mode ${r.proxy_mode ? "enabled" : "disabled"}`);
              qc.invalidateQueries({ queryKey: ["admin-settings"] });
              qc.invalidateQueries({ queryKey: ["admin-proxy-status"] });
            } catch (e: any) { toast.error(e?.message ?? "Toggle failed"); }
            finally { setBusy((b) => { const n = { ...b }; delete n.proxy_mode; return n; }); }
          }} />
          <div className="text-sm">
            <div className="text-white/80">{proxyOn ? "Traffic routed via proxy pool" : "Direct edge connections"}</div>
            {proxyOn && proxyStatusQ.data && (proxyStatusQ.data.usable ?? 0) === 0 && (
              <div className="text-rose-300 mt-1 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                No usable proxies — cookie checks and activations will fail until proxies recover.
              </div>
            )}
            {proxyOn && proxyStatusQ.data && (proxyStatusQ.data.quarantined ?? 0) > 0 && (
              <div className="text-amber-300/80 mt-1 text-xs">
                {proxyStatusQ.data.quarantined} quarantined · avg latency {proxyStatusQ.data.avg_latency_ms}ms
              </div>
            )}
          </div>
        </div>
      </Section>


      {/* Maintenance mode */}
      <Section
        icon={ShieldAlert}
        title="Maintenance mode"
        subtitle="When enabled, the public site shows a banner and blocks new activations."
        pill={<Badge variant="outline" className={maintOn
          ? "bg-red-500/15 text-red-300 border-red-500/30"
          : "bg-white/10 text-white/60 border-white/15"}>{maintOn ? "ENABLED" : "OFF"}</Badge>}
        highlight={maintOn ? "border-[#ff2a3a]/40" : undefined}
      >
        <MaintenanceControls
          local={local}
          setLocal={setLocal}
          dirtyRef={dirtyRef}
          busy={busy}
          setBusy={setBusy}
          doMaint={doMaint}
          qc={qc}
          maintOn={maintOn}
          savedMessage={q.data?.settings?.maintenance_message ?? ""}
        />
      </Section>



      {/* Activation flow */}

      <ActivationFlowSection local={local} set={set} save={save} busy={busy} />



      <LiveJobsPanel />

      {/* Auto jobs */}

      <Section
        icon={RefreshCw}
        title="Scheduled checks & cleanup"
        subtitle="Cron jobs run in the background. Configure each job's interval (hours) and enable/disable independently. Next-run time is computed from the last successful run."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <JobScheduleCard
            title="Cookie auto-check"
            enabledKey="auto_check_enabled"
            intervalKey="cookies_autocheck_interval_hours"
            lastRunKey="cookies_last_run_at"
            cleanupKey="autocheck_cleanup"
            cleanupLabel="Auto-cleanup after check (invalid / free / on-hold / duplicates)"
            defaultInterval={24}
            local={local} set={set} onSave={save}
            onRun={() => runCookiesMut.mutate()}
            running={runCookiesMut.isPending}
          />
          <JobScheduleCard
            title="Proxy auto-check"
            enabledKey="proxy_auto_check_enabled"
            intervalKey="proxies_autocheck_interval_hours"
            lastRunKey="proxies_last_run_at"
            cleanupKey="proxy_autocheck_cleanup"
            cleanupLabel="Auto-remove invalid proxies after check"
            defaultInterval={20}
            local={local} set={set} onSave={save}
            onRun={() => runProxiesMut.mutate()}
            running={runProxiesMut.isPending}
          />
          <ToggleField k="auto_cleanup_enabled" label="Nightly cleanup" hint="Prunes stale rows and old logs" local={local} set={set} onSave={save} busy={busy} />
          <NumField k="auto_cleanup_days" label="Delete rows older than (days)" local={local} set={set} onSave={save} busy={busy} min={1} max={365} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 pt-4 border-t border-white/10">
          <Button size="sm" variant="outline" onClick={exportRunsCSV} className="border-white/15 bg-white/5">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export runs (CSV)
          </Button>
          <Button size="sm" variant="outline" onClick={exportRunsPDF} className="border-white/15 bg-white/5">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export runs (PDF)
          </Button>
          <span className="text-[11px] text-white/40 self-center ml-1">
            Exports the last 20 cookie / proxy / cleanup runs with removed counts, timestamps, and reasons.
          </span>
        </div>
      </Section>

      {/* Admin notifications */}
      <Section
        icon={Bell}
        title="Admin notifications"
        subtitle="Toast notifications when scheduled or manual jobs finish. Quiet hours mute toasts within a time window (24h HH:MM, local time)."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <ToggleField k="notify_cookies" label="Cookie check completion" hint="Toast when cookie auto-check finishes" local={local} set={set} onSave={save} busy={busy} defaultOn />
          <ToggleField k="notify_proxies" label="Proxy check completion" hint="Toast when proxy auto-check finishes" local={local} set={set} onSave={save} busy={busy} defaultOn />
          <ToggleField k="notify_cleanup" label="Nightly cleanup" hint="Toast when nightly cleanup finishes" local={local} set={set} onSave={save} busy={busy} defaultOn />
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
            <div className="text-sm font-medium mb-2">Quiet hours</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Start</label>
                <div className="flex gap-2 mt-1">
                  <Input type="time" value={local.notify_quiet_start ?? ""} onChange={(e) => set("notify_quiet_start", e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />
                  <Button size="sm" onClick={() => save("notify_quiet_start")} className="btn-red shrink-0"><Save className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">End</label>
                <div className="flex gap-2 mt-1">
                  <Input type="time" value={local.notify_quiet_end ?? ""} onChange={(e) => set("notify_quiet_end", e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />
                  <Button size="sm" onClick={() => save("notify_quiet_end")} className="btn-red shrink-0"><Save className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </div>
            <div className="text-[11px] text-white/40 mt-2">Leave blank to always notify. Window may wrap midnight.</div>
          </div>
        </div>
      </Section>

    </div>
  );
}

function GithubSection() {
  const fetchGithub = useServerFn(getGithubInfo);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-github-info"],
    queryFn: () => fetchGithub(),
    refetchInterval: 60000,
  });

  return (
    <Section
      icon={Github}
      title="GitHub connection"
      subtitle="The source repository and deployment connection for this OKFLIX project."
    >
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
        <div className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
          <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
            <GitBranch className="w-5 h-5 text-white/70" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-0.5">Connected Repository</div>
            <div className="text-sm font-medium text-white truncate">
              {isLoading ? "..." : data?.repoName ?? "Unknown Repository"}
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
          <div className="p-2 rounded-lg bg-black/40 border border-white/[0.06]">
            <Github className="w-5 h-5 text-white/70" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-0.5">Connected Account</div>
            <div className="text-sm font-medium text-white truncate">
              {isLoading ? "..." : data?.githubAccount ?? "Unknown Account"}
            </div>
          </div>
        </div>

        <Button variant="outline" size="sm" asChild className="shrink-0 border-white/10 hover:border-[#ff2a3a]/50 hover:bg-[#ff2a3a]/5 transition-all">
          <a href="https://github.com" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-2" />
            GitHub Dashboard
          </a>
        </Button>
      </div>
    </Section>
  );
}

function Section({ icon: Icon, title, subtitle, pill, children, highlight }: {
  icon: any; title: string; subtitle?: string; pill?: React.ReactNode; children: React.ReactNode; highlight?: string;
}) {
  return (
    <div className={`glass p-5 ${highlight ?? ""}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <Icon className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">{title}</div>
            {subtitle && <div className="text-xs text-white/50 mt-1 max-w-2xl">{subtitle}</div>}
          </div>
        </div>
        {pill}
      </div>
      {children}
    </div>
  );
}

function ActivationFlowSection({ local, set, save, busy }: any) {
  const loginOn = local.login_required === "1";
  const keyOn = local.access_key_required === "1";
  const gateOn = loginOn || keyOn;
  const rlRaw = local.rate_limit_per_10min ?? "10";
  const rlValue = parseInt(rlRaw, 10);
  const rlUnlimited = !Number.isNaN(rlValue) && rlValue === 0;
  const rlDisplay = rlUnlimited ? "Unlimited" : `${rlValue || 10} / 10 min`;
  const maxA = parseInt(local.max_activation_attempts ?? "3", 10) || 3;

  const activeLabels: string[] = [];
  if (loginOn) activeLabels.push("Login");
  if (keyOn) activeLabels.push("Access Key");

  const setUnlimited = () => set("rate_limit_per_10min", "0");
  const setDefault10 = () => set("rate_limit_per_10min", "10");

  return (
    <div className={`glass p-5 ${gateOn ? "border-emerald-500/20" : ""}`}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <Timer className="w-4 h-4 text-[#ff2a3a] mt-1" />
          <div>
            <div className="font-display text-lg leading-tight">Activation flow</div>
            <div className="text-xs text-white/50 mt-1 max-w-2xl">
              Cookie retry budget and abuse throttling for the public activation endpoint. Rate limit auto-yields to the access-gate throttle when a gate is enabled.
            </div>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            gateOn
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 font-mono text-[10px]"
              : rlUnlimited
                ? "bg-sky-500/15 text-sky-300 border-sky-500/30 font-mono text-[10px]"
                : "bg-amber-500/15 text-amber-300 border-amber-500/30 font-mono text-[10px]"
          }
        >
          {gateOn
            ? `GATED · ${activeLabels.join(" + ")}`
            : rlUnlimited
              ? "PUBLIC · UNLIMITED"
              : "PUBLIC · IP LIMITED"}
        </Badge>
      </div>

      {/* Live effective policy banner */}
      <div className={`mb-4 rounded-md border px-3 py-2.5 text-xs flex items-start gap-2 ${
        gateOn
          ? "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100/90"
          : rlUnlimited
            ? "border-sky-500/25 bg-sky-500/[0.06] text-sky-100/90"
            : "border-amber-500/25 bg-amber-500/[0.06] text-amber-100/90"
      }`}>
        {gateOn
          ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          : rlUnlimited
            ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
        <div className="leading-relaxed">
          {gateOn ? (
            <>
              <span className="font-semibold">{activeLabels.join(" & ")} gate active.</span>{" "}
              Per-IP rate limit is <span className="font-mono">disabled</span> — gated users are throttled by their per-user daily limit and key quota. Cookie retry cap ({maxA}/activation) still applies.
            </>
          ) : rlUnlimited ? (
            <>
              <span className="font-semibold">Unlimited public activation.</span>{" "}
              No per-IP throttling — any anonymous caller can hit the endpoint without limit. Only the cookie retry cap ({maxA}/activation) protects the pool. Recommended only when an access gate or upstream WAF is in place.
            </>
          ) : (
            <>
              <span className="font-semibold">No access gate enabled.</span>{" "}
              Public activation is protected by the IP rate limit ({rlValue}/10 min) and cookie retry cap ({maxA}/activation). Signed-in users bypass the IP limit and use their per-user daily quota instead.
            </>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <NumField
          k="max_activation_attempts"
          label="Max cookies tried per activation"
          hint={`Currently: retry up to ${maxA} cookies before giving up. Applies to every request.`}
          local={local} set={set} onSave={save} busy={busy} min={1} max={10}
        />
        <div className={gateOn ? "opacity-60" : ""}>
          <NumField
            k="rate_limit_per_10min"
            label="Rate limit (per IP, 10 min)"
            hint={
              gateOn
                ? `Idle — ${activeLabels.join(" + ")} gate is enforcing throttling. Turn gates off in Access to reactivate.`
                : rlUnlimited
                  ? `Unlimited (0) — no per-IP cap. Anonymous callers can activate without any throttling.`
                  : `Currently: allow ${rlValue} attempts per IP every 10 min for anonymous callers. Set to 0 for unlimited.`
            }
            local={local} set={set} onSave={save} busy={busy} min={0} max={200}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={setUnlimited}
              disabled={rlUnlimited}
              className="text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded border border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              ∞ Set unlimited
            </button>
            <button
              type="button"
              onClick={setDefault10}
              className="text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded border border-white/15 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] transition"
            >
              Reset to 10
            </button>
            {gateOn && (
              <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 self-center">
                · Stored value used if gate turns off
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid sm:grid-cols-3 gap-2 text-[11px]">
        <PolicyChip
          label="Anonymous"
          value={gateOn ? "Blocked by gate" : rlDisplay + (rlUnlimited ? "" : " per IP")}
          ok={!gateOn && !rlUnlimited}
          warn={!gateOn && rlUnlimited}
        />
        <PolicyChip label="Signed-in" value="Per-user daily limit" ok />
        <PolicyChip label="Cookie retries" value={`${maxA} per activation`} ok />
      </div>
    </div>
  );
}

function PolicyChip({ label, value, ok, warn }: { label: string; value: string; ok?: boolean; warn?: boolean }) {
  const border = warn
    ? "border-sky-500/30 bg-sky-500/[0.06]"
    : ok
      ? "border-white/10 bg-white/[0.03]"
      : "border-rose-500/25 bg-rose-500/[0.05]";
  return (
    <div className={`rounded-md border px-3 py-2 flex items-center justify-between ${border}`}>
      <span className="font-mono uppercase tracking-widest text-[9px] text-white/50">{label}</span>
      <span className="font-mono text-white/85 text-[11px]">{value}</span>
    </div>
  );
}


function NumField({ k, label, hint, local, set, onSave, busy, min, max }: any) {
  const raw = local[k] ?? "";
  const n = raw === "" ? NaN : Number(raw);
  const outOfRange = raw !== "" && (Number.isNaN(n) || (min != null && n < min) || (max != null && n > max));
  const isBusy = !!busy?.[k];
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</label>
      <div className="flex gap-2">
        <Input
          type="number" min={min} max={max} value={raw}
          onChange={(e) => set(k, e.target.value)}
          className={`bg-white/5 font-mono ${outOfRange ? "border-red-500/50" : "border-white/10"}`}
        />
        <Button size="sm" disabled={isBusy || outOfRange || raw === ""} onClick={() => onSave(k)} className="btn-red shrink-0">
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {outOfRange
        ? <div className="text-[11px] text-red-300">Value must be between {min} and {max}.</div>
        : hint && <div className="text-[11px] text-white/40">{hint}</div>}
    </div>
  );
}





function TextField({ k, label, placeholder, local, set, onSave, busy }: any) {
  const isBusy = !!busy?.[k];
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</label>
      <div className="flex gap-2">
        <Input placeholder={placeholder} value={local[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />
        <Button size="sm" disabled={isBusy} onClick={() => onSave(k)} className="btn-red shrink-0">
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}
function ToggleField({ k, label, hint, local, set, onSave, busy, defaultOn }: any) {
  const raw = local[k];
  const on = raw === "1" || (raw === undefined && !!defaultOn);
  const isBusy = !!busy?.[k];
  return (
    <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-white/40">{hint ?? (on ? "Enabled" : "Disabled")}</div>
      </div>
      <div className="flex items-center gap-2">
        {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/50" />}
        <Switch checked={on} disabled={isBusy} onCheckedChange={(v) => {
          const nv = v ? "1" : "0";
          set(k, nv);
          onSave(k, nv);          // pass explicit value → no stale-closure bug
        }} />
      </div>
    </div>
  );
}

function fmtRelative(ms: number): string {
  const abs = Math.abs(ms);
  const s = Math.round(abs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 48) return r ? `${h}h ${r}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function JobScheduleCard({
  title, enabledKey, intervalKey, lastRunKey, cleanupKey, cleanupLabel,
  defaultInterval, local, set, onSave, onRun, running,
}: {
  title: string;
  enabledKey: string;
  intervalKey: string;
  lastRunKey: string;
  cleanupKey: string;
  cleanupLabel: string;
  defaultInterval: number;
  local: Record<string, string>;
  set: (k: string, v: string) => void;
  onSave: (k: string, valueOverride?: string) => void;
  onRun: () => void;
  running: boolean;
}) {
  const enabled = local[enabledKey] === "1";
  const cleanupOn = local[cleanupKey] !== "0";
  const rawInterval = local[intervalKey];
  const interval = Math.max(1, parseInt(rawInterval || String(defaultInterval), 10) || defaultInterval);
  const lastRunIso = local[lastRunKey];
  const lastRun = lastRunIso ? new Date(lastRunIso) : null;
  const nextRun = lastRun ? new Date(lastRun.getTime() + interval * 3600 * 1000) : null;
  const now = Date.now();
  const nextDeltaMs = nextRun ? nextRun.getTime() - now : 0;
  const overdue = enabled && nextRun && nextDeltaMs <= 0;

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[11px] text-white/40">
            {enabled ? `Runs every ${interval}h` : "Disabled — will not run on schedule"}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className={enabled ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-white/10 text-white/60 border-white/15"}>
            {enabled ? "ON" : "OFF"}
          </Badge>
          <Switch checked={enabled} onCheckedChange={(v) => { const nv = v ? "1" : "0"; set(enabledKey, nv); onSave(enabledKey, nv); }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Interval (hours)</label>
          <div className="flex gap-2 mt-1">
            <Input
              type="number" min={1} max={168}
              value={rawInterval ?? String(defaultInterval)}
              onChange={(e) => set(intervalKey, e.target.value)}
              className="bg-white/5 border-white/10 font-mono"
            />
            <Button size="sm" onClick={() => onSave(intervalKey)} className="btn-red shrink-0">
              <Save className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Next run</label>
          <div className={`mt-1 rounded-md px-2.5 py-2 text-xs font-mono border ${overdue ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-white/70"}`}>
            {!enabled
              ? "—"
              : !nextRun
                ? "Never run yet — due now"
                : overdue
                  ? `Overdue by ${fmtRelative(-nextDeltaMs)}`
                  : `In ${fmtRelative(nextDeltaMs)} · ${nextRun.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          </div>
          <div className="text-[10px] text-white/40 mt-1 font-mono">
            Last: {lastRun ? lastRun.toLocaleString() : "never"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] p-2.5">
        <div className="min-w-0 pr-3">
          <div className="text-xs">{cleanupLabel}</div>
        </div>
        <Switch checked={cleanupOn} onCheckedChange={(v) => { const nv = v ? "1" : "0"; set(cleanupKey, nv); onSave(cleanupKey, nv); }} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRun} disabled={running} className="btn-red">
          {running ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
          Run now
        </Button>
        <span className="text-[11px] text-white/40 self-center">
          Manual run ignores schedule and enabled toggle.
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Maintenance controls — toggle, banner message w/ live preview, and a
// start/end schedule. Kept in one component to keep the section self-contained.
// ============================================================================
const DEFAULT_MAINT_MSG =
  "The service is temporarily unavailable. Please try again shortly.";

function toLocalInputValue(iso: string | undefined | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): string {
  if (!v) return "";
  const t = Date.parse(v);
  return isNaN(t) ? "" : new Date(t).toISOString();
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function MaintenanceControls(props: {
  local: Record<string, string>;
  setLocal: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  dirtyRef: React.MutableRefObject<Set<string>>;
  busy: Record<string, boolean>;
  setBusy: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  doMaint: (args: { data: { enabled?: boolean; message?: string; starts_at?: string | null; ends_at?: string | null } }) => Promise<any>;
  qc: ReturnType<typeof useQueryClient>;
  maintOn: boolean;
  savedMessage: string;
}) {
  const { local, setLocal, dirtyRef, busy, setBusy, doMaint, qc, maintOn, savedMessage } = props;
  const rawMsg = local.maintenance_message ?? "";
  const clean = rawMsg.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  const messageInvalid = clean.length > 0 && clean.length < 8;
  const messageTooLong = rawMsg.length > 500;
  const messageDirty = dirtyRef.current.has("maintenance_message");

  const startsIso = local.maintenance_starts_at ?? "";
  const endsIso = local.maintenance_ends_at ?? "";
  const startsLocal = toLocalInputValue(startsIso);
  const endsLocal = toLocalInputValue(endsIso);
  const startsMs = startsIso ? Date.parse(startsIso) : NaN;
  const endsMs = endsIso ? Date.parse(endsIso) : NaN;
  const scheduleHalfFilled = (!!startsIso && !endsIso) || (!startsIso && !!endsIso);
  const scheduleInvalid =
    scheduleHalfFilled ||
    (!isNaN(startsMs) && !isNaN(endsMs) && endsMs <= startsMs);
  const scheduleError = scheduleHalfFilled
    ? (startsIso
        ? "Set an end time — without it the “Estimated back in” countdown won't render."
        : "Set a start time — a maintenance window needs both start and end.")
    : (!isNaN(startsMs) && !isNaN(endsMs) && endsMs <= startsMs)
      ? "End time must be after start time."
      : null;
  const scheduleDirty =
    dirtyRef.current.has("maintenance_starts_at") ||
    dirtyRef.current.has("maintenance_ends_at");

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const withinWindow =
    !isNaN(startsMs) && !isNaN(endsMs) && nowTick >= startsMs && nowTick < endsMs;
  const nextTransition = (() => {
    if (isNaN(startsMs) || isNaN(endsMs)) return null;
    if (nowTick < startsMs) return { label: "Starts in", ms: startsMs - nowTick };
    if (nowTick < endsMs) return { label: "Ends in", ms: endsMs - nowTick };
    return { label: "Ended", ms: 0 };
  })();

  const previewMsg = clean.length >= 8 ? clean : DEFAULT_MAINT_MSG;
  const brand = useBrand();


  async function saveMessage() {
    if (messageInvalid || messageTooLong || busy["maintenance_message"]) return;
    setBusy((b) => ({ ...b, maintenance_message: true }));
    try {
      await doMaint({ data: { message: clean } });
      setLocal((s) => ({ ...s, maintenance_message: clean }));
      dirtyRef.current.delete("maintenance_message");
      toast.success("Banner message saved", { description: "Public site updates instantly." });
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["public-gate"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save message");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n.maintenance_message; return n; });
    }
  }

  async function saveSchedule() {
    if (scheduleInvalid) {
      toast.error("Can't save maintenance window", { description: scheduleError ?? "Fix the highlighted fields." });
      return;
    }
    if (busy["maintenance_schedule"]) return;
    setBusy((b) => ({ ...b, maintenance_schedule: true }));
    try {
      await doMaint({ data: { starts_at: startsIso || "", ends_at: endsIso || "" } });
      dirtyRef.current.delete("maintenance_starts_at");
      dirtyRef.current.delete("maintenance_ends_at");
      toast.success(startsIso || endsIso ? "Maintenance schedule saved" : "Schedule cleared");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["public-gate"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save schedule");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n.maintenance_schedule; return n; });
    }
  }

  async function clearSchedule() {
    setLocal((s) => ({ ...s, maintenance_starts_at: "", maintenance_ends_at: "" }));
    dirtyRef.current.add("maintenance_starts_at");
    dirtyRef.current.add("maintenance_ends_at");
    await doMaint({ data: { starts_at: "", ends_at: "" } }).then(() => {
      dirtyRef.current.delete("maintenance_starts_at");
      dirtyRef.current.delete("maintenance_ends_at");
      toast.success("Schedule cleared");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["public-gate"] });
    }).catch((e) => toast.error(e?.message ?? "Failed to clear schedule"));
  }

  return (
    <div className="space-y-5">
      {/* Manual toggle */}
      <div className="flex items-center gap-4">
        <Switch
          checked={maintOn}
          disabled={!!busy["maintenance_enabled"]}
          onCheckedChange={async (v) => {
            setBusy((b) => ({ ...b, maintenance_enabled: true }));
            const prev = local.maintenance_enabled;
            setLocal((s) => ({ ...s, maintenance_enabled: v ? "1" : "0" }));
            try {
              await doMaint({ data: { enabled: v } });
              dirtyRef.current.delete("maintenance_enabled");
              toast.success(`Maintenance ${v ? "enabled" : "disabled"}`, {
                description: v
                  ? "Public site is now showing the maintenance banner."
                  : "Public site is live again.",
              });
              qc.invalidateQueries({ queryKey: ["admin-settings"] });
              qc.invalidateQueries({ queryKey: ["public-gate"] });
            } catch (e: any) {
              setLocal((s) => ({ ...s, maintenance_enabled: prev }));
              toast.error(e?.message ?? "Toggle failed");
            } finally {
              setBusy((b) => { const n = { ...b }; delete n.maintenance_enabled; return n; });
            }
          }}
        />
        <span className="text-sm text-white/60">
          {maintOn
            ? "Public site is in maintenance"
            : withinWindow
              ? "Public site is in maintenance (scheduled window)"
              : "Public site is live"}
        </span>
        {busy["maintenance_enabled"] && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/50" />}
      </div>

      {/* Message editor + preview */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Banner message</label>
          <Textarea
            value={rawMsg}
            onChange={(e) => {
              const v = e.target.value.slice(0, 500);
              dirtyRef.current.add("maintenance_message");
              setLocal((s) => ({ ...s, maintenance_message: v }));
            }}
            rows={3}
            placeholder={DEFAULT_MAINT_MSG}
            maxLength={500}
            className={`bg-white/5 border-white/10 ${messageInvalid || messageTooLong ? "border-rose-500/50" : ""}`}
          />
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className={messageTooLong ? "text-rose-300" : "text-white/40"}>
              {rawMsg.length}/500 characters
              {clean.length > 0 && clean.length < 8 && (
                <span className="ml-2 text-rose-300">· min 8 non-whitespace chars</span>
              )}
              {clean.length === 0 && rawMsg.length === 0 && (
                <span className="ml-2 text-white/40">· empty = default message</span>
              )}
            </span>
            {messageDirty && <span className="text-amber-300/80">UNSAVED CHANGES</span>}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy["maintenance_message"] || !messageDirty}
              onClick={() => {
                setLocal((s) => ({ ...s, maintenance_message: savedMessage }));
                dirtyRef.current.delete("maintenance_message");
                toast("Reverted to saved message");
              }}
              className="border-white/10 bg-white/5 hover:bg-white/10"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Revert
            </Button>
            <Button
              size="sm"
              disabled={!!busy["maintenance_message"] || messageInvalid || messageTooLong || !messageDirty}
              onClick={saveMessage}
              className="btn-red"
            >
              {busy["maintenance_message"]
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
                : <><Save className="w-3.5 h-3.5 mr-1.5" /> Save message</>}
            </Button>
          </div>
        </div>

        {/* Live preview — mirrors the full-screen takeover, driven by the
            current Branding Studio values so per-word font size, colors,
            glow, and copy all update instantly here. */}
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Live preview</label>
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#050505] max-h-[420px] overflow-y-auto">
            <MaintenanceView
              b={brand}
              message={previewMsg}
              remainingLabel={!isNaN(endsMs) ? fmtCountdown(Math.max(0, endsMs - nowTick)) : null}
              startsAt={startsIso || null}
              endsAt={endsIso || null}
              channels={[]}
              user={null}
              compact
            />
          </div>
          <div className="text-[10px] text-white/40 font-mono">
            {clean.length >= 8 ? "Shown to users." : "Empty / too short — using default message."}
          </div>
        </div>

      </div>

      {/* Schedule */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-white/60" />
          <div className="text-sm font-medium">Scheduled window</div>
          <Badge
            variant="outline"
            className={
              withinWindow
                ? "bg-red-500/15 text-red-300 border-red-500/30"
                : startsIso || endsIso
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-white/10 text-white/60 border-white/15"
            }
          >
            {withinWindow ? "ACTIVE" : startsIso || endsIso ? "SCHEDULED" : "NONE"}
          </Badge>
          {nextTransition && (
            <span className="text-[11px] font-mono text-white/50 ml-auto">
              {nextTransition.label} {fmtCountdown(nextTransition.ms)}
            </span>
          )}
        </div>
        <p className="text-xs text-white/50">
          Maintenance auto-enables at start and auto-disables at end. Manual toggle above still overrides.
          Users see times in <span className="font-mono text-white/70">{brand.maint_timezone || "UTC"}</span>
          {" · "}<span className="font-mono text-white/70">{brand.maint_time_format === "12h" ? "12h" : "24h"}</span>
          {" "}(change in Admin → Branding → Maintenance).
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-widest text-white/40 mr-1">Quick window</span>
          {[
            { label: "Next 15m", start: 0, end: 15 },
            { label: "Next 30m", start: 0, end: 30 },
            { label: "Next 1h", start: 0, end: 60 },
            { label: "Next 4h", start: 0, end: 240 },
            { label: "Tonight", start: 60, end: 60 * 5 },
          ].map((p) => (
            <Button
              key={p.label}
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px] border-white/10 bg-white/5 hover:bg-white/10"
              onClick={() => {
                const now = Date.now();
                const s = new Date(now + p.start * 60_000).toISOString();
                const e = new Date(now + (p.start + p.end) * 60_000).toISOString();
                dirtyRef.current.add("maintenance_starts_at");
                dirtyRef.current.add("maintenance_ends_at");
                setLocal((st) => ({ ...st, maintenance_starts_at: s, maintenance_ends_at: e }));
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Starts at (local)</label>
            <Input
              type="datetime-local"
              value={startsLocal}
              onChange={(e) => {
                const iso = fromLocalInputValue(e.target.value);
                dirtyRef.current.add("maintenance_starts_at");
                setLocal((s) => ({ ...s, maintenance_starts_at: iso }));
              }}
              className="bg-white/5 border-white/10 font-mono mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Ends at (local)</label>
            <Input
              type="datetime-local"
              value={endsLocal}
              onChange={(e) => {
                const iso = fromLocalInputValue(e.target.value);
                dirtyRef.current.add("maintenance_ends_at");
                setLocal((s) => ({ ...s, maintenance_ends_at: iso }));
              }}
              className={`bg-white/5 border-white/10 font-mono mt-1 ${scheduleInvalid ? "border-rose-500/50" : ""}`}
            />
          </div>
        </div>
        {scheduleError && (
          <div className="text-[11px] text-rose-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> {scheduleError}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy["maintenance_schedule"] || (!startsIso && !endsIso)}
            onClick={clearSchedule}
            className="border-white/10 bg-white/5 hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5 mr-1.5" /> Clear window
          </Button>
          <Button
            size="sm"
            disabled={!!busy["maintenance_schedule"] || scheduleInvalid || !scheduleDirty}
            onClick={saveSchedule}
            className="btn-red"
          >
            {busy["maintenance_schedule"]
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
              : <><Save className="w-3.5 h-3.5 mr-1.5" /> Save schedule</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

