import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowUpRight, Zap, ShieldCheck, Radio, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import logo from "@/assets/brand-logo.png";
import { useBrand } from "@/lib/branding-context";
import {
  loginSearchSchema,
  stashRedirect,
  consumeRedirect,
  sanitizeRedirect,
} from "@/lib/post-login-redirect";

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — Emberlord" },
      { name: "description", content: "Sign in with Google to command Netflix on any TV." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const brand = useBrand();
  const search = Route.useSearch();
  const [busy, setBusy] = useState(false);

  // Persist the intended destination as soon as the login page mounts so the
  // Google popup / redirect flow can pick it up on return.
  useEffect(() => {
    if (search.redirect) stashRedirect(search.redirect);
  }, [search.redirect]);

  // If the user is already signed in, honor the redirect target immediately.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const target = consumeRedirect() ?? sanitizeRedirect(search.redirect) ?? "/";
      navigate({ to: target, replace: true });
    });
  }, [navigate, search.redirect]);

  async function handleGoogle() {
    setBusy(true);
    // Re-stash right before OAuth in case the URL was edited.
    stashRedirect(search.redirect ?? null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setBusy(false);
        return;
      }
      if (result.redirected) return;
      // Popup path — session is set. Resolve the intended target.
      const target = consumeRedirect() ?? sanitizeRedirect(search.redirect) ?? "/";
      navigate({ to: target, replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "Sign-in failed");
      setBusy(false);
    }
  }


  const brandName = `${brand?.name_prefix ?? "EMBER"}${brand?.name_suffix ?? "LORD"}`;
  const heroLogo = brand?.logo_url || logo;
  const tagline1 = "COMMAND THE";
  const tagline2 = "FLAME";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#050505] text-white">
      {/* Ambient background flames */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 -left-40 h-[540px] w-[540px] rounded-full bg-[#ff2a3a] opacity-[0.12] blur-[140px]" />
        <div className="absolute top-1/3 -right-40 h-[520px] w-[520px] rounded-full bg-[#7a0010] opacity-[0.25] blur-[160px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-[#ff2a3a] opacity-[0.08] blur-[140px]" />
        {/* Diagonal ember streaks */}
        <svg className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="ember-streak" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="50%" stopColor="#ff2a3a" stopOpacity="0.35" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path d="M -100 400 Q 500 200 1600 700" stroke="url(#ember-streak)" strokeWidth="1.2" fill="none" />
          <path d="M -100 600 Q 700 350 1700 900" stroke="url(#ember-streak)" strokeWidth="1" fill="none" />
          <path d="M -100 250 Q 400 100 1500 500" stroke="url(#ember-streak)" strokeWidth="0.8" fill="none" />
        </svg>
        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#050505_85%)]" />
      </div>

      {/* Skip link for keyboard users */}
      <a
        href="#signin-card"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to sign-in
      </a>

      {/* Top bar */}
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 sm:py-6">
        <Link to="/" className="flex items-center gap-2.5 group rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-black" aria-label={`${brandName} home`}>
          <img src={heroLogo} alt="" className="h-8 w-8 sm:h-9 sm:w-9 drop-shadow-[0_0_14px_rgba(255,42,58,0.55)]" />
          <span
            className="text-base sm:text-lg font-extrabold tracking-[0.14em]"
            style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
          >
            {brandName}
          </span>
        </Link>
        <Link
          to="/"
          className="text-[10px] sm:text-xs uppercase tracking-[0.22em] text-white/50 hover:text-white transition rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-black px-1"
        >
          ← Back to site
        </Link>
      </header>

      <main
        id="main"
        className="relative z-10 mx-auto grid max-w-7xl gap-10 px-4 pb-12 pt-2 sm:px-6 sm:gap-12 lg:grid-cols-2 lg:gap-16 lg:pt-10 lg:pb-16"
      >
        {/* LEFT — Mascot & tagline */}
        <section className="flex flex-col items-center justify-center text-center lg:items-start lg:text-left" aria-labelledby="tagline-heading">
          <div className="relative">
            <div className="absolute inset-0 -z-10 mx-auto h-full w-full rounded-full bg-[#ff2a3a] opacity-30 blur-[90px]" aria-hidden="true" />
            <img
              src={heroLogo}
              alt=""
              className="h-40 w-40 sm:h-56 sm:w-56 lg:h-80 lg:w-80 drop-shadow-[0_0_60px_rgba(255,42,58,0.55)] motion-safe:animate-[float_6s_ease-in-out_infinite]"
            />
          </div>

          <h1
            id="tagline-heading"
            className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-black leading-[0.95] tracking-tight"
            style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
          >
            <span className="text-white">{tagline1}</span>{" "}
            <span
              className="bg-gradient-to-r from-[#ff2a3a] via-[#ff6b3d] to-[#ff2a3a] bg-clip-text text-transparent [background-size:200%_100%] motion-safe:animate-[shine_var(--brand-shine-duration,4.8s)_linear_infinite]"
            >
              {tagline2}
            </span>
          </h1>


          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/60">
            Sign in to access the private trident — activate Netflix on any Smart TV, Apple TV, Roku, PS5 and beyond.
          </p>

          <div className="mt-8 flex flex-wrap gap-2.5">
            {[
              { icon: Zap, label: "Instant activation" },
              { icon: ShieldCheck, label: "Encrypted end-to-end" },
              { icon: Radio, label: "24/7 uptime" },
              { icon: Crown, label: "Premium pool" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white/70 backdrop-blur-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#ff2a3a] shadow-[0_0_8px_rgba(255,42,58,0.9)]" />
                <Icon className="h-3 w-3 text-[#ff2a3a]/80" />
                {label}
              </span>
            ))}
          </div>
        </section>

        {/* RIGHT — Sign-in card */}
        <section className="flex items-center justify-center">
          <div className="relative w-full max-w-md">
            {/* Ember ring behind card */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-[#ff2a3a]/40 via-white/5 to-transparent opacity-70 blur-[1px]" />
            <div className="relative rounded-2xl border border-white/10 bg-[#0b0b0d]/85 p-8 backdrop-blur-xl shadow-[0_40px_120px_-30px_rgba(255,42,58,0.35)]">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[#ff2a3a]/80 font-semibold">
                Wield the trident
              </div>
              <h2
                className="mt-3 text-3xl font-bold tracking-tight text-white"
                style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
              >
                Sign in to continue
              </h2>
              <p className="mt-2 text-sm text-white/55">
                One click with Google. No password, no forms — just fire.
              </p>

              <button
                onClick={handleGoogle}
                disabled={busy}
                className="group relative mt-8 flex h-13 w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-white px-5 py-3.5 font-medium text-[#0b0b0d] transition-all hover:shadow-[0_0_40px_-4px_rgba(255,255,255,0.35)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#ff2a3a]/15 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                <svg className="relative h-5 w-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="relative text-[15px] font-semibold tracking-tight">
                  {busy ? "Opening Google…" : "Continue with Google"}
                </span>
                <ArrowUpRight className="relative h-4 w-4 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>

              {/* Divider */}
              <div className="my-7 flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <span className="text-[10px] uppercase tracking-[0.28em] text-white/30">Secure OAuth</span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>

              {/* Trust bullets */}
              <ul className="space-y-2.5 text-[13px] text-white/60">
                <li className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-[#ff2a3a] shadow-[0_0_6px_rgba(255,42,58,0.9)]" />
                  We never see or store your password.
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-[#ff2a3a] shadow-[0_0_6px_rgba(255,42,58,0.9)]" />
                  Only your email and name are used for activation records.
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-[#ff2a3a] shadow-[0_0_6px_rgba(255,42,58,0.9)]" />
                  Sign out anytime from your account.
                </li>
              </ul>

              <p className="mt-8 text-center text-[11px] uppercase tracking-[0.2em] text-white/30">
                By continuing you accept the covenant of the flame
              </p>
            </div>

            {/* Under-card status pill */}
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/40">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Gateway online
            </div>
          </div>
        </section>
      </main>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(-1deg); }
          50%      { transform: translateY(-14px) rotate(1deg); }
        }
        @keyframes shine {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
