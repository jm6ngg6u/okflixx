import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound, Plus, Copy, ShieldCheck, ShieldAlert, Ban, Trash2, Infinity as Inf,
  UserCheck, Clock3, Search, RefreshCw, CheckCircle2, XCircle, Play, Activity,
  Save, Loader2, AlertTriangle, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getGateConfig, setGateSettings,
  createAccessKeys, listAccessKeys, disableAccessKey, deleteAccessKeys,
  listRedemptions, getAccessStats,
  testCaptchaKeys,
} from "@/lib/access-keys.functions";

export const Route = createFileRoute("/admin/access")({
  head: () => ({ meta: [{ title: "Access gates — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: AccessAdminPage,
});

type KeyType = "unlimited" | "single_use" | "session_24h";
const REFRESH_MS = 2000;

function AccessAdminPage() {
  const qc = useQueryClient();
  const getConfig = useServerFn(getGateConfig);
  const saveSettings = useServerFn(setGateSettings);
  const createKeys = useServerFn(createAccessKeys);
  const fetchKeys = useServerFn(listAccessKeys);
  const toggleKey = useServerFn(disableAccessKey);
  const removeKeys = useServerFn(deleteAccessKeys);
  const fetchRedemptions = useServerFn(listRedemptions);
  const fetchStats = useServerFn(getAccessStats);
  const runTestKeys = useServerFn(testCaptchaKeys);

  // ─── Queries (2s live refresh) ───────────────────────────────────────
  const config = useQuery({ queryKey: ["gate-config"], queryFn: () => getConfig(), refetchInterval: REFRESH_MS });
  const stats = useQuery({ queryKey: ["access-stats"], queryFn: () => fetchStats(), refetchInterval: REFRESH_MS });

  const [filterType, setFilterType] = useState<"all" | KeyType>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "disabled" | "expired" | "exhausted">("all");
  const [search, setSearch] = useState("");

  const keys = useQuery({
    queryKey: ["access-keys", filterType, filterStatus],
    queryFn: () => fetchKeys({ data: { keyType: filterType, status: filterStatus, limit: 200 } }),
    refetchInterval: REFRESH_MS,
  });
  const redemptions = useQuery({
    queryKey: ["access-redemptions"],
    queryFn: () => fetchRedemptions(),
    refetchInterval: REFRESH_MS,
  });

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    const rows = keys.data?.rows ?? [];
    if (!q) return rows;
    return rows.filter(
      (r: any) => r.code_prefix?.includes(q) || (r.label ?? "").toUpperCase().includes(q),
    );
  }, [keys.data, search]);

  // ─── Gate toggles ────────────────────────────────────────────────────
  const gateMut = useMutation({
    mutationFn: (patch: any) => saveSettings({ data: patch }),
    onSuccess: (_r, patch) => {
      const [k, v] = Object.entries(patch)[0]!;
      toast.success("Gate updated", { description: `${prettyKey(k)} · ${v ? "ON" : "OFF"}` });
      qc.invalidateQueries({ queryKey: ["gate-config"] });
    },
    onError: (e: any) => toast.error("Update failed", { description: e?.message ?? "Unknown" }),
  });

  // ─── Captcha config (site key + provider) ────────────────────────────
  const [siteKeyDraft, setSiteKeyDraft] = useState<string | null>(null);
  const savedSiteKey = config.data?.captchaSiteKey ?? "";
  const siteKeyDirty = siteKeyDraft !== null && siteKeyDraft !== savedSiteKey;

  // ─── Captcha test panel ──────────────────────────────────────────────
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testCaptchaKeys>> | null>(null);
  const testMut = useMutation({
    mutationFn: () => runTestKeys(),
    onSuccess: (r) => {
      setTestResult(r);
      if (r.ok) toast.success("Captcha handshake healthy");
      else toast.error("Captcha test failed", { description: r.summary });
    },
    onError: (e: any) => toast.error("Test failed", { description: e?.message ?? "" }),
  });

  // ─── Key generator ───────────────────────────────────────────────────
  const [genType, setGenType] = useState<KeyType>("unlimited");
  const [genQty, setGenQty] = useState(1);
  const [genLabel, setGenLabel] = useState("");
  const [genExpiry, setGenExpiry] = useState<string>("");
  const [genMaxUses, setGenMaxUses] = useState<string>("");
  const [lastGenerated, setLastGenerated] = useState<{ code: string; id: string }[] | null>(null);
  const [reveal, setReveal] = useState(true);

  const genMut = useMutation({
    mutationFn: () =>
      createKeys({
        data: {
          keyType: genType,
          quantity: genQty,
          label: genLabel || undefined,
          expiresAt: genExpiry ? new Date(genExpiry).toISOString() : null,
          maxUses: genType === "unlimited" && genMaxUses ? Number(genMaxUses) : null,
        },
      }),
    onSuccess: (r: any) => {
      setLastGenerated(r.keys);
      setReveal(true);
      toast.success(`${r.keys.length} ${keyTypeLabel(genType).toLowerCase()} key(s) generated`, {
        description: "Copy them now — codes are shown once.",
      });
      qc.invalidateQueries({ queryKey: ["access-keys"] });
      qc.invalidateQueries({ queryKey: ["access-stats"] });
    },
    onError: (e: any) => toast.error("Generation failed", { description: e?.message ?? "" }),
  });

  function copyAll() {
    if (!lastGenerated) return;
    navigator.clipboard.writeText(lastGenerated.map((k) => k.code).join("\n")).then(
      () => toast.success(`${lastGenerated.length} key(s) copied`),
      () => toast.error("Clipboard blocked"),
    );
  }

  // ─── Selection / bulk ────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });
  }
  const bulkDelete = useMutation({
    mutationFn: () => removeKeys({ data: { ids: Array.from(selected) } }),
    onSuccess: (r: any) => {
      toast.success(`${r.deleted} key(s) deleted`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["access-keys"] });
      qc.invalidateQueries({ queryKey: ["access-stats"] });
    },
    onError: (e: any) => toast.error("Bulk delete failed", { description: e?.message ?? "" }),
  });

  const c = config.data;
  const anyGateOn = !!(c?.accessKeyRequired || c?.captchaRequired || c?.loginRequired);
  const providerMismatch = detectProviderMismatch(c?.captchaSiteKey, c?.captchaProvider);

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-[#ff2a3a]">// SECURITY · ACCESS GATES</div>
          <h1 className="font-display text-3xl md:text-4xl mt-1">Access gates &amp; keys</h1>
          <p className="text-white/60 text-sm mt-2 max-w-2xl">
            Three independent gates protect activation. All checks run server-side; toggles apply instantly. Live refresh every 2s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={anyGateOn
            ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/5"
            : "border-amber-500/40 text-amber-300 bg-amber-500/5"}>
            {anyGateOn ? "● PROTECTED" : "○ UNPROTECTED"}
          </Badge>
          <Button variant="outline" onClick={() => { config.refetch(); keys.refetch(); stats.refetch(); redemptions.refetch(); }} className="border-white/10">
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      {!anyGateOn && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-amber-100 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
          <div>
            <div className="font-medium">No gates enabled</div>
            <div className="text-amber-100/70 text-xs mt-0.5">
              Activation is open to the public. Enable at least one gate below to require verification.
            </div>
          </div>
        </div>
      )}

      {/* GATE MASTER SWITCHES */}
      <div className="grid md:grid-cols-3 gap-4">
        <GateCard
          icon={<KeyRound className="w-5 h-5" />}
          title="Access key gate"
          desc="Require a valid key before every activation. Unlimited, single-use, or 24-hour session keys."
          enabled={!!c?.accessKeyRequired}
          onToggle={(v) => gateMut.mutate({ accessKeyRequired: v })}
          loading={gateMut.isPending}
        />
        <GateCard
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Captcha gate"
          desc="Cloudflare Turnstile or hCaptcha check on every submit. Blocks bots and headless clients."
          enabled={!!c?.captchaRequired}
          onToggle={(v) => gateMut.mutate({ captchaRequired: v })}
          loading={gateMut.isPending}
        />
        <GateCard
          icon={<UserCheck className="w-5 h-5" />}
          title="Login gate"
          desc="Require Google sign-in before activation. Enforces per-user daily limit and full audit trail."
          enabled={!!c?.loginRequired}
          onToggle={(v) => gateMut.mutate({ loginRequired: v })}
          loading={gateMut.isPending}
        />
      </div>

      {/* LOGIN GATE CONFIG */}
      {c?.loginRequired && (
        <Section title="Login gate configuration" tone="emerald" icon={<UserCheck className="w-4 h-4" />}>
          <div className="grid md:grid-cols-2 gap-4 items-end">
            <div>
              <Label className="label-caps mb-2 block">Per-user daily activation limit</Label>
              <Input
                type="number" min={1} max={1000}
                defaultValue={c.userDailyActivationLimit ?? 10}
                onBlur={(e) => {
                  const n = Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 10));
                  if (n === c.userDailyActivationLimit) return;
                  saveSettings({ data: { userDailyActivationLimit: n } }).then(() => {
                    toast.success(`Per-user limit set to ${n}/24h`);
                    qc.invalidateQueries({ queryKey: ["gate-config"] });
                  });
                }}
              />
              <p className="mt-1.5 text-[11px] text-white/50">
                Signed-in users cannot exceed this many activations per rolling 24 hours.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/60 leading-relaxed">
              <div className="font-mono uppercase tracking-widest text-white/80 mb-1">How it works</div>
              Every activation is tied to a Google-verified user. Attempts are logged with IP, user agent, and result — filter by user in <code className="text-white/80">/admin/audit</code>.
            </div>
          </div>
        </Section>
      )}

      {/* CAPTCHA CONFIG */}
      {c?.captchaRequired && (
        <Section title="Captcha configuration" tone="amber" icon={<ShieldAlert className="w-4 h-4" />}>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label className="label-caps mb-2 block">Provider</Label>
              <Select
                value={c.captchaProvider}
                onValueChange={(v) =>
                  saveSettings({ data: { captchaProvider: v as any } }).then(() => {
                    toast.success(`Provider set to ${v}`);
                    qc.invalidateQueries({ queryKey: ["gate-config"] });
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="turnstile">Cloudflare Turnstile</SelectItem>
                  <SelectItem value="hcaptcha">hCaptcha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="label-caps mb-2 block">Site key (public)</Label>
              <div className="flex gap-2">
                <Input
                  value={siteKeyDraft ?? savedSiteKey}
                  placeholder="0x4AAAA… or hCaptcha UUID"
                  onChange={(e) => setSiteKeyDraft(e.target.value)}
                />
                <Button
                  variant={siteKeyDirty ? "default" : "outline"}
                  disabled={!siteKeyDirty}
                  onClick={() => {
                    const v = (siteKeyDraft ?? "").trim();
                    saveSettings({ data: { captchaSiteKey: v } }).then(() => {
                      toast.success("Site key saved");
                      setSiteKeyDraft(null);
                      qc.invalidateQueries({ queryKey: ["gate-config"] });
                    });
                  }}
                >
                  <Save className="w-4 h-4 mr-1.5" /> Save
                </Button>
              </div>
              <p className="text-[11px] text-white/40 mt-2 leading-relaxed">
                Secret is stored in <code className="text-white/70">HCAPTCHA_SECRET</code> / <code className="text-white/70">TURNSTILE_SECRET</code> and is never exposed to the browser.
              </p>
            </div>
          </div>
          {providerMismatch && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[12px] text-red-100 flex items-start gap-2">
              <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-300" />
              <div>
                <div className="font-medium">Provider / site-key mismatch</div>
                <div className="text-red-200/80 mt-1">
                  This site key looks like a <b>{providerMismatch}</b> key but the selected provider is <b>{c.captchaProvider}</b>. Activations will fail until they match.
                </div>
              </div>
            </div>
          )}

          {/* Live test */}
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 flex flex-wrap items-center gap-3">
            <Activity className="w-4 h-4 text-[#ff8a90]" />
            <div className="text-[11px] font-mono uppercase tracking-widest text-white/60">Live handshake test</div>
            <Button size="sm" variant="secondary" disabled={testMut.isPending} onClick={() => testMut.mutate()}>
              {testMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>
                : <><Play className="w-3.5 h-3.5 mr-1.5" /> Test now</>}
            </Button>
            {testResult && (
              <div className={`text-[11px] flex items-center gap-1.5 ${testResult.ok ? "text-emerald-300" : "text-red-300"}`}>
                {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                <span>{testResult.summary}</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* STATS STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="TOTAL KEYS" value={stats.data?.total ?? 0} />
        <Stat label="UNLIMITED" value={stats.data?.types.unlimited ?? 0} accent="emerald" />
        <Stat label="SINGLE-USE" value={stats.data?.types.single_use ?? 0} accent="sky" />
        <Stat label="24H SESSION" value={stats.data?.types.session_24h ?? 0} accent="violet" />
        <Stat label="REDEEMS · 24H" value={stats.data?.redemptions24h ?? 0} accent="red" />
      </div>

      {/* KEY GENERATOR */}
      <div className="glass p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="font-display text-xl">Generate keys</h2>
            <p className="text-white/50 text-xs mt-1">Codes are hashed on save and shown once. Copy immediately.</p>
          </div>
          <Button className="btn-red" onClick={() => genMut.mutate()} disabled={genMut.isPending}>
            {genMut.isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
              : <><Plus className="w-4 h-4 mr-2" /> Generate</>}
          </Button>
        </div>
        <div className="grid md:grid-cols-5 gap-3">
          <div>
            <Label className="label-caps mb-2 block">Type</Label>
            <Select value={genType} onValueChange={(v: any) => setGenType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">♾ Unlimited</SelectItem>
                <SelectItem value="single_use">🔒 Single-use</SelectItem>
                <SelectItem value="session_24h">⏱ 24-hour session</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps mb-2 block">Quantity</Label>
            <Input type="number" min={1} max={200} value={genQty}
              onChange={(e) => setGenQty(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </div>
          <div>
            <Label className="label-caps mb-2 block">Label (optional)</Label>
            <Input placeholder="Reseller batch #14" value={genLabel} onChange={(e) => setGenLabel(e.target.value)} />
          </div>
          <div>
            <Label className="label-caps mb-2 block">Expiry (optional)</Label>
            <Input type="datetime-local" value={genExpiry} onChange={(e) => setGenExpiry(e.target.value)} />
          </div>
          <div>
            <Label className="label-caps mb-2 block">
              Max uses {genType !== "unlimited" && <span className="text-white/30">(auto)</span>}
            </Label>
            <Input
              type="number"
              disabled={genType !== "unlimited"}
              placeholder={genType === "unlimited" ? "∞ blank = infinite" : genType === "single_use" ? "1" : "∞"}
              value={genMaxUses}
              onChange={(e) => setGenMaxUses(e.target.value)}
            />
          </div>
        </div>

        {lastGenerated && lastGenerated.length > 0 && (
          <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2 text-emerald-300 font-mono text-[10px] uppercase tracking-widest">
                <CheckCircle2 className="w-4 h-4" /> {lastGenerated.length} key(s) generated · shown once
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setReveal((r) => !r)}>
                  {reveal ? <><EyeOff className="w-3 h-3 mr-1" /> Hide</> : <><Eye className="w-3 h-3 mr-1" /> Show</>}
                </Button>
                <Button size="sm" variant="outline" onClick={copyAll}><Copy className="w-3 h-3 mr-1" /> Copy all</Button>
                <Button size="sm" variant="ghost" onClick={() => setLastGenerated(null)}>Dismiss</Button>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 font-mono text-sm max-h-72 overflow-y-auto">
              {lastGenerated.map((k) => (
                <button
                  key={k.id}
                  onClick={() => navigator.clipboard.writeText(k.code).then(() => toast.success("Copied"))}
                  className="text-left px-3 py-2 rounded bg-black/40 border border-white/10 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition"
                >
                  {reveal ? k.code : k.code.replace(/[A-Z0-9]/g, "•")}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* KEY TABLE */}
      <div className="glass p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-xl">Key ledger</h2>
            <p className="text-white/40 text-xs mt-0.5">
              {filteredRows.length} of {keys.data?.rows?.length ?? 0} · live · updates every 2s
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-white/40" />
              <Input placeholder="Search prefix / label" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 w-56" />
            </div>
            <Select value={filterType} onValueChange={(v: any) => setFilterType(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="unlimited">Unlimited</SelectItem>
                <SelectItem value="single_use">Single-use</SelectItem>
                <SelectItem value="session_24h">24h session</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="exhausted">Exhausted</SelectItem>
              </SelectContent>
            </Select>
            {selected.size > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm"><Trash2 className="w-4 h-4 mr-1" /> Delete {selected.size}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selected.size} key(s)?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Redemption logs are preserved but detached. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => bulkDelete.mutate()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
                <th className="py-2 px-2 w-8">
                  <input
                    type="checkbox"
                    checked={filteredRows.length > 0 && selected.size === filteredRows.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(filteredRows.map((r: any) => r.id)) : new Set())}
                  />
                </th>
                <th className="py-2 px-2">Prefix</th>
                <th className="py-2 px-2">Type</th>
                <th className="py-2 px-2">Label</th>
                <th className="py-2 px-2">Uses</th>
                <th className="py-2 px-2">Expires</th>
                <th className="py-2 px-2">Status</th>
                <th className="py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.isLoading && (
                <tr><td colSpan={8} className="py-8 text-center text-white/40">
                  <Loader2 className="w-4 h-4 inline animate-spin mr-2" /> Loading…
                </td></tr>
              )}
              {!keys.isLoading && filteredRows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-white/40">
                  {search || filterType !== "all" || filterStatus !== "all"
                    ? "No keys match the current filter."
                    : "No keys yet — generate the first batch above."}
                </td></tr>
              )}
              {filteredRows.map((r: any) => {
                const expired = r.expires_at && new Date(r.expires_at).getTime() < Date.now();
                const exhausted = r.max_uses != null && r.uses_count >= r.max_uses;
                return (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} />
                    </td>
                    <td className="px-2 py-2 font-mono text-white/90">{r.code_prefix}•••</td>
                    <td className="px-2 py-2"><TypeBadge type={r.key_type} /></td>
                    <td className="px-2 py-2 text-white/70">{r.label ?? <span className="text-white/30">—</span>}</td>
                    <td className="px-2 py-2 font-mono">
                      {r.uses_count}{r.max_uses != null ? ` / ${r.max_uses}` : ""}
                    </td>
                    <td className="px-2 py-2 text-xs text-white/60">
                      {r.expires_at ? new Date(r.expires_at).toLocaleString() : <span className="text-white/30">Never</span>}
                    </td>
                    <td className="px-2 py-2">
                      {r.disabled ? <Badge variant="outline" className="border-red-500/40 text-red-300">Disabled</Badge>
                        : expired ? <Badge variant="outline" className="border-amber-500/40 text-amber-300">Expired</Badge>
                        : exhausted ? <Badge variant="outline" className="border-sky-500/40 text-sky-300">Exhausted</Badge>
                        : <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">Active</Badge>}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button
                          size="sm" variant="outline" className="h-7 px-2"
                          title={r.disabled ? "Enable key" : "Disable key"}
                          onClick={() => {
                            toggleKey({ data: { id: r.id, disabled: !r.disabled } }).then(() => {
                              toast.success(r.disabled ? "Key enabled" : "Key disabled");
                              qc.invalidateQueries({ queryKey: ["access-keys"] });
                            }).catch((e: any) => toast.error("Toggle failed", { description: e?.message }));
                          }}
                        >
                          <Ban className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          className="h-7 px-2 text-red-300 border-red-500/30 hover:bg-red-500/10"
                          title="Delete key"
                          onClick={() => {
                            removeKeys({ data: { ids: [r.id] } }).then(() => {
                              toast.success("Key deleted");
                              qc.invalidateQueries({ queryKey: ["access-keys"] });
                              qc.invalidateQueries({ queryKey: ["access-stats"] });
                            }).catch((e: any) => toast.error("Delete failed", { description: e?.message }));
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* REDEMPTION LOG */}
      <div className="glass p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-xl">Redemption log</h2>
            <p className="text-white/40 text-xs mt-0.5">Latest 200 · live · refreshes every 2s</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
                <th className="py-2 px-2">Time</th>
                <th className="py-2 px-2">Result</th>
                <th className="py-2 px-2">Key</th>
                <th className="py-2 px-2">Reason</th>
                <th className="py-2 px-2">IP hash</th>
                <th className="py-2 px-2">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {(redemptions.data?.rows ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-white/40">No redemptions yet.</td></tr>
              )}
              {(redemptions.data?.rows ?? []).map((r: any) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-2 py-2 text-xs text-white/60">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    {r.success
                      ? <span className="inline-flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="w-3 h-3" /> ok</span>
                      : <span className="inline-flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3 h-3" /> fail</span>}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.code_prefix ?? "—"}•••</td>
                  <td className="px-2 py-2 text-xs text-white/60">{r.reason ?? "—"}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-white/40">{(r.ip_hash ?? "").slice(0, 12)}…</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-white/40">{(r.fingerprint_hash ?? "").slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Helpers & sub-components
// ───────────────────────────────────────────────────────────────────────
function prettyKey(k: string): string {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function detectProviderMismatch(siteKey?: string, provider?: string): "hcaptcha" | "turnstile" | null {
  const key = (siteKey ?? "").trim();
  if (!key || !provider) return null;
  const isHcaptcha = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const isTurnstile = /^[0-3]x[A-Za-z0-9_-]{10,}$/.test(key);
  const inferred = isHcaptcha ? "hcaptcha" : isTurnstile ? "turnstile" : null;
  if (!inferred || inferred === provider) return null;
  return inferred;
}

function keyTypeLabel(t: KeyType): string {
  return t === "unlimited" ? "Unlimited" : t === "single_use" ? "Single-use" : "24h session";
}

function TypeBadge({ type }: { type: KeyType }) {
  if (type === "unlimited")
    return <Badge variant="outline" className="border-emerald-500/40 text-emerald-300"><Inf className="w-3 h-3 mr-1" /> Unlimited</Badge>;
  if (type === "single_use")
    return <Badge variant="outline" className="border-sky-500/40 text-sky-300">🔒 Single-use</Badge>;
  return <Badge variant="outline" className="border-violet-500/40 text-violet-300"><Clock3 className="w-3 h-3 mr-1" /> 24h</Badge>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "emerald" | "sky" | "violet" | "red" }) {
  const color =
    accent === "emerald" ? "text-emerald-300 border-emerald-500/30" :
    accent === "sky" ? "text-sky-300 border-sky-500/30" :
    accent === "violet" ? "text-violet-300 border-violet-500/30" :
    accent === "red" ? "text-red-300 border-red-500/30" :
    "text-white border-white/10";
  return (
    <div className={`rounded-xl border bg-black/30 backdrop-blur px-4 py-3 ${color}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">{label}</div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}

function GateCard({
  icon, title, desc, enabled, onToggle, loading,
}: {
  icon: React.ReactNode; title: string; desc: string;
  enabled: boolean; onToggle: (v: boolean) => void; loading?: boolean;
}) {
  return (
    <div className={`glass p-5 border transition ${enabled ? "border-[#ff2a3a]/40 shadow-[0_0_0_1px_rgba(255,42,58,0.2)]" : "border-white/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${enabled ? "bg-[#ff2a3a]/20 text-[#ff8a90]" : "bg-white/5 text-white/50"}`}>
          {icon}
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} disabled={loading} />
      </div>
      <div className="mt-4">
        <div className="font-display text-lg">{title}</div>
        <p className="text-white/55 text-xs mt-1 leading-relaxed">{desc}</p>
        <div className="mt-3">
          {enabled
            ? <Badge className="bg-[#ff2a3a]/20 text-[#ff8a90] border-none">● ON</Badge>
            : <Badge variant="outline" className="border-white/10 text-white/50">○ OFF</Badge>}
        </div>
      </div>
    </div>
  );
}

function Section({
  title, tone, icon, children,
}: {
  title: string;
  tone: "emerald" | "amber" | "sky";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const border = tone === "emerald" ? "border-emerald-500/20" : tone === "amber" ? "border-amber-500/20" : "border-sky-500/20";
  const text = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-sky-300";
  return (
    <div className={`glass p-6 border ${border}`}>
      <div className={`flex items-center gap-2 ${text} font-mono text-[10px] uppercase tracking-widest mb-4`}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}
