// Full-screen maintenance takeover. Replaces every public route while
// maintenance mode is active. Renders: brand logo + wordmark, admin's custom
// message, live countdown (only when an end time is set), signed-in Google
// user chip with sign-out, public contact channels, admin bypass link, and
// auto-recovery (redirects the moment maintenance flips off).
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, Send, Instagram, Phone, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBrand } from "@/lib/branding-context";
import { getPublicContacts } from "@/lib/settings.functions";

type Props = {
  message: string;
  endsAt: string | null;
  onCleared: () => void;
};

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "any moment now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

export function MaintenanceScreen({ message, endsAt, onCleared }: Props) {
  const b = useBrand();
  const qc = useQueryClient();
  const fetchContacts = useServerFn(getPublicContacts);

  const [user, setUser] = useState<{ email: string | null; avatar: string | null; name: string | null } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [now, setNow] = useState(() => Date.now());

  // Session identity
  useEffect(() => {
    let mounted = true;
    const loadUser = async () => {
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
    loadUser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { loadUser(); });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);


  // Countdown ticker (only relevant when an end time is set)
  useEffect(() => {
    if (!endsAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [endsAt]);

  // Auto-recover: poll gate every 5s. When it clears, onCleared() fires so
  // the router remounts the real page.
  useEffect(() => {
    const t = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["public-gate"] });
    }, 5000);
    return () => window.clearInterval(t);
  }, [qc]);

  const endMs = useMemo(() => (endsAt ? Date.parse(endsAt) : NaN), [endsAt]);
  const remainingLabel = Number.isFinite(endMs) ? fmtRemaining(endMs - now) : null;

  // Contact channels
  const contacts = useQuery({
    queryKey: ["public-contacts"],
    queryFn: () => fetchContacts(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const channels = contacts.data?.channels ?? [];
  const iconFor = (k: string) => (k === "telegram" ? Send : k === "instagram" ? Instagram : Phone);

  const signOut = async () => {
    setSigningOut(true);
    try { await supabase.auth.signOut(); } finally { setSigningOut(false); }
  };

  const brandName = `${b.name_prefix}${b.name_suffix}`;

  return (
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-[#050505] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full blur-[140px]"
             style={{ background: "radial-gradient(closest-side, rgba(var(--brand-accent-rgb),0.35), transparent)" }} />
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-black to-transparent" />
      </div>

      {/* Signed-in identity chip (top-right) */}
      {user && (
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
          <button
            onClick={signOut}
            disabled={signingOut}
            className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-widest text-white/80 hover:text-white hover:border-[color:var(--brand-accent)]/50 transition disabled:opacity-60"
          >
            {signingOut ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
            Sign out
          </button>
        </div>
      )}

      {/* Content */}
      <div className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24 text-center">
        {/* Status pill */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-accent)]/40 bg-[color:var(--brand-accent)]/10 px-3 py-1.5 text-[10.5px] font-mono uppercase tracking-[0.25em] text-[color:var(--brand-accent)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--brand-accent)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--brand-accent)]" />
          </span>
          Maintenance in progress
        </div>

        {/* Logo — flashing halo + sweeping shine */}
        <div className="relative mt-8 h-28 w-28">
          <span
            aria-hidden
            className="absolute inset-[-14%] rounded-full blur-2xl maintenance-flash"
            style={{ background: "radial-gradient(closest-side, rgba(var(--brand-accent-rgb),0.75), transparent 70%)" }}
          />
          <img
            src={b.logo_url}
            alt={brandName}
            className="relative h-28 w-28 object-contain maintenance-logo-shine"
            style={{ filter: "drop-shadow(0 0 28px rgba(var(--brand-accent-rgb),0.65))" }}
          />
        </div>

        {/* Wordmark — auto glow pulse */}
        <h1
          className="mt-6 font-[family:var(--brand-font-display)] text-4xl sm:text-6xl font-extrabold tracking-tight text-white maintenance-wordmark-glow"
          style={{ letterSpacing: "var(--brand-letter-spacing)" }}
        >
          {b.name_prefix}
          <span className="text-[color:var(--brand-accent)]">{b.name_suffix}</span>
        </h1>


        {/* Headline */}
        <h2 className="mt-6 font-[family:var(--brand-font-display)] text-2xl sm:text-3xl font-semibold text-white/95">
          We'll be right back.
        </h2>

        {/* Admin message */}
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/70">
          {message || "The service is temporarily paused for maintenance. Your session is safe — you'll be returned to the app the moment we're live again."}
        </p>

        {/* Countdown */}
        {remainingLabel && (
          <div className="mt-8 inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 backdrop-blur">
            <span className="text-[10.5px] font-mono uppercase tracking-[0.25em] text-white/50">Estimated back in</span>
            <span className="font-[family:var(--brand-font-display)] text-lg font-bold text-white tabular-nums">
              {remainingLabel}
            </span>
          </div>
        )}

        {/* Contact channels */}
        {channels.length > 0 && (
          <div className="mt-10 w-full max-w-xl">
            <div className="text-[10.5px] font-mono uppercase tracking-[0.25em] text-white/40">
              // Reach us during downtime
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {channels.map((c) => {
                const Icon = iconFor(c.kind);
                return (
                  <a
                    key={c.kind}
                    href={c.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-white/75 hover:text-white hover:border-[color:var(--brand-accent)]/50 hover:bg-[color:var(--brand-accent)]/[0.08] transition"
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    <span className="text-[11px] font-mono uppercase tracking-widest">
                      {c.name || c.kind}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-[10px] font-mono uppercase tracking-[0.25em] text-white/30">
          {b.footer_legal || "© Emberlord"}
        </div>
      </div>
    </div>
  );
}
