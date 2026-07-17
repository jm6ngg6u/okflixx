import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  uploadProxies, listProxies, deleteProxy, checkAllProxies, deleteAllProxies,
  deleteInvalidProxies, checkProxyById, bulkDeleteProxies, unquarantineProxy,
  getProxyStats, getActiveProxyJob,
} from "@/lib/pool.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Globe2, Upload, PlayCircle, Trash2, FileUp, FileText, Loader2, ShieldX,
  XCircle, RefreshCw, Search, Activity, Zap, ShieldAlert, ShieldCheck, Radio,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/proxies")({
  head: () => ({ meta: [{ title: "Proxy pool — Admin" }, { name: "robots", content: "noindex" }] }),
  component: ProxiesPage,
});

type Filters = {
  status: "all" | "valid" | "invalid" | "quarantined" | "never_checked";
  scheme: string;
  search: string;
};

function ProxiesPage() {
  const qc = useQueryClient();
  const upload = useServerFn(uploadProxies);
  const list = useServerFn(listProxies);
  const del = useServerFn(deleteProxy);
  const checkAll = useServerFn(checkAllProxies);
  const delAll = useServerFn(deleteAllProxies);
  const delInvalid = useServerFn(deleteInvalidProxies);
  const checkOne = useServerFn(checkProxyById);
  const bulkDel = useServerFn(bulkDeleteProxies);
  const unquar = useServerFn(unquarantineProxy);
  const getStats = useServerFn(getProxyStats);
  const getJob = useServerFn(getActiveProxyJob);

  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const fileRef = useRef<HTMLInputElement>(null);
  const [filters, setFilters] = useState<Filters>({ status: "all", scheme: "all", search: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Stats
  const { data: stats } = useQuery({
    queryKey: ["proxy-stats"],
    queryFn: () => getStats({}),
    refetchInterval: 15_000,
  });

  // Active job
  const { data: job } = useQuery<any>({
    queryKey: ["proxy-job"],
    queryFn: () => getJob({}),
    refetchInterval: (q) => {
      const p = (q.state.data as any)?.progress;
      return p?.phase === "running" || p?.phase === "starting" ? 1000 : 8000;
    },
  });

  // Rows
  const { data, isLoading } = useQuery({
    queryKey: ["proxies", page, filters],
    queryFn: () => list({ data: { page, pageSize, status: filters.status, scheme: filters.scheme, search: filters.search } }),
  });

  // Realtime: any proxy_pool or job_runs change → refetch
  useEffect(() => {
    const ch = supabase
      .channel("admin-proxy-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "proxy_pool" }, () => {
        qc.invalidateQueries({ queryKey: ["proxies"] });
        qc.invalidateQueries({ queryKey: ["proxy-stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "job_runs", filter: "job=eq.proxy_recheck" }, () => {
        qc.invalidateQueries({ queryKey: ["proxy-job"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const uploadMut = useMutation({
    mutationFn: async () => upload({ data: { text } }),
    onSuccess: (r) => {
      toast.success(`Added ${r.inserted} · ${r.duplicates} dupes · ${r.invalid} invalid`);
      setText("");
      qc.invalidateQueries({ queryKey: ["proxies"] });
      qc.invalidateQueries({ queryKey: ["proxy-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const checkMut = useMutation({
    mutationFn: async (ids?: string[]) => checkAll({ data: ids && ids.length ? { ids } : {} }),
    onSuccess: (r: any) => toast.success("Recheck finished", { description: `${r.valid} valid · ${r.invalid} invalid` }),
    onError: (e: any) => toast.error(e?.message ?? "Bulk check failed"),
  });

  const delAllMut = useMutation({
    mutationFn: async () => delAll({}),
    onSuccess: (r) => toast.success("Pool cleared", { description: `Removed ${r.deleted} proxies` }),
    onError: (e: any) => toast.error(e?.message ?? "Clear failed"),
  });

  const delInvalidMut = useMutation({
    mutationFn: async () => delInvalid({}),
    onSuccess: (r) => toast.success("Invalid removed", { description: `Removed ${r.deleted} invalid proxies` }),
    onError: (e: any) => toast.error(e?.message ?? "Cleanup failed"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
  });

  const checkOneMut = useMutation({
    mutationFn: async (id: string) => checkOne({ data: { id } }),
    onSuccess: (r: any) => toast.success(r.ok ? "Proxy valid" : "Proxy failed check"),
    onError: (e: any) => toast.error(e?.message ?? "Check failed"),
  });

  const bulkDelMut = useMutation({
    mutationFn: async (ids: string[]) => bulkDel({ data: { ids } }),
    onSuccess: (r) => { toast.success(`Deleted ${r.deleted} proxies`); setSelected(new Set()); },
    onError: (e: any) => toast.error(e?.message ?? "Bulk delete failed"),
  });

  const unquarMut = useMutation({
    mutationFn: async (id: string) => unquar({ data: { id } }),
    onSuccess: () => toast.success("Un-quarantined"),
  });

  async function pickFiles(list: FileList | null) {
    if (!list) return;
    const parts: string[] = [];
    for (const f of Array.from(list)) {
      if (!/\.(txt|csv)$/i.test(f.name)) continue;
      parts.push(await f.text());
    }
    setText((prev) => [prev, ...parts].filter(Boolean).join("\n"));
    toast.success(`Loaded ${parts.length} file${parts.length === 1 ? "" : "s"}`);
  }

  const rows: any[] = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id)) && !allChecked;
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const progress = (job as any)?.progress;
  const jobRunning = progress?.phase === "running" || progress?.phase === "starting";
  const jobPct = progress?.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const s = stats as any;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
            <Globe2 className="w-5 h-5 text-[#ff2a3a]" />
          </div>
          <div>
            <h1 className="font-display text-2xl md:text-3xl normal-case">Proxy pool</h1>
            <p className="text-sm text-white/50 max-w-2xl mt-1 flex items-center gap-2 normal-case">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              live · concurrent recheck · health scoring · auto-quarantine at 5 fails
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => checkMut.mutate(undefined)} disabled={jobRunning || checkMut.isPending} className="btn-red normal-case">
            {jobRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
            {jobRunning ? "Rechecking…" : "Recheck all"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={delInvalidMut.isPending} className="border-red-500/30 text-red-300 hover:bg-red-500/10 normal-case">
                <XCircle className="w-4 h-4 mr-2" /> Remove invalid
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove invalid proxies?</AlertDialogTitle>
                <AlertDialogDescription>Deletes every proxy currently marked invalid (already checked at least once). Never-checked proxies are kept.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => delInvalidMut.mutate()}>Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={delAllMut.isPending} className="border-red-500/40 text-red-300 hover:bg-red-500/10 normal-case">
                <ShieldX className="w-4 h-4 mr-2" /> Clear all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the entire proxy pool?</AlertDialogTitle>
                <AlertDialogDescription>This removes every proxy in the pool. Can't be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => delAllMut.mutate()}>Clear pool</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="total" value={s?.total ?? 0} icon={<Globe2 className="w-3.5 h-3.5" />} />
        <StatCard label="valid" value={s?.valid ?? 0} tone="emerald" icon={<ShieldCheck className="w-3.5 h-3.5" />} />
        <StatCard label="invalid" value={s?.invalid ?? 0} tone="red" icon={<XCircle className="w-3.5 h-3.5" />} />
        <StatCard label="quarantined" value={s?.quarantined ?? 0} tone="amber" icon={<ShieldAlert className="w-3.5 h-3.5" />} />
        <StatCard label="unchecked" value={s?.never_checked ?? 0} tone="sky" icon={<RefreshCw className="w-3.5 h-3.5" />} />
        <StatCard label="checked 1h" value={s?.checked_1h ?? 0} tone="dim" icon={<Activity className="w-3.5 h-3.5" />} />
        <StatCard label="avg health" value={s?.avg_health != null ? `${Math.round((s.avg_health ?? 0) * 100)}%` : "—"} tone="dim" />
        <StatCard label="avg latency" value={s?.avg_latency_ms ? `${s.avg_latency_ms}ms` : "—"} tone="dim" icon={<Zap className="w-3.5 h-3.5" />} />
      </div>


      {/* Live progress strip */}
      {jobRunning && (
        <div className="glass p-4 border border-[#ff2a3a]/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-[#ff2a3a]" />
              <span className="font-display">Rechecking proxies</span>
              <span className="text-white/50">· {progress.done}/{progress.total}</span>
              <span className="text-emerald-300">· {progress.valid} valid</span>
              <span className="text-red-300">· {progress.invalid} invalid</span>
            </div>
            <div className="text-xs text-white/50 font-mono">
              {progress.rate ? `${progress.rate}/s` : ""}
              {progress.eta_sec != null ? ` · ETA ${progress.eta_sec}s` : ""}
            </div>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#ff6b7a] transition-all" style={{ width: `${jobPct}%` }} />
          </div>
        </div>
      )}

      {/* Import */}
      <div className="glass p-5">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Import proxies</div>
          <span className="text-xs text-white/40 ml-2 font-mono">ip:port · ip:port:user:pass · user:pass@ip:port · http(s):// · socks5://</span>
        </div>
        <Tabs defaultValue="paste">
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="paste" className="data-[state=active]:bg-[#ff2a3a]/20"><FileText className="w-3.5 h-3.5 mr-1.5" /> Paste list</TabsTrigger>
            <TabsTrigger value="file" className="data-[state=active]:bg-[#ff2a3a]/20"><FileUp className="w-3.5 h-3.5 mr-1.5" /> Upload .txt</TabsTrigger>
          </TabsList>
          <TabsContent value="paste" className="mt-4 space-y-3">
            <Textarea rows={8} placeholder={"One proxy per line…"} value={text} onChange={(e) => setText(e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />
          </TabsContent>
          <TabsContent value="file" className="mt-4 space-y-3">
            <input ref={fileRef} type="file" accept=".txt,.csv" multiple className="hidden" onChange={(e) => { pickFiles(e.target.files); e.currentTarget.value = ""; }} />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pickFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border-2 border-dashed border-white/10 bg-white/[0.02] hover:border-white/20 p-8 text-center cursor-pointer transition"
            >
              <FileUp className="w-6 h-6 mx-auto mb-2 text-white/40" />
              <div className="text-sm text-white/70">Drop or click to upload .txt / .csv proxy lists</div>
              <div className="text-[11px] text-white/40 mt-1 font-mono">multiple files ok</div>
            </div>
            {text && <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />}
          </TabsContent>
        </Tabs>
        <div className="flex justify-end mt-4">
          <Button onClick={() => uploadMut.mutate()} disabled={!text.trim() || uploadMut.isPending} className="btn-red">
            {uploadMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            {uploadMut.isPending ? "Uploading…" : "Add to pool"}
          </Button>
        </div>
      </div>

      {/* Table + filters */}
      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between flex-wrap gap-3">
          <div className="font-display text-lg">Proxies <span className="text-white/40 text-sm">({data?.count ?? 0})</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
              <Input
                placeholder="Search ip / raw…"
                value={filters.search}
                onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setPage(0); }}
                className="pl-8 h-8 w-52 bg-white/5 border-white/10 text-xs"
              />
            </div>
            <Select value={filters.status} onValueChange={(v: any) => { setFilters({ ...filters, status: v }); setPage(0); }}>
              <SelectTrigger className="h-8 w-36 bg-white/5 border-white/10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="valid">Valid</SelectItem>
                <SelectItem value="invalid">Invalid</SelectItem>
                <SelectItem value="quarantined">Quarantined</SelectItem>
                <SelectItem value="never_checked">Never checked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.scheme} onValueChange={(v: any) => { setFilters({ ...filters, scheme: v }); setPage(0); }}>
              <SelectTrigger className="h-8 w-32 bg-white/5 border-white/10 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All schemes</SelectItem>
                <SelectItem value="http">http</SelectItem>
                <SelectItem value="https">https</SelectItem>
                <SelectItem value="socks5">socks5</SelectItem>
                <SelectItem value="socks4">socks4</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bulk toolbar */}
        {selected.size > 0 && (
          <div className="px-5 py-2.5 border-b border-white/5 bg-[#ff2a3a]/5 flex items-center justify-between text-xs">
            <span className="text-white/70">{selected.size} selected</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => checkMut.mutate(Array.from(selected))} disabled={jobRunning} className="h-7 border-white/15">
                <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> Recheck selected
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkDelMut.mutate(Array.from(selected))} className="h-7 border-red-500/30 text-red-300 hover:bg-red-500/10">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete selected
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-7">Clear</Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/5">
              <tr>
                <th className="p-3 w-8">
                  <Checkbox checked={allChecked} data-state={someChecked ? "indeterminate" : allChecked ? "checked" : "unchecked"} onCheckedChange={toggleAll} />
                </th>
                <th className="text-left p-3">Endpoint</th>
                <th className="text-left p-3">Scheme</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Health</th>
                <th className="text-left p-3">Latency</th>
                <th className="text-left p-3">Uses</th>
                <th className="text-left p-3">Last check</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="p-8 text-center text-white/40">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-white/40">No proxies match — adjust filters or import a list above.</td></tr>}
              {rows.map((r: any) => {
                const quar = !!r.quarantined_at;
                const health = typeof r.health_score === "number" ? r.health_score : 0.5;
                const healthPct = Math.round(health * 100);
                const healthColor = health >= 0.75 ? "bg-emerald-500" : health >= 0.5 ? "bg-amber-500" : "bg-red-500";
                return (
                  <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.03] transition ${selected.has(r.id) ? "bg-[#ff2a3a]/5" : ""}`}>
                    <td className="p-3">
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />
                    </td>
                    <td className="p-3 font-mono text-xs">{r.ip}:{r.port}{r.username ? <span className="text-white/30 ml-1">· auth</span> : null}</td>
                    <td className="p-3 text-white/60 text-xs uppercase">{r.scheme}</td>
                    <td className="p-3">
                      {quar ? (
                        <Badge variant="outline" className="bg-amber-500/15 text-amber-300 border-amber-500/30">quarantined</Badge>
                      ) : (
                        <Badge variant="outline" className={r.is_valid ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-red-500/15 text-red-300 border-red-500/30"}>
                          {r.is_valid ? "valid" : "invalid"}
                        </Badge>
                      )}
                      {r.last_error && <div className="text-[10px] text-white/40 mt-1 truncate max-w-[180px]">{r.last_error}</div>}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className={`h-full ${healthColor}`} style={{ width: `${healthPct}%` }} />
                        </div>
                        <span className="text-[11px] text-white/50 font-mono">{healthPct}%</span>
                      </div>
                      <div className="text-[10px] text-white/30 mt-0.5">{r.success_count ?? 0}✓ · {r.failure_count ?? 0}✗</div>
                    </td>
                    <td className="p-3 text-white/60 font-mono text-xs">{r.last_latency_ms ? `${r.last_latency_ms}ms` : "—"}</td>
                    <td className="p-3 text-white/60 font-mono text-xs">{r.total_uses ?? 0}</td>
                    <td className="p-3 text-white/50 text-xs">{r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}</td>
                    <td className="p-3 text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => checkOneMut.mutate(r.id)} disabled={checkOneMut.isPending} className="hover:bg-white/5" title="Recheck">
                        <RefreshCw className={`w-3.5 h-3.5 text-white/70 ${checkOneMut.isPending && checkOneMut.variables === r.id ? "animate-spin" : ""}`} />
                      </Button>
                      {quar && (
                        <Button size="sm" variant="ghost" onClick={() => unquarMut.mutate(r.id)} className="hover:bg-amber-500/10" title="Un-quarantine">
                          <ShieldCheck className="w-3.5 h-3.5 text-amber-300" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)} className="hover:bg-red-500/10" title="Delete">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 text-xs text-white/50">
          <span>Page {page + 1} of {totalPages}</span>
          <div className="space-x-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)} className="border-white/10">Prev</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)} className="border-white/10">Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone = "default", icon }: { label: string; value: any; tone?: "default" | "emerald" | "red" | "amber" | "dim" | "sky"; icon?: React.ReactNode }) {
  const toneCls =
    tone === "emerald" ? "text-emerald-300" :
    tone === "red" ? "text-red-300" :
    tone === "amber" ? "text-amber-300" :
    tone === "sky" ? "text-sky-300" :
    tone === "dim" ? "text-white/70" :
    "text-white";
  return (
    <div className="glass p-3 rounded-lg">
      <div className="flex items-center gap-1.5 text-[11px] tracking-wide text-white/45 normal-case">
        {icon}
        {label}
      </div>
      <div className={`font-display text-2xl mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

