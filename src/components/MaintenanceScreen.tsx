// Full-screen maintenance takeover. All copy, colours, fonts, glow/shine
// toggles, animation intensity and font scale are driven by branding keys
// (Admin → Branding → Maintenance) and applied live via CSS variables.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, Send, Instagram, Phone, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBrand } from "@/lib/branding-context";
import { getPublicContacts } from "@/lib/settings.functions";
import type { BrandingMap } from "@/lib/branding-context";

type Props = {
  message: string;
  startsAt?: string | null;
  endsAt: string | null;
  onCleared: () => void;
};

function fmtRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "any moment now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  // Compact "12m 34s" style — always shows two units for stability, drops
  // trailing zero-unit only when the value is truly under one unit.
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

type Contact = { kind: string; name?: string | null; href: string };
type UserChip = { email: string | null; avatar: string | null; name: string | null };

/** Pure presentational render of the maintenance takeover — reused by the
 *  live page and the Admin → Branding preview so both stay identical. */
export function MaintenanceView({
  b,
  message,
  remainingLabel,
  startsAt,
  endsAt,
  channels,
  user,
  signingOut,
  onSignOut,
  compact = false,
}: {
  b: BrandingMap;
  message: string;
  remainingLabel: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  channels: Contact[];
  user: UserChip | null;
  signingOut?: boolean;
  onSignOut?: () => void;
  compact?: boolean;
}) {
  const brandName = `${b.name_prefix}${b.name_suffix}`;
  const scale = Math.max(60, Math.min(140, parseInt(b.maint_font_scale, 10) || 100)) / 100;
  const intensity = Math.max(0, Math.min(100, parseInt(b.maint_intensity, 10) || 0)) / 100;
  const flash = b.maint_flash === "1";
  const shine = b.maint_shine === "1";
  const wordmarkGlow = b.maint_wordmark_glow === "1";
  const perScale = (k: keyof BrandingMap, fallback = "100") =>
    Math.max(60, Math.min(160, parseInt((b as any)[k] ?? fallback, 10) || 100)) / 100;
  const sz = {
    status: perScale("maint_size_status" as keyof BrandingMap),
    wordmark: perScale("maint_size_wordmark" as keyof BrandingMap),
    headline: perScale("maint_size_headline" as keyof BrandingMap),
    message: perScale("maint_size_message" as keyof BrandingMap),
    countdown: perScale("maint_size_countdown" as keyof BrandingMap),
    contacts: perScale("maint_size_contacts" as keyof BrandingMap),
    footer: perScale("maint_size_footer" as keyof BrandingMap),
  };

  const fx = (px: number, elem: keyof typeof sz = "message") => `${px * scale * sz[elem]}px`;

  // Timezone-aware formatting for start/end times.
  const tz = (b as any).maint_timezone || "UTC";
  const hour12 = ((b as any).maint_time_format || "24h") === "12h";
  const fmtDT = (iso?: string | null): string | null => {
    if (!iso) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: tz, hour12,
        weekday: "short", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit", timeZoneName: "short",
      }).format(new Date(iso));
    } catch { return null; }
  };
  const startsFormatted = fmtDT(startsAt ?? null);
  const endsFormatted = fmtDT(endsAt ?? null);

  const rootStyle: CSSProperties = {
    // Consumed by keyframes in styles.css.
    ["--maint-intensity" as any]: intensity,
    ["--maint-font-scale" as any]: scale,
  };

  return (
    <div className="relative w-full text-white" style={rootStyle}>
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div
          className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full blur-[140px]"
          style={{
            background: `radial-gradient(closest-side, rgba(var(--brand-accent-rgb),${0.35 * (intensity || 0.4)}), transparent)`,
          }}
        />
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* Signed-in identity chip */}
      {user && !compact && (
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1.5 backdrop-blur">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="h-7 w-7 rounded-full ring-1 ring-white/10" referrerPolicy="no-referrer" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-white/10" />
          )}
          <div className="hidden sm:flex flex-col leading-tight pr-1">
            {user.name && <span className="text-[11px] font-semibold text-white/90">{user.name}</span>}
            <span className="text-[10px] text-white/50 font-mono">{user.email}</span>
          </div>
          {onSignOut && (
            <button
              onClick={onSignOut}
              disabled={signingOut}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-widest text-white/80 hover:text-white hover:border-[color:var(--brand-accent)]/50 transition disabled:opacity-60"
            >
              {signingOut ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
              Sign out
            </button>
          )}
        </div>
      )}

      <div className={`relative flex flex-col items-center justify-center text-center ${compact ? "py-10 px-4" : "min-h-screen px-6 py-24"}`}>
        {/* Status pill */}
        <div
          className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-accent)]/40 bg-[color:var(--brand-accent)]/10 px-3 py-1.5 font-mono uppercase tracking-[0.25em] text-[color:var(--brand-accent)]"
          style={{ fontSize: fx(10.5, "status") }}
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brand-accent)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--brand-accent)]" />
          </span>
          {b.maint_status_pill}
        </div>

        {/* Logo — flashing halo + shine */}
        <div
          className="relative"
          style={{ marginTop: fx(28), height: fx(compact ? 72 : 112), width: fx(compact ? 72 : 112) }}
        >
          {flash && (
            <span
              aria-hidden
              className="absolute inset-[-14%] rounded-full blur-2xl maintenance-flash"
              style={{
                background: `radial-gradient(closest-side, rgba(var(--brand-accent-rgb), ${0.55 + 0.4 * intensity}), transparent 70%)`,
              }}
            />
          )}
          {b.logo_url ? (
            <img
              src={b.logo_url}
              alt={brandName}
              className={`relative h-full w-full object-contain ${shine ? "maintenance-logo-shine" : ""}`}
              style={{ filter: `drop-shadow(0 0 ${18 + 30 * intensity}px rgba(var(--brand-accent-rgb),${0.4 + 0.5 * intensity}))` }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : null}

        </div>

        {/* Wordmark */}
        <h1
          className={`font-[family:var(--brand-font-display)] font-extrabold tracking-tight text-white ${wordmarkGlow ? "maintenance-wordmark-glow" : ""}`}
          style={{
            letterSpacing: "var(--brand-letter-spacing)",
            marginTop: fx(20),
            fontSize: fx(compact ? 32 : 56, "wordmark"),
          }}
        >
          {b.name_prefix}
          <span className="text-[color:var(--brand-accent)]">{b.name_suffix}</span>
        </h1>

        {/* Headline */}
        <h2
          className="font-[family:var(--brand-font-display)] font-semibold text-white/95"
          style={{ marginTop: fx(24), fontSize: fx(compact ? 18 : 26, "headline") }}
        >
          {b.maint_headline}
        </h2>

        {/* Admin message */}
        <p
          className="max-w-xl leading-relaxed text-white/70"
          style={{ marginTop: fx(14), fontSize: fx(compact ? 12 : 15, "message") }}
        >
          {(message || b.maint_message).trim()}
        </p>

        {/* Countdown + timezone-aware start/end times */}
        {(remainingLabel || endsFormatted || startsFormatted) && (
          <div
            className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur"
            style={{ marginTop: fx(28), padding: `${fx(12)} ${fx(20)}` }}
          >
            {remainingLabel && (
              <div className="flex items-baseline gap-2">
                <span
                  className="text-white/70"
                  style={{ fontSize: fx(compact ? 12 : 14, "countdown"), fontFamily: "var(--brand-font-body)" }}
                >
                  {b.maint_countdown_label}
                </span>
                <span
                  className="font-[family:var(--brand-font-display)] font-bold text-white tabular-nums"
                  style={{ fontSize: fx(compact ? 16 : 22, "countdown") }}
                >
                  {remainingLabel}
                </span>
              </div>
            )}
            {(startsFormatted || endsFormatted) && (
              <div className="flex flex-col items-center gap-0.5 pt-1 border-t border-white/5 w-full mt-1">
                {startsFormatted && (
                  <div className="flex items-center gap-2 font-mono text-white/50 tabular-nums" style={{ fontSize: fx(10, "countdown") }}>
                    <span className="uppercase tracking-widest text-white/35">Window opens</span>
                    <span>{startsFormatted}</span>
                  </div>
                )}
                {endsFormatted && (
                  <div className="flex items-center gap-2 font-mono text-white/60 tabular-nums" style={{ fontSize: fx(10.5, "countdown") }}>
                    <span className="uppercase tracking-widest text-white/40">Back online</span>
                    <span>{endsFormatted}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Contact channels */}
        {channels.length > 0 && (
          <div className="w-full max-w-xl" style={{ marginTop: fx(compact ? 20 : 36) }}>
            <div className="font-mono uppercase tracking-[0.25em] text-white/40" style={{ fontSize: fx(10.5, "contacts") }}>
              {b.maint_contacts_label}
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {channels.map((c) => {
                const Icon = c.kind === "telegram" ? Send : c.kind === "instagram" ? Instagram : Phone;
                return (
                  <a
                    key={c.kind}
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-white/75 hover:text-white hover:border-[color:var(--brand-accent)]/50 hover:bg-[color:var(--brand-accent)]/[0.08] transition"
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    <span className="font-mono uppercase tracking-widest" style={{ fontSize: fx(11, "contacts") }}>
                      {c.name || c.kind}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        <div
          className="font-mono uppercase tracking-[0.25em] text-white/30"
          style={{ marginTop: fx(compact ? 24 : 48), fontSize: fx(10, "footer") }}
        >
          {b.footer_legal || "© OKFLIX"}
        </div>
      </div>
    </div>
  );
}

export function MaintenanceScreen({ message, startsAt, endsAt, onCleared }: Props) {
  const b = useBrand();
  const qc = useQueryClient();
  const fetchContacts = useServerFn(getPublicContacts);

  const [user, setUser] = useState<UserChip | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!mounted) return;
      if (!u) { setUser(null); return; }
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      setUser({
        email: u.email ?? null,
        avatar: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
        name: (meta.full_name as string) ?? (meta.name as string) ?? null,
      });
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { load(); });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);

  useEffect(() => {
    const t = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["public-gate"] });
    }, 5000);
    return () => window.clearInterval(t);
  }, [qc]);

  // Auto-recover: fire onCleared when the poll shows maintenance off.
  useEffect(() => { void onCleared; }, [onCleared]);

  const endMs = useMemo(() => (endsAt ? Date.parse(endsAt) : NaN), [endsAt]);
  const remainingLabel = Number.isFinite(endMs) ? fmtRemaining(endMs - now) : null;

  const contacts = useQuery({
    queryKey: ["public-contacts"],
    queryFn: () => fetchContacts(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const channels = (contacts.data?.channels ?? []) as Contact[];

  const signOut = async () => {
    setSigningOut(true);
    try { await supabase.auth.signOut(); } finally { setSigningOut(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-[#050505]">
      <MaintenanceView
        b={b}
        message={message}
        remainingLabel={remainingLabel}
        startsAt={startsAt}
        endsAt={endsAt}
        channels={channels}
        user={user}
        signingOut={signingOut}
        onSignOut={signOut}
      />
    </div>
  );
}
