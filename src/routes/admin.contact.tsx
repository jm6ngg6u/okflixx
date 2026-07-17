import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listSettings, setSetting, getPublicContacts } from "@/lib/settings.functions";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Instagram, Phone, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/contact")({
  head: () => ({ meta: [{ title: "Contact channels — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: ContactPage,
});

type Kind = "telegram" | "instagram" | "whatsapp";

function normalizeHandle(kind: Kind, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (kind === "whatsapp") return v.replace(/[^\d+]/g, "").replace(/\+/g, "");
  let u = v.replace(/^https?:\/\/(t\.me|telegram\.me|instagram\.com|www\.instagram\.com)\//i, "");
  u = u.replace(/^@+/, "").replace(/\/+$/, "").split(/[?#/]/)[0];
  return u.replace(/[^A-Za-z0-9_.]/g, "");
}
function hrefFor(kind: Kind, h: string) {
  if (!h) return "";
  if (kind === "telegram") return `https://t.me/${h}`;
  if (kind === "instagram") return `https://instagram.com/${h}`;
  return `https://wa.me/${h}`;
}
function displayHandle(kind: Kind, h: string) {
  if (!h) return "";
  return kind === "whatsapp" ? `+${h}` : `@${h}`;
}

function ContactPage() {
  const fetchSettings = useServerFn(listSettings);
  const doSet = useServerFn(setSetting);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => fetchSettings(), refetchInterval: 2000 });
  const [local, setLocal] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, true>>({});
  useEffect(() => {
    if (!q.data?.settings) return;
    setLocal((prev) => {
      const next: Record<string, string> = { ...q.data.settings };
      // Preserve any keys the user is currently editing (unsaved).
      for (const k of Object.keys(dirty)) if (k in prev) next[k] = prev[k];
      return next;
    });
  }, [q.data, dirty]);

  const set = (k: string, v: string) => {
    setLocal((s) => ({ ...s, [k]: v }));
    setDirty((d) => ({ ...d, [k]: true }));
  };
  const save = async (k: string, valueOverride?: string) => {
    try {
      const value = valueOverride ?? local[k] ?? "";
      if (valueOverride !== undefined) setLocal((s) => ({ ...s, [k]: value }));
      await doSet({ data: { key: k, value } });
      setDirty((d) => { const n = { ...d }; delete n[k]; return n; });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["public-contacts"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    }
  };

  const visibleCount = (["telegram", "instagram", "whatsapp"] as Kind[]).filter((k) => {
    const enableKey = k === "telegram" ? "contact_tg_enabled" : k === "instagram" ? "contact_ig_enabled" : "contact_wa_enabled";
    const handleKey = k === "telegram" ? "contact_tg_username" : k === "instagram" ? "contact_ig_username" : "contact_wa_number";
    return (local[enableKey] ?? "1") === "1" && !!normalizeHandle(k, local[handleKey] ?? "");
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <MessageCircle className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div className="flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Public contact</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Contact channels</h1>
          <p className="text-sm text-white/50 mt-2">
            Each channel is independent. Turn it <b>on</b> with a valid handle to publish; turn it <b>off</b> or leave the handle blank to hide. No master toggle.
          </p>
        </div>
        <Badge variant="outline" className={visibleCount > 0
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/10 text-white/60 border-white/15"}>
          {visibleCount} LIVE
        </Badge>
      </div>

      <div className="glass p-5 space-y-4">
        <ContactRow icon={Send} label="Telegram" kind="telegram"
          enableKey="contact_tg_enabled" nameKey="contact_tg_name" handleKey="contact_tg_username"
          handlePlaceholder="yourhandle" local={local} set={set} onSave={save} />
        <ContactRow icon={Instagram} label="Instagram" kind="instagram"
          enableKey="contact_ig_enabled" nameKey="contact_ig_name" handleKey="contact_ig_username"
          handlePlaceholder="yourhandle" local={local} set={set} onSave={save} />
        <ContactRow icon={Phone} label="WhatsApp" kind="whatsapp"
          enableKey="contact_wa_enabled" nameKey="contact_wa_name" handleKey="contact_wa_number"
          handlePlaceholder="+1 555 123 4567" local={local} set={set} onSave={save} />

        <ContactPreview local={local} />
        <ContactServerCheck local={local} />
      </div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, kind, enableKey, nameKey, handleKey, handlePlaceholder, local, set, onSave }: {
  icon: any; label: string; kind: Kind;
  enableKey: string; nameKey: string; handleKey: string; handlePlaceholder: string;
  local: Record<string, string>; set: (k: string, v: string) => void;
  onSave: (k: string, valueOverride?: string) => void | Promise<void>;
}) {
  const rawHandle = (local[handleKey] ?? "").trim();
  const normalized = normalizeHandle(kind, rawHandle);
  const filled = !!normalized;
  const invalid = !!rawHandle && !normalized;
  const channelOn = (local[enableKey] ?? "1") === "1";
  const commitHandle = () => {
    if (rawHandle === normalized) { if (rawHandle) onSave(handleKey); return; }
    set(handleKey, normalized);
    onSave(handleKey, normalized);
  };
  const commitName = () => onSave(nameKey);
  const status = !channelOn ? { label: "OFF", cls: "bg-white/10 text-white/50 border-white/15" }
    : filled ? { label: "LIVE", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" }
    : invalid ? { label: "INVALID", cls: "bg-red-500/15 text-red-300 border-red-500/30" }
    : { label: "EMPTY", cls: "bg-white/10 text-white/50 border-white/15" };
  return (
    <div className={`rounded-md border p-3 space-y-2 ${channelOn ? "border-white/10 bg-white/[0.02]" : "border-white/5 bg-white/[0.01] opacity-70"}`}>
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-md flex items-center justify-center border border-white/10 bg-white/[0.03] text-white/70">
          <Icon className="w-4 h-4" />
        </span>
        <div className="text-sm font-medium">{label}</div>
        <Badge variant="outline" className={`ml-auto ${status.cls}`}>{status.label}</Badge>
        <Switch
          checked={channelOn}
          onCheckedChange={(v) => { set(enableKey, v ? "1" : "0"); setTimeout(() => onSave(enableKey, v ? "1" : "0"), 0); }}
          aria-label={`Enable ${label}`}
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Display name</label>
          <Input placeholder={label} value={local[nameKey] ?? ""}
            onChange={(e) => set(nameKey, e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="bg-white/5 border-white/10 font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">
            {kind === "whatsapp" ? "Phone number (with country code)" : "Username"}
          </label>
          <Input placeholder={handlePlaceholder} value={local[handleKey] ?? ""}
            onChange={(e) => set(handleKey, e.target.value)}
            onBlur={commitHandle}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`bg-white/5 border-white/10 font-mono text-xs ${invalid ? "border-red-500/50" : ""}`} />
          <div className="text-[11px] font-mono text-white/40 flex items-center gap-2">
            {filled ? (
              <>
                <span className="text-white/60">→ {displayHandle(kind, normalized)}</span>
                <span className="text-white/25">·</span>
                <a href={hrefFor(kind, normalized) || "#"} target="_blank" rel="noopener noreferrer"
                  className="text-white/50 hover:text-white truncate">{hrefFor(kind, normalized)}</a>
              </>
            ) : invalid ? (
              <span className="text-red-300">Invalid — check the format</span>
            ) : (
              <span className="text-white/30">{kind === "whatsapp" ? "Digits only, include country code" : "@ and URL prefix are stripped automatically"}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactPreview({ local }: { local: Record<string, string> }) {
  const items: Array<{ kind: Kind; name: string; accent: string; Icon: any; handle: string; href: string }> = [];
  const push = (kind: Kind, enableKey: string, nameKey: string, handleKey: string, fb: string, accent: string, Icon: any) => {
    if ((local[enableKey] ?? "1") !== "1") return;
    const h = normalizeHandle(kind, local[handleKey] ?? "");
    if (!h) return;
    items.push({ kind, name: (local[nameKey] ?? "").trim() || fb, accent, Icon, handle: displayHandle(kind, h), href: hrefFor(kind, h) });
  };
  push("telegram", "contact_tg_enabled", "contact_tg_name", "contact_tg_username", "Telegram", "#229ED9", Send);
  push("instagram", "contact_ig_enabled", "contact_ig_name", "contact_ig_username", "Instagram", "#E1306C", Instagram);
  push("whatsapp", "contact_wa_enabled", "contact_wa_name", "contact_wa_number", "WhatsApp", "#25D366", Phone);
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Live preview</div>
        <Badge variant="outline" className={items.length
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          : "bg-white/10 text-white/50 border-white/15"}>
          {items.length ? `${items.length} VISIBLE` : "HIDDEN ON SITE"}
        </Badge>
      </div>
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {items.map((c) => (
            <a key={c.kind} href={c.href} target="_blank" rel="noopener noreferrer"
              className="group flex items-center gap-2.5 rounded-full border bg-black/40 backdrop-blur px-3.5 py-2 transition hover:bg-black/60"
              style={{ borderColor: `${c.accent}55` }}>
              <span className="w-8 h-8 rounded-full flex items-center justify-center icon-glow"
                style={{ background: `${c.accent}22`, border: `1px solid ${c.accent}66`, color: c.accent, ["--glow-color" as any]: c.accent }}>
                <c.Icon className="w-4 h-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-[11px] font-mono uppercase tracking-widest text-white/50">{c.name}</span>
                <span className="text-xs text-white/90 font-medium">{c.handle}</span>
              </span>
            </a>
          ))}
        </div>
      ) : (
        <div className="text-center text-xs text-white/40 py-6 font-mono">
          Turn on any channel and fill a handle to publish it here.
        </div>
      )}
    </div>
  );
}

function ContactServerCheck({ local }: { local: Record<string, string> }) {
  const fetchPublic = useServerFn(getPublicContacts);
  const q = useQuery({
    queryKey: ["public-contacts", "admin-check"],
    queryFn: () => fetchPublic(),
    refetchInterval: 2000,
    staleTime: 0,
  });
  const dbg = q.data?.debug;
  const rows: Array<{ kind: Kind; enableKey: string; handleKey: string }> = [
    { kind: "telegram", enableKey: "contact_tg_enabled", handleKey: "contact_tg_username" },
    { kind: "instagram", enableKey: "contact_ig_enabled", handleKey: "contact_ig_username" },
    { kind: "whatsapp", enableKey: "contact_wa_enabled", handleKey: "contact_wa_number" },
  ];
  const mismatches: string[] = [];
  if (dbg) {
    for (const r of rows) {
      const localOn = (local[r.enableKey] ?? "1") === "1";
      const localHandle = normalizeHandle(r.kind, local[r.handleKey] ?? "");
      const remote = dbg.channels.find((c: any) => c.kind === r.kind);
      if (!remote) { mismatches.push(`${r.kind} row missing`); continue; }
      if (remote.enabled !== localOn) mismatches.push(`${r.kind} toggle`);
      if (remote.normalizedHandle !== localHandle) mismatches.push(`${r.kind} handle`);
    }
  }
  const ok = dbg && mismatches.length === 0;
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Server consistency check</div>
        <div className="flex items-center gap-2">
          {q.isFetching && <RefreshCw className="w-3 h-3 text-white/40 animate-spin" />}
          <Badge variant="outline" className={ok
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
            : "bg-amber-500/15 text-amber-300 border-amber-500/30"}>
            {q.isLoading ? "CHECKING…" : ok ? "IN SYNC" : `DRIFT: ${mismatches.join(", ").toUpperCase()}`}
          </Badge>
        </div>
      </div>
      {dbg && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-white/40 uppercase tracking-widest text-[10px]">
                <th className="text-left py-1 pr-3">Kind</th>
                <th className="text-left py-1 pr-3">Enabled</th>
                <th className="text-left py-1 pr-3">Handle → normalized</th>
                <th className="text-left py-1 pr-3">Public URL</th>
                <th className="text-left py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {dbg.channels.map((c: any) => (
                <tr key={c.kind} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 text-white/80">{c.kind}</td>
                  <td className="py-1.5 pr-3">
                    <span className={c.enabled ? "text-emerald-300" : "text-white/40"}>{c.enabled ? "on" : "off"}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-white/60">
                    {c.rawHandle ? <>{c.rawHandle} <span className="text-white/25">→</span> <span className="text-white/80">{c.display || "—"}</span></> : <span className="text-white/30">empty</span>}
                  </td>
                  <td className="py-1.5 pr-3 truncate max-w-[220px]">
                    {c.href ? <a className="text-white/60 hover:text-white" href={c.href} target="_blank" rel="noopener noreferrer">{c.href}</a> : <span className="text-white/30">—</span>}
                  </td>
                  <td className="py-1.5">
                    {c.visible
                      ? <span className="text-emerald-300">visible</span>
                      : <span className="text-amber-300">hidden · {c.reason.replace(/_/g, " ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {dbg.updatedAt && (
            <div className="mt-2 text-[10px] text-white/30 font-mono">Last write {new Date(dbg.updatedAt).toLocaleString()}</div>
          )}
        </div>
      )}
    </div>
  );
}
