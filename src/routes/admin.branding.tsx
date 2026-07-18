import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Palette, Type, Sparkles, MessageSquareText, RotateCcw, CheckCircle2, Save, Trash2, Undo2, ImageIcon, BookmarkPlus, Wand2 } from "lucide-react";
import {
  listBranding,
  setBranding,
  resetBranding,
  BRANDING_DEFAULTS,
  FONT_WHITELIST,
  listBrandingPresets,
  saveBrandingPreset,
  applyBrandingPreset,
  deleteBrandingPreset,
  undoLastBranding,
  peekBrandingHistory,
  type BrandingKey,
} from "@/lib/branding.functions";
import { useBrand } from "@/lib/branding-context";

export const Route = createFileRoute("/admin/branding")({
  ssr: false,
  head: () => ({ meta: [{ title: "Branding studio — Emberlord" }, { name: "robots", content: "noindex" }] }),
  component: BrandingStudio,
});

type Row = { key: BrandingKey; label: string; placeholder?: string; multiline?: boolean };

const IDENTITY: Row[] = [
  { key: "name_prefix", label: "Brand name — prefix", placeholder: "EMBER" },
  { key: "name_suffix", label: "Brand name — accent", placeholder: "LORD" },
  { key: "tagline", label: "Tagline" },
  { key: "browser_title", label: "Browser tab title" },
  { key: "meta_description", label: "Meta description (SEO)", multiline: true },
  { key: "footer_legal", label: "Footer legal line" },
];


const MESSAGES: Row[] = [
  { key: "hero_kicker", label: "Hero kicker (live badge)" },
  { key: "hero_headline_1", label: "Hero headline — line 1" },
  { key: "hero_headline_2", label: "Hero headline — line 2 (accent)" },
  { key: "hero_sub", label: "Hero sub-copy", multiline: true },
  { key: "code_card_title", label: "Code card title" },
  { key: "code_card_help", label: "Code card helper" },
  { key: "activate_cta", label: "Activate button" },
  { key: "section_features_kicker", label: "Features — kicker" },
  { key: "section_features_title_1", label: "Features — title A" },
  { key: "section_features_title_2", label: "Features — title B (accent)" },
  { key: "section_plan_kicker", label: "Plan — kicker" },
  { key: "section_plan_title_1", label: "Plan — title A" },
  { key: "section_plan_title_2", label: "Plan — title B (accent)" },
  { key: "section_devices_kicker", label: "Devices — kicker" },
  { key: "section_devices_title_1", label: "Devices — title A" },
  { key: "section_devices_title_2", label: "Devices — title B (accent)" },
  { key: "section_cta_title_1", label: "Bottom CTA — line A" },
  { key: "section_cta_title_2", label: "Bottom CTA — line B (accent)" },
  { key: "success_kicker", label: "Success overlay — kicker" },
  { key: "success_title", label: "Success overlay — title" },
  { key: "error_generic", label: "Generic activation error", multiline: true },
];

const WEIGHTS = ["300", "400", "500", "600", "700", "800"];

