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
import { Palette, Type, Sparkles, MessageSquareText, RotateCcw, CheckCircle2, Save, Trash2, Undo2, ImageIcon, BookmarkPlus, Wand2, Upload, LogIn, Wrench } from "lucide-react";
import { MaintenanceView } from "@/components/MaintenanceScreen";
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
import { useBrand, type BrandingMap } from "@/lib/branding-context";

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


const HOME_MESSAGES: Row[] = [
  { key: "hero_kicker", label: "Hero kicker" },
  { key: "hero_headline_1", label: "Hero headline — line 1" },
  { key: "hero_headline_2", label: "Hero headline — line 2 (accent)" },
  { key: "hero_sub", label: "Hero sub-copy", multiline: true },
  // Code card title, helper, CTA + progress/error messages are system-owned. Not editable here.
  { key: "section_features_kicker", label: "Features — kicker" },
  { key: "section_features_title_1", label: "Features — title A" },
  { key: "section_features_title_2", label: "Features — title B (accent)" },
  { key: "section_features_sub", label: "Features — sub-copy", multiline: true },
  { key: "why_card_1_index", label: "Feature 1 — index" },
  { key: "why_card_1_icon", label: "Feature 1 — icon (emoji)" },
  { key: "why_card_1_title", label: "Feature 1 — title" },
  { key: "why_card_1_desc", label: "Feature 1 — short description", multiline: true },
  { key: "why_card_1_metric_value", label: "Feature 1 — metric value" },
  { key: "why_card_1_metric_label", label: "Feature 1 — metric label" },
  { key: "why_card_1_detail", label: "Feature 1 — detail (opens on click)", multiline: true },
  { key: "why_card_2_index", label: "Feature 2 — index" },
  { key: "why_card_2_icon", label: "Feature 2 — icon (emoji)" },
  { key: "why_card_2_title", label: "Feature 2 — title" },
  { key: "why_card_2_desc", label: "Feature 2 — short description", multiline: true },
  { key: "why_card_2_metric_value", label: "Feature 2 — metric value" },
  { key: "why_card_2_metric_label", label: "Feature 2 — metric label" },
  { key: "why_card_2_detail", label: "Feature 2 — detail (opens on click)", multiline: true },
  { key: "why_card_3_index", label: "Feature 3 — index" },
  { key: "why_card_3_icon", label: "Feature 3 — icon (emoji)" },
  { key: "why_card_3_title", label: "Feature 3 — title" },
  { key: "why_card_3_desc", label: "Feature 3 — short description", multiline: true },
  { key: "why_card_3_metric_value", label: "Feature 3 — metric value" },
  { key: "why_card_3_metric_label", label: "Feature 3 — metric label" },
  { key: "why_card_3_detail", label: "Feature 3 — detail (opens on click)", multiline: true },
  { key: "why_card_4_index", label: "Feature 4 — index" },
  { key: "why_card_4_icon", label: "Feature 4 — icon (emoji)" },
  { key: "why_card_4_title", label: "Feature 4 — title" },
  { key: "why_card_4_desc", label: "Feature 4 — short description", multiline: true },
  { key: "why_card_4_metric_value", label: "Feature 4 — metric value" },
  { key: "why_card_4_metric_label", label: "Feature 4 — metric label" },
  { key: "why_card_4_detail", label: "Feature 4 — detail (opens on click)", multiline: true },


  { key: "section_howto_kicker", label: "How it works — kicker" },
  { key: "section_howto_title_1", label: "How it works — title A" },
  { key: "section_howto_title_2", label: "How it works — title B (accent)" },
  { key: "section_howto_sub", label: "How it works — sub-copy", multiline: true },
  { key: "howto_step_1_icon", label: "Step 1 — icon (emoji)" },
  { key: "howto_step_1_title", label: "Step 1 — title" },
  { key: "howto_step_1_desc", label: "Step 1 — description", multiline: true },
  { key: "howto_step_1_detail", label: "Step 1 — expanded detail (dialog)", multiline: true },
  { key: "howto_step_2_icon", label: "Step 2 — icon (emoji)" },
  { key: "howto_step_2_title", label: "Step 2 — title" },
  { key: "howto_step_2_desc", label: "Step 2 — description", multiline: true },
  { key: "howto_step_2_detail", label: "Step 2 — expanded detail (dialog)", multiline: true },
  { key: "howto_step_3_icon", label: "Step 3 — icon (emoji)" },
  { key: "howto_step_3_title", label: "Step 3 — title" },
  { key: "howto_step_3_desc", label: "Step 3 — description", multiline: true },
  { key: "howto_step_3_detail", label: "Step 3 — expanded detail (dialog)", multiline: true },
  { key: "howto_step_4_icon", label: "Step 4 — icon (emoji)" },
  { key: "howto_step_4_title", label: "Step 4 — title" },
  { key: "howto_step_4_desc", label: "Step 4 — description", multiline: true },
  { key: "howto_step_4_detail", label: "Step 4 — expanded detail (dialog)", multiline: true },
  { key: "howto_step_5_icon", label: "Step 5 — icon (emoji)" },
  { key: "howto_step_5_title", label: "Step 5 — title" },
  { key: "howto_step_5_desc", label: "Step 5 — description", multiline: true },
  { key: "howto_step_5_detail", label: "Step 5 — expanded detail (dialog)", multiline: true },
  { key: "section_faq_kicker", label: "FAQ — kicker" },
  { key: "section_faq_title_1", label: "FAQ — title A" },
  { key: "section_faq_title_2", label: "FAQ — title B (accent)" },
  { key: "section_faq_sub", label: "FAQ — subtitle", multiline: true },
  { key: "faq_1_q", label: "FAQ 1 — question" },
  { key: "faq_1_a", label: "FAQ 1 — answer", multiline: true },
  { key: "faq_2_q", label: "FAQ 2 — question" },
  { key: "faq_2_a", label: "FAQ 2 — answer", multiline: true },
  { key: "faq_3_q", label: "FAQ 3 — question" },
  { key: "faq_3_a", label: "FAQ 3 — answer", multiline: true },
  { key: "faq_4_q", label: "FAQ 4 — question" },
  { key: "faq_4_a", label: "FAQ 4 — answer", multiline: true },
  { key: "faq_5_q", label: "FAQ 5 — question" },
  { key: "faq_5_a", label: "FAQ 5 — answer", multiline: true },
  { key: "faq_6_q", label: "FAQ 6 — question" },
  { key: "faq_6_a", label: "FAQ 6 — answer", multiline: true },
  { key: "section_cta_title_1", label: "Bottom CTA — line A" },
  { key: "section_cta_title_2", label: "Bottom CTA — line B (accent)" },
  { key: "success_kicker", label: "Success overlay — kicker" },
  { key: "success_title", label: "Success overlay — title" },
  // Live activation dashboard (metrics are system-owned; copy is editable)
  { key: "nav_link_live", label: "Nav — Live link label" },
  { key: "section_live_kicker", label: "Live feed — kicker" },
  { key: "section_live_title_1", label: "Live feed — title A" },
  { key: "section_live_title_2", label: "Live feed — title B (accent)" },
  { key: "section_live_sub", label: "Live feed — subtitle", multiline: true },
  { key: "section_live_pulse_label", label: "Live feed — pulse pill label" },
  { key: "section_live_today_label", label: "Live tile 1 — label (today)" },
  { key: "section_live_today_hint", label: "Live tile 1 — hint" },
  { key: "section_live_total_label", label: "Live tile 2 — label (total)" },
  { key: "section_live_total_hint", label: "Live tile 2 — hint" },
  { key: "section_live_rate_label", label: "Live tile 3 — label (rate)" },
  { key: "section_live_rate_hint", label: "Live tile 3 — hint" },
  { key: "section_live_footnote", label: "Live feed — footnote", multiline: true },
];

