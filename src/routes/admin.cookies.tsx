import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import {
  uploadCookies, listCookies, deleteCookie, checkCookieNow, checkAllCookies,
  deleteAllCookies, deleteInvalidCookies, deleteFreeHoldCookies,
  deleteDuplicateCookies, getCookieDetail,
} from "@/lib/pool.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Cookie, Upload, RefreshCw, Trash2, PlayCircle, FileText, FileArchive,
  FileUp, CheckCircle2, XCircle, Loader2, Eye, Download, Copy as CopyIcon,
  FlameKindling, Ban, Layers, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/cookies")({
  head: () => ({ meta: [{ title: "Cookie pool — Admin" }, { name: "robots", content: "noindex" }] }),
  component: CookiePoolPage,
});

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  free: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  on_hold: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  invalid: "bg-red-500/15 text-red-300 border-red-500/30",
  unknown: "bg-white/5 text-white/50 border-white/10",
};

type BatchResult = { inserted: number; duplicates: number; invalid: number };

function CookiePoolPage() {
  const qc = useQueryClient();
  const upload = useServerFn(uploadCookies);
  const list = useServerFn(listCookies);
  const del = useServerFn(deleteCookie);
  const check = useServerFn(checkCookieNow);
  const checkAll = useServerFn(checkAllCookies);
  const delAll = useServerFn(deleteAllCookies);
  const delInvalid = useServerFn(deleteInvalidCookies);
  const delFreeHold = useServerFn(deleteFreeHoldCookies);
  const delDupes = useServerFn(deleteDuplicateCookies);
  const detailFn = useServerFn(getCookieDetail);

  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<null | "all" | "invalid" | "freehold" | "dupes">(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["cookies", page, status],
    queryFn: () => list({ data: { page, pageSize, status: status || undefined } }),
    refetchInterval: 15_000,
  });

  const checkMut = useMutation({
    mutationFn: async (id: string) => check({ data: { id } }),
    onSuccess: (r) => {
      const mode = r.proxy_used ? "proxy" : "direct";
      const message = r.last_error ? `${r.status} · ${r.last_error}` : `${r.status}${r.email ? ` · ${r.email}` : ""}`;
      toast.success(`Rechecked (${mode}) · ${message}`);
      qc.invalidateQueries({ queryKey: ["cookies"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Check failed"),
  });
  const checkAllMut = useMutation({
    mutationFn: async () => checkAll({}),
    onSuccess: (r: any) => {
      toast.success(`Checked ${r.checked} · ${r.active} active · ${r.free} free · ${r.on_hold} hold · ${r.invalid} invalid · ${r.unknown} unknown`);
      qc.invalidateQueries({ queryKey: ["cookies"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk check failed"),
  });
  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cookies"] }),
  });
  const bulkMut = useMutation({
    mutationFn: async (kind: "all" | "invalid" | "freehold" | "dupes") => {
      if (kind === "all") return { kind, ...(await delAll({})) };
      if (kind === "invalid") return { kind, ...(await delInvalid({})) };
      if (kind === "freehold") return { kind, ...(await delFreeHold({})) };
      return { kind, ...(await delDupes({})) };
    },
    onSuccess: (r: any) => {
      const label = r.kind === "all" ? "all cookies" : r.kind === "invalid" ? "invalid" : r.kind === "freehold" ? "free/hold" : "duplicates";
      toast.success(`Removed ${r.deleted ?? 0} ${label}${r.scanned ? ` (scanned ${r.scanned})` : ""}`);
      qc.invalidateQueries({ queryKey: ["cookies"] });
      setConfirm(null);
    },
    onError: (e: any) => { toast.error(e?.message ?? "Bulk delete failed"); setConfirm(null); },
  });

  async function openDetails(id: string) {
    setDetailId(id);
    setDetail(null);
    try {
      const row = await detailFn({ data: { id } });
      setDetail(row);
    } catch (e: any) { toast.error(e?.message ?? "Load failed"); setDetailId(null); }
  }

  function exportCsv() {
    const cols = ["id","email","status","is_valid","country","plan_name","video_quality","max_streams","payment_method","name","member_since","total_uses","success_count","fail_count","last_checked_at","last_used_at","last_error"];
    const esc = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; };
    const csv = [cols.join(","), ...rows.map((r: any) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cookies-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cookie pool"
        subtitle="Upload Netflix session cookies used by the live TV activation flow. Supports single files, bulk .txt uploads, and .zip archives."
        icon={Cookie}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportCsv} className="border-white/10 bg-white/5 hover:bg-white/10">
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button onClick={() => checkAllMut.mutate()} disabled={checkAllMut.isPending} className="btn-red">
              <PlayCircle className="w-4 h-4 mr-2" /> {checkAllMut.isPending ? "Checking…" : "Recheck all"}
            </Button>
          </div>
        }
      />

      <UploadPanel
        onDone={() => qc.invalidateQueries({ queryKey: ["cookies"] })}
        runUpload={(blobs, label) => upload({ data: { blobs, label } })}
      />

      {/* Bulk actions */}
      <div className="glass p-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-2">
          <FlameKindling className="w-4 h-4 text-[#ff2a3a]" />
          <span className="font-display text-sm">Bulk cleanup</span>
        </div>
        <Button size="sm" variant="outline" disabled={bulkMut.isPending} onClick={() => setConfirm("invalid")} className="border-white/10 bg-white/5 hover:bg-red-500/10">
          <Ban className="w-3.5 h-3.5 mr-1.5 text-red-400" /> Remove invalid
        </Button>
        <Button size="sm" variant="outline" disabled={bulkMut.isPending} onClick={() => setConfirm("freehold")} className="border-white/10 bg-white/5 hover:bg-amber-500/10">
          <Layers className="w-3.5 h-3.5 mr-1.5 text-amber-300" /> Remove free / on-hold
        </Button>
        <Button size="sm" variant="outline" disabled={bulkMut.isPending} onClick={() => setConfirm("dupes")} className="border-white/10 bg-white/5 hover:bg-sky-500/10">
          <CopyIcon className="w-3.5 h-3.5 mr-1.5 text-sky-300" /> Remove duplicates
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="outline" disabled={bulkMut.isPending} onClick={() => setConfirm("all")} className="border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Delete ALL cookies
        </Button>
      </div>


      <div className="glass overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <div className="font-display text-lg">Pool <span className="text-white/40 text-sm">({data?.count ?? 0})</span></div>
            <div className="text-xs text-white/50">Live · auto-refresh every 15s</div>
          </div>
          <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-44 bg-white/5 border-white/10"><SelectValue placeholder="Filter status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="on_hold">On hold</SelectItem>
              <SelectItem value="invalid">Invalid</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/5">
              <tr>
                <th className="text-left p-3">Email / Label</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Plan</th>
                <th className="text-left p-3">Country</th>
                <th className="text-left p-3">Uses</th>
                <th className="text-left p-3">Last check</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-8 text-center text-white/40">Loading…</td></tr>}
              {!isLoading && rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-white/40">Pool is empty — upload cookies above.</td></tr>}
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                  <td className="p-3">
                    <div className="font-medium truncate max-w-[260px]">{r.email ?? r.label ?? "—"}</div>
                    {r.name && <div className="text-xs text-white/40">{r.name}</div>}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className={STATUS_STYLE[r.status] ?? STATUS_STYLE.unknown}>{r.status}</Badge>
                  </td>
                  <td className="p-3 text-white/60 text-xs">
                    <div>{r.plan_name ?? "—"}{r.video_quality ? ` · ${r.video_quality}` : ""}</div>
                    {r.max_streams ? <div className="text-[10px] text-white/35">{r.max_streams} stream{r.max_streams === 1 ? "" : "s"}</div> : null}
                  </td>
                  <td className="p-3 text-white/60 font-mono text-xs">{r.country ?? "—"}</td>
                  <td className="p-3 text-white/60 text-xs">
                    {r.total_uses ?? 0} <span className="text-emerald-400">✓{r.success_count ?? 0}</span> <span className="text-red-400">✗{r.fail_count ?? 0}</span>
                  </td>
                  <td className="p-3 text-white/50 text-xs">
                    <div>{r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.last_checked_mode && <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-white/45">{r.last_checked_mode}</Badge>}
                      {r.last_error && <span className="max-w-[220px] truncate text-[10px] text-red-300/80" title={r.last_error}>{r.last_error}</span>}
                    </div>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => openDetails(r.id)} className="hover:bg-white/10" title="View full details">
                      <Eye className="w-3.5 h-3.5 text-white/70" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => checkMut.mutate(r.id)} disabled={checkMut.isPending} className="hover:bg-white/10" title="Recheck now">
                      <RefreshCw className={`w-3.5 h-3.5 ${checkMut.isPending ? "animate-spin" : ""}`} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => delMut.mutate(r.id)} className="hover:bg-red-500/10" title="Delete">
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

      {/* Bulk confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="bg-black/90 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              {confirm === "all" && "Delete every cookie?"}
              {confirm === "invalid" && "Delete all invalid cookies?"}
              {confirm === "freehold" && "Delete all free & on-hold cookies?"}
              {confirm === "dupes" && "Remove duplicate cookies?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              {confirm === "all" && "This wipes the entire cookie pool. There is no undo."}
              {confirm === "invalid" && "Removes every row where status is invalid or is_valid=false. Frees pool space."}
              {confirm === "freehold" && "Removes cookies that came back free or on-hold from the last check."}
              {confirm === "dupes" && "Keeps the newest cookie per email/fingerprint and deletes the rest."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && bulkMut.mutate(confirm)} className="btn-red">
              {bulkMut.isPending ? "Working…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail modal */}
      <Dialog open={detailId !== null} onOpenChange={(v) => { if (!v) { setDetailId(null); setDetail(null); } }}>
        <DialogContent className="bg-black/95 border-white/10 text-white max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Cookie className="w-5 h-5 text-[#ff2a3a]" /> Cookie details
            </DialogTitle>
          </DialogHeader>
          {!detail && <div className="p-8 text-center text-white/50"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading…</div>}
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Email", detail.email],
                  ["Name", detail.name],
                  ["Status", detail.status],
                  ["Valid", String(detail.is_valid)],
                  ["Plan", detail.plan_name],
                  ["Quality", detail.video_quality],
                  ["Max streams", detail.max_streams],
                  ["Country", detail.country],
                  ["Member since", detail.member_since],
                  ["Payment", detail.payment_method],
                  ["Total uses", detail.total_uses],
                  ["Success / Fail", `${detail.success_count ?? 0} / ${detail.fail_count ?? 0}`],
                  ["Last checked", detail.last_checked_at],
                  ["Last used", detail.last_used_at],
                  ["Last mode", detail.last_checked_mode],
                  ["Fingerprint", detail.fingerprint],
                ].map(([k, v]) => (
                  <div key={k as string} className="glass p-3">
                    <div className="text-[10px] uppercase tracking-widest text-white/40">{k}</div>
                    <div className="text-white/85 font-mono text-xs mt-1 break-all">{v ?? "—"}</div>
                  </div>
                ))}
              </div>
              {detail.last_error && (
                <div className="glass p-3 border-red-500/30">
                  <div className="text-[10px] uppercase tracking-widest text-red-300">Last error</div>
                  <div className="text-red-200 text-xs font-mono mt-1 break-all">{detail.last_error}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Full cookie capture ({(detail.cookies_json ?? []).length} pairs)</div>
                <pre className="glass p-3 text-[11px] font-mono max-h-72 overflow-auto whitespace-pre-wrap break-all">
{JSON.stringify(detail.cookies_json, null, 2)}
                </pre>
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="border-white/10 bg-white/5"
                    onClick={() => { navigator.clipboard.writeText(JSON.stringify(detail.cookies_json, null, 2)); toast.success("Copied JSON"); }}>
                    <CopyIcon className="w-3.5 h-3.5 mr-1.5" /> Copy JSON
                  </Button>
                  <Button size="sm" variant="outline" className="border-white/10 bg-white/5"
                    onClick={() => {
                      const header = (detail.cookies_json ?? []).map((c: any) => `${c.name}=${c.value}`).join("; ");
                      navigator.clipboard.writeText(header); toast.success("Copied cookie header");
                    }}>
                    <CopyIcon className="w-3.5 h-3.5 mr-1.5" /> Copy header
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


// -------------------- Upload panel --------------------

function UploadPanel({
  runUpload,
  onDone,
}: {
  runUpload: (blobs: string[], label: string) => Promise<BatchResult>;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"single" | "bulk" | "zip">("single");

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2 mb-4">
        <Upload className="w-4 h-4 text-[#ff2a3a]" />
        <div className="font-display text-lg">Upload cookies</div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="single" className="data-[state=active]:bg-[#ff2a3a]/20 data-[state=active]:text-white">
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Single cookie
          </TabsTrigger>
          <TabsTrigger value="bulk" className="data-[state=active]:bg-[#ff2a3a]/20 data-[state=active]:text-white">
            <FileUp className="w-3.5 h-3.5 mr-1.5" /> Bulk .txt
          </TabsTrigger>
          <TabsTrigger value="zip" className="data-[state=active]:bg-[#ff2a3a]/20 data-[state=active]:text-white">
            <FileArchive className="w-3.5 h-3.5 mr-1.5" /> ZIP archive
          </TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="mt-4">
          <SingleUpload runUpload={runUpload} onDone={onDone} />
        </TabsContent>
        <TabsContent value="bulk" className="mt-4">
          <BulkUpload runUpload={runUpload} onDone={onDone} />
        </TabsContent>
        <TabsContent value="zip" className="mt-4">
          <ZipUpload runUpload={runUpload} onDone={onDone} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SingleUpload({ runUpload, onDone }: { runUpload: (b: string[], l: string) => Promise<BatchResult>; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [blob, setBlob] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function loadFile(f: File) {
    const text = await f.text();
    setBlob(text);
    if (!label) setLabel(f.name.replace(/\.(txt|json)$/i, ""));
    toast.success(`Loaded ${f.name}`);
  }

  async function submit() {
    if (!blob.trim()) return;
    setBusy(true);
    try {
      const r = await runUpload([blob.trim()], label);
      toast.success(`Added ${r.inserted} · ${r.duplicates} dupe · ${r.invalid} invalid`);
      setBlob(""); setLabel("");
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="bg-white/5 border-white/10"
        />
        <input ref={fileRef} type="file" accept=".txt,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.currentTarget.value = ""; }} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} className="border-white/10 bg-white/5 hover:bg-white/10 shrink-0">
          <FileText className="w-4 h-4 mr-2" /> Pick .txt / .json
        </Button>
      </div>
      <Textarea
        rows={8}
        placeholder={"Paste one Netflix cookie export — Netscape, JSON, or header string.\nExample:  NetflixId=v%3D2%26...; SecureNetflixId=v%3D2%26...; ..."}
        value={blob}
        onChange={(e) => setBlob(e.target.value)}
        className="bg-white/5 border-white/10 font-mono text-xs"
      />
      <div className="flex justify-end">
        <Button onClick={submit} disabled={!blob.trim() || busy} className="btn-red">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          {busy ? "Uploading…" : "Add to pool"}
        </Button>
      </div>
    </div>
  );
}

function BulkUpload({ runUpload, onDone }: { runUpload: (b: string[], l: string) => Promise<BatchResult>; onDone: () => void }) {
  const [files, setFiles] = useState<{ name: string; text: string; state: "pending" | "ok" | "dup" | "bad"; note?: string }[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFiles(list: FileList | null) {
    if (!list) return;
    const arr = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, text: await f.text(), state: "pending" as const })));
    setFiles((prev) => [...prev, ...arr]);
    toast.success(`Loaded ${arr.length} file${arr.length === 1 ? "" : "s"}`);
  }

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    // Chunk uploads (max 200 per call per server validator)
    const CHUNK = 100;
    let inserted = 0, dup = 0, bad = 0;
    for (let i = 0; i < files.length; i += CHUNK) {
      const batch = files.slice(i, i + CHUNK);
      try {
        const r = await runUpload(batch.map((b) => b.text), label);
        inserted += r.inserted; dup += r.duplicates; bad += r.invalid;
      } catch (e: any) {
        toast.error(e?.message ?? "Batch failed");
        break;
      }
    }
    toast.success(`Bulk done · ${inserted} new · ${dup} dupes · ${bad} invalid`);
    setFiles([]); setLabel("");
    onDone();
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Batch label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} className="bg-white/5 border-white/10" />
        <input ref={fileRef} type="file" accept=".txt,.json" multiple className="hidden" onChange={(e) => { pickFiles(e.target.files); e.currentTarget.value = ""; }} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} className="border-white/10 bg-white/5 hover:bg-white/10 shrink-0">
          <FileUp className="w-4 h-4 mr-2" /> Pick multiple .txt / .json
        </Button>
      </div>

      <DropZone
        label="Drop .txt / .json files here"
        accept={[".txt", ".json"]}
        onFiles={(fl) => pickFiles(fl)}
      />

      {files.length > 0 && (
        <div className="rounded-md border border-white/10 divide-y divide-white/5 max-h-64 overflow-auto">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-3.5 h-3.5 text-white/40" />
                <span className="truncate">{f.name}</span>
                <span className="text-white/30">· {(f.text.length / 1024).toFixed(1)} KB</span>
              </div>
              <button onClick={() => setFiles((p) => p.filter((_, k) => k !== i))} className="text-white/40 hover:text-red-400">
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="text-xs text-white/50">{files.length} file{files.length === 1 ? "" : "s"} queued</div>
        <Button onClick={submit} disabled={files.length === 0 || busy} className="btn-red">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          {busy ? "Uploading…" : `Upload ${files.length}`}
        </Button>
      </div>
    </div>
  );
}

function ZipUpload({ runUpload, onDone }: { runUpload: (b: string[], l: string) => Promise<BatchResult>; onDone: () => void }) {
  const [entries, setEntries] = useState<{ name: string; text: string }[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [zipName, setZipName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadZip(f: File) {
    setBusy(true);
    setEntries([]);
    setZipName(f.name);
    if (!label) setLabel(f.name.replace(/\.zip$/i, ""));
    try {
      const zip = await JSZip.loadAsync(f);
      const results: { name: string; text: string }[] = [];
      const files = Object.values(zip.files).filter((z) => !z.dir && /\.(txt|json)$/i.test(z.name));
      let done = 0;
      for (const z of files) {
        const text = await z.async("string");
        if (text.trim()) results.push({ name: z.name, text });
        done++;
        setProgress(Math.round((done / files.length) * 100));
      }
      setEntries(results);
      toast.success(`Extracted ${results.length} cookie file${results.length === 1 ? "" : "s"} from ${f.name}`);
    } catch (e: any) {
      toast.error(`ZIP read failed: ${e?.message ?? e}`);
    } finally { setBusy(false); setProgress(0); }
  }

  async function submit() {
    if (entries.length === 0) return;
    setBusy(true);
    const CHUNK = 100;
    let inserted = 0, dup = 0, bad = 0;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const batch = entries.slice(i, i + CHUNK);
      try {
        const r = await runUpload(batch.map((b) => b.text), label);
        inserted += r.inserted; dup += r.duplicates; bad += r.invalid;
        setProgress(Math.round(((i + batch.length) / entries.length) * 100));
      } catch (e: any) {
        toast.error(e?.message ?? "Batch failed");
        break;
      }
    }
    toast.success(`ZIP imported · ${inserted} new · ${dup} dupes · ${bad} invalid`);
    setEntries([]); setLabel(""); setZipName("");
    onDone();
    setBusy(false);
    setProgress(0);
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Batch label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} className="bg-white/5 border-white/10" />
        <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadZip(f); e.currentTarget.value = ""; }} />
        <Button variant="outline" onClick={() => fileRef.current?.click()} className="border-white/10 bg-white/5 hover:bg-white/10 shrink-0">
          <FileArchive className="w-4 h-4 mr-2" /> Pick .zip
        </Button>
      </div>

      <DropZone
        label="Drop a .zip archive here (contains .txt / .json cookies)"
        accept={[".zip"]}
        onFiles={(fl) => { const f = fl?.[0]; if (f) loadZip(f); }}
      />

      {(busy || progress > 0) && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#b0060f] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[11px] text-white/50 font-mono">{zipName ? `${zipName} · ` : ""}{progress}%</div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-md border border-white/10 divide-y divide-white/5 max-h-64 overflow-auto">
          {entries.slice(0, 200).map((e, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-3.5 h-3.5 text-white/40" />
                <span className="truncate">{e.name}</span>
                <span className="text-white/30">· {(e.text.length / 1024).toFixed(1)} KB</span>
              </div>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          ))}
          {entries.length > 200 && <div className="px-3 py-2 text-[11px] text-white/40">…and {entries.length - 200} more</div>}
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="text-xs text-white/50">{entries.length} cookie file{entries.length === 1 ? "" : "s"} extracted</div>
        <Button onClick={submit} disabled={entries.length === 0 || busy} className="btn-red">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          {busy ? "Uploading…" : `Import ${entries.length}`}
        </Button>
      </div>
    </div>
  );
}

// -------------------- Shared bits --------------------

function DropZone({ label, accept, onFiles }: { label: string; accept: string[]; onFiles: (fl: FileList) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        const dt = new DataTransfer();
        Array.from(e.dataTransfer.files)
          .filter((f) => accept.some((a) => f.name.toLowerCase().endsWith(a)))
          .forEach((f) => dt.items.add(f));
        onFiles(dt.files);
      }}
      className={`rounded-lg border-2 border-dashed p-6 text-center transition ${
        hover ? "border-[#ff2a3a]/60 bg-[#ff2a3a]/5" : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      <FileUp className="w-6 h-6 mx-auto mb-2 text-white/40" />
      <div className="text-sm text-white/70">{label}</div>
      <div className="text-[11px] text-white/40 mt-1 font-mono">{accept.join(" · ")}</div>
    </div>
  );
}

function PageHeader({ title, subtitle, icon: Icon, action }: { title: string; subtitle: string; icon: any; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <h1 className="font-display text-2xl md:text-3xl">{title}</h1>
          <p className="text-sm text-white/50 max-w-2xl mt-1">{subtitle}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
