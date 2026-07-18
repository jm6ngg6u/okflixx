// Branding Studio: live-editable site name, messages, fonts and effects.
// All values are stored in app_settings with a "branding_" prefix. Public
// read is anon-safe and cached briefly; writes require admin and are audited.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// -------------------------- Defaults & schema --------------------------

export const BRANDING_DEFAULTS = {
  // Identity
  name_prefix: "EMBER",
  name_suffix: "LORD",
  tagline: "Command Netflix on any TV",
  browser_title: "Emberlord — Activate Netflix on any TV",
  logo_url: "/__l5e/assets-v1/48705337-395f-45fa-bb9b-b75a91db0e04/emberlord-logo.png",
  favicon_url: "/favicon.png",
  meta_description:
    "Enter your 8-digit code and stream Netflix instantly on any Smart TV, Apple TV, Roku, PS5 or Xbox. Encrypted, always-on, 2026-ready.",
  footer_legal: "© 2026 · Encrypted · Everywhere",
  // Messages
  hero_kicker: "Live · 82,431 TVs activated",
  hero_headline_1: "Stream Netflix",
  hero_headline_2: "on any TV instantly.",
  hero_sub:
    "Type your 8-digit TV code. We handle the rest — encrypted, latency-free, on every screen you own.",
  code_card_title: "Enter TV Code",
  code_card_help: "Find the 8-character code on your Netflix TV screen.",
  activate_cta: "Activate Now →",
  section_features_kicker: "// Why Emberlord",
  section_features_title_1: "Built for",
  section_features_title_2: "2026 TVs",
  section_plan_kicker: "// Access",
  section_plan_title_1: "One plan.",
  section_plan_title_2: "Free forever.",
  section_devices_kicker: "// Compatible",
  section_devices_title_1: "Every screen.",
  section_devices_title_2: "One code.",
  section_cta_title_1: "Ready to",
  section_cta_title_2: "press play?",
  success_title: "You're in.",
  success_kicker: "// Activation complete",
  error_generic: "We couldn't activate your TV right now. Please try again in a moment.",
  // Login page (Google-only)
  login_kicker: "Wield the trident",
  login_title: "Create Account",
  login_subtitle: "Join thousands of other operatives today.",
  login_tagline_1: "JOIN THE",
  login_tagline_2: "ELITE",
  login_description:
    "Create your account to access our private gateway and start activating Netflix on any Smart TV, Apple TV, Roku, or console.",
  login_button: "Continue with Google",
  login_button_busy: "Opening Google…",
  login_footer_prompt: "Already have security clearance?",
  login_footer_cta: "Login",
  login_status: "Gateway online",
  login_error_title: "Sign-in failed",
  login_error_hint:
    "Popups can be blocked in-browser. Try the full-page sign-in link or open this page in a new tab.",
  login_help_url: "",
  login_help_label: "Need help?",
  login_expected_origin: "",
  // Typography (whitelisted below)
  font_display: "Sora",
  font_body: "Inter",
  font_mono: "JetBrains Mono",
  font_display_weight: "700",
  font_body_weight: "400",
  // Effects
  accent_hex: "#ff2a3a",
  glow: "60", // 0..100
  shine_speed: "medium", // slow | medium | fast | off
  letter_spacing: "normal", // tight | normal | loose
  wordmark_pulse: "1", // "1" on / "0" off
  // Maintenance page
  maint_headline: "We'll be right back.",
  maint_message: "The service is temporarily paused for maintenance. Your session is safe — you'll be returned to the app the moment we're live again.",
  maint_countdown_label: "Estimated back in",
  maint_contacts_label: "// Reach us during downtime",
  maint_status_pill: "Maintenance in progress",
  maint_flash: "1",         // "1" on / "0" off — halo pulse behind logo
  maint_shine: "1",         // "1" on / "0" off — logo glow/shine loop
  maint_wordmark_glow: "1", // "1" on / "0" off — wordmark auto glow
  maint_intensity: "70",    // 0..100 — animation strength multiplier
  maint_font_scale: "100",  // 60..140 — global font size scale (%)
  // Timezone + clock formatting for the countdown / ends-at line.
  maint_timezone: "UTC",     // IANA
  maint_time_format: "24h",  // "24h" | "12h"
  // Per-element size overrides (percent, 60..160). Multiplies with maint_font_scale.
  maint_size_status: "100",
  maint_size_wordmark: "100",
  maint_size_headline: "100",
  maint_size_message: "100",
  maint_size_countdown: "100",
  maint_size_contacts: "100",
  maint_size_footer: "100",
  // Global site-wide typography size overrides (percent, 60..160).
  // Consumed by CSS variables `--brand-size-*` and utility classes in
  // styles.css. Change once → propagates to every branded surface.
  size_wordmark_nav: "100",
  size_hero_kicker: "100",
  size_hero_title: "100",
  size_hero_sub: "100",
  size_section_kicker: "100",
  size_section_title: "100",
  size_card_title: "100",
  size_body: "100",
  // Per-surface master scale (percent, 60..160). Multiplies every
  // --brand-size-* utility on that surface via --brand-surface-scale.
  home_scale: "100",
  login_scale: "100",
};


