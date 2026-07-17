import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound, Plus, Copy, ShieldCheck, ShieldAlert, Ban, Trash2, Infinity as Inf,
  UserCheck, Clock3, Search, RefreshCw, CheckCircle2, XCircle, Play, Activity,
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
  testCaptchaKeys, listCaptchaLogs,
} from "@/lib/access-keys.functions";

export const Route = createFileRoute("/admin/access")({
  head: () => ({ meta: [{ title: "Access keys — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: AccessAdminPage,
});

type KeyType = "unlimited" | "single_use" | "session_24h";

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
  const fetchCaptchaLogs = useServerFn(listCaptchaLogs);

  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testCaptchaKeys>> | null>(null);
  const [testing, setTesting] = useState(false);
  const captchaLogs = useQuery({
    queryKey: ["captcha-logs"],
    queryFn: () => fetchCaptchaLogs({ data: { limit: 30 } }),
    refetchInterval: 5000,
  });

  const config = useQuery({
    queryKey: ["gate-config"],
    queryFn: () => getConfig(),
    refetchInterval: 5000,
  });
  const stats = useQuery({
    queryKey: ["access-stats"],
    queryFn: () => fetchStats(),
    refetchInterval: 5000,
  });

  const [filterType, setFilterType] = useState<"all" | KeyType>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "disabled" | "expired" | "exhausted">("all");
  const [search, setSearch] = useState("");

  const keys = useQuery({
    queryKey: ["access-keys", filterType, filterStatus],
    queryFn: () => fetchKeys({ data: { keyType: filterType, status: filterStatus, limit: 200 } }),
    refetchInterval: 5000,
  });

  const redemptions = useQuery({
    queryKey: ["access-redemptions"],
    queryFn: () => fetchRedemptions(),
    refetchInterval: 5000,
  });

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return keys.data?.rows ?? [];
    return (keys.data?.rows ?? []).filter(
      (r: any) => r.code_prefix?.includes(q) || (r.label ?? "").toUpperCase().includes(q),
    );
  }, [keys.data, search]);

  // --- Gate toggles ---
  async function toggle(field: "accessKeyRequired" | "captchaRequired" | "loginRequired", value: boolean) {
    try {
      await saveSettings({ data: { [field]: value } });
      toast.success("Gate updated", { description: `${field.replace(/([A-Z])/g, " $1").toLowerCase()} · ${value ? "on" : "off"}` });
      qc.invalidateQueries({ queryKey: ["gate-config"] });
    } catch (e: any) {
      toast.error("Update failed", { description: e?.message ?? "" });
    }
  }

  // --- Create keys dialog state ---
  const [genOpen, setGenOpen] = useState(false);
  const [genType, setGenType] = useState<KeyType>("unlimited");
  const [genQty, setGenQty] = useState(1);
  const [genLabel, setGenLabel] = useState("");
  const [genExpiry, setGenExpiry] = useState<string>("");
  const [genMaxUses, setGenMaxUses] = useState<string>("");
  const [lastGenerated, setLastGenerated] = useState<{ code: string; id: string }[] | null>(null);

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
      toast.success("Keys generated", { description: `${r.keys.length} new ${keyTypeLabel(genType)} key(s)` });
      qc.invalidateQueries({ queryKey: ["access-keys"] });
      qc.invalidateQueries({ queryKey: ["access-stats"] });
    },
    onError: (e: any) => toast.error("Generation failed", { description: e?.message ?? "" }),
  });

  function copyAll() {
    if (!lastGenerated) return;
    const text = lastGenerated.map((k) => k.code).join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast.success("All keys copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  }

  // --- Selection ---
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const bulkDelete = useMutation({
    mutationFn: () => removeKeys({ data: { ids: Array.from(selected) } }),
    onSuccess: () => {
      toast.success("Keys deleted", { description: `${selected.size} removed` });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["access-keys"] });
      qc.invalidateQueries({ queryKey: ["access-stats"] });
    },
    onError: (e: any) => toast.error("Delete failed", { description: e?.message ?? "" }),
  });

  const c = config.data;

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-[#ff2a3a]">// Security</div>
          <h1 className="font-display text-3xl md:text-4xl mt-1">Access gates &amp; keys</h1>
          <p className="text-white/60 text-sm mt-2 max-w-2xl">
            Three independent gates protect the activation form. Turn any of them on to require it before a TV code is redeemed. All checks run server-side and cannot be bypassed.
          </p>
        </div>
        <Button variant="outline" onClick={() => { config.refetch(); keys.refetch(); stats.refetch(); }} className="border-white/10">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* GATE MASTER SWITCHES */}
      <div className="grid md:grid-cols-3 gap-4">
        <GateCard
          icon={<KeyRound className="w-5 h-5" />}
          title="Access key gate"
          desc="Require a valid key before every activation. Unlimited, single-use, or 24-hour keys."
          enabled={!!c?.accessKeyRequired}
          onToggle={(v) => toggle("accessKeyRequired", v)}
        />
        <GateCard
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Captcha gate"
          desc="Cloudflare Turnstile or hCaptcha check on every submit. Blocks bots and scripts."
          enabled={!!c?.captchaRequired}
          onToggle={(v) => toggle("captchaRequired", v)}
        />
        <GateCard
          icon={<UserCheck className="w-5 h-5" />}
          title="Login gate"
          desc="Require the user to be signed in before activation. Highest friction, highest trust."
          enabled={!!c?.loginRequired}
          onToggle={(v) => toggle("loginRequired", v)}
        />
      </div>

      {/* CAPTCHA CONFIG */}
      {c?.captchaRequired && (
        <div className="glass p-6 border border-amber-500/20">
          <div className="flex items-center gap-2 text-amber-400 font-mono text-[10px] uppercase tracking-widest mb-3">
            <ShieldAlert className="w-4 h-4" /> Captcha configuration
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <Label className="label-caps mb-2 block">Provider</Label>
              <Select
                value={c.captchaProvider}
                onValueChange={(v) => saveSettings({ data: { captchaProvider: v as any } }).then(() => qc.invalidateQueries({ queryKey: ["gate-config"] }))}
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
                  defaultValue={c.captchaSiteKey}
                  placeholder="0x4AAAA..."
                  onBlur={(e) => {
                    if (e.target.value !== c.captchaSiteKey) {
                      saveSettings({ data: { captchaSiteKey: e.target.value } }).then(() =>
                        qc.invalidateQueries({ queryKey: ["gate-config"] }),
                      );
                    }
                  }}
                />
              </div>
              <p className="text-[11px] text-white/40 mt-2">
                Add secret via project settings: <code className="text-white/70">TURNSTILE_SECRET</code> or <code className="text-white/70">HCAPTCHA_SECRET</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CAPTCHA HEALTH — live test + recent verify log */}
      {c?.captchaRequired && (
        <div className="glass p-6 border border-white/10 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/60">
              <Activity className="w-4 h-4 text-[#ff8a90]" /> Captcha health
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={testing}
              onClick={async () => {
                setTesting(true);
                setTestResult(null);
                try {
                  const r = await runTestKeys();
                  setTestResult(r);
                  if (r.ok) toast.success("Captcha keys look healthy.");
                  else toast.error(r.summary);
                } catch (e: any) {
                  toast.error(`Test failed: ${e?.message ?? "unknown"}`);
                } finally { setTesting(false); }
              }}
            >
              {testing
                ? (<><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>)
                : (<><Play className="w-3.5 h-3.5 mr-1.5" /> Test captcha keys</>)}
            </Button>
          </div>

          {testResult && (
            <div className={`rounded-lg border px-4 py-3 text-[12px] ${
              testResult.ok
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : "border-red-500/40 bg-red-500/10 text-red-100"
            }`}>
              <div className="flex items-start gap-2">
                {testResult.ok
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-300" />
                  : <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-300" />}
                <div className="flex-1">
                  <div className="font-medium">{testResult.summary}</div>
                  <ul className="mt-2 space-y-1">
                    {testResult.checks.map((chk, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] font-mono">
                        <span className={chk.ok ? "text-emerald-300" : "text-red-300"}>
                          {chk.ok ? "PASS" : "FAIL"}
                        </span>
                        <span className="text-white/70">{chk.label}</span>
                        <span className="text-white/40">— {chk.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-2">
              Recent verify attempts (redacted)
            </div>
            <div className="rounded-md border border-white/10 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-white/[0.03] text-white/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-mono uppercase tracking-widest">Time</th>
                    <th className="text-left px-3 py-2 font-mono uppercase tracking-widest">Provider</th>
                    <th className="text-left px-3 py-2 font-mono uppercase tracking-widest">Result</th>
                    <th className="text-left px-3 py-2 font-mono uppercase tracking-widest">Codes</th>
                    <th className="text-left px-3 py-2 font-mono uppercase tracking-widest">Token</th>
                    <th className="text-left px-3 py-2 font-mono uppercase tracking-widest">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {(captchaLogs.data?.rows ?? []).length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-white/40">No verify attempts yet.</td></tr>
                  ) : (captchaLogs.data!.rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-white/60">{new Date(r.created_at).toLocaleTimeString()}</td>
                      <td className="px-3 py-2 text-white/70">{r.provider}<span className="text-white/30 ml-1">/{r.purpose}</span></td>
                      <td className="px-3 py-2">
                        <span className={r.success ? "text-emerald-300" : "text-red-300"}>
                          {r.success ? "ok" : (r.reason ?? "fail")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-white/50 font-mono">{(r.error_codes ?? []).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-white/40 font-mono">
                        {r.token_prefix ? `${r.token_prefix}… (${r.token_length})` : "—"}
                      </td>
                      <td className="px-3 py-2 text-white/50">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* STATS STRIP */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Total keys" value={stats.data?.total ?? 0} />
        <Stat label="Unlimited" value={stats.data?.types.unlimited ?? 0} accent="emerald" />
        <Stat label="Single-use" value={stats.data?.types.single_use ?? 0} accent="sky" />
        <Stat label="24h session" value={stats.data?.types.session_24h ?? 0} accent="violet" />
        <Stat label="Redeems · 24h" value={stats.data?.redemptions24h ?? 0} accent="red" />
      </div>

      {/* KEY GENERATOR */}
      <div className="glass p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="font-display text-xl">Generate keys</h2>
            <p className="text-white/50 text-xs mt-1">All key codes are shown once. Store them safely or copy the batch below.</p>
          </div>
          <Button className="btn-red" onClick={() => genMut.mutate()} disabled={genMut.isPending}>
            <Plus className="w-4 h-4 mr-2" /> {genMut.isPending ? "Generating…" : "Generate"}
          </Button>
        </div>
        <div className="grid md:grid-cols-5 gap-3">
          <div>
            <Label className="label-caps mb-2 block">Type</Label>
            <Select value={genType} onValueChange={(v: any) => setGenType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">♾️ Unlimited</SelectItem>
                <SelectItem value="single_use">🔒 Single-use</SelectItem>
                <SelectItem value="session_24h">⏱️ 24-hour session</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="label-caps mb-2 block">Quantity</Label>
            <Input type="number" min={1} max={200} value={genQty} onChange={(e) => setGenQty(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
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
            <Label className="label-caps mb-2 block">Max uses {genType !== "unlimited" && <span className="text-white/30">(auto)</span>}</Label>
            <Input
              type="number"
              disabled={genType !== "unlimited"}
              placeholder={genType === "unlimited" ? "∞ (blank)" : genType === "single_use" ? "1" : "∞"}
              value={genMaxUses}
              onChange={(e) => setGenMaxUses(e.target.value)}
            />
          </div>
        </div>

        {lastGenerated && lastGenerated.length > 0 && (
          <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-emerald-400 font-mono text-[10px] uppercase tracking-widest">
                <CheckCircle2 className="w-4 h-4" /> {lastGenerated.length} key(s) generated · shown once
              </div>
              <div className="flex gap-2">
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
                  {k.code}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* KEY TABLE */}
      <div className="glass p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-display text-xl">Key ledger</h2>
          <div className="flex flex-wrap gap-2">
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
                    <AlertDialogTitle>Delete selected keys?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes {selected.size} key(s). Redemption logs stay in place but detach from the key.
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
                <th className="py-2 px-2 w-8"></th>
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
                <tr><td colSpan={8} className="py-8 text-center text-white/40">Loading…</td></tr>
              )}
              {!keys.isLoading && filteredRows.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-white/40">No keys yet — generate the first batch above.</td></tr>
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
                    <td className="px-2 py-2">
                      <TypeBadge type={r.key_type} />
                    </td>
                    <td className="px-2 py-2 text-white/70">{r.label ?? <span className="text-white/30">—</span>}</td>
                    <td className="px-2 py-2 font-mono">
                      {r.uses_count}{r.max_uses != null ? ` / ${r.max_uses}` : r.key_type === "unlimited" ? "" : ""}
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
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => {
                            toggleKey({ data: { id: r.id, disabled: !r.disabled } }).then(() => {
                              toast.success(r.disabled ? "Key enabled" : "Key disabled");
                              qc.invalidateQueries({ queryKey: ["access-keys"] });
                            });
                          }}
                        >
                          <Ban className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-red-300 border-red-500/30 hover:bg-red-500/10"
                          onClick={() => {
                            removeKeys({ data: { ids: [r.id] } }).then(() => {
                              toast.success("Key deleted");
                              qc.invalidateQueries({ queryKey: ["access-keys"] });
                              qc.invalidateQueries({ queryKey: ["access-stats"] });
                            });
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
          <h2 className="font-display text-xl">Redemption log</h2>
          <span className="text-xs text-white/40">Latest 200 · refreshes every 5s</span>
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
                <tr key={r.id} className="border-b border-white/5">
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
  icon, title, desc, enabled, onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className={`glass p-5 border ${enabled ? "border-[#ff2a3a]/40 shadow-[0_0_0_1px_rgba(255,42,58,0.2)]" : "border-white/10"} transition`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${enabled ? "bg-[#ff2a3a]/20 text-[#ff8a90]" : "bg-white/5 text-white/50"}`}>
          {icon}
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
      <div className="mt-4">
        <div className="font-display text-lg">{title}</div>
        <p className="text-white/55 text-xs mt-1 leading-relaxed">{desc}</p>
        <div className="mt-3">
          {enabled
            ? <Badge className="bg-[#ff2a3a]/20 text-[#ff8a90] border-none">● On</Badge>
            : <Badge variant="outline" className="border-white/10 text-white/50">○ Off</Badge>}
        </div>
      </div>
    </div>
  );
}
