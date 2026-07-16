import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listSettings, setSetting, toggleProxyMode, setMaintenance } from "@/lib/settings.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Zap, ShieldAlert, Bell, RefreshCw, Timer, Save } from "lucide-react";
import { toast } from "sonner";
import { LiveJobsPanel } from "@/components/LiveJobsPanel";


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

  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings() });
  const [local, setLocal] = useState<Record<string, string>>({});

  useEffect(() => {
    if (q.data?.settings) setLocal(q.data.settings);
  }, [q.data]);

  const set = (k: string, v: string) => setLocal((s) => ({ ...s, [k]: v }));
  const save = async (k: string) => {
    try {
      await doSet({ data: { key: k, value: local[k] ?? "" } });
      toast.success(`Saved ${k.replace(/_/g, " ")}`);
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
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
        subtitle="Cron jobs run in the background. Cookie auto-check honors the proxy-mode flag at execution time. After a cookie check completes, auto-cleanup removes invalid / free / on-hold / duplicate cookies. After a proxy check, invalid proxies are removed."
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <ToggleField k="auto_check_enabled" label="Cookie auto-check (every 24h)" hint="Rechecks every cookie once per day" local={local} set={set} onSave={save} />
          <ToggleField k="autocheck_cleanup" label="Auto-cleanup after cookie check" hint="Removes invalid / free / on-hold / duplicates" local={local} set={set} onSave={save} />
          <ToggleField k="proxy_auto_check_enabled" label="Proxy auto-check (every 20h)" hint="Rechecks every proxy every 20 hours" local={local} set={set} onSave={save} />
          <ToggleField k="proxy_autocheck_cleanup" label="Auto-remove invalid proxies" hint="Delete invalid proxies after each check" local={local} set={set} onSave={save} />
          <ToggleField k="auto_cleanup_enabled" label="Nightly cleanup" hint="Prunes stale rows and old logs" local={local} set={set} onSave={save} />
          <NumField k="auto_cleanup_days" label="Delete rows older than (days)" local={local} set={set} onSave={save} min={1} max={365} />
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
function ToggleField({ k, label, hint, local, set, onSave }: any) {
  const on = local[k] === "1";
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
