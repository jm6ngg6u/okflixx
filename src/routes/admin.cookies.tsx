import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import {
  uploadCookies, listCookies, listCookieCountries, deleteCookie, checkCookieNow, checkAllCookies,
  deleteAllCookies, deleteInvalidCookies, deleteFreeHoldCookies,
  deleteDuplicateCookies, getCookieDetail,
  getCookiePoolStats, unlockStuckCookies, bulkDeleteCookies,
  previewCookieUpload, advancedCleanupCookies,
} from "@/lib/pool.functions";
import { supabase } from "@/integrations/supabase/client";
import { countryFlag, countryName } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  CalendarClock, Fingerprint, Wifi, ChevronDown, Search, Lock, Unlock,
  ArrowUp, ArrowDown, Rows3, Rows2, Zap, Radio, TrendingUp, ListChecks,
  X, SlidersHorizontal, Target, Clock3, Percent, ScanSearch,
} from "lucide-react";
import { toast } from "sonner";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/**
 * Wrap an admin data-fetch promise so failures are:
 *  1. Logged to the browser console with structured detail (op name, args,
 *     message, stack) — makes prod bug reports actionable.
 *  2. Forwarded to Lovable's error reporter (same channel as the error
 *     boundary), tagged as a handled fetch failure.
 * The original error is rethrown so React Query still sees `isError`.
 */
async function logAdminFetch<T>(op: string, args: unknown, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const anyErr = err as any;
    const detail = {
      op,
      args,
      message: anyErr?.message ?? String(err),
      name: anyErr?.name,
      status: anyErr?.status ?? anyErr?.response?.status,
      body: anyErr?.body ?? anyErr?.response?.data,
      stack: anyErr?.stack,
      at: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.error(`[admin.cookies] ${op} failed`, detail);
    reportLovableError(err, { source: "admin_cookies_fetch", ...detail });
    throw err;
  }
}



export const Route = createFileRoute("/admin/cookies")({
  head: () => ({ meta: [{ title: "Cookie pool — Admin" }, { name: "robots", content: "noindex" }] }),
  component: CookiePoolPage,
});

