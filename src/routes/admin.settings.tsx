import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listSettings, setSetting, toggleProxyMode, setMaintenance,
  runCookiesAutocheckNow, runProxiesAutocheckNow, testPoolAlertWebhook, getProxyModeStatus,
} from "@/lib/settings.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Zap, ShieldAlert, Bell, RefreshCw, Timer, Save, Play, Loader2, Download, Search, Send, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";

import { toast } from "sonner";
import { LiveJobsPanel } from "@/components/LiveJobsPanel";
import { listRecentJobRuns } from "@/lib/settings.functions";


export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
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
  const testWebhookFn = useServerFn(testPoolAlertWebhook);

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
          : `${r.checked ?? 0} checked · ${r.active ?? 0} active · ${r.invalid ?? 0} invalid · ${r.on_hold ?? 0} on-hold · ${r.free ?? 0} free${reasonsDesc(r)}`,
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
          : `${r.checked ?? 0} checked · ${r.ok_count ?? 0} valid · ${r.dead ?? 0} invalid${r.removed_invalid ? ` · ${r.removed_invalid} removed` : ""}${reasonsDesc(r)}`,
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
      const cols = ["job", "started_at", "finished_at", "ok", "duration_s", "checked", "active", "invalid", "on_hold", "free", "ok_count", "dead", "removed_invalid", "removed_free", "removed_on_hold", "removed_duplicates", "reasons", "error"];
      const esc = (v: any) => {
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const body = rows.map((r: any) => {
        const s = r.summary ?? {};
        const dur = r.finished_at ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000) : "";
        return [r.job, r.started_at, r.finished_at ?? "", r.ok ?? "", dur, s.checked ?? "", s.active ?? "", s.invalid ?? "", s.on_hold ?? "", s.free ?? "", s.ok_count ?? "", s.dead ?? "", s.removed_invalid ?? "", s.removed_free ?? "", s.removed_on_hold ?? "", s.removed_duplicates ?? "", s.reasons ? JSON.stringify(s.reasons) : "", r.error ?? ""].map(esc).join(",");
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
          else parts.push(`${s.checked ?? 0} checked, ${s.active ?? 0} active, ${s.invalid ?? 0} invalid, ${s.on_hold ?? 0} on-hold, ${s.free ?? 0} free`);
          if (s.removed_invalid || s.removed_free || s.removed_on_hold || s.removed_duplicates)
            parts.push(`Removed: ${s.removed_invalid ?? 0} invalid, ${s.removed_free ?? 0} free, ${s.removed_on_hold ?? 0} on-hold, ${s.removed_duplicates ?? 0} duplicates`);
        } else if (r.job === "proxies-autocheck") {
          if (s.skipped) parts.push(`Skipped: ${s.skipped}`);
          else parts.push(`${s.checked ?? 0} checked, ${s.ok_count ?? 0} valid, ${s.dead ?? 0} invalid`);
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
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <Switch checked={maintOn} disabled={!!busy["maintenance_enabled"]} onCheckedChange={async (v) => {
              setBusy((b) => ({ ...b, maintenance_enabled: true }));
              // Optimistic — flip the switch immediately.
              const prev = local.maintenance_enabled;
              setLocal((s) => ({ ...s, maintenance_enabled: v ? "1" : "0" }));
              try {
                // Toggle-only: do NOT resend the banner message here or an
                // un-hydrated local state would wipe the saved copy.
                await doMaint({ data: { enabled: v } });
                dirtyRef.current.delete("maintenance_enabled");
                toast.success(`Maintenance ${v ? "enabled" : "disabled"}`, {
                  description: v ? "Public site is now showing the maintenance banner." : "Public site is live again.",
                });
                qc.invalidateQueries({ queryKey: ["admin-settings"] });
                qc.invalidateQueries({ queryKey: ["public-gate"] });
              } catch (e: any) {
                setLocal((s) => ({ ...s, maintenance_enabled: prev }));
                toast.error(e?.message ?? "Toggle failed");
              }
              finally { setBusy((b) => { const n = { ...b }; delete n.maintenance_enabled; return n; }); }
            }} />
            <span className="text-sm text-white/60">{maintOn ? "Public site is in maintenance" : "Public site is live"}</span>
            {busy["maintenance_enabled"] && <Loader2 className="w-3.5 h-3.5 animate-spin text-white/50" />}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Banner message</label>
            <Textarea
              value={local.maintenance_message ?? ""}
              onChange={(e) => set("maintenance_message", e.target.value)}
              rows={2}
              placeholder="We'll be back shortly."
              maxLength={2000}
              className="bg-white/5 border-white/10"
            />
            <div className="flex items-center justify-between text-[10px] text-white/40 font-mono">
              <span>{(local.maintenance_message ?? "").length}/2000</span>
              {dirtyRef.current.has("maintenance_message") && <span className="text-amber-300/80">UNSAVED CHANGES</span>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy["maintenance_message"] || !dirtyRef.current.has("maintenance_message")}
              onClick={() => {
                const remote = q.data?.settings?.maintenance_message ?? "";
                setLocal((s) => ({ ...s, maintenance_message: remote }));
                dirtyRef.current.delete("maintenance_message");
                toast("Reverted to saved message");
              }}
              className="border-white/10 bg-white/5 hover:bg-white/10"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Revert
            </Button>
            <Button
              size="sm"
              disabled={!!busy["maintenance_message"]}
              onClick={() => save("maintenance_message")}
              className="btn-red"
            >
              {busy["maintenance_message"]
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
                : <><Save className="w-3.5 h-3.5 mr-1.5" /> Save message</>}
            </Button>
          </div>
        </div>
      </Section>


      {/* Activation flow */}

      <Section
        icon={Timer}
        title="Activation flow"
        subtitle="Attempt limits and rate limiting for the public activation endpoint."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <NumField k="max_activation_attempts" label="Max cookies tried per activation" hint="How many cookies to try before giving up" local={local} set={set} onSave={save} busy={busy} min={1} max={10} />
          <NumField k="rate_limit_per_10min" label="Rate limit (per IP, 10 min)" hint="Attempts allowed per IP within 10 minutes" local={local} set={set} onSave={save} busy={busy} min={1} max={200} />
        </div>
      </Section>


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

      {/* Pool alerts */}
      <Section
        icon={Bell}
        title="Pool alerts"
        subtitle="POST a JSON payload to a webhook when usable cookies fall below the threshold."
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <NumField k="pool_alert_threshold" label="Alert threshold (usable cookies)" local={local} set={set} onSave={save} busy={busy} min={0} max={10000} />
          <TextField k="pool_alert_webhook" label="Webhook URL" placeholder="https://…" local={local} set={set} onSave={save} busy={busy} />
        </div>
        <div className="flex items-center justify-end mt-3">
          <Button
            size="sm"
            variant="outline"
            className="border-white/15 bg-white/[0.03] hover:bg-white/[0.06]"
            disabled={!!busy["__test_webhook"] || !(local.pool_alert_webhook ?? "").trim()}
            onClick={async () => {
              setBusy((b) => ({ ...b, __test_webhook: true }));
              try {
                const r: any = await testWebhookFn();
                if (r.ok) toast.success(`Webhook OK · ${r.status} in ${r.duration_ms}ms`);
                else toast.error(`Webhook failed${r.status ? ` · ${r.status}` : ""}`, { description: r.error ?? r.snippet ?? "" });
              } catch (e: any) {
                toast.error("Test failed", { description: e?.message ?? "" });
              } finally {
                setBusy((b) => { const n = { ...b }; delete n.__test_webhook; return n; });
              }
            }}
          >
            {busy["__test_webhook"] ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
            Send test payload
          </Button>
        </div>
      </Section>

    </div>
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
