import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import {
  uploadCookies, listCookies, listCookieCountries, deleteCookie, checkCookieNow, checkAllCookies,
  deleteAllCookies, deleteInvalidCookies, deleteFreeHoldCookies,
  deleteDuplicateCookies, getCookieDetail,
} from "@/lib/pool.functions";
import { countryFlag, countryName } from "@/lib/countries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Cookie, Upload, RefreshCw, Trash2, PlayCircle, FileText, FileArchive,
  FileUp, CheckCircle2, XCircle, Loader2, Eye, Download, Copy as CopyIcon,
  FlameKindling, Ban, Layers, AlertTriangle, Globe2, Filter, Sparkles,
  ShieldCheck, PauseCircle, HelpCircle, Mail, CreditCard, Tv, Users2,
  CalendarClock, Fingerprint, Wifi, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/cookies")({
  head: () => ({ meta: [{ title: "Cookie pool — Admin" }, { name: "robots", content: "noindex" }] }),
  component: CookiePoolPage,
});

const STATUS_META: Record<string, { label: string; cls: string; Icon: any; dot: string }> = {
  active:  { label: "Active",  cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", Icon: ShieldCheck,   dot: "bg-emerald-400" },
  free:    { label: "Free",    cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",              Icon: Sparkles,      dot: "bg-sky-400" },
  on_hold: { label: "On hold", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",       Icon: PauseCircle,   dot: "bg-amber-400" },
  invalid: { label: "Invalid", cls: "bg-red-500/15 text-red-300 border-red-500/30",              Icon: XCircle,       dot: "bg-red-400" },
  unknown: { label: "Unknown", cls: "bg-white/5 text-white/50 border-white/10",                  Icon: HelpCircle,    dot: "bg-white/40" },
};

type BatchResult = { inserted: number; duplicates: number; invalid: number };
type BulkKind = "all" | "invalid" | "freehold" | "dupes";

function CookiePoolPage() {
  const qc = useQueryClient();
  const upload = useServerFn(uploadCookies);
  const list = useServerFn(listCookies);
  const listCountries = useServerFn(listCookieCountries);
  const del = useServerFn(deleteCookie);
  const check = useServerFn(checkCookieNow);
  const checkAll = useServerFn(checkAllCookies);
  const delAll = useServerFn(deleteAllCookies);
  const delInvalid = useServerFn(deleteInvalidCookies);
  const delFreeHold = useServerFn(deleteFreeHoldCookies);
  const delDupes = useServerFn(deleteDuplicateCookies);
  const detailFn = useServerFn(getCookieDetail);

  const [status, setStatus] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<null | BulkKind>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [pageCheckProgress, setPageCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const pageSize = 25;

  const isAnyChecking = checkingIds.size > 0 || pageCheckProgress !== null;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["cookies", page, status, country],
    queryFn: () => list({ data: { page, pageSize, status: status || undefined, country: country || undefined } }),
    // Faster live refresh while any check is in flight
    refetchInterval: isAnyChecking ? 2_000 : 15_000,
  });

  const { data: countries } = useQuery({
    queryKey: ["cookie-countries"],
    queryFn: () => listCountries({}),
    refetchInterval: 30_000,
  });

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  async function runOneCheck(id: string) {
    setCheckingIds((s) => { const n = new Set(s); n.add(id); return n; });
    try {
      const r = await check({ data: { id } });
      const mode = r.proxy_used ? "proxy" : "direct";
      const meta = STATUS_META[r.status] ?? STATUS_META.unknown;
      const detailsBits = [
        r.email,
        r.plan_name,
        r.country ? `${countryFlag(r.country)} ${countryName(r.country)}` : null,
      ].filter(Boolean).join(" · ");
      const msg = r.last_error ? r.last_error : detailsBits || meta.label;
      const line = `${meta.label} · ${mode}${msg ? " · " + msg : ""}`;
      if (r.status === "active" || r.status === "free") toast.success(line);
      else if (r.status === "invalid") toast.error(line);
      else toast(line);
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
      return r;
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
      throw e;
    } finally {
      setCheckingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function runPageCheck() {
    if (rows.length === 0) return;
    setPageCheckProgress({ done: 0, total: rows.length });
    const tId = toast.loading(`Checking ${rows.length} cookies on this page…`);
    const tally = { active: 0, free: 0, on_hold: 0, invalid: 0, unknown: 0 };
    let done = 0;
    for (const r of rows) {
      try {
        const out = await check({ data: { id: r.id } });
        tally[out.status as keyof typeof tally] = (tally[out.status as keyof typeof tally] ?? 0) + 1;
      } catch { /* keep going */ }
      done++;
      setPageCheckProgress({ done, total: rows.length });
      toast.loading(`Checking cookies… ${done}/${rows.length}`, { id: tId });
      qc.invalidateQueries({ queryKey: ["cookies"] });
    }
    toast.success(
      `Page rechecked · ${done}/${rows.length}   ✓ ${tally.active} active · ${tally.free} free · ${tally.on_hold} hold · ${tally.invalid} invalid · ${tally.unknown} unknown`,
      { id: tId },
    );
    setPageCheckProgress(null);
    qc.invalidateQueries({ queryKey: ["cookie-countries"] });
  }

  const checkAllMut = useMutation({
    mutationFn: async () => {
      const tId = toast.loading("Rechecking entire pool… this can take a while");
      try {
        const r: any = await checkAll({});
        toast.success(
          `Pool rechecked · ${r.checked} total   ✓ ${r.active} active · ${r.free} free · ${r.on_hold} hold · ${r.invalid} invalid · ${r.unknown} unknown`,
          { id: tId },
        );
        return r;
      } catch (e: any) {
        toast.error(e?.message ?? "Bulk check failed", { id: tId });
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Cookie deleted");
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const bulkMut = useMutation({
    mutationFn: async (kind: BulkKind) => {
      const label =
        kind === "all" ? "Deleting all cookies" :
        kind === "invalid" ? "Removing invalid cookies" :
        kind === "freehold" ? "Removing free & on-hold cookies" :
        "Scanning for duplicates";
      const tId = toast.loading(`${label}…`);
      try {
        let res: any;
        if (kind === "all") res = await delAll({});
        else if (kind === "invalid") res = await delInvalid({});
        else if (kind === "freehold") res = await delFreeHold({});
        else res = await delDupes({});
        const deleted = res.deleted ?? 0;
        let line = "";
        if (kind === "all")      line = `🗑️  Wiped ${deleted} cookies from the pool`;
        else if (kind === "invalid")  line = `❌ Removed ${deleted} invalid cookie${deleted === 1 ? "" : "s"}`;
        else if (kind === "freehold") line = `⏸️  Removed ${deleted} · Free: ${res.free ?? 0} · Hold: ${res.on_hold ?? 0}`;
        else                     line = `🔁 Removed ${deleted} duplicate${deleted === 1 ? "" : "s"} (scanned ${res.scanned ?? 0})`;
        toast.success(line, { id: tId });
        return { kind, ...res };
      } catch (e: any) {
        toast.error(e?.message ?? "Bulk delete failed", { id: tId });
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
      setConfirm(null);
    },
    onError: () => setConfirm(null),
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
    const cols = ["id","email","status","is_valid","country","plan_name","video_quality","max_streams","payment_method","member_since","total_uses","success_count","fail_count","last_checked_at","last_used_at","last_error"];
    const esc = (v: any) => { if (v == null) return ""; const s = String(v).replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; };
    const csv = [cols.join(","), ...rows.map((r: any) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cookies-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Exported ${rows.length} rows to CSV`);
  }

  const activeFilters = useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(STATUS_META[status]?.label ?? status);
    if (country) parts.push(`${countryFlag(country)} ${countryName(country)}`);
    return parts;
  }, [status, country]);

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
            <Button
              variant="outline"
              onClick={runPageCheck}
              disabled={pageCheckProgress !== null || rows.length === 0}
              className="border-white/10 bg-white/5 hover:bg-white/10"
              title="Recheck the cookies currently visible on this page"
            >
              {pageCheckProgress ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
              {pageCheckProgress ? `Checking ${pageCheckProgress.done}/${pageCheckProgress.total}` : "Check page"}
            </Button>
            <Button onClick={() => checkAllMut.mutate()} disabled={checkAllMut.isPending} className="btn-red">
              {checkAllMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
              {checkAllMut.isPending ? "Rechecking all…" : "Recheck all"}
            </Button>
          </div>
        }
      />

      <UploadPanel
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["cookies"] });
          qc.invalidateQueries({ queryKey: ["cookie-countries"] });
        }}
        runUpload={(blobs, label) => upload({ data: { blobs, label } })}
      />

      {/* Bulk cleanup — nested dropdown */}
      <div className="glass p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-[#ff2a3a]/15 border border-[#ff2a3a]/30 flex items-center justify-center">
            <FlameKindling className="w-4 h-4 text-[#ff2a3a]" />
          </div>
          <div>
            <div className="font-display text-sm leading-tight">Bulk cleanup</div>
            <div className="text-[11px] text-white/45">Group actions across the entire pool</div>
          </div>
        </div>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10">
              <Layers className="w-3.5 h-3.5 mr-1.5" /> Cleanup actions
              <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 bg-black/95 border-white/10 text-white">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-white/40">Non-destructive</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setConfirm("dupes")} className="focus:bg-sky-500/10">
              <CopyIcon className="w-3.5 h-3.5 mr-2 text-sky-300" />
              <div className="flex flex-col">
                <span className="text-sm">Remove duplicates</span>
                <span className="text-[10px] text-white/40">Keep newest per email / fingerprint</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-white/40">Selective purge</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setConfirm("invalid")} className="focus:bg-red-500/10">
              <Ban className="w-3.5 h-3.5 mr-2 text-red-400" />
              <div className="flex flex-col">
                <span className="text-sm">Remove invalid</span>
                <span className="text-[10px] text-white/40">Deletes status=invalid or is_valid=false</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirm("freehold")} className="focus:bg-amber-500/10">
              <PauseCircle className="w-3.5 h-3.5 mr-2 text-amber-300" />
              <div className="flex flex-col">
                <span className="text-sm">Remove free / on-hold</span>
                <span className="text-[10px] text-white/40">Reports free & hold counts separately</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-red-300/80">Destructive</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setConfirm("all")} className="focus:bg-red-500/15 text-red-200">
              <AlertTriangle className="w-3.5 h-3.5 mr-2 text-red-300" />
              <div className="flex flex-col">
                <span className="text-sm">Delete ALL cookies</span>
                <span className="text-[10px] text-red-300/60">Wipes the entire pool · no undo</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Pool table */}
      <div className="glass overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 flex-wrap gap-3">
          <div>
            <div className="font-display text-lg flex items-center gap-2">
              Pool <span className="text-white/40 text-sm font-body font-normal">({data?.count ?? 0})</span>
              {(isFetching || isAnyChecking) && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff2a3a]" />}
            </div>
            <div className="text-xs text-white/50">
              Live · auto-refresh every {isAnyChecking ? "2s while checking" : "15s"}
              {activeFilters.length > 0 && (
                <span className="ml-2 text-white/70">· filtered: {activeFilters.join(" + ")}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-white/45">
              <Filter className="w-3.5 h-3.5" /> Filters
            </div>
            <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-40 bg-white/5 border-white/10 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent className="bg-black/95 border-white/10 text-white">
                <SelectItem value="all">All statuses</SelectItem>
                {(["active","free","on_hold","invalid","unknown"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[s].dot}`} />
                      {STATUS_META[s].label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={country || "all"} onValueChange={(v) => { setCountry(v === "all" ? "" : v); setPage(0); }}>
              <SelectTrigger className="w-52 bg-white/5 border-white/10 h-9">
                <SelectValue placeholder="Country">
                  {country
                    ? <span className="inline-flex items-center gap-2"><span className="text-base leading-none">{countryFlag(country)}</span>{countryName(country)}</span>
                    : "All countries"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-black/95 border-white/10 text-white max-h-72">
                <SelectItem value="all">🌍 All countries</SelectItem>
                {(countries ?? []).map((c: any) => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="inline-flex items-center gap-2">
                      <span className="text-base leading-none">{countryFlag(c.code)}</span>
                      <span>{countryName(c.code)}</span>
                      <span className="text-white/40 text-[10px] ml-1">({c.count})</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Live progress bar while a page-check is running */}
        {pageCheckProgress && (
          <div className="px-5 pt-3">
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#b0060f] transition-all"
                style={{ width: `${Math.round((pageCheckProgress.done / pageCheckProgress.total) * 100)}%` }}
              />
            </div>
            <div className="text-[11px] text-white/50 font-mono mt-1">
              Checking {pageCheckProgress.done} / {pageCheckProgress.total} on this page…
            </div>
          </div>
        )}

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
              {!isLoading && rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-white/40">Pool is empty for the current filters.</td></tr>}
              {rows.map((r: any) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.unknown;
                const StatusIcon = meta.Icon;
                const rowChecking = checkingIds.has(r.id);
                return (
                  <tr key={r.id} className={`border-b border-white/5 transition ${rowChecking ? "bg-[#ff2a3a]/[0.04]" : "hover:bg-white/[0.03]"}`}>
                    <td className="p-3">
                      <div className="font-medium truncate max-w-[260px]">{r.email ?? r.label ?? "—"}</div>
                      {r.label && r.email && <div className="text-[10px] text-white/35 truncate max-w-[260px]">{r.label}</div>}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className={`${meta.cls} gap-1.5`}>
                        <StatusIcon className="w-3 h-3" />
                        {meta.label}
                      </Badge>
                    </td>
                    <td className="p-3 text-white/70 text-xs">
                      <div>{r.plan_name ?? "—"}{r.video_quality ? ` · ${r.video_quality}` : ""}</div>
                      {r.max_streams ? <div className="text-[10px] text-white/40">{r.max_streams} stream{r.max_streams === 1 ? "" : "s"}</div> : null}
                    </td>
                    <td className="p-3 text-white/75 text-xs">
                      {r.country ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-base leading-none">{countryFlag(r.country)}</span>
                          <span className="truncate max-w-[140px]">{countryName(r.country)}</span>
                        </span>
                      ) : <span className="text-white/40">—</span>}
                    </td>
                    <td className="p-3 text-white/70 text-xs">
                      {r.total_uses ?? 0} <span className="text-emerald-400">✓{r.success_count ?? 0}</span> <span className="text-red-400">✗{r.fail_count ?? 0}</span>
                    </td>
                    <td className="p-3 text-white/55 text-xs">
                      <div>{r.last_checked_at ? new Date(r.last_checked_at).toLocaleString() : "never"}</div>
                      <div className="mt-1 flex flex-wrap gap-1 items-center">
                        {rowChecking && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#ff2a3a]">
                            <Loader2 className="w-3 h-3 animate-spin" /> checking…
                          </span>
                        )}
                        {!rowChecking && r.last_checked_mode && <Badge variant="outline" className="border-white/10 bg-white/5 text-[10px] text-white/50">{r.last_checked_mode}</Badge>}
                        {r.last_error && <span className="max-w-[220px] truncate text-[10px] text-red-300/80" title={r.last_error}>{r.last_error}</span>}
                      </div>
                    </td>
                    <td className="p-3 text-right space-x-1 whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => openDetails(r.id)} className="hover:bg-white/10" title="View full details">
                        <Eye className="w-3.5 h-3.5 text-white/70" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => runOneCheck(r.id)} disabled={rowChecking} className="hover:bg-white/10" title="Recheck now">
                        <RefreshCw className={`w-3.5 h-3.5 ${rowChecking ? "animate-spin text-[#ff2a3a]" : ""}`} />
                      </Button>
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
              {confirm === "freehold" && "Removes cookies that came back free or on-hold from the last check. You'll get separate counts."}
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

      {/* Detail modal — restructured */}
      <Dialog open={detailId !== null} onOpenChange={(v) => { if (!v) { setDetailId(null); setDetail(null); } }}>
        <DialogContent className="bg-black/95 border-white/10 text-white max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Cookie className="w-5 h-5 text-[#ff2a3a]" /> Cookie details
            </DialogTitle>
          </DialogHeader>
          {!detail && <div className="p-8 text-center text-white/50"><Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading…</div>}
          {detail && <CookieDetailView detail={detail} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -------------------- Detail view --------------------

function DetailField({ icon: Icon, label, value, mono = false, accent }: { icon: any; label: string; value: React.ReactNode; mono?: boolean; accent?: "red" | "emerald" | "amber" | "sky" }) {
  const accentCls =
    accent === "red" ? "text-red-300" :
    accent === "emerald" ? "text-emerald-300" :
    accent === "amber" ? "text-amber-300" :
    accent === "sky" ? "text-sky-300" : "text-white/90";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/45">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={`mt-1.5 text-sm ${mono ? "font-mono text-xs" : ""} ${accentCls} break-all`}>
        {value ?? <span className="text-white/35">—</span>}
      </div>
    </div>
  );
}

function CookieDetailView({ detail }: { detail: any }) {
  const meta = STATUS_META[detail.status] ?? STATUS_META.unknown;
  const StatusIcon = meta.Icon;
  const flag = countryFlag(detail.country);
  const cName = countryName(detail.country);
  const cookiePairs = detail.cookies_json ?? [];
  return (
    <div className="space-y-5 text-sm">
      {/* Header banner */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-[#ff2a3a]/10 via-white/[0.02] to-transparent p-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <div className="font-display text-lg truncate">{detail.email ?? detail.label ?? "Unnamed cookie"}</div>
            <div className="text-xs text-white/50 mt-0.5">
              {detail.plan_name ?? "No plan"}
              {detail.video_quality ? <> · <span className="text-white/70">{detail.video_quality}</span></> : null}
              {detail.max_streams ? <> · {detail.max_streams} stream{detail.max_streams === 1 ? "" : "s"}</> : null}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`${meta.cls} gap-1.5`}>
              <StatusIcon className="w-3 h-3" /> {meta.label}
            </Badge>
            {detail.country && (
              <Badge variant="outline" className="border-white/10 bg-white/5 text-white/80 gap-1.5">
                <span className="text-base leading-none">{flag}</span> {cName}
              </Badge>
            )}
            <Badge variant="outline" className={detail.is_valid ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-white/50"}>
              {detail.is_valid ? "Valid" : "Not valid"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Account fields */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-white/45 mb-2 flex items-center gap-1.5">
          <Users2 className="w-3 h-3" /> Account
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <DetailField icon={Mail} label="Email" value={detail.email} />
          <DetailField icon={Tv} label="Plan" value={detail.plan_name} />
          <DetailField icon={Sparkles} label="Quality" value={detail.video_quality} />
          <DetailField icon={Users2} label="Max streams" value={detail.max_streams} />
          <DetailField icon={CreditCard} label="Payment" value={detail.payment_method} />
          <DetailField
            icon={Globe2}
            label="Country"
            value={detail.country ? <span className="inline-flex items-center gap-1.5"><span className="text-base leading-none">{flag}</span>{cName}<span className="text-white/40 text-xs ml-1">({String(detail.country).toUpperCase()})</span></span> : null}
          />
          <DetailField icon={CalendarClock} label="Member since" value={detail.member_since} />
        </div>
      </div>

      {/* Usage + timings */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-white/45 mb-2 flex items-center gap-1.5">
          <CalendarClock className="w-3 h-3" /> Usage & timings
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <DetailField icon={PlayCircle} label="Total uses" value={detail.total_uses ?? 0} />
          <DetailField icon={CheckCircle2} label="Successes" value={detail.success_count ?? 0} accent="emerald" />
          <DetailField icon={XCircle} label="Failures" value={detail.fail_count ?? 0} accent="red" />
          <DetailField icon={CalendarClock} label="Last checked" value={detail.last_checked_at ? new Date(detail.last_checked_at).toLocaleString() : null} />
          <DetailField icon={PlayCircle} label="Last used" value={detail.last_used_at ? new Date(detail.last_used_at).toLocaleString() : null} />
          <DetailField icon={Wifi} label="Last mode" value={detail.last_checked_mode} />
          <DetailField icon={Fingerprint} label="Fingerprint" value={detail.fingerprint} mono />
        </div>
      </div>

      {detail.last_error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3">
          <div className="text-[10px] uppercase tracking-widest text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> Last error
          </div>
          <div className="text-red-200 text-xs font-mono mt-1.5 break-all">{detail.last_error}</div>
        </div>
      )}

      {/* Full cookie capture */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-white/45 flex items-center gap-1.5">
            <Cookie className="w-3 h-3" /> Full cookie capture ({cookiePairs.length} pairs)
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 h-7 text-xs"
              onClick={() => { navigator.clipboard.writeText(JSON.stringify(cookiePairs, null, 2)); toast.success("Copied JSON"); }}>
              <CopyIcon className="w-3 h-3 mr-1.5" /> JSON
            </Button>
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 h-7 text-xs"
              onClick={() => {
                const header = cookiePairs.map((c: any) => `${c.name}=${c.value}`).join("; ");
                navigator.clipboard.writeText(header); toast.success("Copied cookie header");
              }}>
              <CopyIcon className="w-3 h-3 mr-1.5" /> Header
            </Button>
          </div>
        </div>
        <pre className="rounded-lg border border-white/10 bg-black/60 p-3 text-[11px] font-mono max-h-72 overflow-auto whitespace-pre-wrap break-all text-white/80">
{JSON.stringify(cookiePairs, null, 2)}
        </pre>
      </div>
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