const LOGIN_MESSAGES: Row[] = [
  { key: "login_kicker", label: "Card kicker" },
  { key: "login_title", label: "Card title" },
  { key: "login_subtitle", label: "Card subtitle" },
  { key: "login_tagline_1", label: "Hero tagline (white)" },
  { key: "login_tagline_2", label: "Hero tagline (accent)" },
  { key: "login_description", label: "Hero description", multiline: true },
  { key: "login_button", label: "Button label" },
  { key: "login_button_busy", label: "Button (loading)" },
  { key: "login_footer_prompt", label: "Footer prompt" },
  { key: "login_footer_cta", label: "Footer CTA" },
  { key: "login_status", label: "Status pill" },
  { key: "login_error_title", label: "Error title" },
  { key: "login_error_hint", label: "Error hint / help copy", multiline: true },
  { key: "login_help_url", label: "Help link URL", placeholder: "https://…" },
  { key: "login_help_label", label: "Help link label" },
  { key: "login_expected_origin", label: "Expected origin (env check)", placeholder: "https://your-site.lovable.app" },
];

const MAINT_MESSAGES: Row[] = [
  { key: "maint_status_pill", label: "Status pill" },
  { key: "maint_headline", label: "Headline" },
  { key: "maint_message", label: "Body message", multiline: true },
  { key: "maint_countdown_label", label: "Countdown label" },
  { key: "maint_contacts_label", label: "Contacts kicker" },
];

