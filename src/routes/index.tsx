import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { LiveBackground } from "@/components/LiveBackground";
import { ClickRipple } from "@/components/ClickRipple";
import { CodeInput, type CodeInputHandle } from "@/components/CodeInput";
import { BackgroundSong } from "@/components/BackgroundSong";
import { submitActivation } from "@/lib/activate.functions";
import { getGateConfig, redeemAccessKey } from "@/lib/access-keys.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KeyRound, Lock, ShieldCheck, UserCheck, CheckCircle2 } from "lucide-react";
import logo from "@/assets/brand-logo.png";

// Lightweight browser fingerprint — canvas + UA + screen + timezone + language.
async function computeFingerprint(): Promise<string> {
  try {
    const parts: string[] = [
      navigator.userAgent,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      String(navigator.hardwareConcurrency ?? 0),
    ];
    // Canvas fingerprint
    try {
      const c = document.createElement("canvas");
      c.width = 200; c.height = 50;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.textBaseline = "top";
        ctx.font = "14px 'Arial'";
        ctx.fillStyle = "#f60";
        ctx.fillRect(0, 0, 100, 30);
        ctx.fillStyle = "#069";
        ctx.fillText("emberlord-fp", 2, 15);
        parts.push(c.toDataURL().slice(-64));
      }
    } catch {}
    const s = parts.join("|");
    // Simple hash (browser-side; server re-hashes with SHA-256).
    const enc = new TextEncoder().encode(s);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `fallback:${Math.random().toString(36).slice(2)}`;
  }
}

const SESSION_KEY = "emberlord_access_session";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EMBERLORD — Activate Netflix on any TV in seconds" },
      { name: "description", content: "Enter your 8-digit code and stream Netflix instantly on any Smart TV, Apple TV, Roku, PS5 or Xbox. Encrypted, always-on, 2026-ready." },
    ],
  }),
  component: HomePage,
});

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

type SuccessPayload = {
  code: string;
  attempts: number;
  policy: string;
  redirectUrl: string;
  account: {
    email: string | null;
    country: string | null;
    plan_name: string | null;
    video_quality: string | null;
    max_streams: number | null;
    member_since: string | null;
    payment_method: string | null;
    name: string | null;
  };
};

