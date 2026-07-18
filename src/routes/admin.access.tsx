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
  
  listUserActivationOverrides, setUserActivationOverride, removeUserActivationOverride,
  getGateLastUpdated, listAccessAudit, previewActivationPolicy,
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

  // ─── Gate toggles ─ optimistic with rollback ─────────────────────────
  // Snapshot the current config, patch instantly, then reconcile with the
  // authoritative server response in `onSettled`. If another admin flipped
  // the same switch first, the 2s poll + onSettled invalidate resyncs.
  const gateMut = useMutation({
    mutationFn: (patch: any) => saveSettings({ data: patch }),
    onMutate: async (patch: any) => {
      await qc.cancelQueries({ queryKey: ["gate-config"] });
      const previous = qc.getQueryData<any>(["gate-config"]);
      if (previous) qc.setQueryData(["gate-config"], { ...previous, ...patch });
      return { previous, patch };
    },
    onSuccess: (_r, patch) => {
      const [k, v] = Object.entries(patch)[0]!;
      const isBool = typeof v === "boolean";
      toast.success("Gate updated", { description: `${prettyKey(k)} · ${isBool ? (v ? "ON" : "OFF") : String(v)}` });
    },
    onError: (e: any, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(["gate-config"], ctx.previous);
      toast.error("Update failed · rolled back", { description: e?.message ?? "Unknown" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["gate-config"] }),
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
    mutationFn: (ids: string[]) => removeKeys({ data: { ids } }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ["access-keys"] });
      const prevLists = qc.getQueriesData<any>({ queryKey: ["access-keys"] });
      const idSet = new Set(ids);
      for (const [key, val] of prevLists) {
        if (val?.rows) qc.setQueryData(key, { ...val, rows: val.rows.filter((r: any) => !idSet.has(r.id)) });
      }
      return { prevLists };
    },
    onSuccess: (r: any) => {
      toast.success(`${r.deleted} key(s) deleted`);
      setSelected(new Set());
    },
    onError: (e: any, _ids, ctx) => {
      if (ctx?.prevLists) for (const [key, val] of ctx.prevLists) qc.setQueryData(key, val);
      toast.error("Bulk delete failed · rolled back", { description: e?.message ?? "" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["access-keys"] });
      qc.invalidateQueries({ queryKey: ["access-stats"] });
    },
  });

  // Per-row: enable/disable and delete — both optimistic.
  const toggleKeyMut = useMutation({
    mutationFn: (v: { id: string; disabled: boolean }) => toggleKey({ data: v }),
    onMutate: async ({ id, disabled }) => {
      await qc.cancelQueries({ queryKey: ["access-keys"] });
      const prev = qc.getQueriesData<any>({ queryKey: ["access-keys"] });
      for (const [key, val] of prev) {
        if (val?.rows) qc.setQueryData(key, { ...val, rows: val.rows.map((r: any) => r.id === id ? { ...r, disabled } : r) });
      }
      return { prev };
    },
    onSuccess: (_r, v) => toast.success(v.disabled ? "Key disabled" : "Key enabled"),
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) for (const [key, val] of ctx.prev) qc.setQueryData(key, val);
      toast.error("Toggle failed · rolled back", { description: e?.message ?? "" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["access-keys"] }),
  });

  const deleteKeyMut = useMutation({
    mutationFn: (id: string) => removeKeys({ data: { ids: [id] } }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["access-keys"] });
      const prev = qc.getQueriesData<any>({ queryKey: ["access-keys"] });
      for (const [key, val] of prev) {
        if (val?.rows) qc.setQueryData(key, { ...val, rows: val.rows.filter((r: any) => r.id !== id) });
      }
      return { prev };
    },
    onSuccess: () => toast.success("Key deleted"),
    onError: (e: any, _id, ctx) => {
      if (ctx?.prev) for (const [key, val] of ctx.prev) qc.setQueryData(key, val);
      toast.error("Delete failed · rolled back", { description: e?.message ?? "" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["access-keys"] });
      qc.invalidateQueries({ queryKey: ["access-stats"] });
    },
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
              <Label className="label-caps mb-2 block">Global daily activation limit</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={0} max={10000}
                  defaultValue={c.userDailyActivationLimit ?? 10}
                  key={`gdl-${c.userDailyActivationLimit ?? 10}`}
                  onBlur={(e) => {
                    const n = Math.max(0, Math.min(10000, parseInt(e.target.value, 10) || 0));
                    if (n === c.userDailyActivationLimit) return;
                    saveSettings({ data: { userDailyActivationLimit: n } }).then(() => {
                      toast.success(n === 0 ? "Global limit set to ∞ (unlimited)" : `Global limit set to ${n}/24h`);
                      qc.invalidateQueries({ queryKey: ["gate-config"] });
                    });
                  }}
                />
                <Badge variant="outline" className={c.userDailyActivationLimit === 0
                  ? "border-emerald-500/40 text-emerald-300"
                  : "border-white/10 text-white/60"}>
                  {c.userDailyActivationLimit === 0 ? "∞ Unlimited" : `${c.userDailyActivationLimit}/24h`}
                </Badge>
              </div>
              <p className="mt-1.5 text-[11px] text-white/50 leading-relaxed">
                Applies to every signed-in user by default. Set to <b className="text-white/80">0</b> to allow unlimited activations for all accounts. Individual overrides below take precedence.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/60 leading-relaxed">
              <div className="font-mono uppercase tracking-widest text-white/80 mb-1">How the gates stack</div>
              <ul className="space-y-1 list-disc list-inside">
                <li><b className="text-white/80">Login gate</b> — quota is per user, not per IP.</li>
                <li><b className="text-white/80">Captcha gate</b> — a passed challenge waives the IP rate limit (unlimited for that solved session).</li>
                <li><b className="text-white/80">Access key</b> — atomic single-use / unlimited / 24h session. No bypass path.</li>
              </ul>
            </div>
          </div>

          <UserOverridesPanel />
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
                    <AlertDialogAction onClick={() => bulkDelete.mutate(Array.from(selected))}>Delete</AlertDialogAction>
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
                          onClick={() => toggleKeyMut.mutate({ id: r.id, disabled: !r.disabled })}
                        >
                          <Ban className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          className="h-7 px-2 text-red-300 border-red-500/30 hover:bg-red-500/10"
                          title="Delete key"
                          onClick={() => deleteKeyMut.mutate(r.id)}
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

      {/* NEW — Policy preview + Audit timeline + Last-updated strip */}
      <AccessOpsPanels />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Ops panels: real-time policy preview + gate audit timeline + last-updated