export type BrandingKey = keyof typeof BRANDING_DEFAULTS;
const KEYS = Object.keys(BRANDING_DEFAULTS) as BrandingKey[];

export const FONT_WHITELIST = [
  "Sora",
  "Inter",
  "Work Sans",
  "Space Grotesk",
  "Manrope",
  "Outfit",
  "Bricolage Grotesque",
  "Poppins",
  "DM Sans",
  "Plus Jakarta Sans",
  "Anton",
  "Bebas Neue",
  "Playfair Display",
  "Fraunces",
  "JetBrains Mono",
  "IBM Plex Mono",
  "Space Mono",
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SHINE = new Set(["slow", "medium", "fast", "off"]);
const SPACING = new Set(["tight", "normal", "loose"]);
const WEIGHTS = new Set(["300", "400", "500", "600", "700", "800"]);

function sanitize(key: BrandingKey, raw: string): string {
  const v = (raw ?? "").toString();
  if (key === "accent_hex") return HEX_RE.test(v) ? v.toLowerCase() : BRANDING_DEFAULTS.accent_hex;
  if (key === "shine_speed") return SHINE.has(v) ? v : BRANDING_DEFAULTS.shine_speed;
  if (key === "letter_spacing") return SPACING.has(v) ? v : BRANDING_DEFAULTS.letter_spacing;
  if (key === "glow") {
    const n = Math.max(0, Math.min(100, parseInt(v, 10)));
    return Number.isFinite(n) ? String(n) : BRANDING_DEFAULTS.glow;
  }
  if (key === "wordmark_pulse" || key === "maint_flash" || key === "maint_shine" || key === "maint_wordmark_glow") return v === "0" ? "0" : "1";
  if (key === "maint_intensity") {
    const n = Math.max(0, Math.min(100, parseInt(v, 10)));
    return Number.isFinite(n) ? String(n) : BRANDING_DEFAULTS.maint_intensity;
  }
  if (key === "maint_font_scale") {
    const n = Math.max(60, Math.min(140, parseInt(v, 10)));
    return Number.isFinite(n) ? String(n) : BRANDING_DEFAULTS.maint_font_scale;
  }
  if (
    key === "maint_size_status" || key === "maint_size_wordmark" ||
    key === "maint_size_headline" || key === "maint_size_message" ||
    key === "maint_size_countdown" || key === "maint_size_contacts" ||
    key === "maint_size_footer"
  ) {
    const n = Math.max(60, Math.min(160, parseInt(v, 10)));
    return Number.isFinite(n) ? String(n) : "100";
  }
  if (
    key === "size_wordmark_nav" || key === "size_hero_kicker" ||
    key === "size_hero_title" || key === "size_hero_sub" ||
    key === "size_section_kicker" || key === "size_section_title" ||
    key === "size_card_title" || key === "size_body" ||
    key === "home_scale" || key === "login_scale"
  ) {
    const n = Math.max(60, Math.min(160, parseInt(v, 10)));
    return Number.isFinite(n) ? String(n) : "100";
  }
  if (key === "maint_time_format") return v === "12h" ? "12h" : "24h";
  if (key === "maint_timezone") {
    const s = (v || "").trim();
    if (!s) return BRANDING_DEFAULTS.maint_timezone;
    try { new Intl.DateTimeFormat("en", { timeZone: s }); return s; } catch { return BRANDING_DEFAULTS.maint_timezone; }
  }
  if (key === "font_display" || key === "font_body" || key === "font_mono") {
    return (FONT_WHITELIST as readonly string[]).includes(v) ? v : BRANDING_DEFAULTS[key];
  }
  if (key === "font_display_weight" || key === "font_body_weight") {
    return WEIGHTS.has(v) ? v : BRANDING_DEFAULTS[key];
  }
  if (key === "logo_url" || key === "favicon_url") {
    const s = v.trim();
    if (!s) return "";
    // Allow http(s), same-origin absolute paths, data URLs (images only).
    if (/^https?:\/\//i.test(s) && s.length <= 512) return s;
    if (/^\/[^\s<>"']{0,511}$/.test(s)) return s;
    if (/^data:image\/(png|jpe?g|gif|svg\+xml|webp|x-icon|vnd\.microsoft\.icon);base64,[a-zA-Z0-9+/=]+$/.test(s) && s.length <= 200000) return s;
    return "";
  }
  // Free text — trim + clip. No HTML allowed; consumers render as text.
  return v.replace(/[<>]/g, "").slice(0, 240);
}


export type BrandingMap = Record<BrandingKey, string>;

function withDefaults(rows: { key: string; value: string }[] | null | undefined): BrandingMap {
  const out = { ...BRANDING_DEFAULTS } as BrandingMap;
  for (const r of rows ?? []) {
    const k = r.key.replace(/^branding_/, "") as BrandingKey;
    if (k in BRANDING_DEFAULTS) {
      const s = sanitize(k, r.value ?? "");
      if (s !== "") (out as any)[k] = s;
    }
  }
  return out;
}

// -------------------------- Server functions --------------------------

/** Anon-safe: full branding map, with defaults filled in for any missing key. */
export const getPublicBranding = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dbKeys = KEYS.map((k) => `branding_${k}`);
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value,updated_at")
    .in("key", dbKeys);
  const updatedAt = (data ?? []).reduce(
    (m, r: any) => Math.max(m, r.updated_at ? Date.parse(r.updated_at) : 0),
    0,
  );
  return { branding: withDefaults(data ?? []), updatedAt: updatedAt || Date.now(), fonts: FONT_WHITELIST };
});

/** Admin: same map + raw rows, for the editor. */
export const listBranding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const dbKeys = KEYS.map((k) => `branding_${k}`);
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("key,value,updated_at")
      .in("key", dbKeys);
    return {
      branding: withDefaults(data ?? []),
      defaults: BRANDING_DEFAULTS,
      fonts: FONT_WHITELIST,
    };
  });

