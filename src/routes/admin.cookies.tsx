import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uploadCookies, listCookies, deleteCookie, checkCookieNow, checkAllCookies } from "@/lib/pool.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cookie, Upload, RefreshCw, Trash2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/cookies")({
  head: () => ({ meta: [{ title: "Cookie pool — Admin" }, { name: "robots", content: "noindex" }] }),
  component: CookiePoolPage,
});

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/20 text-green-400 border-green-500/30",
  free: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  on_hold: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  invalid: "bg-red-500/20 text-red-400 border-red-500/30",
  unknown: "bg-muted text-muted-foreground",
};

function CookiePoolPage() {
  const qc = useQueryClient();
  const upload = useServerFn(uploadCookies);
  const list = useServerFn(listCookies);
  const del = useServerFn(deleteCookie);
  const check = useServerFn(checkCookieNow);
  const checkAll = useServerFn(checkAllCookies);

  const [label, setLabel] = useState("");
  const [blob, setBlob] = useState("");
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["cookies", page, status],
    queryFn: () => list({ data: { page, pageSize, status: status || undefined } }),
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      // Split by blank-line separator: "---" or two newlines with a marker
      const blobs = blob.split(/\n\s*---+\s*\n|\n\s*===\s*\n/).map((s) => s.trim()).filter(Boolean);
      const payload = blobs.length ? blobs : [blob.trim()];
      return upload({ data: { label, blobs: payload } });
    },
    onSuccess: (r) => {
      toast.success(`Uploaded: ${r.inserted} new, ${r.duplicates} dupes, ${r.invalid} invalid`);
      setBlob(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["cookies"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const checkMut = useMutation({
    mutationFn: async (id: string) => check({ data: { id } }),
    onSuccess: (r) => { toast.success(`Status: ${r.status}`); qc.invalidateQueries({ queryKey: ["cookies"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Check failed"),
  });

  const checkAllMut = useMutation({
    mutationFn: async () => checkAll({}),
    onSuccess: (r) => { toast.success(`Checked ${r.checked} · ${r.active} active · ${r.invalid} invalid`); qc.invalidateQueries({ queryKey: ["cookies"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Bulk check failed"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookies"] }),
  });

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Cookie className="w-6 h-6" /> Cookie pool</h1>
          <p className="text-sm text-muted-foreground">Netflix session cookies used by the TV activation flow. Separate multiple accounts with a line of <code>---</code>.</p>
        </div>
        <Button variant="outline" onClick={() => checkAllMut.mutate()} disabled={checkAllMut.isPending}>
          <PlayCircle className="w-4 h-4 mr-2" /> {checkAllMut.isPending ? "Checking…" : "Check all"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="w-4 h-4" /> Upload cookies</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Label (optional, e.g. 'batch-jul-2026')" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Textarea
            rows={8}
            placeholder={`Paste one or more Netflix cookie exports.\n\nSupported formats:\n• Netscape (cookies.txt)\n• JSON array (Cookie-Editor / EditThisCookie)\n• Header string:  NetflixId=...; SecureNetflixId=...; ...\n\nSeparate multiple accounts with a line containing ---`}
            value={blob}
            onChange={(e) => setBlob(e.target.value)}
          />
          <div className="flex justify-end">
            <Button onClick={() => uploadMut.mutate()} disabled={!blob.trim() || uploadMut.isPending}>
              {uploadMut.isPending ? "Uploading…" : "Add to pool"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Pool ({data?.count ?? 0})</CardTitle>
          <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Filter status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="on_hold">On hold</SelectItem>
              <SelectItem value="invalid">Invalid</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b border-border/60">
                <tr>
                  <th className="text-left p-3">Email / Label</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Plan</th>
                  <th className="text-left p-3">Country</th>
                  <th className="text-left p-3">Uses</th>
                  <th className="text-left p-3">Last checked</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
                {!isLoading && rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No cookies yet.</td></tr>}
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="p-3">
                      <div className="font-medium truncate max-w-[240px]">{r.email ?? r.label ?? "—"}</div>
                      {r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={STATUS_COLORS[r.status] ?? STATUS_COLORS.unknown}>{r.status}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{r.plan_name ?? "—"} {r.video_quality ? `· ${r.video_quality}` : ""}</td>
                    <td className="p-3 text-muted-foreground">{r.country ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{r.total_uses ?? 0} <span className="text-green-500">✓{r.success_count ?? 0}</span> <span className="text-red-500">✗{r.fail_count ?? 0}</span></td>
                    <td className="p-3 text-muted-foreground text-xs">{r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}</td>
                    <td className="p-3 text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => checkMut.mutate(r.id)} disabled={checkMut.isPending}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
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
    </div>
  );
}
