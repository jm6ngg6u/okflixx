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
import { Palette, Type, Sparkles, MessageSquareText, RotateCcw, CheckCircle2, Save, Trash2, Undo2, ImageIcon, BookmarkPlus, Wand2, Upload, LogIn } from "lucide-react";
import { useRef } from "react";
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
  { key: "login_kicker", label: "Login — card kicker" },
  { key: "login_title", label: "Login — card title" },
  { key: "login_subtitle", label: "Login — card subtitle" },
  { key: "login_tagline_1", label: "Login — hero tagline (white)" },
  { key: "login_tagline_2", label: "Login — hero tagline (accent)" },
  { key: "login_description", label: "Login — hero description", multiline: true },
  { key: "login_button", label: "Login — button label" },
  { key: "login_button_busy", label: "Login — button (loading)" },
  { key: "login_footer_prompt", label: "Login — footer prompt" },
  { key: "login_footer_cta", label: "Login — footer CTA" },
  { key: "login_status", label: "Login — status pill" },
  { key: "login_error_title", label: "Login — error title" },
  { key: "login_error_hint", label: "Login — error hint / help copy", multiline: true },
  { key: "login_help_url", label: "Login — help link URL", placeholder: "https://…" },
  { key: "login_help_label", label: "Login — help link label" },
  { key: "login_expected_origin", label: "Login — expected origin (env check)", placeholder: "https://your-site.lovable.app" },
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
          <UndoButton />
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
        <TabsList className="bg-black/40 border border-white/10 flex-wrap">
          <TabsTrigger value="identity"><Palette className="w-3.5 h-3.5 mr-2" />Identity</TabsTrigger>
          <TabsTrigger value="assets"><ImageIcon className="w-3.5 h-3.5 mr-2" />Assets</TabsTrigger>
          <TabsTrigger value="messages"><MessageSquareText className="w-3.5 h-3.5 mr-2" />Messages</TabsTrigger>
          <TabsTrigger value="typography"><Type className="w-3.5 h-3.5 mr-2" />Typography</TabsTrigger>
          <TabsTrigger value="effects"><Sparkles className="w-3.5 h-3.5 mr-2" />Effects</TabsTrigger>
          <TabsTrigger value="presets"><Wand2 className="w-3.5 h-3.5 mr-2" />Presets</TabsTrigger>
        </TabsList>


        <TabsContent value="identity" className="mt-4">
          <Section title="Site identity" desc="Wordmark, tab title, and legal footer. Tab title updates instantly in every open browser tab.">
            <FieldGrid rows={IDENTITY} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} />
          </Section>
        </TabsContent>

        <TabsContent value="assets" className="mt-4">
          <Section title="Logo & favicon" desc="Paste an https URL, a same-origin path (/favicon.png), or a data URL. Changes appear across the site and browser tab within 2 seconds.">
            <AssetsPanel values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} />
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

        <TabsContent value="presets" className="mt-4">
          <Section title="Theme presets" desc="Snapshot the current look as a named preset. Apply any preset instantly across the whole site.">
            <PresetsPanel />
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

/** Live mini-preview of the public hero AND login card using current branding.
 *  Toggle switches between "Home hero" and "Login card" so admins can see
 *  every font/color/glow/shine change on the login page BEFORE it goes live —
 *  no round-trip to /login needed. */