/** Read the current full branding map (admin, no snapshot side-effect). */
async function readCurrentBranding(): Promise<Record<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const dbKeys = KEYS.map((k) => `branding_${k}`);
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("key,value")
    .in("key", dbKeys);
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[(r as any).key.replace(/^branding_/, "")] = (r as any).value ?? "";
  return map;
}

/** Snapshot current branding into history so a future Undo can restore it. */
async function snapshotBranding(userId: string, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const current = await readCurrentBranding();
  await supabaseAdmin.from("branding_history").insert({
    data: current,
    reason,
    created_by: userId,
  });
  // Keep only the most recent 20 entries.
  const { data: keep } = await supabaseAdmin
    .from("branding_history")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(20);
  const ids = (keep ?? []).map((r: any) => r.id);
  if (ids.length) {
    await supabaseAdmin.from("branding_history").delete().not("id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
  }
}

/** Admin: upsert a single branding key. Value is sanitized server-side. */
export const setBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string().min(1).max(64), value: z.string().max(200000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const shortKey = data.key.replace(/^branding_/, "") as BrandingKey;
    if (!(shortKey in BRANDING_DEFAULTS)) throw new Error("Unknown branding key");
    const clean = sanitize(shortKey, data.value);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Debounced snapshot: only if the last history entry is >30s old.
    const { data: last } = await supabaseAdmin
      .from("branding_history")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const stale = !last || Date.now() - Date.parse((last as any).created_at) > 30_000;
    if (stale) await snapshotBranding(userId, `edit:${shortKey}`);

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({
        key: `branding_${shortKey}`,
        value: clean,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      });
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: `branding.${shortKey}`,
      target: shortKey,
      details: { value: clean.length > 200 ? clean.slice(0, 200) + "…" : clean },
    });
    return { ok: true, key: shortKey, value: clean };
  });

