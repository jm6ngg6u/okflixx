import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listSettings, setSetting, toggleProxyMode, setMaintenance,
  runCookiesAutocheckNow, runProxiesAutocheckNow,
} from "@/lib/settings.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Zap, ShieldAlert, Bell, RefreshCw, Timer, Save, Play, Loader2, Download, MessageCircle, Send, Instagram, Phone } from "lucide-react";
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

  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings() });
  const [local, setLocal] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (q.data?.settings) setLocal(q.data.settings);
  }, [q.data]);

  const set = (k: string, v: string) => setLocal((s) => ({ ...s, [k]: v }));
  const save = async (k: string, valueOverride?: string) => {
    try {
      const value = valueOverride ?? local[k] ?? "";
      if (valueOverride !== undefined) setLocal((s) => ({ ...s, [k]: value }));
      await doSet({ data: { key: k, value } });
      toast.success(`Saved ${k.replace(/_/g, " ")}`);
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["public-contacts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
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
        pill={<Badge variant="outline" className={proxyOn
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/10 text-white/60 border-white/15"}>{proxyOn ? "PROXIED" : "DIRECT"}</Badge>}
      >
        <div className="flex items-center gap-4">
          <Switch checked={proxyOn} onCheckedChange={async () => {
            try {
              const r = await doToggle();
              set("proxy_mode", r.proxy_mode ? "1" : "0");
              toast.success(`Proxy mode ${r.proxy_mode ? "enabled" : "disabled"}`);
              qc.invalidateQueries({ queryKey: ["admin-settings"] });
            } catch (e: any) { toast.error(e?.message ?? "Toggle failed"); }
          }} />
          <span className="text-sm text-white/60">{proxyOn ? "Traffic routed via proxy pool" : "Direct edge connections"}</span>
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
            <Switch checked={maintOn} onCheckedChange={async (v) => {
              try {
                await doMaint({ data: { enabled: v, message: local.maintenance_message ?? "" } });
                set("maintenance_enabled", v ? "1" : "0");
                toast.success(`Maintenance ${v ? "enabled" : "disabled"}`);
                qc.invalidateQueries({ queryKey: ["admin-settings"] });
              } catch (e: any) { toast.error(e?.message ?? "Failed"); }
            }} />
            <span className="text-sm text-white/60">{maintOn ? "Public site is in maintenance" : "Public site is live"}</span>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Banner message</label>
            <Textarea
              value={local.maintenance_message ?? ""}
              onChange={(e) => set("maintenance_message", e.target.value)}
              rows={2}
              placeholder="We'll be back shortly."
              className="bg-white/5 border-white/10"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => save("maintenance_message")} className="btn-red">
              <Save className="w-3.5 h-3.5 mr-1.5" /> Save message
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
          <NumField k="max_activation_attempts" label="Max cookies tried per activation" hint="How many cookies to try before giving up" local={local} set={set} onSave={save} min={1} max={10} />
          <NumField k="rate_limit_per_10min" label="Rate limit (per IP, 10 min)" hint="Attempts allowed per IP within 10 minutes" local={local} set={set} onSave={save} min={1} max={200} />
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
          <ToggleField k="auto_cleanup_enabled" label="Nightly cleanup" hint="Prunes stale rows and old logs" local={local} set={set} onSave={save} />
          <NumField k="auto_cleanup_days" label="Delete rows older than (days)" local={local} set={set} onSave={save} min={1} max={365} />
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
          <ToggleField k="notify_cookies" label="Cookie check completion" hint="Toast when cookie auto-check finishes" local={local} set={set} onSave={save} defaultOn />
          <ToggleField k="notify_proxies" label="Proxy check completion" hint="Toast when proxy auto-check finishes" local={local} set={set} onSave={save} defaultOn />
          <ToggleField k="notify_cleanup" label="Nightly cleanup" hint="Toast when nightly cleanup finishes" local={local} set={set} onSave={save} defaultOn />
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
          <NumField k="pool_alert_threshold" label="Alert threshold (usable cookies)" local={local} set={set} onSave={save} min={0} max={10000} />
          <TextField k="pool_alert_webhook" label="Webhook URL" placeholder="https://…" local={local} set={set} onSave={save} />
        </div>
      </Section>

      {/* Contact channels */}
      <Section
        icon={MessageCircle}
        title="Contact channels"
        subtitle="Public contact links shown in the site footer. Leave a handle blank to hide that channel. Master toggle hides the whole strip."
        pill={<Badge variant="outline" className={local.contact_enabled === "1"
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/10 text-white/60 border-white/15"}>{local.contact_enabled === "1" ? "VISIBLE" : "HIDDEN"}</Badge>}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] p-3">
            <div>
              <div className="text-sm font-medium">Show contact strip on public site</div>
              <div className="text-[11px] text-white/40">When off, no contact icons are rendered anywhere.</div>
            </div>
            <Switch
              checked={local.contact_enabled === "1"}
              onCheckedChange={(v) => { set("contact_enabled", v ? "1" : "0"); setTimeout(() => save("contact_enabled"), 0); }}
            />
          </div>

          {local.contact_enabled !== "1" && (
            ((local.contact_tg_username ?? "").trim() ||
             (local.contact_ig_username ?? "").trim() ||
             (local.contact_wa_number ?? "").trim()) ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs px-3 py-2">
                Handles are filled but the master toggle is <b>OFF</b> — nothing appears on the public site. Enable the switch above to publish.
              </div>
            ) : null
          )}

          <ContactRow icon={Send} label="Telegram" kind="telegram" accent="#229ED9" nameKey="contact_tg_name" handleKey="contact_tg_username" handlePlaceholder="yourhandle" local={local} set={set} onSave={save} />
          <ContactRow icon={Instagram} label="Instagram" kind="instagram" accent="#E1306C" nameKey="contact_ig_name" handleKey="contact_ig_username" handlePlaceholder="yourhandle" local={local} set={set} onSave={save} />
          <ContactRow icon={Phone} label="WhatsApp" kind="whatsapp" accent="#25D366" nameKey="contact_wa_name" handleKey="contact_wa_number" handlePlaceholder="+1 555 123 4567" local={local} set={set} onSave={save} />

          {/* Live preview */}
          <ContactPreview local={local} />
        </div>
      </Section>
    </div>
  );
}

// ---- Contact normalization helpers ---------------------------------------
function normalizeHandle(kind: "telegram" | "instagram" | "whatsapp", raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (kind === "whatsapp") return v.replace(/[^\d+]/g, "").replace(/^\++/, "").replace(/\+/g, "");
  // telegram / instagram username: strip leading @, spaces, urls
  let u = v.replace(/^https?:\/\/(t\.me|telegram\.me|instagram\.com|www\.instagram\.com)\//i, "");
  u = u.replace(/^@+/, "").replace(/\/+$/, "").split(/[?#/]/)[0];
  return u.replace(/[^A-Za-z0-9_.]/g, "");
}
function hrefFor(kind: "telegram" | "instagram" | "whatsapp", handle: string): string | null {
  if (!handle) return null;
  if (kind === "telegram") return `https://t.me/${handle}`;
  if (kind === "instagram") return `https://instagram.com/${handle}`;
  return `https://wa.me/${handle}`;
}
function displayHandle(kind: "telegram" | "instagram" | "whatsapp", handle: string): string {
  if (!handle) return "";
  return kind === "whatsapp" ? `+${handle}` : `@${handle}`;
}

function ContactRow({ icon: Icon, label, kind, accent, nameKey, handleKey, handlePlaceholder, local, set, onSave }: {
  icon: any; label: string; kind: "telegram" | "instagram" | "whatsapp"; accent: string;
  nameKey: string; handleKey: string; handlePlaceholder: string;
  local: Record<string, string>; set: (k: string, v: string) => void;
  onSave: (k: string, valueOverride?: string) => void | Promise<void>;
}) {
  const rawHandle = (local[handleKey] ?? "").trim();
  const normalized = normalizeHandle(kind, rawHandle);
  const filled = !!normalized;
  const invalid = !!rawHandle && !normalized;
  const commitHandle = () => {
    if (rawHandle === normalized) { if (rawHandle) onSave(handleKey); return; }
    set(handleKey, normalized);
    onSave(handleKey, normalized);
  };
  const commitName = () => onSave(nameKey);
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="w-8 h-8 rounded-md flex items-center justify-center icon-glow"
          style={{ background: `${accent}22`, border: `1px solid ${accent}55`, color: accent, ["--glow-color" as any]: accent }}
        >
          <Icon className="w-4 h-4" />
        </span>
        <div className="text-sm font-medium">{label}</div>
        <Badge variant="outline" className={filled
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30 ml-auto"
          : "bg-white/10 text-white/50 border-white/15 ml-auto"}>{filled ? "SHOWING" : "HIDDEN"}</Badge>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Display name</label>
          <Input
            placeholder={label}
            value={local[nameKey] ?? ""}
            onChange={(e) => set(nameKey, e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="bg-white/5 border-white/10 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
            {kind === "whatsapp" ? "Phone number (with country code)" : "Username"}
          </label>
          <Input
            placeholder={handlePlaceholder}
            value={local[handleKey] ?? ""}
            onChange={(e) => set(handleKey, e.target.value)}
            onBlur={commitHandle}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`bg-white/5 border-white/10 font-mono text-xs ${invalid ? "border-red-500/50" : ""}`}
          />
          <div className="text-[11px] font-mono text-white/40 flex items-center gap-2">
            {filled ? (
              <>
                <span className="text-white/60">→ {displayHandle(kind, normalized)}</span>
                <span className="text-white/25">·</span>
                <a href={hrefFor(kind, normalized) ?? "#"} target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white truncate">{hrefFor(kind, normalized)}</a>
              </>
            ) : invalid ? (
              <span className="text-red-300">Invalid — check the format</span>
            ) : (
              <span className="text-white/30">{kind === "whatsapp" ? "Digits only, include country code" : "@ and URL prefix are stripped automatically"}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactPreview({ local }: { local: Record<string, string> }) {
  const enabled = local.contact_enabled === "1";
  const items: Array<{ kind: "telegram" | "instagram" | "whatsapp"; name: string; accent: string; Icon: any; handle: string; href: string }> = [];
  const push = (kind: "telegram" | "instagram" | "whatsapp", nameKey: string, handleKey: string, fallbackName: string, accent: string, Icon: any) => {
    const h = normalizeHandle(kind, local[handleKey] ?? "");
    if (!h) return;
    const href = hrefFor(kind, h);
    if (!href) return;
    items.push({ kind, name: (local[nameKey] ?? "").trim() || fallbackName, accent, Icon, handle: displayHandle(kind, h), href });
  };
  push("telegram", "contact_tg_name", "contact_tg_username", "Telegram", "#229ED9", Send);
  push("instagram", "contact_ig_name", "contact_ig_username", "Instagram", "#E1306C", Instagram);
  push("whatsapp", "contact_wa_name", "contact_wa_number", "WhatsApp", "#25D366", Phone);

  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Live preview</div>
        <Badge variant="outline" className={enabled && items.length
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/10 text-white/50 border-white/15"}>
          {enabled && items.length ? `${items.length} VISIBLE` : "HIDDEN ON SITE"}
        </Badge>
      </div>
      {enabled && items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {items.map((c) => (
            <a key={c.kind} href={c.href} target="_blank" rel="noopener noreferrer"
              className="group flex items-center gap-2.5 rounded-full border bg-black/40 backdrop-blur px-3.5 py-2 transition hover:bg-black/60"
              style={{ borderColor: `${c.accent}55` }}>
              <span className="w-8 h-8 rounded-full flex items-center justify-center icon-glow"
                style={{ background: `${c.accent}22`, border: `1px solid ${c.accent}66`, color: c.accent, ["--glow-color" as any]: c.accent }}>
                <c.Icon className="w-4 h-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-mono uppercase tracking-widest text-white/50">{c.name}</span>
                <span className="text-xs text-white/90 font-medium">{c.handle}</span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="text-center text-xs text-white/40 py-6 font-mono">
          {enabled ? "Fill any handle above to preview it here." : "Master toggle is off — the strip is hidden on the public site."}
        </div>
      )}
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

function NumField({ k, label, hint, local, set, onSave, min, max }: any) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</label>
      <div className="flex gap-2">
        <Input type="number" min={min} max={max} value={local[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="bg-white/5 border-white/10 font-mono" />
        <Button size="sm" onClick={() => onSave(k)} className="btn-red shrink-0"><Save className="w-3.5 h-3.5" /></Button>
      </div>
      {hint && <div className="text-[11px] text-white/40">{hint}</div>}
    </div>
  );
}





function TextField({ k, label, placeholder, local, set, onSave }: any) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">{label}</label>
      <div className="flex gap-2">
        <Input placeholder={placeholder} value={local[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />
        <Button size="sm" onClick={() => onSave(k)} className="btn-red shrink-0"><Save className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}
function ToggleField({ k, label, hint, local, set, onSave, defaultOn }: any) {
  const raw = local[k];
  const on = raw === "1" || (raw === undefined && !!defaultOn);
  return (
    <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-white/40">{hint ?? (on ? "Enabled" : "Disabled")}</div>
      </div>
      <Switch checked={on} onCheckedChange={(v) => {
        set(k, v ? "1" : "0");
        setTimeout(() => onSave(k), 0);
      }} />
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
  onSave: (k: string) => void;
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
          <Switch checked={enabled} onCheckedChange={(v) => { set(enabledKey, v ? "1" : "0"); setTimeout(() => onSave(enabledKey), 0); }} />
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
        <Switch checked={cleanupOn} onCheckedChange={(v) => { set(cleanupKey, v ? "1" : "0"); setTimeout(() => onSave(cleanupKey), 0); }} />
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