function LivePreview() {
  const b = useBrand();
  const [view, setView] = useState<"home" | "login">("home");
  return (
    <div className="glass p-6 md:p-8 relative overflow-hidden">
      <div className="absolute top-3 right-3 flex items-center gap-3 text-[10px] uppercase tracking-widest">
        <span className="flex items-center gap-1.5 text-emerald-300">
          <CheckCircle2 className="w-3 h-3" /> Live
        </span>
      </div>

      <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-black/40 p-1">
        <button
          onClick={() => setView("home")}
          className={`px-3 py-1.5 rounded-md text-[11px] uppercase tracking-widest transition ${
            view === "home" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
          }`}
        >
          <Palette className="w-3 h-3 inline mr-1.5" />Home hero
        </button>
        <button
          onClick={() => setView("login")}
          className={`px-3 py-1.5 rounded-md text-[11px] uppercase tracking-widest transition ${
            view === "login" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"
          }`}
        >
          <LogIn className="w-3 h-3 inline mr-1.5" />Login card
        </button>
      </div>

      {view === "home" ? (
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] text-xs text-white/75 mb-4"
            style={{ fontFamily: "var(--brand-font-body)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse" />
            <span className="font-mono uppercase tracking-widest">{b.hero_kicker}</span>
          </div>
          <div className="font-display text-4xl md:text-5xl leading-[0.98] tracking-tight wordmark-pulse"
            style={{ fontFamily: "var(--brand-font-display)", fontWeight: b.font_display_weight }}>
            {b.name_prefix}<span className="text-brand-accent">{b.name_suffix}</span>
          </div>
          <div className="mt-3 font-display text-xl md:text-2xl text-white/85"
            style={{ fontFamily: "var(--brand-font-display)" }}>
            {b.hero_headline_1} <span className="text-brand-accent">{b.hero_headline_2}</span>
          </div>
          <p className="mt-3 text-white/60 text-sm max-w-md mx-auto"
            style={{ fontFamily: "var(--brand-font-body)" }}>{b.hero_sub}</p>
          <button className="mt-5 px-6 py-2.5 rounded-md text-sm font-medium text-white"
            style={{
              background: `linear-gradient(135deg, var(--brand-accent), color-mix(in oklab, var(--brand-accent) 60%, black))`,
              boxShadow: `0 0 ${20 + parseInt(b.glow) / 2}px color-mix(in oklab, var(--brand-accent) ${b.glow}%, transparent)`,
              fontFamily: "var(--brand-font-body)",
            }}>
            {b.activate_cta}
          </button>
        </div>
      ) : (
        <LoginPreview b={b} />
      )}
    </div>
  );
}

/** Miniature of the /login card + hero — reflects font/color/glow/shine
 *  in real time from the branding CSS variables. */
function LoginPreview({ b }: { b: BrandingMap }) {
  const glowPx = 12 + parseInt(b.glow || "0") / 2;
  const shineOn = b.shine_speed !== "off";
  const logo = b.logo_url;
  return (
    <div className="grid md:grid-cols-[1.1fr_1fr] gap-6 items-center">
      {/* Hero side */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-black to-[#120608] p-6 min-h-[280px] flex flex-col items-center justify-center text-center relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--brand-accent) 22%, transparent), transparent 65%)` }} />
        {logo ? (
          <div className="relative w-20 h-20 mb-3">
            <img src={logo} alt="" className="w-full h-full object-contain"
              style={{ filter: `drop-shadow(0 0 ${glowPx}px color-mix(in oklab, var(--brand-accent) 80%, transparent))` }}
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0.15")} />
            {shineOn && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  WebkitMaskImage: `url(${JSON.stringify(logo)})`,
                  maskImage: `url(${JSON.stringify(logo)})`,
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  background: `linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.85) 50%, transparent 70%)`,
                  backgroundSize: "300% 100%",
                  animation: `preview-shine var(--brand-shine-duration, 4.8s) linear infinite`,
                }}
              />
            )}
          </div>
        ) : null}
        <div className="text-2xl leading-tight tracking-tight"
          style={{ fontFamily: "var(--brand-font-display)", fontWeight: b.font_display_weight }}>
          {b.login_tagline_1} <span style={{ color: "var(--brand-accent)" }}>{b.login_tagline_2}</span>
        </div>
        <p className="mt-2 text-white/60 text-xs max-w-xs" style={{ fontFamily: "var(--brand-font-body)" }}>
          {b.login_description}
        </p>
        <style>{`@keyframes preview-shine { 0% { background-position: 200% 0 } 100% { background-position: -100% 0 } }`}</style>
      </div>
      {/* Login card side */}
      <div className="rounded-xl border border-white/10 bg-[#0b0b0d]/95 p-5"
        style={{ boxShadow: `0 20px 60px -20px color-mix(in oklab, var(--brand-accent) 35%, transparent)` }}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--brand-accent)", fontFamily: "var(--brand-font-display)" }}>
          {b.login_kicker}
        </div>
        <h3 className="mt-2 text-xl font-bold tracking-tight"
          style={{ fontFamily: "var(--brand-font-display)", fontWeight: b.font_display_weight }}>
          {b.login_title}
        </h3>
        <p className="mt-1 text-xs text-white/60" style={{ fontFamily: "var(--brand-font-body)" }}>
          {b.login_subtitle}
        </p>
        <button className="mt-4 w-full py-2.5 rounded-lg text-sm font-medium text-white relative overflow-hidden"
          style={{
            background: `linear-gradient(180deg, var(--brand-accent), color-mix(in oklab, var(--brand-accent) 55%, black))`,
            boxShadow: `0 0 ${glowPx}px color-mix(in oklab, var(--brand-accent) ${b.glow}%, transparent)`,
            fontFamily: "var(--brand-font-body)",
          }}>
          {b.login_button}
        </button>
        <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-white/40"
          style={{ fontFamily: "var(--brand-font-body)" }}>
          Encrypted · One-tap · No password
        </p>
        <p className="mt-3 text-center text-[11px] text-white/50" style={{ fontFamily: "var(--brand-font-body)" }}>
          {b.login_footer_prompt}{" "}
          <span style={{ color: "var(--brand-accent)" }}>{b.login_footer_cta}</span>
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-white/45"
          style={{ fontFamily: "var(--brand-font-body)" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {b.login_status}
        </div>
      </div>
    </div>
  );
}

// -------------------------- Undo / Presets / Assets --------------------------

function UndoButton() {
  const undo = useServerFn(undoLastBranding);
  const peek = useServerFn(peekBrandingHistory);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["branding-history-peek"],
    queryFn: () => peek(),
    refetchInterval: 4000,
  });
  const hasHistory = (q.data?.entries?.length ?? 0) > 0;
  const last = q.data?.entries?.[0];
  const m = useMutation({
    mutationFn: () => undo(),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error("Nothing to undo");
        return;
      }
      qc.invalidateQueries({ queryKey: ["admin-branding"] });
      qc.invalidateQueries({ queryKey: ["public-branding"] });
      qc.invalidateQueries({ queryKey: ["branding-history-peek"] });
      toast.success("Reverted last branding change");
    },
    onError: () => toast.error("Undo failed"),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!hasHistory || m.isPending}
      onClick={() => m.mutate()}
      title={last ? `Undo: ${last.reason ?? "last change"} · ${new Date(last.created_at).toLocaleTimeString()}` : "No history"}
    >
      <Undo2 className="w-3.5 h-3.5 mr-2" />
      {m.isPending ? "Reverting…" : "Undo"}
    </Button>
  );
}

