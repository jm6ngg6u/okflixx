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
  logo_url: "",
  favicon_url: "",
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
  if (key === "wordmark_pulse") return v === "0" ? "0" : "1";
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

/** Admin: upsert a single branding key. Value is sanitized server-side. */
export const setBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ key: z.string().min(1).max(64), value: z.string().max(2048) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Forbidden");
    const shortKey = data.key.replace(/^branding_/, "") as BrandingKey;
    if (!(shortKey in BRANDING_DEFAULTS)) throw new Error("Unknown branding key");
    const clean = sanitize(shortKey, data.value);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
      details: { value: clean },
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
      await supabaseAdmin.from("app_settings").delete().eq("key", `branding_${shortKey}`);
      await supabaseAdmin.from("admin_activity_log").insert({
        admin_id: userId,
        action: `branding.reset`,
        target: shortKey,
      });
      return { ok: true, key: shortKey, value: BRANDING_DEFAULTS[shortKey] };
    }
    const dbKeys = KEYS.map((k) => `branding_${k}`);
    await supabaseAdmin.from("app_settings").delete().in("key", dbKeys);
    await supabaseAdmin.from("admin_activity_log").insert({
      admin_id: userId,
      action: `branding.reset_all`,
    });
    return { ok: true };
  });