function BrandingStudio() {
  const list = useServerFn(listBranding);
  const save = useServerFn(setBranding);
  const reset = useServerFn(resetBranding);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["admin-branding"],
    queryFn: () => list(),
    refetchInterval: 2000,
  });

  const [dirty, setDirty] = useState<Partial<Record<BrandingKey, string>>>({});

  // When the query refreshes, drop any dirty keys that already match the server.
  useEffect(() => {
    if (!q.data) return;
    setDirty((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next) as BrandingKey[]) {
        if (q.data!.branding[k] === next[k]) delete next[k];
      }
      return next;
    });
  }, [q.data]);

  const values: Record<BrandingKey, string> = useMemo(() => {
    const base = q.data?.branding ?? (BRANDING_DEFAULTS as Record<BrandingKey, string>);
    return { ...base, ...dirty } as Record<BrandingKey, string>;
  }, [q.data, dirty]);

  const mutate = useMutation({
    mutationFn: (v: { key: BrandingKey; value: string }) => save({ data: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["admin-branding"] });
      const prev = qc.getQueryData<any>(["admin-branding"]);
      qc.setQueryData<any>(["admin-branding"], (cur: any) =>
        cur ? { ...cur, branding: { ...cur.branding, [v.key]: v.value } } : cur,
      );
      qc.setQueryData<any>(["public-branding"], (cur: any) =>
        cur ? { ...cur, branding: { ...cur.branding, [v.key]: v.value } } : cur,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-branding"], ctx.prev);
      toast.error("Save failed", { description: "Reverted." });
    },
    onSuccess: (r) => {
      setDirty((prev) => {
        const next = { ...prev };
        delete next[r.key as BrandingKey];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["public-branding"] });
      toast.success("Saved", { description: r.key });
    },
  });

  const resetOne = useMutation({
    mutationFn: (key: BrandingKey) => reset({ data: { key } }),
    onSuccess: () => {
      toast.success("Reset to default");
      qc.invalidateQueries({ queryKey: ["admin-branding"] });
      qc.invalidateQueries({ queryKey: ["public-branding"] });
    },
  });

  function commit(key: BrandingKey, value: string) {
    mutate.mutate({ key, value });
  }
  function stage(key: BrandingKey, value: string) {
    setDirty((p) => ({ ...p, [key]: value }));
  }

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Palette className="w-4 h-4 text-[#ff2a3a]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">// Live brand</span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight">Branding studio</h1>
          <p className="text-white/55 text-sm mt-2 max-w-xl">
            Every field commits on blur and pushes to the live site in under 2 seconds.
            Font families, accent, glow and shine are wired to CSS variables — no page reload needed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`border-none ${dirtyCount ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
            {dirtyCount ? `${dirtyCount} unsaved` : "All synced"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!confirm("Reset ALL branding to defaults? This clears every field.")) return;
              reset({ data: {} }).then(() => {
                qc.invalidateQueries({ queryKey: ["admin-branding"] });
                qc.invalidateQueries({ queryKey: ["public-branding"] });
                toast.success("Reset to defaults");
              });
            }}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-2" /> Reset all
          </Button>
        </div>
      </header>

      <LivePreview />

      <Tabs defaultValue="identity" className="w-full">
        <TabsList className="bg-black/40 border border-white/10">
          <TabsTrigger value="identity"><Palette className="w-3.5 h-3.5 mr-2" />Identity</TabsTrigger>
          <TabsTrigger value="messages"><MessageSquareText className="w-3.5 h-3.5 mr-2" />Messages</TabsTrigger>
          <TabsTrigger value="typography"><Type className="w-3.5 h-3.5 mr-2" />Typography</TabsTrigger>
          <TabsTrigger value="effects"><Sparkles className="w-3.5 h-3.5 mr-2" />Effects</TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="mt-4">
          <Section title="Site identity" desc="Wordmark, tab title, and legal footer.">
            <FieldGrid rows={IDENTITY} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} />
          </Section>
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <Section title="Site copy" desc="Every visible headline, section kicker, CTA and receipt message.">
            <FieldGrid rows={MESSAGES} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} />
          </Section>
        </TabsContent>

        <TabsContent value="typography" className="mt-4">
          <Section title="Typography" desc="Curated Google Fonts — display for headlines, body for copy, mono for tickers/codes.">
            <div className="grid md:grid-cols-3 gap-6">
              <FontPicker label="Display font" fontKey="font_display" weightKey="font_display_weight"
                values={values} commit={commit} resetOne={resetOne.mutate} showWeight />
              <FontPicker label="Body font" fontKey="font_body" weightKey="font_body_weight"
                values={values} commit={commit} resetOne={resetOne.mutate} showWeight />
              <FontPicker label="Mono font" fontKey="font_mono" values={values} commit={commit} resetOne={resetOne.mutate} />
            </div>
            <div className="mt-6">
              <Label>Letter spacing</Label>
              <div className="flex gap-2 mt-2">
                {(["tight", "normal", "loose"] as const).map((s) => (
                  <Button key={s} variant={values.letter_spacing === s ? "default" : "outline"} size="sm"
                    onClick={() => commit("letter_spacing", s)}>{s}</Button>
                ))}
              </div>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="effects" className="mt-4">
          <Section title="Accent, glow, and shine" desc="Applied live via CSS variables. Everything animates smoothly.">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <Label>Accent color</Label>
                <div className="flex items-center gap-3 mt-2">
                  <input type="color" value={values.accent_hex}
                    onChange={(e) => stage("accent_hex", e.target.value)}
                    onBlur={(e) => commit("accent_hex", e.target.value)}
                    className="w-14 h-10 rounded border border-white/10 bg-transparent cursor-pointer" />
                  <Input value={values.accent_hex}
                    onChange={(e) => stage("accent_hex", e.target.value)}
                    onBlur={(e) => commit("accent_hex", e.target.value)}
                    className="font-mono max-w-[160px]" />
                  <Button size="sm" variant="ghost" onClick={() => resetOne.mutate("accent_hex")}>
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-white/40 mt-1">Drives buttons, kickers, wordmark accent, and glow.</p>
              </div>

              <div>
                <Label>Glow intensity — {values.glow}%</Label>
                <Slider className="mt-3" min={0} max={100} step={1} value={[parseInt(values.glow, 10) || 0]}
                  onValueChange={(v) => stage("glow", String(v[0]))}
                  onValueCommit={(v) => commit("glow", String(v[0]))} />
              </div>

              <div>
                <Label>Shine speed</Label>
                <div className="flex gap-2 mt-2">
                  {(["off", "slow", "medium", "fast"] as const).map((s) => (
                    <Button key={s} variant={values.shine_speed === s ? "default" : "outline"} size="sm"
                      onClick={() => commit("shine_speed", s)}>{s}</Button>
                  ))}
                </div>
              </div>

              <div>
                <Label>Wordmark pulse</Label>
                <div className="flex items-center gap-3 mt-3">
                  <Switch checked={values.wordmark_pulse === "1"}
                    onCheckedChange={(v) => commit("wordmark_pulse", v ? "1" : "0")} />
                  <span className="text-sm text-white/60">Animate the wordmark glow</span>
                </div>
              </div>
            </div>
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="glass p-6">
      <div className="mb-5">
        <h2 className="font-display text-xl">{title}</h2>
        {desc && <p className="text-white/55 text-sm mt-1">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function FieldGrid({
  rows, values, stage, commit, resetOne,
}: {
  rows: Row[];
  values: Record<BrandingKey, string>;
  stage: (k: BrandingKey, v: string) => void;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-5">
      {rows.map((r) => {
        const isDefault = values[r.key] === BRANDING_DEFAULTS[r.key];
        return (
          <div key={r.key}>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor={r.key}>{r.label}</Label>
              {!isDefault && (
                <button
                  onClick={() => resetOne(r.key)}
                  className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition"
                >reset</button>
              )}
            </div>
            {r.multiline ? (
              <Textarea id={r.key}
                value={values[r.key] ?? ""}
                onChange={(e) => stage(r.key, e.target.value)}
                onBlur={(e) => commit(r.key, e.target.value)}
                placeholder={r.placeholder ?? BRANDING_DEFAULTS[r.key]}
                rows={3}
                className="bg-black/40 border-white/10" />
            ) : (
              <Input id={r.key}
                value={values[r.key] ?? ""}
                onChange={(e) => stage(r.key, e.target.value)}
                onBlur={(e) => commit(r.key, e.target.value)}
                placeholder={r.placeholder ?? BRANDING_DEFAULTS[r.key]}
                className="bg-black/40 border-white/10" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FontPicker({
  label, fontKey, weightKey, values, commit, resetOne, showWeight,
}: {
  label: string;
  fontKey: BrandingKey;
  weightKey?: BrandingKey;
  values: Record<BrandingKey, string>;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
  showWeight?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label>{label}</Label>
        <button onClick={() => resetOne(fontKey)} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white">reset</button>
      </div>
      <Select value={values[fontKey]} onValueChange={(v) => commit(fontKey, v)}>
        <SelectTrigger className="bg-black/40 border-white/10"><SelectValue /></SelectTrigger>
        <SelectContent>
          {FONT_WHITELIST.map((f) => (
            <SelectItem key={f} value={f}>
              <span style={{ fontFamily: `"${f}"` }}>{f}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showWeight && weightKey && (
        <div className="mt-3">
          <Label className="text-[10px]">Weight</Label>
          <Select value={values[weightKey]} onValueChange={(v) => commit(weightKey, v)}>
            <SelectTrigger className="mt-2 bg-black/40 border-white/10"><SelectValue /></SelectTrigger>
            <SelectContent>{WEIGHTS.map((w) => (<SelectItem key={w} value={w}>{w}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      )}
      <div className="mt-3 p-3 rounded border border-white/10 bg-black/30">
        <div style={{ fontFamily: `"${values[fontKey]}"`, fontWeight: showWeight ? values[weightKey ?? fontKey] : 400 }}
          className="text-lg leading-tight">Aa 8-digit code · Netflix</div>
      </div>
    </div>
  );
}

/** Live mini-preview of the public hero using the current branding state. */
function LivePreview() {
  const b = useBrand();
  return (
    <div className="glass p-8 relative overflow-hidden">
      <div className="absolute top-3 right-3 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> Live
      </div>
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-xs text-white/75 mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse" />
          <span className="font-mono uppercase tracking-widest">{b.hero_kicker}</span>
        </div>
        <div className="font-display text-4xl md:text-5xl leading-[0.98] tracking-tight wordmark-pulse">
          {b.name_prefix}<span className="text-brand-accent">{b.name_suffix}</span>
        </div>
        <div className="mt-3 font-display text-xl md:text-2xl text-white/85">
          {b.hero_headline_1} <span className="text-brand-accent">{b.hero_headline_2}</span>
        </div>
        <p className="mt-3 text-white/60 text-sm max-w-md mx-auto">{b.hero_sub}</p>
        <button className="mt-5 px-6 py-2.5 rounded-md text-sm font-medium text-white"
          style={{ background: `linear-gradient(135deg, var(--brand-accent), color-mix(in oklab, var(--brand-accent) 60%, black))` }}>
          {b.activate_cta}
        </button>
      </div>
    </div>
  );
}
