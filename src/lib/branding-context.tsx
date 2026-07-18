// BrandingProvider — mounts at the root, reads branding every 2s, writes CSS
// variables + Google Fonts <link> tags to the DOM, and exposes text via
// useBrand(). All values fall back to hard-coded defaults so a missing row
// never breaks the site.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicBranding, BRANDING_DEFAULTS, type BrandingKey } from "@/lib/branding.functions";
import { supabase } from "@/integrations/supabase/client";

export type BrandingMap = Record<BrandingKey, string>;

type Ctx = { b: BrandingMap; updatedAt: number };

const BrandingCtx = createContext<Ctx>({ b: { ...BRANDING_DEFAULTS } as BrandingMap, updatedAt: 0 });

export function useBrand(): BrandingMap {
  return useContext(BrandingCtx).b;
}

/** Convert 0..100 glow -> intensity multiplier (0..1). */
function glowN(v: string) {
  const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
  return n / 100;
}

function shineDuration(v: string) {
  return v === "off" ? "0s" : v === "slow" ? "9s" : v === "fast" ? "2.4s" : "4.8s";
}
function letterSpacingFor(v: string) {
  return v === "tight" ? "-0.025em" : v === "loose" ? "0.02em" : "0em";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Apply CSS variables — non-destructive to unrelated variables. */
function applyCss(b: BrandingMap) {
  if (typeof document === "undefined") return;
  const r = document.documentElement.style;
  const rgb = hexToRgb(b.accent_hex);
  r.setProperty("--brand-accent", b.accent_hex);
  r.setProperty("--brand-accent-rgb", `${rgb.r},${rgb.g},${rgb.b}`);
  r.setProperty("--brand-glow", String(glowN(b.glow)));
  r.setProperty("--brand-shine-duration", shineDuration(b.shine_speed));
  r.setProperty("--brand-letter-spacing", letterSpacingFor(b.letter_spacing));
  r.setProperty("--brand-font-display", `"${b.font_display}"`);
  r.setProperty("--brand-font-body", `"${b.font_body}"`);
  r.setProperty("--brand-font-mono", `"${b.font_mono}"`);
  r.setProperty("--brand-font-display-weight", b.font_display_weight);
  r.setProperty("--brand-font-body-weight", b.font_body_weight);
}

const FONT_LINK_ID = "branding-fonts-link";

/** Inject a single Google Fonts <link> that loads the three chosen families. */
function ensureFontLink(b: BrandingMap) {
  if (typeof document === "undefined") return;
  const families = Array.from(new Set([b.font_display, b.font_body, b.font_mono])).filter(Boolean);
  const spec = families
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800`)
    .join("&");
  const href = `https://fonts.googleapis.com/css2?${spec}&display=swap`;
  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const fetchBranding = useServerFn(getPublicBranding);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["public-branding"],
    queryFn: () => fetchBranding(),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const b = useMemo<BrandingMap>(
    () => q.data?.branding ?? ({ ...BRANDING_DEFAULTS } as BrandingMap),
    [q.data],
  );

  useEffect(() => {
    applyCss(b);
    ensureFontLink(b);
  }, [b]);

  // Supabase realtime — refetch instantly on any branding_* app_settings change.
  useEffect(() => {
    const ch = supabase
      .channel("branding-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload: any) => {
          const key = payload.new?.key ?? payload.old?.key ?? "";
          if (typeof key === "string" && key.startsWith("branding_")) {
            qc.invalidateQueries({ queryKey: ["public-branding"] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const ctx = useMemo<Ctx>(() => ({ b, updatedAt: q.data?.updatedAt ?? 0 }), [b, q.data?.updatedAt]);
  return <BrandingCtx.Provider value={ctx}>{children}</BrandingCtx.Provider>;
}