const MESSAGES: Row[] = [...HOME_MESSAGES, ...LOGIN_MESSAGES, ...MAINT_MESSAGES];

const WEIGHTS = ["300", "400", "500", "600", "700", "800"];

// Map every branding key → human label so toasts / progress read cleanly.
const KEY_LABELS: Partial<Record<BrandingKey, string>> = (() => {
  const m: Partial<Record<BrandingKey, string>> = {};
  for (const r of [...IDENTITY, ...MESSAGES]) m[r.key] = r.label;
  m.font_display = "Display font";
  m.font_body = "Body font";
  m.font_mono = "Mono font";
  m.font_display_weight = "Display weight";
  m.font_body_weight = "Body weight";
  m.letter_spacing = "Letter spacing";
  m.accent_hex = "Accent color";
  m.glow = "Glow intensity";
  m.shine_speed = "Shine speed";
  m.wordmark_pulse = "Wordmark pulse";
  m.logo_url = "Main logo";
  m.favicon_url = "Favicon";
  m.maint_flash = "Logo flash halo";
  m.maint_shine = "Logo shine loop";
  m.maint_wordmark_glow = "Wordmark auto glow";
  m.maint_intensity = "Animation intensity";
  m.maint_font_scale = "Font size scale";
  return m;
})();
function labelFor(k: string) {
  return KEY_LABELS[k as BrandingKey] ?? k.replace(/_/g, " ");
}

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
    onError: (_e, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-branding"], ctx.prev);
      toast.error(`Couldn't save ${labelFor(v.key)}`, { description: "Change reverted." });
    },
    onSuccess: (r) => {
      setDirty((prev) => {
        const next = { ...prev };
        delete next[r.key as BrandingKey];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["public-branding"] });
      toast.success(`${labelFor(r.key)} updated`, { description: "Live on the site." });
    },
  });

  const resetOne = useMutation({
    mutationFn: (key: BrandingKey) => reset({ data: { key } }),
    onSuccess: (_r, key) => {
      toast.success(`${labelFor(key)} reset to default`);
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
          {mutate.isPending && (
            <Badge variant="outline" className="border-none bg-sky-500/15 text-sky-300 gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse" />
              Saving {labelFor((mutate.variables as any)?.key ?? "")}…
            </Badge>
          )}
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

      <Tabs defaultValue="home" className="w-full">
        <TabsList className="bg-black/40 border border-white/10 flex-wrap">
          <TabsTrigger value="home"><Palette className="w-3.5 h-3.5 mr-2" />Home page</TabsTrigger>
          <TabsTrigger value="login"><LogIn className="w-3.5 h-3.5 mr-2" />Login page</TabsTrigger>
          <TabsTrigger value="identity"><MessageSquareText className="w-3.5 h-3.5 mr-2" />Identity & SEO</TabsTrigger>
          <TabsTrigger value="assets"><ImageIcon className="w-3.5 h-3.5 mr-2" />Assets</TabsTrigger>
          <TabsTrigger value="typography"><Type className="w-3.5 h-3.5 mr-2" />Typography</TabsTrigger>
          <TabsTrigger value="effects"><Sparkles className="w-3.5 h-3.5 mr-2" />Effects</TabsTrigger>
          <TabsTrigger value="maintenance"><Wrench className="w-3.5 h-3.5 mr-2" />Maintenance</TabsTrigger>
          <TabsTrigger value="presets"><Wand2 className="w-3.5 h-3.5 mr-2" />Presets</TabsTrigger>
        </TabsList>

        <TabsContent value="home" className="mt-4 space-y-4">
          <PreviewFrame
            title="Home hero — live preview"
            subtitle="Kicker, wordmark, headline, CTA."
            icon={<Palette className="w-3.5 h-3.5" />}
          >
            <HomeHeroPreview b={values as unknown as BrandingMap} />
          </PreviewFrame>
          <SurfaceActionBar
            label="Home page"
            rows={HOME_MESSAGES}
            dirty={dirty}
            values={values}
            commit={commit}
            resetOne={resetOne.mutate}
          />
          <Section title="Home page copy" desc="Edit freely — nothing goes live until you press Save.">
            <FieldGrid rows={HOME_MESSAGES} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} autosave={false} />
          </Section>
        </TabsContent>

        <TabsContent value="login" className="mt-4 space-y-4">
          <PreviewFrame
            title="Login card — live preview"
            subtitle="Mascot glow, shine sweep, Google button, status pill."
            icon={<LogIn className="w-3.5 h-3.5" />}
          >
            <LoginPreview b={values as unknown as BrandingMap} />
          </PreviewFrame>
          <SurfaceActionBar
            label="Login page"
            rows={LOGIN_MESSAGES}
            dirty={dirty}
            values={values}
            commit={commit}
            resetOne={resetOne.mutate}
          />
          <Section title="Login page copy" desc="Edit freely — nothing goes live until you press Save.">
            <FieldGrid rows={LOGIN_MESSAGES} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} autosave={false} />
          </Section>
        </TabsContent>


        <TabsContent value="identity" className="mt-4">
          <Section title="Site identity" desc="Wordmark parts, browser tab title, SEO description and footer. Tab title updates in every open browser tab.">
            <FieldGrid rows={IDENTITY} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} />
          </Section>
        </TabsContent>

        <TabsContent value="assets" className="mt-4">
          <Section title="Logo & favicon" desc="Upload a file or paste an https / same-origin / data URL. Changes appear across the site and browser tab within 2 seconds.">
            <AssetsPanel values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} />
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

            <div className="mt-6 rounded-xl border border-white/10 p-4">
              <div className="text-[11px] font-mono uppercase tracking-widest text-white/50 mb-3">
                Global per-element size (%) — applies site-wide
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  ["size_wordmark_nav", "Nav wordmark"],
                  ["size_hero_kicker", "Hero kicker"],
                  ["size_hero_title", "Hero title"],
                  ["size_hero_sub", "Hero subheading"],
                  ["size_section_kicker", "Section kicker"],
                  ["size_section_title", "Section title"],
                  ["size_card_title", "Card title"],
                  ["size_body", "Body copy"],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <Label>{label} — {values[k] || "100"}%</Label>
                    <Slider className="mt-3" min={60} max={160} step={2}
                      value={[parseInt(values[k] || "100", 10) || 100]}
                      onValueChange={(v) => stage(k, String(v[0]))}
                      onValueCommit={(v) => commit(k, String(v[0]))} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-white/40 mt-3">
                Real-time — every branded surface (home, login, admin) scales instantly.
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-white/10 p-4">
              <div className="text-[11px] font-mono uppercase tracking-widest text-white/50 mb-3">
                Per-surface master scale (%) — multiplies every element on that page
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  ["home_scale", "Home page"],
                  ["login_scale", "Login page"],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <Label>{label} — {values[k] || "100"}%</Label>
                    <Slider className="mt-3" min={60} max={160} step={2}
                      value={[parseInt(values[k] || "100", 10) || 100]}
                      onValueChange={(v) => stage(k, String(v[0]))}
                      onValueCommit={(v) => commit(k, String(v[0]))} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-white/40 mt-3">
                Stacks with per-element sizes above. Maintenance page has its own scale in the Maintenance tab.
              </p>
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


        <TabsContent value="maintenance" className="mt-4 space-y-4">
          <MaintenancePreviewFrame values={values} />

          <SurfaceActionBar
            label="Maintenance page"
            rows={MAINT_MESSAGES}
            dirty={dirty}
            values={values}
            commit={commit}
            resetOne={resetOne.mutate}
          />
          <Section title="Maintenance copy" desc="Every string shown on the full-screen takeover.">
            <FieldGrid rows={MAINT_MESSAGES} values={values} stage={stage} commit={commit} resetOne={resetOne.mutate} autosave={false} />
          </Section>
          <Section title="Animation & size" desc="Toggle each effect independently, dial the intensity, and scale every message up or down for readability.">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <Label>Logo flash halo</Label>
                <div className="flex items-center gap-3 mt-3">
                  <Switch checked={values.maint_flash === "1"}
                    onCheckedChange={(v) => commit("maint_flash", v ? "1" : "0")} />
                  <span className="text-sm text-white/60">Pulsing accent halo behind the logo</span>
                </div>
              </div>
              <div>
                <Label>Logo shine loop</Label>
                <div className="flex items-center gap-3 mt-3">
                  <Switch checked={values.maint_shine === "1"}
                    onCheckedChange={(v) => commit("maint_shine", v ? "1" : "0")} />
                  <span className="text-sm text-white/60">Continuous drop-shadow shine on the logo</span>
                </div>
              </div>
              <div>
                <Label>Wordmark auto glow</Label>
                <div className="flex items-center gap-3 mt-3">
                  <Switch checked={values.maint_wordmark_glow === "1"}
                    onCheckedChange={(v) => commit("maint_wordmark_glow", v ? "1" : "0")} />
                  <span className="text-sm text-white/60">Breathing text-glow on the brand name</span>
                </div>
              </div>
              <div>
                <Label>Animation intensity — {values.maint_intensity}%</Label>
                <Slider className="mt-3" min={0} max={100} step={1}
                  value={[parseInt(values.maint_intensity, 10) || 0]}
                  onValueChange={(v) => stage("maint_intensity", String(v[0]))}
                  onValueCommit={(v) => commit("maint_intensity", String(v[0]))} />
                <p className="text-[11px] text-white/40 mt-2">0 = subtle, 100 = maximum glow & speed.</p>
              </div>
              <div className="md:col-span-2">
                <Label>Font size scale — {values.maint_font_scale}%</Label>
                <Slider className="mt-3" min={60} max={140} step={2}
                  value={[parseInt(values.maint_font_scale, 10) || 100]}
                  onValueChange={(v) => stage("maint_font_scale", String(v[0]))}
                  onValueCommit={(v) => commit("maint_font_scale", String(v[0]))} />
                <p className="text-[11px] text-white/40 mt-2">Scales every heading, message and label on the maintenance page — 100% keeps defaults.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <Label>Timezone</Label>
                <select
                  className="mt-2 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  value={values.maint_timezone || "UTC"}
                  onChange={(e) => commit("maint_timezone", e.target.value)}
                >
                  {[
                    "UTC","America/Los_Angeles","America/Denver","America/Chicago","America/New_York",
                    "America/Sao_Paulo","Europe/London","Europe/Paris","Europe/Berlin","Europe/Istanbul",
                    "Africa/Lagos","Africa/Cairo","Asia/Dubai","Asia/Karachi","Asia/Kolkata",
                    "Asia/Bangkok","Asia/Shanghai","Asia/Tokyo","Australia/Sydney","Pacific/Auckland",
                  ].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
                <p className="text-[11px] text-white/40 mt-1">Countdown end time is rendered in this timezone.</p>
              </div>
              <div>
                <Label>Clock format</Label>
                <select
                  className="mt-2 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  value={values.maint_time_format || "24h"}
                  onChange={(e) => commit("maint_time_format", e.target.value)}
                >
                  <option value="24h">24-hour</option>
                  <option value="12h">12-hour</option>
                </select>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-white/10 p-4">
              <div className="text-[11px] font-mono uppercase tracking-widest text-white/50 mb-3">Per-element size (%)</div>
              <div className="grid gap-4 md:grid-cols-2">
                {([
                  ["maint_size_status", "Status pill"],
                  ["maint_size_wordmark", "Wordmark"],
                  ["maint_size_headline", "Headline"],
                  ["maint_size_message", "Body message"],
                  ["maint_size_countdown", "Countdown"],
                  ["maint_size_contacts", "Contacts"],
                  ["maint_size_footer", "Footer"],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <Label>{label} — {values[k] || "100"}%</Label>
                    <Slider className="mt-3" min={60} max={160} step={2}
                      value={[parseInt(values[k] || "100", 10) || 100]}
                      onValueChange={(v) => stage(k, String(v[0]))}
                      onValueCommit={(v) => commit(k, String(v[0]))} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-white/40 mt-3">Multiplies with the global font scale above.</p>
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
  rows, values, stage, commit, resetOne, autosave = true,
}: {
  rows: Row[];
  values: Record<BrandingKey, string>;
  stage: (k: BrandingKey, v: string) => void;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
  autosave?: boolean;
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
                onBlur={autosave ? (e) => commit(r.key, e.target.value) : undefined}
                placeholder={r.placeholder ?? BRANDING_DEFAULTS[r.key]}
                rows={3}
                className="bg-black/40 border-white/10" />
            ) : (
              <Input id={r.key}
                value={values[r.key] ?? ""}
                onChange={(e) => stage(r.key, e.target.value)}
                onBlur={autosave ? (e) => commit(r.key, e.target.value) : undefined}
                placeholder={r.placeholder ?? BRANDING_DEFAULTS[r.key]}
                className="bg-black/40 border-white/10" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SurfaceActionBar({
  label, rows, dirty, values, commit, resetOne,
}: {
  label: string;
  rows: Row[];
  dirty: Partial<Record<BrandingKey, string>>;
  values: Record<BrandingKey, string>;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
}) {
  const pendingKeys = rows.filter((r) => dirty[r.key] !== undefined).map((r) => r.key);
  const resettableKeys = rows.filter((r) => values[r.key] !== BRANDING_DEFAULTS[r.key]).map((r) => r.key);
  const pending = pendingKeys.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/40 px-4 py-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono uppercase tracking-[0.25em] text-white/40">{label}</span>
        <Badge
          variant="outline"
          className={`border-none ${pending ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}
        >
          {pending ? `${pending} unsaved` : "All synced"}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={resettableKeys.length === 0}
          onClick={() => {
            if (!confirm(`Reset all ${label.toLowerCase()} fields to defaults?`)) return;
            resettableKeys.forEach((k) => resetOne(k));
          }}
        >
          <RotateCcw className="w-3.5 h-3.5 mr-2" /> Reset section
        </Button>
        <Button
          size="sm"
          disabled={pending === 0}
          onClick={() => {
            pendingKeys.forEach((k) => commit(k, dirty[k] as string));
          }}
          className="bg-[#ff2a3a] hover:bg-[#ff2a3a]/90 text-white"
        >
          Save {pending ? `(${pending})` : ""}
        </Button>
      </div>
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

function PreviewFrame({
  title, subtitle, icon, children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="glass relative overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-white/[0.06] text-brand-accent">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm leading-tight truncate">{title}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/40 truncate">{subtitle}</div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-300 shrink-0">
          <CheckCircle2 className="w-3 h-3" /> Live · updates every 2s
        </span>
      </div>
      <div className="p-6 md:p-7">{children}</div>
    </div>
  );
}

/** Maintenance preview with device (mobile/desktop) + identity (guest/user)
 *  toggles so admins can inspect both breakpoints and both audience states. */

function MaintenancePreviewFrame({ values }: { values: Record<string, string> }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [asUser, setAsUser] = useState(false);
  const width = device === "mobile" ? 390 : 1180;
  const height = device === "mobile" ? 720 : 620;

  const mockUser = asUser
    ? {
        email: "alex.chen@gmail.com",
        avatar:
          "https://lh3.googleusercontent.com/a/ACg8ocKQZ7lMxN6yZ4x9YvR2K3-preview-user",
        name: "Alex Chen",
      }
    : null;

  return (
    <PreviewFrame
      title="Maintenance page — live preview"
      subtitle="Toggle device + identity to inspect every audience state."
      icon={<Wrench className="w-3.5 h-3.5" />}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex rounded-md border border-white/10 bg-black/40 p-0.5">
          <button
            type="button"
            onClick={() => setDevice("desktop")}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest rounded ${
              device === "desktop" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setDevice("mobile")}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest rounded ${
              device === "mobile" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            Mobile
          </button>
        </div>
        <div className="inline-flex rounded-md border border-white/10 bg-black/40 p-0.5">
          <button
            type="button"
            onClick={() => setAsUser(false)}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest rounded ${
              !asUser ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            Guest
          </button>
          <button
            type="button"
            onClick={() => setAsUser(true)}
            className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest rounded ${
              asUser ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            Signed in (Google)
          </button>
        </div>
      </div>
      <div className="w-full overflow-x-auto">
        <div
          className="mx-auto rounded-2xl border border-white/10 bg-[#050505] overflow-hidden shadow-[0_20px_60px_-30px_rgba(255,42,58,0.5)]"
          style={{ width, maxWidth: "100%", height }}
        >
          <div className="h-full overflow-y-auto">
            <MaintenanceView
              b={values as unknown as BrandingMap}
              message={values.maint_message}
              remainingLabel="12m 34s"
              startsAt={new Date(Date.now() - 5 * 60_000).toISOString()}
              endsAt={new Date(Date.now() + 12 * 60_000 + 34_000).toISOString()}
              channels={[
                { kind: "telegram", name: "Telegram", href: "#" },
                { kind: "instagram", name: "Instagram", href: "#" },
                { kind: "whatsapp", name: "WhatsApp", href: "#" },
              ]}
              user={mockUser}
              compact={device === "mobile"}
            />
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}


function HomeHeroPreview({ b }: { b: BrandingMap }) {
  return (
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

/** File → data URL uploader with strict client-side validation.
 *  Data URLs are stored directly in branding — the server sanitizer allows
 *  data:image/* up to 200KB, so no bucket / no CORS / no signed URLs required. */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function AssetsPanel({
  values, stage, commit, resetOne,
}: {
  values: Record<BrandingKey, string>;
  stage: (k: BrandingKey, v: string) => void;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
}) {
  const fields: {
    key: BrandingKey;
    label: string;
    help: string;
    maxKb: number;
    accept: string;
  }[] = [
    {
      key: "logo_url",
      label: "Main logo",
      help: "Header · footer · login screen. Transparent PNG or SVG, 512×512 recommended.",
      maxKb: 180,
      accept: "image/png,image/jpeg,image/webp,image/svg+xml",
    },
    {
      key: "favicon_url",
      label: "Favicon",
      help: "Browser tab icon. Empty = uses main logo. PNG, SVG, or ICO, 96×96 recommended.",
      maxKb: 60,
      accept: "image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon",
    },
  ];
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {fields.map((f) => (
        <AssetField key={f.key} field={f} value={values[f.key] ?? ""} stage={stage} commit={commit} resetOne={resetOne} />
      ))}
    </div>
  );
}

function AssetField({
  field, value, stage, commit, resetOne,
}: {
  field: { key: BrandingKey; label: string; help: string; maxKb: number; accept: string };
  value: string;
  stage: (k: BrandingKey, v: string) => void;
  commit: (k: BrandingKey, v: string) => void;
  resetOne: (k: BrandingKey) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!field.accept.split(",").some((t) => file.type === t.trim())) {
      toast.error("Unsupported file", { description: `Use ${field.accept.replace(/image\//g, "").toUpperCase()}` });
      return;
    }
    if (file.size > field.maxKb * 1024) {
      toast.error("File too large", { description: `Max ${field.maxKb} KB (was ${Math.round(file.size / 1024)} KB)` });
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readAsDataURL(file);
      // Sanity — sanitizer will reject anything else, but bail early with a clearer message.
      if (!dataUrl.startsWith("data:image/")) throw new Error("not an image");
      commit(field.key, dataUrl);
      toast.success("Uploaded", { description: `${file.name} · ${Math.round(file.size / 1024)} KB` });
    } catch (err: any) {
      toast.error("Upload failed", { description: err?.message ?? "Try a smaller image" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label htmlFor={field.key}>{field.label}</Label>
        {value && (
          <button onClick={() => resetOne(field.key)} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white">
            clear
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          id={field.key}
          value={value}
          onChange={(e) => stage(field.key, e.target.value)}
          onBlur={(e) => commit(field.key, e.target.value)}
          placeholder="Paste URL or upload →"
          className="bg-black/40 border-white/10 font-mono text-xs flex-1"
        />
        <input ref={fileRef} type="file" accept={field.accept} onChange={handleFile} className="hidden" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="whitespace-nowrap"
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {uploading ? "Reading…" : "Upload"}
        </Button>
      </div>
      <p className="text-[11px] text-white/40 mt-1">{field.help} · Max {field.maxKb} KB.</p>

      {/* Masked glow / shine preview — matches the /login header exactly. */}
      <div className="mt-3 aspect-[3/1] rounded border border-white/10 bg-[radial-gradient(circle_at_center,color-mix(in_oklab,var(--brand-accent)_18%,transparent),transparent_70%)] bg-black/40 flex items-center justify-center overflow-hidden relative">
        {value ? (
          <div className="relative h-24 w-24">
            <img
              src={value}
              alt={field.label + " preview"}
              className="h-full w-full object-contain"
              style={{
                filter: `drop-shadow(0 0 18px color-mix(in oklab, var(--brand-accent) 80%, transparent))`,
              }}
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
            {/* Shine mask — clipped to the alpha of the uploaded logo. */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                WebkitMaskImage: `url(${JSON.stringify(value)})`,
                maskImage: `url(${JSON.stringify(value)})`,
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                background: `linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.85) 50%, transparent 70%)`,
                backgroundSize: "300% 100%",
                animation: `assets-shine var(--brand-shine-duration, 4.8s) linear infinite`,
              }}
            />
          </div>
        ) : (
          <span className="text-[11px] text-white/40 uppercase tracking-widest">No image · using default</span>
        )}
        <style>{`@keyframes assets-shine { 0% { background-position: 200% 0 } 100% { background-position: -100% 0 } }`}</style>
      </div>
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

