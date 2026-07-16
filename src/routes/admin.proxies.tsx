import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadProxies, listProxies, deleteProxy, checkAllProxies, deleteAllProxies, deleteInvalidProxies } from "@/lib/pool.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Globe2, Upload, PlayCircle, Trash2, FileUp, FileText, Loader2, ShieldX, XCircle } from "lucide-react";

import { toast } from "sonner";

export const Route = createFileRoute("/admin/proxies")({
  head: () => ({ meta: [{ title: "Proxy pool — Admin" }, { name: "robots", content: "noindex" }] }),
  component: ProxiesPage,
});

function ProxiesPage() {
  const qc = useQueryClient();
  const upload = useServerFn(uploadProxies);
  const list = useServerFn(listProxies);
  const del = useServerFn(deleteProxy);
  const checkAll = useServerFn(checkAllProxies);
  const delAll = useServerFn(deleteAllProxies);
  const delInvalid = useServerFn(deleteInvalidProxies);


  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["proxies", page],
    queryFn: () => list({ data: { page, pageSize } }),
    refetchInterval: 30_000,
  });

  const uploadMut = useMutation({
    mutationFn: async () => upload({ data: { text } }),
    onSuccess: (r) => {
      toast.success(`Added ${r.inserted} · ${r.duplicates} dupes · ${r.invalid} invalid`);
      setText("");
      qc.invalidateQueries({ queryKey: ["proxies"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const checkMut = useMutation({
    mutationFn: async () => checkAll({}),
    onSuccess: (r) => { toast.success(`Checked · ${r.valid} valid · ${r.invalid} invalid`); qc.invalidateQueries({ queryKey: ["proxies"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Bulk check failed"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proxies"] }),
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

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
            <Globe2 className="w-5 h-5 text-[#ff2a3a]" />
          </div>
          <div>
            <h1 className="font-display text-2xl md:text-3xl">Proxy pool</h1>
            <p className="text-sm text-white/50 max-w-2xl mt-1">Formats supported: <code className="text-white/70">ip:port</code>, <code className="text-white/70">ip:port:user:pass</code>, <code className="text-white/70">user:pass@ip:port</code>, <code className="text-white/70">http(s)://…</code>, <code className="text-white/70">socks5://…</code></p>
          </div>
        </div>
        <Button onClick={() => checkMut.mutate()} disabled={checkMut.isPending} className="btn-red">
          <PlayCircle className="w-4 h-4 mr-2" /> {checkMut.isPending ? "Checking…" : "Recheck all"}
        </Button>
      </div>

      <div className="glass p-5">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Import proxies</div>
        </div>
        <Tabs defaultValue="paste">
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="paste" className="data-[state=active]:bg-[#ff2a3a]/20"><FileText className="w-3.5 h-3.5 mr-1.5" /> Paste list</TabsTrigger>
            <TabsTrigger value="file" className="data-[state=active]:bg-[#ff2a3a]/20"><FileUp className="w-3.5 h-3.5 mr-1.5" /> Upload .txt</TabsTrigger>
          </TabsList>
          <TabsContent value="paste" className="mt-4 space-y-3">
            <Textarea rows={8} placeholder={"One proxy per line…\nhttp://user:pass@1.2.3.4:8080\nsocks5://5.6.7.8:1080\n1.2.3.4:8080:user:pass"} value={text} onChange={(e) => setText(e.target.value)} className="bg-white/5 border-white/10 font-mono text-xs" />
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

      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <div className="font-display text-lg">Proxies <span className="text-white/40 text-sm">({data?.count ?? 0})</span></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/5">
              <tr>
                <th className="text-left p-3">Endpoint</th>
                <th className="text-left p-3">Scheme</th>
                <th className="text-left p-3">Auth</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Latency</th>
                <th className="text-left p-3">Last check</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-8 text-center text-white/40">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-white/40">No proxies yet — import a list above.</td></tr>}
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                  <td className="p-3 font-mono text-xs">{r.ip}:{r.port}</td>
                  <td className="p-3 text-white/60 text-xs uppercase">{r.scheme}</td>
                  <td className="p-3 text-white/60 text-xs">{r.username ? "yes" : "—"}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={r.is_valid ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-red-500/15 text-red-300 border-red-500/30"}>
                      {r.is_valid ? "valid" : "invalid"}
                    </Badge>
                    {r.last_error && <div className="text-[10px] text-white/40 mt-1 truncate max-w-[200px]">{r.last_error}</div>}
                  </td>
                  <td className="p-3 text-white/60 font-mono text-xs">{r.last_latency_ms ? `${r.last_latency_ms}ms` : "—"}</td>
                  <td className="p-3 text-white/50 text-xs">{r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}</td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)} className="hover:bg-red-500/10">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </Button>
                  </td>
                </tr>
              ))}
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
