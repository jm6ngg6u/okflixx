import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listSettings, setSetting, toggleProxyMode, setMaintenance } from "@/lib/settings.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Zap, ShieldAlert, Bell, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
      toast.success(`Saved ${k}`);
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    }
  };

  const proxyOn = local.proxy_mode === "1";
  const maintOn = local.maintenance_enabled === "1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" /> Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Global toggles and thresholds. Changes take effect immediately.
        </p>
      </div>

      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4" /> Proxy mode
            <Badge variant={proxyOn ? "default" : "secondary"}>{proxyOn ? "ON (proxied)" : "OFF (proxyless)"}</Badge>
          </CardTitle>
          <CardDescription>
            When ON, every cookie check and TV activation is routed through a working proxy from the pool.
            When OFF, everything runs direct. The 24 h auto-check job follows this same flag.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch
            checked={proxyOn}
            onCheckedChange={async () => {
              try {
                const r = await doToggle();
                set("proxy_mode", r.proxy_mode ? "1" : "0");
                toast.success(`Proxy mode is now ${r.proxy_mode ? "ON" : "OFF"}`);
                qc.invalidateQueries({ queryKey: ["admin-settings"] });
              } catch (e: any) {
                toast.error(e?.message ?? "Toggle failed");
              }
            }}
          />
          <span className="text-sm text-muted-foreground">Toggle proxy on/off</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" /> Maintenance mode
            <Badge variant={maintOn ? "destructive" : "secondary"}>{maintOn ? "ENABLED" : "off"}</Badge>
          </CardTitle>
          <CardDescription>Shows a banner and blocks new activations when enabled.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={maintOn}
              onCheckedChange={async (v) => {
                await doMaint({ data: { enabled: v, message: local.maintenance_message ?? "" } });
                set("maintenance_enabled", v ? "1" : "0");
                toast.success(`Maintenance ${v ? "enabled" : "disabled"}`);
                qc.invalidateQueries({ queryKey: ["admin-settings"] });
              }}
            />
            <span className="text-sm text-muted-foreground">Enable maintenance mode</span>
          </div>
          <Label>Message shown to visitors</Label>
          <Textarea
            value={local.maintenance_message ?? ""}
            onChange={(e) => set("maintenance_message", e.target.value)}
            rows={2}
          />
          <Button size="sm" onClick={() => save("maintenance_message")}>Save message</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activation flow</CardTitle>
          <CardDescription>Max attempts is the number of different cookies we try before giving up.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <NumField k="max_activation_attempts" label="Max attempts per activation" local={local} set={set} onSave={save} min={1} max={10} />
          <NumField k="rate_limit_per_10min" label="Rate limit (per IP / 10 min)" local={local} set={set} onSave={save} min={1} max={200} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-check & auto-cleanup</CardTitle>
          <CardDescription>Runs every 24 h via cron. Uses the current proxy-mode value at the time it runs.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <ToggleField k="auto_check_enabled" label="Auto-check cookies every 24 h" local={local} set={set} onSave={save} />
          <ToggleField k="auto_cleanup_enabled" label="Auto-cleanup dead / stale rows" local={local} set={set} onSave={save} />
          <NumField k="auto_check_interval_hours" label="Auto-check interval (hours)" local={local} set={set} onSave={save} min={1} max={168} />
          <NumField k="auto_cleanup_days" label="Delete rows older than (days)" local={local} set={set} onSave={save} min={1} max={365} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4" /> Pool alerts</CardTitle>
          <CardDescription>POSTs a JSON alert to your webhook when usable cookies drop below the threshold.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <NumField k="pool_alert_threshold" label="Alert threshold (usable cookies)" local={local} set={set} onSave={save} min={0} max={10000} />
          <TextField k="pool_alert_webhook" label="Webhook URL" placeholder="https://…" local={local} set={set} onSave={save} />
        </CardContent>
      </Card>
    </div>
  );
}

function NumField({ k, label, local, set, onSave, min, max }: any) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2 mt-1">
        <Input type="number" min={min} max={max} value={local[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
        <Button size="sm" onClick={() => onSave(k)}>Save</Button>
      </div>
    </div>
  );
}
function TextField({ k, label, placeholder, local, set, onSave }: any) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2 mt-1">
        <Input placeholder={placeholder} value={local[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
        <Button size="sm" onClick={() => onSave(k)}>Save</Button>
      </div>
    </div>
  );
}
function ToggleField({ k, label, local, set, onSave }: any) {
  const on = local[k] === "1";
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{on ? "Enabled" : "Disabled"}</div>
      </div>
      <Switch
        checked={on}
        onCheckedChange={(v) => {
          set(k, v ? "1" : "0");
          setTimeout(() => onSave(k), 0);
        }}
      />
    </div>
  );
}
