import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listAttempts } from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

export const Route = createFileRoute("/admin/attempts")({
  head: () => ({ meta: [{ title: "Attempts log — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: AttemptsPage,
});

const RESULTS = ["", "success", "rate_limited", "bot_detected", "invalid_code", "server_error"];

function AttemptsPage() {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState("");
  const [country, setCountry] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const fetchList = useServerFn(listAttempts);
  const { data, isLoading } = useQuery({
    queryKey: ["attempts", page, result, country, q],
    queryFn: () => fetchList({ data: { page, pageSize: 50, result: result || undefined, country: country || undefined, q: q || undefined } }),
  });

  const total = data?.count ?? 0;
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Attempts log</h1>
        <p className="text-sm text-muted-foreground">{total} attempts · page {page + 1} of {pages}</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Filters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Select value={result || "all"} onValueChange={(v) => { setResult(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Result" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              {RESULTS.filter(Boolean).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Country code (e.g. US)" value={country} onChange={(e) => { setCountry(e.target.value.toUpperCase()); setPage(0); }} className="w-[180px]" />
          <form onSubmit={(e) => { e.preventDefault(); setQ(qInput); setPage(0); }} className="flex gap-2 flex-1 min-w-[200px]">
            <Input placeholder="Search code / UA / IP hash" value={qInput} onChange={(e) => setQInput(e.target.value)} />
            <Button type="submit" variant="secondary"><Search className="w-4 h-4" /></Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Result</th>
                  <th className="text-left px-3 py-2">Country</th>
                  <th className="text-left px-3 py-2">User agent</th>
                  <th className="text-left px-3 py-2">IP hash</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No attempts match</td></tr>
                ) : rows.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono">{r.code}</td>
                    <td className="px-3 py-2"><ResultBadge result={r.result} /></td>
                    <td className="px-3 py-2 font-mono">{r.country ?? "—"}</td>
                    <td className="px-3 py-2 max-w-[280px] truncate text-xs" title={r.user_agent ?? ""}>{r.user_agent ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{(r.ip_hash ?? "").slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between items-center">
        <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
          <ChevronLeft className="w-4 h-4" /> Prev
        </Button>
        <div className="text-sm text-muted-foreground">Page {page + 1} / {pages}</div>
        <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages}>
          Next <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const map: Record<string, { v: any; label: string }> = {
    success: { v: "default", label: "success" },
    rate_limited: { v: "secondary", label: "rate limited" },
    bot_detected: { v: "destructive", label: "bot" },
    invalid_code: { v: "outline", label: "invalid" },
    server_error: { v: "destructive", label: "error" },
  };
  const cfg = map[result] ?? { v: "outline", label: result };
  return <Badge variant={cfg.v}>{cfg.label}</Badge>;
}