// ───────────────────────────────────────────────────────────────────────
function AccessOpsPanels() {
  const runPreview = useServerFn(previewActivationPolicy);
  const fetchAudit = useServerFn(listAccessAudit);
  const fetchLastUpdated = useServerFn(getGateLastUpdated);

  const lastUpdated = useQuery({
    queryKey: ["gate-last-updated"],
    queryFn: () => fetchLastUpdated(),
    refetchInterval: REFRESH_MS,
  });
  const audit = useQuery({
    queryKey: ["access-audit"],
    queryFn: () => fetchAudit({ data: { limit: 60 } }),
    refetchInterval: REFRESH_MS,
  });

  const [pvEmail, setPvEmail] = useState("");
  const [pvHasKey, setPvHasKey] = useState(false);
  const [pvHasCaptcha, setPvHasCaptcha] = useState(false);
  const preview = useMutation({
    mutationFn: () => runPreview({ data: {
      email: pvEmail.trim() || null,
      hasAccessKey: pvHasKey,
      hasCaptchaPass: pvHasCaptcha,
    } }),
  });

  const l = lastUpdated.data?.latest;
  const rel = l ? relTime(l.updated_at) : null;

  return (
    <div className="space-y-6">
      {/* Last-updated strip */}
      <div className="glass border border-white/10 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="font-mono uppercase tracking-widest text-white/40">Config state</div>
        {l ? (
          <>
            <span className="text-white/70">
              Last change <span className="text-white">{rel}</span> — {prettyKey(l.key)}
            </span>
            <span className="text-white/50">
              by <span className="text-white/80">{l.email ?? "system"}</span>
            </span>
          </>
        ) : (
          <span className="text-white/50">No configuration changes recorded yet.</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Policy preview */}
        <div className="glass border border-white/10 p-5">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-[#ff8a90]" />
            <h2 className="font-display text-xl">Activation policy preview</h2>
          </div>
          <p className="text-white/55 text-xs mb-4">
            Dry-run every gate for a hypothetical visitor. Server evaluates the same rules used at activation time.
          </p>
          <div className="grid gap-3 md:grid-cols-2 mb-3">
            <div>
              <Label className="text-[11px] uppercase tracking-widest text-white/50">User email (optional)</Label>
              <Input value={pvEmail} onChange={(e) => setPvEmail(e.target.value)}
                placeholder="visitor@example.com" className="mt-1 bg-black/40 border-white/10" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <Switch checked={pvHasKey} onCheckedChange={setPvHasKey} /> Has access key
              </label>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <Switch checked={pvHasCaptcha} onCheckedChange={setPvHasCaptcha} /> Captcha solved
              </label>
            </div>
          </div>
          <Button onClick={() => preview.mutate()} disabled={preview.isPending}
            className="bg-[#ff2a3a] hover:bg-[#ff2a3a]/90">
            {preview.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Evaluate
          </Button>

          {preview.data && (
            <div className="mt-4 space-y-3">
              <div className={`rounded-lg border px-3 py-2 text-sm flex items-center gap-2 ${
                preview.data.allow
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-red-500/40 bg-red-500/10 text-red-200"
              }`}>
                {preview.data.allow ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                <span className="font-medium">
                  {preview.data.allow ? "ACTIVATION ALLOWED" : "ACTIVATION BLOCKED"}
                </span>
                {preview.data.user && (
                  <span className="ml-auto text-xs opacity-75">as {preview.data.user.email}</span>
                )}
              </div>
              <ul className="divide-y divide-white/5 border border-white/10 rounded-lg overflow-hidden">
                {preview.data.gates.map((g: any) => (
                  <li key={g.key} className="flex items-center gap-3 px-3 py-2 text-sm bg-black/20">
                    <span className={
                      g.verdict === "pass" ? "text-emerald-300" :
                      g.verdict === "block" ? "text-red-300" : "text-white/40"
                    }>
                      {g.verdict === "pass" ? "PASS" : g.verdict === "block" ? "BLOCK" : "N/A "}
                    </span>
                    <span className="text-white/85 min-w-[9rem]">{g.label}</span>
                    <span className="text-white/55 text-xs">{g.reason}</span>
                  </li>
                ))}
              </ul>
              <div className="text-[11px] font-mono uppercase tracking-widest text-white/40">
                Cap: {preview.data.cap.unlimited
                  ? "unlimited"
                  : `${preview.data.cap.used24h} / ${preview.data.cap.effective} last 24h`}
                {preview.data.cap.override !== null && " (per-user override)"}
              </div>
            </div>
          )}
        </div>

        {/* Audit timeline */}
        <div className="glass border border-white/10 p-5">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-[#ff8a90]" />
            <h2 className="font-display text-xl">Audit timeline</h2>
          </div>
          <p className="text-white/55 text-xs mb-4">
            Every change to gates, captcha config, per-user overrides, and access keys. Newest first.
          </p>
          <div className="max-h-[420px] overflow-auto pr-1 space-y-2">
            {(audit.data?.rows ?? []).map((r: any) => (
              <div key={r.id} className="rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[#ff8a90]">
                    {r.action}
                  </span>
                  <span className="ml-auto text-white/40">{relTime(r.created_at)}</span>
                </div>
                <div className="mt-1 text-white/70">
                  <span className="text-white/50">by</span>{" "}
                  <span className="text-white/90">{r.actor ?? "system"}</span>
                  {r.target && <> — <span className="text-white/60">{r.target}</span></>}
                </div>
                {r.details && Object.keys(r.details).length > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-white/40 truncate">
                    {JSON.stringify(r.details)}
                  </div>
                )}
              </div>
            ))}
            {audit.data && audit.data.rows.length === 0 && (
              <div className="text-white/40 text-sm py-6 text-center">No audit entries yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
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

// ───────────────────────────────────────────────────────────────────────
// Per-user activation-limit overrides
// ───────────────────────────────────────────────────────────────────────
function UserOverridesPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUserActivationOverrides);
  const setFn = useServerFn(setUserActivationOverride);
  const removeFn = useServerFn(removeUserActivationOverride);

  const q = useQuery({
    queryKey: ["user-overrides"],
    queryFn: () => listFn(),
    refetchInterval: 2000,
  });

  const [email, setEmail] = useState("");
  const [limit, setLimit] = useState<string>("0");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const setMut = useMutation({
    mutationFn: () =>
      setFn({
        data: {
          email: email.trim(),
          dailyLimit: Math.max(0, Math.min(10000, parseInt(limit, 10) || 0)),
          note: note.trim() || null,
        },
      }),
    onSuccess: (r: any) => {
      const n = Math.max(0, parseInt(limit, 10) || 0);
      toast.success(
        n === 0 ? `${r.email} · ∞ unlimited` : `${r.email} · ${n}/24h`,
        { description: "Override applied instantly" },
      );
      setEmail(""); setLimit("0"); setNote("");
      qc.invalidateQueries({ queryKey: ["user-overrides"] });
    },
    onError: (e: any) => toast.error("Could not set override", { description: e?.message ?? "" }),
  });

  const removeMut = useMutation({
    mutationFn: (userId: string) => removeFn({ data: { userId } }),
    onMutate: async (userId) => {
      await qc.cancelQueries({ queryKey: ["user-overrides"] });
      const prev = qc.getQueryData<any>(["user-overrides"]);
      if (prev?.rows) qc.setQueryData(["user-overrides"], { ...prev, rows: prev.rows.filter((r: any) => r.user_id !== userId) });
      return { prev };
    },
    onSuccess: () => toast.success("Override removed", { description: "User falls back to the global limit" }),
    onError: (e: any, _u, ctx) => {
      if (ctx?.prev) qc.setQueryData(["user-overrides"], ctx.prev);
      toast.error("Remove failed · rolled back", { description: e?.message ?? "" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["user-overrides"] }),
  });


  const rows = (q.data?.rows ?? []) as Array<{
    user_id: string; daily_limit: number; note: string | null; updated_at: string; email: string | null;
  }>;
  const filtered = search.trim()
    ? rows.filter((r) => (r.email ?? "").toLowerCase().includes(search.trim().toLowerCase()))
    : rows;

  return (
    <div className="mt-6 rounded-lg border border-emerald-500/20 bg-black/30">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">Per-user activation limits</div>
          <p className="text-white/50 text-[11px] mt-0.5">
            Overrides the global cap for one account. <b className="text-white/80">0 = unlimited</b> — takes effect on the very next activation.
          </p>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">
          {filtered.length} / {rows.length} · live
        </div>
      </div>

      <div className="grid md:grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_auto] gap-2 p-3 border-b border-white/5">
        <Input placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          type="number" min={0} max={10000}
          placeholder="0 = ∞"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          title="Daily activation cap for this user (0 = unlimited)"
        />
        <Input placeholder="Note (optional) · e.g. VIP reseller" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          className="btn-red"
          disabled={setMut.isPending || !email.trim()}
          onClick={() => setMut.mutate()}
        >
          {setMut.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Applying…</>
            : <><Save className="w-4 h-4 mr-2" /> Apply</>}
        </Button>
      </div>

      <div className="px-3 py-2 border-b border-white/5">
        <div className="relative max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-white/40" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Filter by email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Limit</th>
              <th className="py-2 px-3">Note</th>
              <th className="py-2 px-3">Updated</th>
              <th className="py-2 px-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-white/40 text-xs">
                  {rows.length === 0
                    ? "No per-user overrides — every signed-in user is on the global limit."
                    : "No user matches that search."}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.user_id} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-2 px-3 font-mono text-xs text-white/80">
                  {r.email ?? <span className="text-white/40 italic">unknown · {r.user_id.slice(0, 8)}…</span>}
                </td>
                <td className="py-2 px-3">
                  {r.daily_limit === 0
                    ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-300"><Inf className="w-3 h-3 mr-1" /> Unlimited</Badge>
                    : <Badge variant="outline" className="border-sky-500/40 text-sky-300">{r.daily_limit}/24h</Badge>}
                </td>
                <td className="py-2 px-3 text-xs text-white/60">{r.note || <span className="text-white/30">—</span>}</td>
                <td className="py-2 px-3 text-[11px] text-white/40 whitespace-nowrap">
                  {new Date(r.updated_at).toLocaleString()}
                </td>
                <td className="py-2 px-3 text-right">
                  <Button
                    size="sm" variant="outline"
                    className="h-7 px-2 text-red-300 border-red-500/30 hover:bg-red-500/10"
                    title="Remove override (fall back to global limit)"
                    onClick={() => removeMut.mutate(r.user_id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