const STATUS_META: Record<string, { label: string; cls: string; Icon: any; dot: string; tone: string }> = {
  active:  { label: "Active",  cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", Icon: ShieldCheck,   dot: "bg-emerald-400", tone: "emerald" },
  free:    { label: "Free",    cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",              Icon: Sparkles,      dot: "bg-sky-400",     tone: "sky" },
  on_hold: { label: "On hold", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",       Icon: PauseCircle,   dot: "bg-amber-400",   tone: "amber" },
  invalid: { label: "Invalid", cls: "bg-red-500/15 text-red-300 border-red-500/30",              Icon: XCircle,       dot: "bg-red-400",     tone: "red" },
  unknown: { label: "Unknown", cls: "bg-white/5 text-white/50 border-white/10",                  Icon: HelpCircle,    dot: "bg-white/40",    tone: "muted" },
};

type BatchResult = { inserted: number; duplicates: number; invalid: number };
type BulkKind = "all" | "invalid" | "freehold" | "dupes" | "selection";
type SortKey = "created_at" | "last_checked_at" | "total_uses" | "success_count" | "fail_count" | "email";

const LIVE_POLL_MS = 4000;   // background poll (realtime handles the fast path)
const STATS_POLL_MS = 5000;

function fmtRel(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function freshnessTone(iso: string | null | undefined): { cls: string; label: string } {
  if (!iso) return { cls: "bg-white/20", label: "no data" };
  const age = Date.now() - Date.parse(iso);
  if (age < 5 * 60_000) return { cls: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]", label: "fresh" };
  if (age < 60 * 60_000) return { cls: "bg-amber-400", label: "aging" };
  if (age < 24 * 60 * 60_000) return { cls: "bg-orange-400", label: "old" };
  return { cls: "bg-red-500", label: "stale" };
}

/**
 * Health score (0-100) — a single number that combines success rate, freshness,
 * status, and lock state so ops can prioritize cookies at a glance.
 * Formula is client-side and derivable, so no DB migration is needed.
 */
function healthScore(r: any): number {
  const succ = Number(r.success_count ?? 0);
  const fail = Number(r.fail_count ?? 0);
  const attempts = succ + fail;
  let score = attempts > 0 ? (succ / attempts) * 100 : 50; // neutral if untested

  if (r.status === "active") score += 10;
  else if (r.status === "free") score += 3;
  else if (r.status === "on_hold") score -= 15;
  else if (r.status === "invalid") score -= 40;
  else if (r.status === "unknown") score -= 5;

  const t = r.last_checked_at ? Date.parse(r.last_checked_at) : 0;
  if (!t) score -= 15;
  else {
    const age = Date.now() - t;
    if (age > 24 * 60 * 60_000) score -= 12;
    else if (age > 60 * 60_000) score -= 4;
  }
  if (r.is_locked && r.locked_at && Date.now() - Date.parse(r.locked_at) > 5 * 60_000) score -= 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}
function healthTone(h: number): { text: string; bar: string; label: string } {
  if (h >= 75) return { text: "text-emerald-300", bar: "from-emerald-500 to-emerald-400", label: "excellent" };
  if (h >= 55) return { text: "text-lime-300",    bar: "from-lime-500 to-emerald-400",    label: "good" };
  if (h >= 35) return { text: "text-amber-300",   bar: "from-amber-500 to-yellow-400",    label: "fair" };
  if (h >= 15) return { text: "text-orange-300",  bar: "from-orange-500 to-amber-400",    label: "poor" };
  return              { text: "text-red-300",     bar: "from-red-600 to-red-400",         label: "critical" };
}

function CookiePoolPage() {
  const qc = useQueryClient();
  const upload = useServerFn(uploadCookies);
  const list = useServerFn(listCookies);
  const listCountries = useServerFn(listCookieCountries);
  const del = useServerFn(deleteCookie);
  const bulkDel = useServerFn(bulkDeleteCookies);
  const check = useServerFn(checkCookieNow);
  const checkAll = useServerFn(checkAllCookies);
  const delAll = useServerFn(deleteAllCookies);
  const delInvalid = useServerFn(deleteInvalidCookies);
  const delFreeHold = useServerFn(deleteFreeHoldCookies);
  const delDupes = useServerFn(deleteDuplicateCookies);
  const detailFn = useServerFn(getCookieDetail);
  const statsFn = useServerFn(getCookiePoolStats);
  const unlockFn = useServerFn(unlockStuckCookies);

  const [status, setStatus] = useState<string>("");
  const [country, setCountry] = useState<string>("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [sort, setSort] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [stuckOnly, setStuckOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<null | BulkKind>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<"comfy" | "compact">("comfy");
  const [pageCheckProgress, setPageCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const [realtimeUp, setRealtimeUp] = useState(false);
  const [nextTickIn, setNextTickIn] = useState(LIVE_POLL_MS / 1000);
  const pageSize = 25;

  const isAnyChecking = checkingIds.size > 0 || pageCheckProgress !== null;

  const listArgs = { page, pageSize, status: status || undefined, country: country || undefined,
    q: q || undefined, sort, sortDir, stuckOnly: stuckOnly || undefined };
  const { data, isLoading, isFetching, dataUpdatedAt, error, isError, refetch } = useQuery({
    queryKey: ["cookies", page, status, country, q, sort, sortDir, stuckOnly],
    queryFn: () => logAdminFetch("listCookies", listArgs, () => list({ data: listArgs })),
    refetchInterval: (query) => (query.state.error ? false : (isAnyChecking ? 2_000 : LIVE_POLL_MS)),
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const { data: stats, error: statsError } = useQuery({
    queryKey: ["cookie-stats"],
    queryFn: () => logAdminFetch("getCookiePoolStats", {}, () => statsFn({})),
    refetchInterval: (query) => (query.state.error ? false : STATS_POLL_MS),
    retry: 1,
  });

  const { data: countries } = useQuery({
    queryKey: ["cookie-countries"],
    queryFn: () => logAdminFetch("listCookieCountries", {}, () => listCountries({})),
    refetchInterval: 30_000,
    retry: 1,
  });


  const rows: any[] = useMemo(() => data?.rows ?? [], [data]);
  const totalPages = Math.max(1, Math.ceil((data?.count ?? 0) / pageSize));

  // -------- Realtime subscription: instant row flashes --------
  useEffect(() => {
    const channel = supabase
      .channel("cookie_pool_admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "cookie_pool" }, (payload: any) => {
        const id = payload?.new?.id ?? payload?.old?.id;
        if (id) {
          setFlashIds((prev) => { const n = new Set(prev); n.add(id); return n; });
          setTimeout(() => setFlashIds((prev) => { const n = new Set(prev); n.delete(id); return n; }), 1400);
        }
        qc.invalidateQueries({ queryKey: ["cookies"] });
        qc.invalidateQueries({ queryKey: ["cookie-stats"] });
      })
      .subscribe((s) => setRealtimeUp(s === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  // -------- Countdown to next background refresh --------
  useEffect(() => {
    const interval = isAnyChecking ? 2000 : LIVE_POLL_MS;
    setNextTickIn(Math.round(interval / 1000));
    const id = setInterval(() => setNextTickIn((v) => (v <= 1 ? Math.round(interval / 1000) : v - 1)), 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt, isAnyChecking]);

  // Clear stale selections when rows change
  useEffect(() => {
    setSelection((prev) => {
      if (prev.size === 0) return prev;
      const known = new Set(rows.map((r) => r.id));
      const next = new Set<string>();
      prev.forEach((id) => { if (known.has(id)) next.add(id); });
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [rows]);

  function toggleSort(key: SortKey) {
    if (sort === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSort(key); setSortDir("desc"); }
    setPage(0);
  }
  function toggleSel(id: string) {
    setSelection((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function selectAllVisible() {
    if (selection.size === rows.length) setSelection(new Set());
    else setSelection(new Set(rows.map((r) => r.id)));
  }
  function clearSelection() { setSelection(new Set()); }

  async function runOneCheck(id: string) {
    setCheckingIds((s) => { const n = new Set(s); n.add(id); return n; });
    try {
      const r: any = await check({ data: { id } });
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
      qc.invalidateQueries({ queryKey: ["cookie-stats"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
      return r;
    } catch (e: any) {
      toast.error(e?.message ?? "Check failed");
      throw e;
    } finally {
      setCheckingIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  async function runBulkCheck(ids: string[], label: string) {
    if (ids.length === 0) return;
    setPageCheckProgress({ done: 0, total: ids.length });
    const tId = toast.loading(`${label} · 0/${ids.length}`);
    const tally = { active: 0, free: 0, on_hold: 0, invalid: 0, unknown: 0 };
    let done = 0;
    for (const id of ids) {
      try {
        const out: any = await check({ data: { id } });
        tally[out.status as keyof typeof tally] = (tally[out.status as keyof typeof tally] ?? 0) + 1;
      } catch { /* keep going */ }
      done++;
      setPageCheckProgress({ done, total: ids.length });
      toast.loading(`${label} · ${done}/${ids.length}`, { id: tId });
    }
    toast.success(
      `${label} complete · ✓ ${tally.active} active · ${tally.free} free · ${tally.on_hold} hold · ${tally.invalid} invalid`,
      { id: tId },
    );
    setPageCheckProgress(null);
    qc.invalidateQueries({ queryKey: ["cookies"] });
    qc.invalidateQueries({ queryKey: ["cookie-stats"] });
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
      qc.invalidateQueries({ queryKey: ["cookie-stats"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Cookie deleted");
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-stats"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const bulkDelSelectionMut = useMutation({
    mutationFn: async (ids: string[]) => bulkDel({ data: { ids } }),
    onSuccess: (r: any) => {
      toast.success(`Deleted ${r.deleted} selected cookie${r.deleted === 1 ? "" : "s"}`);
      clearSelection();
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-stats"] });
      qc.invalidateQueries({ queryKey: ["cookie-countries"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk delete failed"),
  });

  const unlockMut = useMutation({
    mutationFn: async () => unlockFn({}),
    onSuccess: (r: any) => {
      toast.success(`Unlocked ${r.unlocked} stuck cookie${r.unlocked === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Unlock failed"),
  });

  const bulkMut = useMutation({
    mutationFn: async (kind: BulkKind) => {
      const label =
        kind === "all" ? "Deleting all cookies" :
        kind === "invalid" ? "Removing invalid cookies" :
        kind === "freehold" ? "Removing free & on-hold cookies" :
        kind === "selection" ? "Deleting selected cookies" :
        "Scanning for duplicates";
      const tId = toast.loading(`${label}…`);
      try {
        let res: any;
        if (kind === "all") res = await delAll({});
        else if (kind === "invalid") res = await delInvalid({});
        else if (kind === "freehold") res = await delFreeHold({});
        else if (kind === "selection") res = await bulkDel({ data: { ids: Array.from(selection) } });
        else res = await delDupes({});
        const deleted = res.deleted ?? 0;
        let line = "";
        if (kind === "all")      line = `🗑️  Wiped ${deleted} cookies from the pool`;
        else if (kind === "invalid")  line = `❌ Removed ${deleted} invalid cookie${deleted === 1 ? "" : "s"}`;
        else if (kind === "freehold") line = `⏸️  Removed ${deleted} · Free: ${res.free ?? 0} · Hold: ${res.on_hold ?? 0}`;
        else if (kind === "selection") line = `✓ Removed ${deleted} selected cookie${deleted === 1 ? "" : "s"}`;
        else                     line = `🔁 Removed ${deleted} duplicate${deleted === 1 ? "" : "s"} (scanned ${res.scanned ?? 0})`;
        toast.success(line, { id: tId });
        if (kind === "selection") clearSelection();
        return { kind, ...res };
      } catch (e: any) {
        toast.error(e?.message ?? "Bulk delete failed", { id: tId });
        throw e;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cookies"] });
      qc.invalidateQueries({ queryKey: ["cookie-stats"] });
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
    if (q) parts.push(`"${q}"`);
    if (stuckOnly) parts.push("stuck-lock");
    return parts;
  }, [status, country, q, stuckOnly]);

  const activeFilterCount = activeFilters.length;
  function clearAllFilters() {
    setStatus(""); setCountry(""); setQ(""); setQInput(""); setStuckOnly(false); setPage(0);
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader
        title="Cookie pool"
        subtitle="Live Netflix session pool powering TV activation. Realtime status feed, instant recheck, health monitoring."
        icon={Cookie}
        action={
          <div className="flex flex-wrap gap-2">
            <LiveIndicator realtimeUp={realtimeUp} isFetching={isFetching} isAnyChecking={isAnyChecking} nextTickIn={nextTickIn} />
            <Button variant="outline" onClick={exportCsv} className="border-white/10 bg-white/5 hover:bg-white/10">
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => runBulkCheck(rows.map((r) => r.id), "Checking page")}
              disabled={pageCheckProgress !== null || rows.length === 0}
              className="border-white/10 bg-white/5 hover:bg-white/10"
              title="Recheck the cookies currently visible on this page"
            >
              {pageCheckProgress ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
              {pageCheckProgress ? `Checking ${pageCheckProgress.done}/${pageCheckProgress.total}` : "Check page"}
            </Button>
            <Button onClick={() => checkAllMut.mutate()} disabled={checkAllMut.isPending} className="btn-red">
              {checkAllMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              {checkAllMut.isPending ? "Rechecking all…" : "Recheck all"}
            </Button>
          </div>
        }
      />

      {/* KPI health strip */}
      <PoolHealthStrip
        stats={stats}
        avgHealth={rows.length > 0 ? Math.round(rows.reduce((acc, r) => acc + healthScore(r), 0) / rows.length) : null}
        onFilterStatus={(s) => { setStatus(s); setPage(0); }}
        onFilterStuck={() => { setStuckOnly(true); setStatus(""); setCountry(""); setPage(0); }}
      />

      {/* Stuck-lock banner */}
      {stats && stats.stuck > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent px-4 py-3">
          <div className="w-9 h-9 rounded-md bg-amber-500/15 border border-amber-500/30 grid place-items-center">
            <Lock className="w-4 h-4 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-amber-200 font-medium">
              {stats.stuck} cookie{stats.stuck === 1 ? "" : "s"} locked longer than 5 minutes
            </div>
            <div className="text-[11px] text-amber-200/60">
              Likely a worker crash mid-check. Unlock to return them to the rotation pool.
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setStuckOnly((v) => !v)}
            className="border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-100">
            <Filter className="w-3.5 h-3.5 mr-1.5" /> {stuckOnly ? "Clear filter" : "Show stuck"}
          </Button>
          <Button size="sm" onClick={() => unlockMut.mutate()} disabled={unlockMut.isPending} className="btn-red">
            {unlockMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5 mr-1.5" />}
            Unlock all
          </Button>
        </div>
      )}

      <UploadPanel
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["cookies"] });
          qc.invalidateQueries({ queryKey: ["cookie-stats"] });
          qc.invalidateQueries({ queryKey: ["cookie-countries"] });
        }}
        runUpload={(blobs, label) => upload({ data: { blobs, label } })}
      />

      {/* Bulk cleanup dropdown */}
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

        <Button size="sm" onClick={() => setAdvancedOpen(true)}
          className="bg-gradient-to-r from-[#ff2a3a] to-[#b0060f] hover:from-[#ff3a4a] hover:to-[#c81020] text-white border-0 shadow-[0_4px_20px_-4px_rgba(255,42,58,0.5)]">
          <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5" /> Advanced cleanup
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10">
              <Layers className="w-3.5 h-3.5 mr-1.5" /> Cleanup actions
              <ChevronDown className="w-3.5 h-3.5 ml-1.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Non-destructive</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setConfirm("dupes")}>
              <CopyIcon className="w-3.5 h-3.5 mr-2 text-sky-300" />
              <div className="flex flex-col">
                <span className="text-sm">Remove duplicates</span>
                <span className="text-[10px] text-white/40">Keep newest per email / fingerprint</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Selective purge</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setConfirm("invalid")}>
              <Ban className="w-3.5 h-3.5 mr-2 text-red-400" />
              <div className="flex flex-col">
                <span className="text-sm">Remove invalid</span>
                <span className="text-[10px] text-white/40">Deletes status=invalid or is_valid=false</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirm("freehold")}>
              <PauseCircle className="w-3.5 h-3.5 mr-2 text-amber-300" />
              <div className="flex flex-col">
                <span className="text-sm">Remove free / on-hold</span>
                <span className="text-[10px] text-white/40">Reports free & hold counts separately</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-red-300/80">Destructive</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setConfirm("all")} className="text-red-200 focus:bg-red-500/15">
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
        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-white/5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="font-display text-lg flex items-center gap-2">
                Pool <span className="text-white/40 text-sm font-body font-normal">({data?.count ?? 0}{activeFilterCount > 0 ? ` of ${stats?.total ?? "…"}` : ""})</span>
                {(isFetching || isAnyChecking) && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff2a3a]" />}
              </div>
              <div className="text-xs text-white/50 flex items-center gap-2 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 ${realtimeUp ? "text-emerald-300" : "text-white/40"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${realtimeUp ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse" : "bg-white/30"}`} />
                  {realtimeUp ? "Live · realtime" : "Reconnecting…"}
                </span>
                <span>·</span>
                <span>next refresh in {nextTickIn}s</span>
                {activeFilters.length > 0 && <><span>·</span><span className="text-white/70">filtered: {activeFilters.join(" + ")}</span></>}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <form onSubmit={(e) => { e.preventDefault(); setQ(qInput.trim()); setPage(0); }}>
                  <Input
                    placeholder="Search email · label · name"
                    value={qInput}
                    onChange={(e) => setQInput(e.target.value)}
                    className="w-64 h-9 pl-9 bg-white/5 border-white/10 font-mono"
                  />
                </form>
                {qInput && (
                  <button type="button"
                    onClick={() => { setQInput(""); if (q) { setQ(""); setPage(0); } }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Select value={status || "all"} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
                <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
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
                <SelectTrigger className="w-52 h-9">
                  <SelectValue placeholder="Country">
                    {country
                      ? <span className="inline-flex items-center gap-2"><span className="text-base leading-none">{countryFlag(country)}</span>{countryName(country)}</span>
                      : "All countries"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
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
              <div className="flex items-center gap-0.5 p-0.5 rounded-md border border-white/10 bg-white/5">
                <button onClick={() => setDensity("comfy")} title="Comfortable rows"
                  className={`p-1.5 rounded ${density === "comfy" ? "bg-white/10 text-white" : "text-white/40"}`}>
                  <Rows3 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setDensity("compact")} title="Compact rows"
                  className={`p-1.5 rounded ${density === "compact" ? "bg-white/10 text-white" : "text-white/40"}`}>
                  <Rows2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {activeFilterCount > 0 && (
                <Button size="sm" variant="ghost" onClick={clearAllFilters} className="text-white/60 h-9">
                  <X className="w-3.5 h-3.5 mr-1" /> Clear ({activeFilterCount})
                </Button>
              )}
            </div>
          </div>
          {pageCheckProgress && (
            <div>
              <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#b0060f] transition-all"
                  style={{ width: `${Math.round((pageCheckProgress.done / pageCheckProgress.total) * 100)}%` }} />
              </div>
              <div className="text-[11px] text-white/50 font-mono mt-1">
                Checking {pageCheckProgress.done} / {pageCheckProgress.total} on this page…
              </div>
            </div>
          )}
        </div>

        {isError && (
          <div
            role="alert"
            className="mx-4 mb-3 rounded-lg border border-red-500/40 bg-gradient-to-r from-red-500/15 to-red-500/5 p-4 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-red-100">
                Couldn't load cookies
              </div>
              <div className="text-xs text-red-200/80 mt-1 break-words">
                {(error as any)?.message || "The cookies request failed. Check your connection or try again."}
              </div>
              <div className="text-[10px] text-red-200/50 mt-1 font-mono">
                op: listCookies · see browser console for full detail
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
            >
              {isFetching ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Retry
            </Button>
          </div>
        )}

        {statsError && !isError && (
          <div className="mx-4 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Stats temporarily unavailable — table data is still live.
          </div>
        )}

        <div className="overflow-x-auto">

          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox"
                    checked={rows.length > 0 && selection.size === rows.length}
                    onChange={selectAllVisible}
                    className="accent-[#ff2a3a] cursor-pointer" />
                </th>
                <th>Email / Label</th>
                <th>Status</th>
                <th>Plan · Country</th>
                <SortableTh label="Uses" active={sort === "total_uses"} dir={sortDir} onClick={() => toggleSort("total_uses")} />
                <SortableTh label="Success" active={sort === "success_count"} dir={sortDir} onClick={() => toggleSort("success_count")} />
                <th>Health</th>
                <SortableTh label="Last check" active={sort === "last_checked_at"} dir={sortDir} onClick={() => toggleSort("last_checked_at")} />
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={9} className="p-0"><div className="skeleton-row" /></td></tr>
              ))}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="state-block">
                      <div className="state-icon"><Cookie className="w-5 h-5" /></div>
                      <div className="state-title">No cookies match these filters</div>
                      <div className="state-sub">
                        {activeFilterCount > 0
                          ? "Try clearing filters, or upload fresh Netflix session cookies below."
                          : "The pool is empty. Upload cookies to start activating TV codes."}
                      </div>
                      {activeFilterCount > 0 && (
                        <Button size="sm" variant="outline" onClick={clearAllFilters} className="mt-1 border-white/10 bg-white/5">
                          Clear filters
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {!isLoading && rows.map((r: any) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.unknown;
                const StatusIcon = meta.Icon;
                const rowChecking = checkingIds.has(r.id);
                const flashing = flashIds.has(r.id);
                const selected = selection.has(r.id);
                const fresh = freshnessTone(r.last_checked_at);
                const succRate = (r.success_count + r.fail_count) > 0
                  ? Math.round((r.success_count / (r.success_count + r.fail_count)) * 100)
                  : null;
                const succCls = succRate == null ? "text-white/40"
                  : succRate >= 80 ? "text-emerald-300"
                  : succRate >= 50 ? "text-amber-300"
                  : "text-red-300";
                const isStuckLock = r.is_locked && r.locked_at && Date.now() - Date.parse(r.locked_at) > 5 * 60_000;
                return (
                  <tr
                    key={r.id}
                    data-selected={selected}
                    className={`
                      ${density === "compact" ? "[&>td]:!py-2" : ""}
                      ${flashing ? "animate-[flash-row_1.2s_ease-out]" : ""}
                      ${rowChecking ? "!bg-[#ff2a3a]/[0.05]" : ""}
                    `}
                  >
                    <td>
                      <input type="checkbox" checked={selected} onChange={() => toggleSel(r.id)}
                        className="accent-[#ff2a3a] cursor-pointer" />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${fresh.cls}`} title={`Freshness: ${fresh.label}`} />
                        <div className="min-w-0">
                          <div className="font-medium truncate max-w-[240px]">{r.email ?? r.label ?? "—"}</div>
                          {r.label && r.email && <div className="text-[10px] text-white/35 truncate max-w-[240px]">{r.label}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={`${meta.cls} gap-1.5`}>
                          <StatusIcon className="w-3 h-3" />
                          {meta.label}
                        </Badge>
                        {r.is_locked && (
                          <Badge variant="outline" className={isStuckLock
                            ? "bg-amber-500/15 text-amber-300 border-amber-500/30 gap-1"
                            : "bg-white/5 text-white/60 border-white/15 gap-1"}>
                            <Lock className="w-2.5 h-2.5" />
                            {isStuckLock ? "stuck" : "in use"}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="text-white/70 text-xs">
                      <div className="truncate max-w-[200px]">{r.plan_name ?? "—"}{r.video_quality ? ` · ${r.video_quality}` : ""}</div>
                      <div className="text-[10px] text-white/45 flex items-center gap-1 mt-0.5">
                        {r.country ? <>
                          <span className="text-sm leading-none">{countryFlag(r.country)}</span>
                          <span>{countryName(r.country)}</span>
                        </> : "no country"}
                        {r.max_streams ? <span className="ml-1">· {r.max_streams} stream{r.max_streams === 1 ? "" : "s"}</span> : null}
                      </div>
                    </td>
                    <td className="font-mono text-xs tabular-nums text-white/75">{r.total_uses ?? 0}</td>
                    <td className="font-mono text-xs tabular-nums">
                      <span className={succCls}>{succRate == null ? "—" : `${succRate}%`}</span>
                      <div className="text-[10px] text-white/40">
                        <span className="text-emerald-400/80">{r.success_count ?? 0}</span>
                        {" / "}
                        <span className="text-red-400/80">{r.fail_count ?? 0}</span>
                      </div>
                    </td>
                    <td className="min-w-[110px]">
                      {(() => {
                        const h = healthScore(r);
                        const tone = healthTone(h);
                        return (
                          <div className="flex flex-col gap-1" title={`Health: ${h}/100 · ${tone.label}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`font-mono text-xs tabular-nums font-semibold ${tone.text}`}>{h}</span>
                              <span className="text-[9px] uppercase tracking-widest text-white/40">{tone.label}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div
                                className={`h-full bg-gradient-to-r ${tone.bar} transition-all duration-500`}
                                style={{ width: `${h}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="text-white/60 text-xs">
                      <div className="font-mono">{fmtRel(r.last_checked_at)}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1 items-center">
                        {rowChecking && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#ff2a3a]">
                            <Loader2 className="w-3 h-3 animate-spin" /> checking…
                          </span>
                        )}
                        {!rowChecking && r.last_checked_mode && (
                          <span className="text-[10px] text-white/40 font-mono">via {r.last_checked_mode}</span>
                        )}
                        {r.last_error && <span className="max-w-[220px] truncate text-[10px] text-red-300/80" title={r.last_error}>· {r.last_error}</span>}
                      </div>
                    </td>
                    <td className="text-right space-x-1 whitespace-nowrap">
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
          <span>Page {page + 1} of {totalPages} · showing {rows.length} row{rows.length === 1 ? "" : "s"}</span>
          <div className="space-x-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)} className="border-white/10">Prev</Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)} className="border-white/10">Next</Button>
          </div>
        </div>
      </div>

      {/* Sticky selection action bar */}
      {selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-black/90 backdrop-blur-xl border border-white/15 rounded-full pl-4 pr-2 py-2 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]">
          <ListChecks className="w-4 h-4 text-[#ff2a3a]" />
          <span className="text-sm font-medium">{selection.size} selected</span>
          <span className="text-white/30">·</span>
          <Button size="sm" variant="outline" onClick={() => runBulkCheck(Array.from(selection), "Checking selection")}
            disabled={pageCheckProgress !== null}
            className="border-white/15 bg-white/5 hover:bg-white/10 rounded-full">
            <PlayCircle className="w-3.5 h-3.5 mr-1.5" /> Recheck
          </Button>
          <Button size="sm" onClick={() => setConfirm("selection")} className="btn-red rounded-full">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
          <button onClick={clearSelection} className="ml-1 w-7 h-7 rounded-full hover:bg-white/10 grid place-items-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Bulk confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="bg-black/90 border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              {confirm === "all" && "Delete every cookie?"}
              {confirm === "invalid" && "Delete all invalid cookies?"}
              {confirm === "freehold" && "Delete all free & on-hold cookies?"}
              {confirm === "dupes" && "Remove duplicate cookies?"}
              {confirm === "selection" && `Delete ${selection.size} selected cookie${selection.size === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              {confirm === "all" && "This wipes the entire cookie pool. There is no undo."}
              {confirm === "invalid" && "Removes every row where status is invalid or is_valid=false. Frees pool space."}
              {confirm === "freehold" && "Removes cookies that came back free or on-hold from the last check. You'll get separate counts."}
              {confirm === "dupes" && "Keeps the newest cookie per email/fingerprint and deletes the rest."}
              {confirm === "selection" && "Removes only the rows you selected. Cannot be undone."}
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

// -------------------- Support components --------------------

function SortableTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }) {
  return (
    <th>
      <button onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-white transition ${active ? "text-white" : ""}`}>
        {label}
        {active
          ? (dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowDown className="w-3 h-3 opacity-20" />}
      </button>
    </th>
  );
}

function LiveIndicator({ realtimeUp, isFetching, isAnyChecking, nextTickIn }: { realtimeUp: boolean; isFetching: boolean; isAnyChecking: boolean; nextTickIn: number }) {
  return (
    <div className="hidden md:flex items-center gap-2 h-9 px-3 rounded-md border border-white/10 bg-white/[0.03] text-[11px] font-mono">
      <Radio className={`w-3.5 h-3.5 ${realtimeUp ? "text-emerald-300" : "text-white/40"}`} />
      <span className={realtimeUp ? "text-emerald-300" : "text-white/50"}>
        {realtimeUp ? "LIVE" : "…"}
      </span>
      <span className="text-white/25">|</span>
      <span className="text-white/60">
        {isAnyChecking ? "checking" : isFetching ? "syncing" : `t-${nextTickIn}s`}
      </span>
    </div>
  );
}

function PoolHealthStrip({ stats, avgHealth, onFilterStatus, onFilterStuck }: {
  stats: any;
  avgHealth: number | null;
  onFilterStatus: (s: string) => void;
  onFilterStuck: () => void;
}) {
  const s = stats ?? { byStatus: {}, total: 0, locked: 0, stuck: 0, successRate: null, checkedLastHour: 0 };
  const hTone = avgHealth == null ? "muted"
    : avgHealth >= 75 ? "emerald"
    : avgHealth >= 55 ? "sky"
    : avgHealth >= 35 ? "amber"
    : "red";
  const hLabel = avgHealth == null ? "no data"
    : avgHealth >= 75 ? "excellent"
    : avgHealth >= 55 ? "good"
    : avgHealth >= 35 ? "fair"
    : avgHealth >= 15 ? "poor" : "critical";
  const tiles: { key: string; label: string; value: string; sub?: string; tone: string; Icon: any; onClick?: () => void }[] = [
    { key: "total",    label: "Total",       value: fmt(s.total),                Icon: Cookie,      tone: "muted" },
    { key: "active",   label: "Active",      value: fmt(s.byStatus?.active),     Icon: ShieldCheck, tone: "emerald", onClick: () => onFilterStatus("active") },
    { key: "free",     label: "Free",        value: fmt(s.byStatus?.free),       Icon: Sparkles,    tone: "sky",     onClick: () => onFilterStatus("free") },
    { key: "on_hold",  label: "On hold",     value: fmt(s.byStatus?.on_hold),    Icon: PauseCircle, tone: "amber",   onClick: () => onFilterStatus("on_hold") },
    { key: "invalid",  label: "Invalid",     value: fmt(s.byStatus?.invalid),    Icon: XCircle,     tone: "red",     onClick: () => onFilterStatus("invalid") },
    { key: "health",   label: "Avg health",  value: avgHealth == null ? "—" : `${avgHealth}`, sub: `page · ${hLabel}`, Icon: TrendingUp, tone: hTone },
    { key: "success",  label: "Success rate",value: s.successRate == null ? "—" : `${s.successRate}%`, sub: `${fmt(s.totalSucc)} ✓ / ${fmt(s.totalFail)} ✗`, Icon: TrendingUp, tone: "emerald" },
    { key: "locked",   label: "Locked now",  value: fmt(s.locked), sub: s.stuck > 0 ? `${s.stuck} stuck` : "healthy", Icon: Lock, tone: s.stuck > 0 ? "amber" : "muted", onClick: s.stuck > 0 ? onFilterStuck : undefined },
    { key: "check1h",  label: "Checks 1h",   value: fmt(s.checkedLastHour), Icon: Zap, tone: "sky" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {tiles.map((t) => (
        <button key={t.key}
          onClick={t.onClick}
          disabled={!t.onClick}
          className={`kpi-tile kpi-tone-${t.tone} ${t.onClick ? "kpi-clickable" : ""}`}>
          <div className="flex items-center gap-1.5">
            <t.Icon className="w-3.5 h-3.5 opacity-70" />
            <span className="kpi-label">{t.label}</span>
          </div>
          <div className="kpi-value">{t.value}</div>
          {t.sub && <div className="kpi-sub">{t.sub}</div>}
        </button>
      ))}
    </div>
  );
}
function fmt(n: any): string { if (n == null) return "0"; return Number(n).toLocaleString(); }



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
