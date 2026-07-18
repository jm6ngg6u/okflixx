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

  useEffect(() => {
    if (search.redirect) stashRedirect(search.redirect);
  }, [search.redirect]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const target = consumeRedirect() ?? sanitizeRedirect(search.redirect) ?? "/";
      navigate({ to: target, replace: true });
    });
  }, [navigate, search.redirect]);

  async function handleGoogle() {
    setBusy(true);
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
      const target = consumeRedirect() ?? sanitizeRedirect(search.redirect) ?? "/";
      navigate({ to: target, replace: true });
    } catch (err: any) {
      toast.error(err?.message ?? "Sign-in failed");
      setBusy(false);
    }
  }

  const brandName = `${brand?.name_prefix ?? "EMBER"}${brand?.name_suffix ?? "LORD"}`;
  const heroLogo = brand?.logo_url || logo;
  const tagline1 = "JOIN THE";
  const tagline2 = "ELITE";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#050505] text-white">
      {/* ============ BACKGROUND: sweeping ember beams ============ */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {/* Blurred glows */}
        <div className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full bg-[#ff2a3a] opacity-[0.14] blur-[150px]" />
        <div className="absolute top-1/3 -right-52 h-[560px] w-[560px] rounded-full bg-[#7a0010] opacity-[0.28] blur-[170px]" />
        <div className="absolute bottom-[-8rem] left-1/4 h-[420px] w-[420px] rounded-full bg-[#ff2a3a] opacity-[0.10] blur-[150px]" />

        {/* Big animated curved ember streaks (Florzin-style) */}
        <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,#000_35%,transparent_85%)]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="none">
            <defs>
              <linearGradient id="beam-a" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ff2a3a" stopOpacity="0" />
                <stop offset="45%" stopColor="#ff6b3d" stopOpacity="0.85" />
                <stop offset="55%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#ff2a3a" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="beam-b" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ff2a3a" stopOpacity="0" />
                <stop offset="50%" stopColor="#ff2a3a" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#ff2a3a" stopOpacity="0" />
              </linearGradient>
              <filter id="beam-blur" x="-10%" y="-100%" width="120%" height="300%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
              <filter id="beam-blur-strong" x="-10%" y="-100%" width="120%" height="300%">
                <feGaussianBlur stdDeviation="12" />
              </filter>
            </defs>
            {/* Two soft wide bands */}
            <path d="M -200 620 Q 400 380 900 480 T 1800 260" stroke="url(#beam-b)" strokeWidth="90" fill="none" filter="url(#beam-blur-strong)" opacity="0.55" />
            <path d="M -200 300 Q 500 100 1000 220 T 1900 640" stroke="url(#beam-b)" strokeWidth="70" fill="none" filter="url(#beam-blur-strong)" opacity="0.45" />
            {/* Bright ember streaks that shimmer */}
            <g className="beam-shimmer">
              <path d="M -200 640 Q 400 400 900 500 T 1800 280" stroke="url(#beam-a)" strokeWidth="2.2" fill="none" filter="url(#beam-blur)" />
              <path d="M -200 320 Q 500 120 1000 240 T 1900 660" stroke="url(#beam-a)" strokeWidth="1.6" fill="none" filter="url(#beam-blur)" />
              <path d="M -200 780 Q 700 560 1200 660 T 1900 900" stroke="url(#beam-a)" strokeWidth="1.2" fill="none" filter="url(#beam-blur)" />
              <path d="M -200 180 Q 600 40 1200 140 T 1900 420" stroke="url(#beam-a)" strokeWidth="1" fill="none" filter="url(#beam-blur)" />
            </g>
          </svg>
        </div>

        {/* Subtle vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#050505_92%)]" />
        {/* Grain */}
        <div
          className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>\")",
          }}
        />
      </div>

      {/* Skip link */}
      <a
        href="#signin-card"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to sign-in
      </a>

      {/* ============ TOP BAR ============ */}
      <header className="relative z-10 mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-5 sm:px-6 sm:py-6">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          aria-label={`${brandName} home`}
        >
          <img src={heroLogo} alt="" className="h-8 w-8 shrink-0 drop-shadow-[0_0_14px_rgba(255,42,58,0.55)] sm:h-9 sm:w-9" />
          <span
            className="truncate text-base font-extrabold tracking-[0.14em] sm:text-lg"
            style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
          >
            {brandName}
          </span>
        </Link>
        <Link
          to="/"
          className="shrink-0 rounded-md px-1 text-[10px] uppercase tracking-[0.22em] text-white/50 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:text-xs"
        >
          ← Back to site
        </Link>
      </header>

      {/* ============ MAIN GRID ============ */}
      <main
        id="main"
        className="relative z-10 mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-4 sm:px-6 sm:gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pt-8"
      >
        {/* ================== LEFT ================== */}
        <section
          className="flex flex-col items-center text-center lg:items-start lg:text-left"
          aria-labelledby="tagline-heading"
        >
          {/* Mascot with shine clipped to the transparent logo shape */}
          <div className="relative inline-block">
            <div className="relative inline-block">
              <img
                src={heroLogo}
                alt=""
                className="login-hero-logo h-40 w-40 select-none object-contain drop-shadow-[0_0_60px_rgba(255,42,58,0.55)] motion-safe:animate-[float_6s_ease-in-out_infinite] sm:h-56 sm:w-56 lg:h-72 lg:w-72"
                draggable={false}
              />
              {/* Shine flash is masked by the logo alpha, so no square box can appear. */}
              <span
                aria-hidden="true"
                className="logo-shine-sweep pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 0%, transparent 38%, rgba(255,255,255,0.95) 47%, rgba(255,42,58,0.95) 50%, rgba(255,255,255,0.9) 53%, transparent 62%, transparent 100%)",
                  backgroundSize: "260% 100%",
                  backgroundPosition: "180% 0",
                  mixBlendMode: "screen",
                  filter: "drop-shadow(0 0 18px rgba(255,42,58,0.95))",
                  WebkitMaskImage: `url(${heroLogo})`,
                  maskImage: `url(${heroLogo})`,
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                }}
              />
            </div>
          </div>


          {/* Two-tone tagline */}
          <h1
            id="tagline-heading"
            className="mt-8 text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl"
            style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
          >
            <span className="text-white">{tagline1}</span>{" "}
            <span
              className="relative inline-block bg-gradient-to-r from-[#ff2a3a] via-[#ff6b3d] to-[#ff2a3a] bg-clip-text text-transparent [background-size:200%_100%] motion-safe:animate-[shine_var(--brand-shine-duration,4.8s)_linear_infinite]"
              style={{ WebkitTextStroke: "0.5px rgba(255,42,58,0.15)" }}
            >
              {tagline2}
            </span>
          </h1>

          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/65">
            Create your account to access our private gateway and start activating Netflix on any Smart TV, Apple TV, Roku, or console.
          </p>

          {/* Feature pills — 4 items, wrapping */}
          <div className="mt-8 flex flex-wrap justify-center gap-2.5 lg:justify-start">
            {[
              { icon: Crown, label: "Premium pool" },
              { icon: Zap, label: "Instant activation" },
              { icon: Radio, label: "24/7 uptime" },
              { icon: ShieldCheck, label: "Secure gateway" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.16em] text-white/75 backdrop-blur-sm"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#ff2a3a] shadow-[0_0_8px_rgba(255,42,58,0.9)]" />
                <Icon className="h-3 w-3 text-[#ff5a68]" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>

          {/* Stats row */}
          <dl className="mt-10 grid w-full max-w-lg grid-cols-3 gap-3 text-center lg:text-left">
            {[
              { k: "15K+", v: "Happy customers" },
              { k: "50+", v: "TVs supported" },
              { k: "100%", v: "Success rate" },
            ].map(({ k, v }) => (
              <div
                key={v}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-4 backdrop-blur-sm"
              >
                <dt className="sr-only">{v}</dt>
                <dd>
                  <div
                    className="text-2xl font-black tracking-tight text-white sm:text-3xl"
                    style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
                  >
                    {k}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/45">
                    {v}
                  </div>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ================== RIGHT — Sign-in card ================== */}
        <section
          id="signin-card"
          className="flex items-center justify-center"
          aria-labelledby="signin-heading"
        >
          <div className="relative w-full max-w-md">
            <div
              className="absolute -inset-px rounded-2xl bg-gradient-to-b from-[#ff2a3a]/40 via-white/5 to-transparent opacity-70 blur-[1px]"
              aria-hidden="true"
            />
            <div className="relative rounded-2xl border border-white/10 bg-[#0b0b0d]/90 p-6 shadow-[0_40px_120px_-30px_rgba(255,42,58,0.35)] backdrop-blur-xl sm:p-8">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#ff5a68]">
                Wield the trident
              </div>

              <h2
                id="signin-heading"
                className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-[2rem]"
                style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
              >
                Create Account
              </h2>
              <p className="mt-2 text-sm text-white/65">
                Join thousands of other operatives today.
              </p>

              {/* Google button */}
              <button
                onClick={handleGoogle}
                disabled={busy}
                aria-busy={busy}
                aria-label={busy ? "Opening Google sign-in" : "Continue with Google"}
                className="group relative mt-7 flex min-h-12 w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-gradient-to-b from-[#ff2a3a] to-[#c1121f] px-5 py-3.5 font-medium text-white transition-all hover:shadow-[0_0_40px_-4px_rgba(255,42,58,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0d] disabled:cursor-not-allowed disabled:opacity-60 sm:mt-8"
              >
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  aria-hidden="true"
                />
                <span
                  className="relative text-[15px] font-semibold tracking-[0.14em] uppercase"
                  style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
                >
                  {busy ? "Opening Google…" : "Sign Up"}
                </span>
                <ArrowUpRight
                  className="relative h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden="true"
                />
              </button>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <span className="text-[11px] uppercase tracking-[0.24em] text-white/45">
                  Or sign up with
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>

              {/* Google chip (secondary, alt visual) */}
              <button
                onClick={handleGoogle}
                disabled={busy}
                aria-label="Continue with Google account"
                className="group flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-white/12 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="tracking-wide">Google</span>
              </button>

              {/* Login footer link */}
              <p className="mt-7 text-center text-[13px] text-white/55">
                Already have security clearance?{" "}
                <Link
                  to="/login"
                  className="font-semibold text-[#ff5a68] underline-offset-4 transition hover:text-[#ff2a3a] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b0d] rounded-sm"
                >
                  Login
                </Link>
              </p>
            </div>

            {/* Status pill under card */}
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.24em] text-white/45">
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
        @keyframes logo-shine {
          0%, 56%   { opacity: 0; background-position: 185% 0; }
          61%       { opacity: 1; }
          72%       { opacity: 1; background-position: -95% 0; }
          78%, 100% { opacity: 0; background-position: -95% 0; }
        }
        @keyframes logo-flash {
          0%, 56%, 80%, 100% {
            filter: brightness(1) contrast(1) drop-shadow(0 0 60px rgba(255,42,58,0.55));
          }
          64% {
            filter: brightness(1.45) contrast(1.12) drop-shadow(0 0 90px rgba(255,42,58,0.95));
          }
          70% {
            filter: brightness(1.18) contrast(1.05) drop-shadow(0 0 76px rgba(255,255,255,0.42));
          }
        }
        .logo-shine-sweep {
          opacity: 0;
          animation: logo-shine 3.8s ease-in-out infinite;
        }
        .login-hero-logo {
          animation: float 6s ease-in-out infinite, logo-flash 3.8s ease-in-out infinite;
        }
        .beam-shimmer {
          animation: beam-drift 9s ease-in-out infinite alternate;
          transform-origin: center;
        }
        @keyframes beam-drift {
          0%   { transform: translateX(-30px) translateY(-6px); opacity: 0.75; }
          50%  { transform: translateX(0)     translateY(4px);  opacity: 1;    }
          100% { transform: translateX(30px)  translateY(-4px); opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          .beam-shimmer { animation: none !important; }
          .logo-shine-sweep, .login-hero-logo { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