function HomePage() {
  useReveal();
  const codeRef = useRef<CodeInputHandle>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const lastSubmitRef = useRef<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessPayload | null>(null);
  const [stage, setStage] = useState<"idle" | "checking" | "activating">("idle");
  const activate = useServerFn(submitActivation);
  const fetchGate = useServerFn(getGateConfig);
  const redeemFn = useServerFn(redeemAccessKey);

  // Gate config polled every 10s so admin toggles reach the landing page.
  const gate = useQuery({
    queryKey: ["public-gate"],
    queryFn: () => fetchGate(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const [accessKey, setAccessKey] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  // Which provider the widget on this page was actually rendered for —
  // sent to the server so a mismatched admin toggle produces a clear
  // error instead of "captcha failed".
  const captchaWidgetProviderRef = useRef<"turnstile" | "hcaptcha" | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem(SESSION_KEY) : null,
  );

  // Compute fingerprint once on mount.
  useEffect(() => { computeFingerprint().then(setFingerprint); }, []);

  // Track auth state (for login-gate).
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAuthUserId(data.user?.id ?? null);
      setAuthEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setAuthUserId(s?.user?.id ?? null);
      setAuthEmail(s?.user?.email ?? null);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  // Load Turnstile / hCaptcha script when captcha gate is on, then explicitly render the widget.
  const captchaWidgetRef = useRef<HTMLDivElement>(null);
  const captchaRenderedRef = useRef(false);
  useEffect(() => {
    if (!gate.data?.captchaRequired || !gate.data.captchaSiteKey) return;
    const provider = gate.data.captchaProvider;
    const src = provider === "hcaptcha"
      ? "https://js.hcaptcha.com/1/api.js?render=explicit"
      : "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    const ensureScript = () => new Promise<void>((resolve) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src; s.async = true; s.defer = true;
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
    let cancelled = false;
    (async () => {
      await ensureScript();
      const start = Date.now();
      while (!cancelled) {
        const api: any = provider === "hcaptcha" ? (window as any).hcaptcha : (window as any).turnstile;
        if (api && captchaWidgetRef.current && !captchaRenderedRef.current) {
          try {
            api.render(captchaWidgetRef.current, {
              sitekey: gate.data!.captchaSiteKey,
              theme: "dark",
              callback: (token: string) => {
                setCaptchaToken(token);
                setCaptchaError(null);
                captchaWidgetProviderRef.current = provider;
              },
              "expired-callback": () => setCaptchaToken(""),
              "error-callback": (err?: string) => {
                setCaptchaToken("");
                setCaptchaError(err ? `Widget error: ${err}` : "Widget error — refresh and try again.");
              },
            });
            captchaRenderedRef.current = true;
            captchaWidgetProviderRef.current = provider;
          } catch { /* already rendered */ }
          return;
        }
        if (Date.now() - start > 8000) return;
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => { cancelled = true; };
  }, [gate.data?.captchaRequired, gate.data?.captchaSiteKey, gate.data?.captchaProvider]);

  const gateBlocks = useMemo(() => {
    const g = gate.data;
    if (!g) return { needsLogin: false, needsCaptcha: false, needsKey: false, hasSession: false };
    return {
      needsLogin: g.loginRequired && !authUserId,
      needsCaptcha: g.captchaRequired && !captchaToken,
      needsKey: g.accessKeyRequired && !accessKey && !sessionToken,
      hasSession: !!sessionToken,
    };
  }, [gate.data, authUserId, captchaToken, accessKey, sessionToken]);

  // --- Redeem key ---
  const [redeeming, setRedeeming] = useState(false);
  async function redeemKey() {
    if (!accessKey.trim()) { toast.error("Enter your access key"); return; }
    if (!fingerprint) { toast.error("Preparing security check — try again in a moment."); return; }
    setRedeeming(true);
    try {
      const r = await redeemFn({ data: { code: accessKey.trim(), fingerprint } });
      if (!r.ok) {
        toast.error("Key rejected", {
          description: r.reason === "already_redeemed" ? "This key was used on another device."
            : r.reason === "expired" ? "This key has expired."
            : r.reason === "disabled" ? "This key has been disabled."
            : "Check the key and try again.",
        });
        return;
      }
      if (r.keyType === "session_24h" && r.sessionToken) {
        localStorage.setItem(SESSION_KEY, r.sessionToken);
        setSessionToken(r.sessionToken);
        toast.success("Unlocked for 24 hours", { description: "You can activate freely on this device until it expires." });
      } else {
        toast.success("Key accepted", {
          description: r.keyType === "unlimited" ? "Unlimited activations enabled." : "One-time key ready.",
        });
      }
    } catch (e: any) {
      toast.error("Redeem failed", { description: e?.message ?? "" });
    } finally {
      setRedeeming(false);
    }
  }

  const handleActivate = async () => {
    // Client throttle — 3s cooldown between submits.
    const now = Date.now();
    if (submitting) return;
    if (now - lastSubmitRef.current < 3000) {
      toast.error("Slow down a moment.");
      return;
    }
    lastSubmitRef.current = now;

    const code = (codeRef.current?.getCode() ?? "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      toast.error("Enter the full 8-character code from your TV.");
      return;
    }

    // Pre-flight gate checks (UI hints; server is source of truth).
    if (gateBlocks.needsLogin) { toast.error("Please sign in first."); return; }
    if (gateBlocks.needsCaptcha) { toast.error("Complete the captcha first."); return; }
    if (gateBlocks.needsKey) { toast.error("Enter your access key first."); return; }

    setSubmitting(true);
    setStage("checking");
    const stageTimer = window.setTimeout(() => setStage("activating"), 1200);
    try {
      const result = await activate({
        data: {
          code,
          website: honeypotRef.current?.value ?? "",
          elapsedMs: now - mountedAtRef.current,
          accessKey: accessKey || null,
          accessSessionToken: sessionToken,
          captchaToken: captchaToken || null,
          fingerprint: fingerprint || null,
          authUserId,
        },
      });
      if (result.ok) {
        setSuccess({
          code,
          attempts: result.attempts,
          policy: result.policy,
          redirectUrl: result.redirectUrl,
          account: result.account,
        });
      } else if (result.error === "rate_limited") {
        toast.error("Too many attempts. Try again in 10 minutes.");
      } else if (result.error === "bot_detected") {
        toast.error("Something looked off. Please refresh and try again.");
      } else if (result.error === "invalid_code") {
        toast.error(result.message ?? "That code doesn't look right. Check your TV screen.");
      } else if (result.error === "maintenance") {
        toast.error(result.message ?? "The service is temporarily unavailable.");
      } else if (result.error === "login_required") {
        toast.error(result.message ?? "Please sign in to activate.");
      } else if (result.error === "captcha_required" || result.error === "captcha_invalid") {
        toast.error(result.message ?? "Captcha check failed. Please retry.");
        setCaptchaToken(""); // force re-solve
      } else if (result.error === "access_key_required" || result.error === "access_key_invalid") {
        // Session might have expired — clear it so the input reappears.
        if (result.error === "access_key_invalid" && sessionToken) {
          localStorage.removeItem(SESSION_KEY);
          setSessionToken(null);
        }
        toast.error(result.message ?? "Access key required.");
      } else if (result.error === "no_cookie" || result.error === "exhausted") {
        toast.error(result.message ?? "We couldn't activate right now. Please try again shortly.");
      } else {
        toast.error("Server hiccup. Try again in a moment.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      window.clearTimeout(stageTimer);
      setStage("idle");
      setSubmitting(false);
    }
  };

  const anyGate = !!(gate.data && (gate.data.accessKeyRequired || gate.data.captchaRequired || gate.data.loginRequired));



  return (
    <div className="relative min-h-screen text-white">
      <LiveBackground />
      {success && <SuccessOverlay payload={success} onClose={() => setSuccess(null)} />}

      <ClickRipple />
      <BackgroundSong />

      {/* NAV */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-3 group">
          <img src={logo} alt="Emberlord" data-wave-origin className="h-10 w-10 object-contain logo-shine group-hover:scale-110 transition" width={40} height={40} />
          <span className="font-display text-xl tracking-tight">EMBER<span className="text-[#ff2a3a]">LORD</span></span>
        </Link>
        <div className="hidden md:flex gap-8 text-sm text-white/70">
          <a href="#activate" className="hover:text-white transition">Activate</a>
          <a href="#features" className="hover:text-white transition">Features</a>
          <a href="#plans" className="hover:text-white transition">Access</a>
          <a href="#devices" className="hover:text-white transition">Devices</a>
          <a href="#reviews" className="hover:text-white transition">Reviews</a>
        </div>
        <a href="#activate" className="btn-red text-sm">Activate →</a>
      </nav>

      {/* HERO — CENTERED */}
      <section id="activate" className="relative">
        <div className="relative z-10 max-w-4xl mx-auto px-6 md:px-12 pt-16 pb-24 text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur text-xs text-white/75 mb-8 reveal">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff2a3a] animate-pulse" />
            <span className="font-mono uppercase tracking-widest">Live · 82,431 TVs activated</span>
          </div>

          <h1 className="font-display text-[clamp(2.6rem,6.5vw,5.4rem)] leading-[0.98] tracking-tight reveal">
            Stream <span className="text-live">Netflix</span> <br />
            on any TV <span className="text-shine">instantly.</span>
          </h1>

          <p className="mt-6 max-w-lg text-white/65 text-base md:text-lg leading-relaxed reveal">
            Type your 8-digit TV code. We handle the rest — encrypted, latency-free, on every screen you own.
          </p>

          {/* CODE PANEL — CENTER */}
          <div id="code-panel" className="reveal mt-10 w-full max-w-xl">
            <div className="glass glow-ring-anim p-8 md:p-10">
              <div className="flex items-center justify-between mb-6">
                <div className="font-mono text-[10px] uppercase tracking-widest text-white/50">Step 01 / Activate</div>
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#ff2a3a] animate-pulse" />
                  <span className="w-2 h-2 rounded-full bg-white/20" />
                  <span className="w-2 h-2 rounded-full bg-white/20" />
                </div>
              </div>
              <h3 className="font-display text-2xl mb-1">Enter TV Code</h3>
              <p className="text-white/50 text-sm mb-6">Find the 8-character code on your Netflix TV screen.</p>

              <CodeInput ref={codeRef} />

              {/* Honeypot — hidden from humans, bots fill it and get rejected */}
              <input
                ref={honeypotRef}
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
              />

              {/* ---- ACCESS GATES ---- */}
              {anyGate && (
                <div className="mt-6 space-y-3">
                  {/* Login gate */}
                  {gate.data?.loginRequired && (
                    <div className={`rounded-lg border p-3 flex items-center gap-3 ${authUserId ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                      <UserCheck className={`w-4 h-4 ${authUserId ? "text-emerald-400" : "text-amber-400"}`} />
                      <div className="flex-1 text-xs">
                        {authUserId ? (
                          <>Signed in as <span className="text-white font-mono">{authEmail}</span></>
                        ) : (
                          <>Sign-in required for activation.</>
                        )}
                      </div>
                      {!authUserId && (
                        <Link to="/auth" className="text-xs text-[#ff8a90] hover:text-white underline underline-offset-2">Sign in →</Link>
                      )}
                    </div>
                  )}

                  {/* Access key gate */}
                  {gate.data?.accessKeyRequired && (
                    <div className={`rounded-lg border p-3 ${sessionToken ? "border-violet-500/30 bg-violet-500/5" : "border-white/10 bg-white/[0.03]"}`}>
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">
                        <KeyRound className="w-3.5 h-3.5 text-[#ff8a90]" />
                        <span>Access key required</span>
                        {sessionToken && (
                          <span className="ml-auto inline-flex items-center gap-1 text-violet-300 text-[10px]">
                            <CheckCircle2 className="w-3 h-3" /> 24h unlock active
                          </span>
                        )}
                      </div>
                      {!sessionToken ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={accessKey}
                            onChange={(e) => setAccessKey(e.target.value.toUpperCase())}
                            placeholder="NFX-XXXX-XXXX-XXXX"
                            className="flex-1 bg-black/40 border border-white/10 rounded-md px-3 py-2 font-mono text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#ff2a3a]/60"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            onClick={redeemKey}
                            disabled={redeeming || !accessKey.trim()}
                            className="px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 border border-white/10 text-xs uppercase tracking-widest text-white/80 disabled:opacity-50"
                          >
                            {redeeming ? "Checking…" : "Verify"}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { localStorage.removeItem(SESSION_KEY); setSessionToken(null); setAccessKey(""); }}
                          className="text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-white/70"
                        >
                          Lock session
                        </button>
                      )}
                    </div>
                  )}

                  {/* Captcha gate */}
                  {gate.data?.captchaRequired && gate.data.captchaSiteKey && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#ff8a90]" />
                        <span>Verify you're human</span>
                        {captchaToken && (
                          <span className="ml-auto inline-flex items-center gap-1 text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        )}
                      </div>
                      <div
                        ref={captchaWidgetRef}
                        className="min-h-[78px]"
                      />

                    </div>
                  )}
                </div>
              )}


              <button
                onClick={handleActivate}
                disabled={submitting}
                className="btn-red w-full mt-7 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {stage === "checking"
                  ? "◆ Verifying cookie…"
                  : stage === "activating"
                    ? "◆ Activating on Netflix…"
                    : submitting
                      ? "Working…"
                      : "Activate Now →"}
              </button>

              <div className="mt-5 pt-5 border-t border-white/10 flex justify-between font-mono text-[10px] uppercase tracking-widest text-white/40">
                <span>Encrypted End-to-End</span>
                <span className="text-[#ff2a3a]">● Online</span>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs font-mono text-white/45 reveal">
            <span>◆ 99.99% Uptime</span>
            <span>◆ AES-256 Encrypted</span>
            <span>◆ 24/7 Support</span>
            <span>◆ 4K · HDR · Dolby</span>
          </div>
        </div>

        {/* DEVICE TICKER */}
        <div className="relative z-10 border-y border-white/5 bg-black/40 backdrop-blur-sm py-5">
          <div className="marquee">
            <div className="marquee-track font-mono text-sm uppercase tracking-[0.3em] text-white/40">
              {Array.from({ length: 2 }).map((_, k) => (
                <span key={k} className="flex gap-12">
                  {["Smart TV", "Apple TV", "Roku", "Fire TV", "Chromecast", "PS5", "Xbox", "Nvidia Shield", "LG WebOS", "Samsung Tizen"].map((d) => (
                    <span key={d} className="flex items-center gap-3">
                      <span className="text-[#ff2a3a]">◆</span> {d}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="relative py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Why Emberlord</div>
            <h2 className="font-display text-4xl md:text-6xl">Built for <span className="text-shine">2026 TVs</span>.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { t: "Instant Sync", d: "One code, every screen. Sub-second handshake on every activation.", i: "01" },
              { t: "Encrypted Vault", d: "AES-256 tunnel between your TV and Netflix. Nothing sniffable, ever.", i: "02" },
              { t: "Always Live", d: "Redundant edge nodes worldwide. 99.99% real-world uptime.", i: "03" },
            ].map((f) => (
              <div key={f.t} className="glass glass-hover p-8 reveal">
                <div className="font-mono text-xs text-[#ff2a3a] mb-6">/{f.i}</div>
                <div className="font-display text-2xl mb-3">{f.t}</div>
                <p className="text-white/60 text-sm leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PLAN — SINGLE FREE PREMIUM */}
      <section id="plans" className="relative py-28 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Access</div>
            <h2 className="font-display text-4xl md:text-6xl">One plan. <span className="text-live">Free forever.</span></h2>
            <p className="mt-5 text-white/60 max-w-xl mx-auto">Premium UHD unlocked for every activated TV — every country, every device. No card, no trial, no catch.</p>
          </div>

          <div className="glass glow-ring-anim p-10 md:p-12 reveal text-center">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#ff2a3a] mb-4">◆ Premium UHD · Global</div>
            <div className="font-display text-2xl mb-2">Emberlord Premium</div>
            <div className="flex items-baseline justify-center gap-2 mb-8">
              <span className="font-display text-7xl text-shine">$0</span>
              <span className="text-white/40 text-sm">/ forever</span>
            </div>
            <ul className="grid sm:grid-cols-2 gap-3 text-sm text-white/75 text-left max-w-md mx-auto">
              <li>◆ 4K UHD + HDR + Dolby Vision</li>
              <li>◆ Dolby Atmos surround</li>
              <li>◆ Unlimited screens</li>
              <li>◆ Every country unlocked</li>
              <li>◆ Full Netflix catalog</li>
              <li>◆ Zero ads, zero fees</li>
            </ul>
            <a href="#activate" className="btn-red mt-10 inline-block">Activate Free Premium →</a>
            <div className="mt-6 font-mono text-[10px] uppercase tracking-widest text-white/40">No credit card · No subscription · No expiry</div>
          </div>
        </div>
      </section>



      {/* DEVICES */}
      <section id="devices" className="relative py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Compatible</div>
            <h2 className="font-display text-4xl md:text-6xl">Every screen. <span className="text-shine">One code.</span></h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {["Smart TV", "Apple TV", "Roku", "Fire TV", "Chromecast", "PS5 / PS4", "Xbox", "Nvidia Shield"].map((d) => (
              <div key={d} className="glass glass-hover p-6 text-center reveal">
                <div className="font-display text-xl">{d}</div>
                <div className="font-mono text-[10px] text-white/40 uppercase tracking-widest mt-2">Certified</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* REVIEWS */}
      <section id="reviews" className="relative py-28 px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 reveal">
            <div className="font-mono text-xs uppercase tracking-[0.3em] text-[#ff2a3a] mb-4">// Reviews</div>
            <h2 className="font-display text-4xl md:text-6xl">4.9 / 5 · <span className="text-live">82,000+</span> activations</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { q: "Activated in under 20 seconds. Genuinely smooth.", n: "M. Ortega" },
              { q: "The code flow just works. No hoops, no spam.", n: "J. Chen" },
              { q: "Fastest TV setup I've ever done. Support was instant.", n: "S. Nakamura" },
            ].map((t) => (
              <div key={t.n} className="glass glass-hover p-8 reveal">
                <div className="text-[#ff2a3a] text-sm mb-4">★ ★ ★ ★ ★</div>
                <p className="text-white/85 leading-relaxed">"{t.q}"</p>
                <div className="mt-6 pt-4 border-t border-white/10 flex justify-between text-xs font-mono uppercase tracking-widest text-white/50">
                  <span>{t.n}</span>
                  <span className="text-[#ff2a3a]">Verified</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-32 px-6 md:px-12">
        <div className="relative max-w-3xl mx-auto text-center reveal">
          <h2 className="font-display text-5xl md:text-7xl leading-[0.98]">Ready to <span className="text-shine">press play?</span></h2>
          <p className="mt-6 text-white/60 max-w-lg mx-auto">Your TV is waiting. Grab your code and start streaming in seconds.</p>
          <div className="mt-9 flex justify-center gap-3">
            <a href="#activate" className="btn-red">Activate TV →</a>
            <a href="#plans" className="btn-ghost">Free Premium</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative border-t border-white/5 py-10 px-6 md:px-12 bg-black/40 backdrop-blur">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between gap-4 items-center">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Emberlord" className="h-7 w-7 object-contain" width={28} height={28} loading="lazy" />
            <span className="font-display text-lg">EMBER<span className="text-[#ff2a3a]">LORD</span></span>
          </div>
          <div className="font-mono text-xs uppercase tracking-widest text-white/40">© 2026 · Encrypted · Everywhere</div>
          <div className="flex gap-6 text-xs text-white/40">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Help</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function flagEmoji(cc: string | null): string {
  if (!cc || cc.length !== 2) return "🌐";
  const A = 0x1f1e6;
  const up = cc.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65) + String.fromCodePoint(A + up.charCodeAt(1) - 65);
}

function maskEmail(email: string | null): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const shown = local.length <= 2 ? local[0] ?? "" : local.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(2, local.length - shown.length))}@${domain}`;
}

function SuccessOverlay({ payload, onClose }: { payload: SuccessPayload; onClose: () => void }) {
  const [count, setCount] = useState(6);
  const [captured, setCaptured] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (count <= 0) {
      window.location.href = payload.redirectUrl;
      return;
    }
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [count, payload.redirectUrl]);

  const capture = async () => {
    try {
      // Best-effort: copy a text receipt to clipboard so the user has proof.
      const a = payload.account;
      const lines = [
        `EMBERLORD · Netflix TV Activation`,
        `Code: ${payload.code}`,
        `Time: ${new Date().toLocaleString()}`,
        `Attempts: ${payload.attempts}`,
        `Policy: ${payload.policy}`,
        `Plan: ${a.plan_name ?? "Premium"} · ${a.video_quality ?? "UHD"}`,
        `Country: ${a.country ?? "—"}`,
        `Screens: ${a.max_streams ?? "—"}`,
        `Member since: ${a.member_since ?? "—"}`,
      ].join("\n");
      await navigator.clipboard.writeText(lines);
      setCaptured(true);
      toast.success("Receipt copied to clipboard");
      window.setTimeout(() => setCaptured(false), 2000);
    } catch {
      toast.error("Clipboard blocked — screenshot the panel instead.");
    }
  };

  const a = payload.account;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/80 backdrop-blur-xl animate-in fade-in duration-300">
      {/* Ember burst */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(255,42,58,0.35),transparent_70%)] animate-pulse" />
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="absolute w-1 h-1 rounded-full bg-[#ff9a86]"
            style={{
              left: `${50 + Math.cos((i / 18) * Math.PI * 2) * 32}%`,
              top: `${50 + Math.sin((i / 18) * Math.PI * 2) * 32}%`,
              boxShadow: "0 0 12px #ff2a3a, 0 0 24px #ff2a3a",
              animation: `ping 1.6s ${(i * 80) % 1200}ms cubic-bezier(0,0,0.2,1) infinite`,
            }}
          />
        ))}
      </div>

      <div
        ref={cardRef}
        className="relative w-full max-w-2xl glass p-8 md:p-10 border border-[#ff2a3a]/30 shadow-[0_0_0_1px_rgba(255,42,58,0.25),0_30px_120px_-20px_rgba(255,42,58,0.55)] animate-in zoom-in-95 duration-300"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-[#ff2a3a] to-[#b0060f] flex items-center justify-center shadow-[0_0_40px_rgba(255,42,58,0.6)]">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span className="absolute inset-0 rounded-full ring-2 ring-[#ff2a3a]/40 animate-ping" />
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-[#ff2a3a]">// Activation complete</div>
              <h3 className="font-display text-3xl md:text-4xl leading-none mt-1">You're in.</h3>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none" aria-label="Close">✕</button>
        </div>

        <p className="mt-4 text-white/70 text-sm md:text-base">
          Code <span className="font-mono text-white bg-white/10 px-2 py-0.5 rounded">{payload.code}</span> unlocked Netflix on your TV.
          Redirecting in <span className="text-[#ff2a3a] font-mono">{count}s</span>…
        </p>

        {/* Account details */}
        <div className="mt-6 grid sm:grid-cols-2 gap-3">
          <Detail label="Plan" value={a.plan_name ?? "Premium"} accent />
          <Detail label="Quality" value={a.video_quality ?? "UHD"} accent />
          <Detail label="Country" value={`${flagEmoji(a.country)}  ${a.country ?? "Global"}`} />
          <Detail label="Screens" value={a.max_streams != null ? String(a.max_streams) : "Unlimited"} />
          <Detail label="Member since" value={a.member_since ?? "—"} />
          <Detail label="Account" value={maskEmail(a.email)} mono />
        </div>

        {/* Pipeline footer */}
        <div className="mt-6 pt-5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-white/50">
          <div className="flex items-center gap-3">
            <span className="text-[#ff2a3a]">◆</span> Cookie verified
            <span className="text-white/20">·</span>
            <span className="text-[#ff2a3a]">◆</span> TV linked
            <span className="text-white/20">·</span>
            <span className="text-[#ff2a3a]">◆</span> {payload.attempts} attempt{payload.attempts === 1 ? "" : "s"}
            <span className="text-white/20">·</span>
            <span>Rotation: {payload.policy.replace("_", " ")}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={payload.redirectUrl} className="btn-red flex-1 text-center">Open Netflix now →</a>
          <button onClick={capture} className="btn-ghost">
            {captured ? "✓ Copied" : "Copy receipt"}
          </button>
          <button onClick={onClose} className="btn-ghost">Activate another</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-[#ff2a3a]/30 bg-[#ff2a3a]/5" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/40">{label}</div>
      <div className={`mt-1 text-sm ${mono ? "font-mono" : ""} ${accent ? "text-white" : "text-white/85"}`}>{value}</div>
    </div>
  );
}