/** Admin: reset a single key (or all) to defaults. */
export const resetBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.key) {
      const shortKey = data.key.replace(/^branding_/, "") as BrandingKey;
      if (!(shortKey in BRANDING_DEFAULTS)) throw new Error("Unknown branding key");
      await snapshotBranding(userId, `reset:${shortKey}`);
      await supabaseAdmin.from("app_settings").delete().eq("key", `branding_${shortKey}`);
      await supabaseAdmin.from("admin_activity_log").insert({
        admin_id: userId,
        action: `branding.reset`,
        target: shortKey,
      });
      return { ok: true, key: shortKey, value: BRANDING_DEFAULTS[shortKey] };
    }
    await snapshotBranding(userId, "reset_all");
    const dbKeys = KEYS.map((k) => `branding_${k}`);
    await supabaseAdmin.from("app_settings").delete().in("key", dbKeys);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: `branding.reset_all`,
    });
    return { ok: true };
  });

// -------------------------- Presets & Undo --------------------------

/** Admin: list saved presets. */
export const listBrandingPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("branding_presets")
      .select("id,name,data,updated_at,created_at")
      .order("updated_at", { ascending: false });
    return { presets: data ?? [] };
  });

/** Admin: save the CURRENT live branding as a named preset (creates or updates). */
export const saveBrandingPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await readCurrentBranding();
    const cleanName = data.name.replace(/[<>]/g, "").trim().slice(0, 64);
    const { error } = await supabaseAdmin
      .from("branding_presets")
      .upsert(
        { name: cleanName, data: current, created_by: userId, updated_at: new Date().toISOString() },
        { onConflict: "name" },
      );
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "branding.preset.save",
      target: cleanName,
    });
    return { ok: true, name: cleanName };
  });

/** Admin: apply a saved preset — replaces all branding keys atomically. */
export const applyBrandingPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin
      .from("branding_presets")
      .select("id,name,data")
      .eq("id", data.id)
      .maybeSingle();
    if (!p) throw new Error("Preset not found");
    await snapshotBranding(userId, `preset:${(p as any).name}`);
    const preset = (p as any).data as Record<string, string>;
    const rows = KEYS.map((k) => ({
      key: `branding_${k}`,
      value: sanitize(k, preset[k] ?? ""),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    }));
    const { error } = await supabaseAdmin.from("app_settings").upsert(rows);
    if (error) throw error;
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "branding.preset.apply",
      target: (p as any).name,
    });
    return { ok: true, name: (p as any).name };
  });

/** Admin: delete a saved preset. */
export const deleteBrandingPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("branding_presets").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Admin: undo the last branding change by restoring the most recent snapshot. */
export const undoLastBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: h } = await supabaseAdmin
      .from("branding_history")
      .select("id,data,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!h) return { ok: false, reason: "no_history" as const };
    const snap = (h as any).data as Record<string, string>;
    // Take a snapshot of the CURRENT state before restoring, so undo can be redone.
    await snapshotBranding(userId, "before_undo");
    const rows = KEYS.map((k) => ({
      key: `branding_${k}`,
      value: sanitize(k, snap[k] ?? ""),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    }));
    const { error } = await supabaseAdmin.from("app_settings").upsert(rows);
    if (error) throw error;
    // Consume the restored snapshot so a second Undo goes to the entry before it.
    await supabaseAdmin.from("branding_history").delete().eq("id", (h as any).id);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: "branding.undo",
      target: (h as any).reason ?? "",
    });
    return { ok: true, restoredAt: (h as any).created_at, reason: (h as any).reason };
  });

/** Admin: peek at the most recent snapshot without applying it (for UI hint). */
export const peekBrandingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("branding_history")
      .select("id,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    return { entries: data ?? [] };
  });

