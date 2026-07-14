import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadProxies, listProxies, deleteProxy, checkAllProxies } from "@/lib/pool.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Globe2, Upload, PlayCircle, Trash2 } from "lucide-react";
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

  const [text, setText] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["proxies", page],
    queryFn: () => list({ data: { page, pageSize } }),
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

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Globe2 className="w-6 h-6" /> Proxy pool</h1>
          <p className="text-sm text-muted-foreground">Formats: <code>ip:port</code>, <code>ip:port:user:pass</code>, <code>user:pass@ip:port</code>, <code>http(s)://…</code>, <code>socks5://…</code></p>
        </div>
        <Button variant="outline" onClick={() => checkMut.mutate()} disabled={checkMut.isPending}>
          <PlayCircle className="w-4 h-4 mr-2" /> {checkMut.isPending ? "Checking…" : "Check all"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" /> Bulk import</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={6} placeholder={"One proxy per line…"} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end">
            <Button onClick={() => uploadMut.mutate()} disabled={!text.trim() || uploadMut.isPending}>
              {uploadMut.isPending ? "Uploading…" : "Add to pool"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Proxies ({data?.count ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="text-left p-3">Endpoint</th>
                  <th className="text-left p-3">Scheme</th>
                  <th className="text-left p-3">Auth</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Last checked</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No proxies yet.</td></tr>}
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="p-3 font-mono text-xs">{r.ip}:{r.port}</td>
                    <td className="p-3 text-muted-foreground">{r.scheme}</td>
                    <td className="p-3 text-muted-foreground">{r.username ? "yes" : "—"}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={r.is_valid ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                        {r.is_valid ? "valid" : "invalid"}
                      </Badge>
                      {r.last_error && <div className="text-[10px] text-muted-foreground mt-1 truncate max-w-[200px]">{r.last_error}</div>}
                    </td>
                    <td className="p-3 text-muted-foreground text-xs">{r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3 border-t border-border/60">
            <div className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</div>
            <div className="space-x-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Note: outbound requests from the serverless runtime cannot be tunneled through arbitrary HTTP/SOCKS proxies. The "Check all"
        button verifies host reachability only. Proxies are stored for use by external workers or future off-edge check jobs.
      </p>
    </div>
  );
}