function AssetsPanel({
  values, stage, commit, resetOne,
}: {
  values: Record<BrandingKey, string>;
  stage: (k: BrandingKey, v: string) => void;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
}) {
  const fields: { key: BrandingKey; label: string; help: string }[] = [
    { key: "logo_url", label: "Main logo URL", help: "Shown in the header, footer, and login screen. Recommended: transparent PNG, 512×512." },
    { key: "favicon_url", label: "Favicon URL", help: "Browser tab icon. If empty, the main logo is used. Recommended: 96×96 PNG or SVG." },
  ];
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {fields.map((f) => {
        const v = values[f.key] ?? "";
        return (
          <div key={f.key}>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor={f.key}>{f.label}</Label>
              {v && (
                <button onClick={() => resetOne(f.key)} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white">clear</button>
              )}
            </div>
            <Input
              id={f.key}
              value={v}
              onChange={(e) => stage(f.key, e.target.value)}
              onBlur={(e) => commit(f.key, e.target.value)}
              placeholder="https://... or /favicon.png"
              className="bg-black/40 border-white/10 font-mono text-sm"
            />
            <p className="text-[11px] text-white/40 mt-1">{f.help}</p>
            <div className="mt-3 aspect-[3/1] rounded border border-white/10 bg-[radial-gradient(circle_at_center,rgba(255,42,58,0.12),transparent_70%)] bg-black/40 flex items-center justify-center overflow-hidden">
              {v ? (
                <img
                  src={v}
                  alt={f.label + " preview"}
                  className="max-h-24 max-w-[70%] object-contain drop-shadow-[0_0_18px_rgba(255,42,58,0.4)]"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    const parent = (e.currentTarget as HTMLImageElement).parentElement;
                    if (parent && !parent.querySelector(".asset-err")) {
                      const s = document.createElement("span");
                      s.className = "asset-err text-[11px] text-rose-300 uppercase tracking-widest";
                      s.textContent = "Image failed to load";
                      parent.appendChild(s);
                    }
                  }}
                />
              ) : (
                <span className="text-[11px] text-white/40 uppercase tracking-widest">No image · using default</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PresetsPanel() {
  const listP = useServerFn(listBrandingPresets);
  const saveP = useServerFn(saveBrandingPreset);
  const applyP = useServerFn(applyBrandingPreset);
  const deleteP = useServerFn(deleteBrandingPreset);
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const q = useQuery({
    queryKey: ["branding-presets"],
    queryFn: () => listP(),
    refetchInterval: 4000,
  });

  const save = useMutation({
    mutationFn: (n: string) => saveP({ data: { name: n } }),
    onSuccess: (r) => {
      toast.success(`Saved preset "${r.name}"`);
      setName("");
      qc.invalidateQueries({ queryKey: ["branding-presets"] });
    },
    onError: () => toast.error("Save failed"),
  });

  const apply = useMutation({
    mutationFn: (id: string) => applyP({ data: { id } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin-branding"] });
      qc.invalidateQueries({ queryKey: ["public-branding"] });
      qc.invalidateQueries({ queryKey: ["branding-history-peek"] });
      toast.success(`Applied "${r.name}"`);
    },
    onError: () => toast.error("Apply failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteP({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branding-presets"] });
      toast.success("Preset removed");
    },
  });

  const presets = q.data?.presets ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name (e.g. Midnight Ember, Neon Ice)"
          className="bg-black/40 border-white/10"
          maxLength={64}
        />
        <Button
          onClick={() => {
            const n = name.trim();
            if (!n) return toast.error("Give the preset a name");
            save.mutate(n);
          }}
          disabled={save.isPending}
          className="whitespace-nowrap"
        >
          <BookmarkPlus className="w-4 h-4 mr-2" />
          {save.isPending ? "Saving…" : "Save current as preset"}
        </Button>
      </div>

      {presets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/30 p-8 text-center">
          <p className="text-sm text-white/50">No presets yet.</p>
          <p className="text-[11px] text-white/30 mt-1 uppercase tracking-widest">Save your first look above.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map((p: any) => {
            const d = p.data as Record<string, string>;
            const accent = d.accent_hex || "#ff2a3a";
            const nameFull = `${d.name_prefix ?? ""}${d.name_suffix ?? ""}`;
            return (
              <div
                key={p.id}
                className="relative rounded-lg border border-white/10 bg-black/40 p-4 hover:border-white/25 transition group"
              >
                <div
                  className="absolute inset-x-0 top-0 h-1 rounded-t-lg"
                  style={{ background: `linear-gradient(90deg, ${accent}, transparent 80%)` }}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-base truncate">{p.name}</div>
                    <div className="text-[10px] uppercase tracking-widest text-white/40">
                      Saved {new Date(p.updated_at).toLocaleString()}
                    </div>
                  </div>
                  <span
                    className="h-6 w-6 rounded-full border border-white/10 flex-shrink-0"
                    style={{ background: accent, boxShadow: `0 0 12px ${accent}80` }}
                  />
                </div>

                <div
                  className="mt-3 rounded border border-white/5 bg-[#050505] p-3"
                  style={{ fontFamily: `"${d.font_display ?? "Sora"}"` }}
                >
                  <div className="text-lg leading-tight tracking-tight">
                    {(d.name_prefix ?? "EMBER") + (d.name_suffix ?? "LORD") || nameFull}
                  </div>
                  <div className="text-[11px] text-white/40 truncate" style={{ fontFamily: `"${d.font_body ?? "Inter"}"` }}>
                    {d.tagline ?? BRANDING_DEFAULTS.tagline}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => apply.mutate(p.id)}
                    disabled={apply.isPending}
                    className="flex-1"
                  >
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Delete preset "${p.name}"?`)) del.mutate(p.id);
                    }}
                    aria-label={`Delete preset ${p.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-300" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-white/40">
        Tip: use presets for seasonal launches (Halloween, Summer, Launch Day). Undo in the header reverts the very last change if a preset looks wrong.
      </p>
    </div>
  );
}

