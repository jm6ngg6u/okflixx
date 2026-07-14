import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAttempts } from "@/lib/admin.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search, ScrollText, Filter } from "lucide-react";

export const Route = createFileRoute("/admin/attempts")({
  head: () => ({ meta: [{ title: "Attempts log — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: AttemptsPage,
});

const RESULTS = ["success", "rate_limited", "bot_detected", "invalid_code", "server_error"];

const RESULT_STYLE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rate_limited: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  bot_detected: "bg-red-500/15 text-red-300 border-red-500/30",
  invalid_code: "bg-white/10 text-white/60 border-white/15",
  server_error: "bg-red-500/15 text-red-300 border-red-500/30",
};

function AttemptsPage() {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const fetchList = useServerFn(listAttempts);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["attempts", page, result, country, q],
    queryFn: () => fetchList({ data: { page, pageSize: 50, result: result || undefined, country: country || undefined, q: q || undefined } }),
    refetchInterval: 20_000,
  });

  const total = data?.count ?? 0;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <ScrollText className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Log</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Attempts log</h1>
          <p className="text-sm text-white/50 mt-2">
            {total.toLocaleString()} attempts · page {page + 1} / {pages} · {isFetching ? <span className="text-emerald-400">syncing…</span> : "live"}
          </p>
        </div>
      </div>

      <div className="glass p-5">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-sm">Filters</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select value={result || "all"} onValueChange={(v) => { setResult(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-[200px] bg-white/5 border-white/10"><SelectValue placeholder="Result" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              {RESULTS.map((r) => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Country (e.g. US)" value={country} onChange={(e) => { setCountry(e.target.value.toUpperCase()); setPage(0); }} className="w-[180px] bg-white/5 border-white/10 font-mono" maxLength={4} />
          <form onSubmit={(e) => { e.preventDefault(); setQ(qInput); setPage(0); }} className="flex gap-2 flex-1 min-w-[240px]">
            <Input placeholder="Search code / user-agent / IP hash" value={qInput} onChange={(e) => setQInput(e.target.value)} className="bg-white/5 border-white/10" />
            <Button type="submit" className="btn-red"><Search className="w-4 h-4" /></Button>
          </form>
          {(result || country || q) && (
            <Button variant="ghost" onClick={() => { setResult(""); setCountry(""); setQ(""); setQInput(""); setPage(0); }} className="text-white/60">Clear</Button>
          )}
        </div>
      </div>

      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/5">
              <tr>
                <th className="text-left p-3">Time</th>
                <th className="text-left p-3">Code</th>
                <th className="text-left p-3">Result</th>
                <th className="text-left p-3">Country</th>
                <th className="text-left p-3">User agent</th>
                <th className="text-left p-3">IP hash</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="p-10 text-center text-white/40">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center text-white/40">No attempts match these filters</td></tr>
              ) : rows.map((r: any) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.03] transition">
                  <td className="p-3 whitespace-nowrap font-mono text-xs text-white/60">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-3 font-mono text-[#ff8a90]">{r.code}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={RESULT_STYLE[r.result] ?? "bg-white/5 text-white/50 border-white/10"}>
                      {(r.result ?? "unknown").replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="p-3 font-mono text-xs text-white/70">{r.country ?? "—"}</td>
                  <td className="p-3 max-w-[320px] truncate text-xs text-white/50" title={r.user_agent ?? ""}>{r.user_agent ?? "—"}</td>
                  <td className="p-3 font-mono text-xs text-white/40">{(r.ip_hash ?? "").slice(0, 14) || "—"}{r.ip_hash ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 text-xs text-white/50">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="border-white/10">
            <ChevronLeft className="w-4 h-4 mr-1" /> Prev
          </Button>
          <div className="font-mono">Page {page + 1} / {pages}</div>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages} className="border-white/10">
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
