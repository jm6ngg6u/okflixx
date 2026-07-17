import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { LiveBackground } from "@/components/LiveBackground";
import { ClickRipple } from "@/components/ClickRipple";
import { CodeInput, type CodeInputHandle } from "@/components/CodeInput";
import { BackgroundSong } from "@/components/BackgroundSong";
import { submitActivation } from "@/lib/activate.functions";
import { getGateConfig, redeemAccessKey, getCaptchaHealth } from "@/lib/access-keys.functions";
import { getPublicPoolStatus } from "@/lib/settings.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KeyRound, Lock, ShieldCheck, UserCheck, CheckCircle2, RotateCcw, AlertCircle, Loader2, Copy, LifeBuoy, X, Database, Sparkles, Repeat } from "lucide-react";
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
  gatesPassed: { key: "login" | "key" | "captcha"; label: string; detail: string }[];
  sessionExpiresAt: number | null;
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
  // Multi-step progress: idle → checking-login → checking-key → checking-captcha → checking-cookie → activating.
  type Stage = "idle" | "checking-login" | "checking-key" | "checking-captcha" | "checking-cookie" | "activating";
  const [stage, setStage] = useState<Stage>("idle");
  const activate = useServerFn(submitActivation);
  const fetchGate = useServerFn(getGateConfig);
  const redeemFn = useServerFn(redeemAccessKey);
  const fetchCaptchaHealth = useServerFn(getCaptchaHealth);


  // Gate config polled every 10s so admin toggles reach the landing page.
  const gate = useQuery({
    queryKey: ["public-gate"],
    queryFn: () => fetchGate(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  // Live captcha health for the status banner (5-min rolling window).
  const captchaHealth = useQuery({
    queryKey: ["public-captcha-health"],
    queryFn: () => fetchCaptchaHealth(),
    refetchInterval: 15_000,
    enabled: !!gate.data?.captchaRequired,
  });

  // Live cookie-pool status shown on the landing page. Mirrors the exact RPC
  // the server picker uses, so what a user sees here is what actually gets
  // considered when they submit a code. 5s cadence keeps it feeling live
  // without hammering the server.
  const fetchPoolStatus = useServerFn(getPublicPoolStatus);
  const poolStatus = useQuery({
    queryKey: ["public-pool-status"],
    queryFn: () => fetchPoolStatus(),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });

  const [accessKey, setAccessKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<
    | { kind: "no_cookie" | "exhausted"; message: string; attempts?: number; code: string; at: number }
    | null
  >(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [autoRetry, setAutoRetry] = useState(true);

  // Short-lived (10 min) HMAC pass minted after a successful captcha verify.
  // Sent on subsequent activations so the user doesn't have to re-solve for
  // every retry / new code within the window. Server enforces expiry + binding.
  const CAPTCHA_PASS_KEY = "cp1";
  const [captchaPassToken, setCaptchaPassToken] = useState<string | null>(
    typeof window !== "undefined" ? (() => {
      const raw = sessionStorage.getItem(CAPTCHA_PASS_KEY);
      if (!raw) return null;
      try {
        const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
        return exp > Date.now() ? token : null;
      } catch { return null; }
    })() : null,
  );
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

  // Retry countdown for service errors (no_cookie / exhausted).
  const handleActivateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (retryCountdown <= 0) return;
    const t = window.setTimeout(() => {
      setRetryCountdown((n) => {
        const next = Math.max(0, n - 1);
        if (next === 0 && autoRetry && serviceError) {
          // Fire on next tick so state settles.
          window.setTimeout(() => handleActivateRef.current?.(), 0);
        }
        return next;
      });
    }, 1000);
    return () => window.clearTimeout(t);
  }, [retryCountdown, autoRetry, serviceError]);

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
      // Captcha is satisfied by either a fresh widget token OR a live pass token.
      needsCaptcha: g.captchaRequired && !captchaToken && !captchaPassToken,
      needsKey: g.accessKeyRequired && !accessKey && !sessionToken,
      hasSession: !!sessionToken,
    };
  }, [gate.data, authUserId, captchaToken, captchaPassToken, accessKey, sessionToken]);

  // --- Redeem key ---
  const [redeeming, setRedeeming] = useState(false);
  async function redeemKey() {
    setKeyError(null);
    if (!accessKey.trim()) {
      setKeyError("Enter your access key to continue.");
      toast.error("Access key required", { description: "Paste the key you received to unlock activation." });
      return;
    }
    if (!fingerprint) {
      setKeyError("Preparing security check — try again in a moment.");
      toast.error("Security check not ready", { description: "Give the page a moment to finish loading." });
      return;
    }
    setRedeeming(true);
    try {
      const r = await redeemFn({ data: { code: accessKey.trim(), fingerprint } });
      if (!r.ok) {
        const desc = r.reason === "already_redeemed" ? "This key was used on another device."
          : r.reason === "expired" ? "This key has expired."
          : r.reason === "disabled" ? "This key has been disabled."
          : "Check the key and try again.";
        setKeyError(desc);
        toast.error("Key rejected", { description: desc });
        return;
      }
      setKeyError(null);
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
      const msg = e?.message ?? "Network error — please try again.";
      setKeyError(msg);
      toast.error("Redeem failed", { description: msg });
    } finally {
      setRedeeming(false);
    }
  }

  // Reset just the *attempt* state. Keeps the code the user typed but drops
  // captcha tokens / pass / 24h session / key input / inline errors, then
  // re-solves whichever gates are currently enabled.
  const resetAttempt = () => {
    setCaptchaToken("");
    setCaptchaError(null);
    setCaptchaPassToken(null);
    try { sessionStorage.removeItem(CAPTCHA_PASS_KEY); } catch { /* noop */ }
    setAccessKey("");
    setKeyError(null);
    if (sessionToken) {
      localStorage.removeItem(SESSION_KEY);
      setSessionToken(null);
    }
    setLoginError(null);
    // Reset the captcha widget so a fresh challenge renders.
    try {
      const api: any = captchaWidgetProviderRef.current === "hcaptcha"
        ? (window as any).hcaptcha : (window as any).turnstile;
      api?.reset?.();
    } catch { /* noop */ }
    toast("Attempt reset", { description: "Re-run the security checks below." });
  };

  const handleActivate = async () => {
    // Client throttle — 3s cooldown between submits.
    const now = Date.now();
    if (submitting) return;
    if (now - lastSubmitRef.current < 3000) {
      toast.error("Slow down a moment.", { description: "Please wait a few seconds between activations." });
      return;
    }
    lastSubmitRef.current = now;

    const code = (codeRef.current?.getCode() ?? "").toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      toast.error("Invalid TV code", { description: "Enter the full 8-character code shown on your TV screen." });
      return;
    }

    // Pre-flight gate checks — server is still source of truth, but naming
    // the blocking gate lets the user act immediately.
    if (gateBlocks.needsLogin) {
      setLoginError("Sign in with Google to continue.");
      toast.error("Sign-in required", { description: "Use the Sign in button above the code panel." });
      return;
    }
    if (gateBlocks.needsKey) {
      setKeyError("Redeem your access key before submitting.");
      toast.error("Access key required", { description: "Paste your key and press Verify." });
      return;
    }
    if (gateBlocks.needsCaptcha) {
      setCaptchaError("Complete the human check below.");
      toast.error("Human check required", { description: "Solve the captcha before submitting." });
      return;
    }

    setLoginError(null); setKeyError(null); setCaptchaError(null); setServiceError(null); setRetryCountdown(0);
    setSubmitting(true);

    // Walk through enabled gates so the user sees a real per-step progress.
    const g = gate.data;
    const steps: Stage[] = [];
    if (g?.loginRequired) steps.push("checking-login");
    if (g?.accessKeyRequired) steps.push("checking-key");
    if (g?.captchaRequired) steps.push("checking-captcha");
    steps.push("checking-cookie");
    const stageTimers: number[] = [];
    setStage(steps[0]);
    for (let i = 1; i < steps.length; i++) {
      stageTimers.push(window.setTimeout(() => setStage(steps[i]), i * 450));
    }
    const activatingTimer = window.setTimeout(() => setStage("activating"), steps.length * 450 + 400);

    try {
      const result = await activate({
        data: {
          code,
          website: honeypotRef.current?.value ?? "",
          elapsedMs: now - mountedAtRef.current,
          accessKey: accessKey || null,
          accessSessionToken: sessionToken,
          captchaToken: captchaToken || null,
          captchaWidgetProvider: captchaWidgetProviderRef.current,
          captchaPassToken: captchaPassToken || null,
          fingerprint: fingerprint || null,
          authUserId,
        },
      });
      // Server-minted captcha_pass — cache for follow-up activations.
      const cp = (result as any).captchaPass as { token: string; exp: number } | null | undefined;
      if (cp && cp.token) {
        setCaptchaPassToken(cp.token);
        try { sessionStorage.setItem(CAPTCHA_PASS_KEY, JSON.stringify(cp)); } catch { /* noop */ }
      }
      if (result.ok) {
        // Snapshot which gates passed for the receipt.
        const passed: SuccessPayload["gatesPassed"] = [];
        if (g?.loginRequired) passed.push({ key: "login", label: "Sign-in", detail: authEmail ?? "Signed in" });
        if (g?.accessKeyRequired) passed.push({
          key: "key",
          label: "Access key",
          detail: sessionToken ? "24-hour session" : "Verified",
        });
        if (g?.captchaRequired) passed.push({
          key: "captcha",
          label: "Human check",
          detail: cp?.token ? "Captcha pass · 10 min" : "Verified",
        });
        setSuccess({
          code,
          attempts: result.attempts,
          policy: result.policy,
          redirectUrl: result.redirectUrl,
          gatesPassed: passed,
          sessionExpiresAt: cp?.exp ?? null,
          account: result.account,
        });
      } else if (result.error === "rate_limited") {
        toast.error("Too many attempts", { description: "Try again in about 10 minutes, or solve the captcha to unlock unlimited activations." });
      } else if (result.error === "bot_detected") {
        toast.error("Automated activity detected", { description: "Refresh the page and try again." });
      } else if (result.error === "invalid_code") {
        toast.error("Invalid TV code", { description: result.message ?? "Check the code shown on your TV and re-enter it." });
      } else if (result.error === "maintenance") {
        toast.error("Service unavailable", { description: result.message ?? "We're briefly down for maintenance — try again shortly." });
      } else if (result.error === "login_required") {
        setLoginError(result.message ?? "Sign in to activate.");
        toast.error("Login gate blocked activation", { description: result.message ?? "Sign in with Google to continue." });
      } else if (result.error === "captcha_required" || result.error === "captcha_invalid") {
        const msg = result.message ?? "Captcha check failed. Please retry.";
        setCaptchaError(msg);
        setCaptchaToken("");
        setCaptchaPassToken(null);
        try { sessionStorage.removeItem(CAPTCHA_PASS_KEY); } catch { /* noop */ }
        try {
          const api: any = captchaWidgetProviderRef.current === "hcaptcha"
            ? (window as any).hcaptcha : (window as any).turnstile;
          api?.reset?.();
        } catch { /* noop */ }
        toast.error("Captcha gate blocked activation", { description: "Solve the fresh human check below and try again." });
      } else if (result.error === "access_key_required" || result.error === "access_key_invalid") {
        if (result.error === "access_key_invalid" && sessionToken) {
          localStorage.removeItem(SESSION_KEY);
          setSessionToken(null);
        }
        setKeyError(result.message ?? "Access key required.");
        toast.error("Access-key gate blocked activation", {
          description: result.error === "access_key_invalid" ? "Your 24-hour session expired — redeem a fresh key." : "Enter and verify your access key.",
        });
      } else if (result.error === "no_cookie") {
        const errCode = `NC-${Date.now().toString(36).toUpperCase().slice(-6)}`;
        setServiceError({
          kind: "no_cookie",
          message: result.message ?? "Cookie pool is empty. Our team has been alerted — try again in a moment.",
          code: errCode,
          at: Date.now(),
        });
        setRetryCountdown(30);
        setAutoRetry(true);
        toast.error("Cookie pool empty", {
          description: `No active cookies available. Auto-retry in 30s · ${errCode}`,
        });
      } else if (result.error === "exhausted") {
        const errCode = `EX-${Date.now().toString(36).toUpperCase().slice(-6)}`;
        setServiceError({
          kind: "exhausted",
          message: result.message ?? "We tried several cookies and none activated this code.",
          attempts: result.attempts,
          code: errCode,
          at: Date.now(),
        });
        setRetryCountdown(20);
        setAutoRetry(true);
        toast.error("Activation exhausted", {
          description: `Attempted ${result.attempts ?? "several"} cookies. Auto-retry in 20s · ${errCode}`,
        });
      } else {
        toast.error("Server hiccup", { description: "Try again in a moment." });
      }
    } catch (err) {
      console.error(err);
      toast.error("Network error", { description: "Check your connection and try again." });
    } finally {
      stageTimers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(activatingTimer);
      setStage("idle");

      setSubmitting(false);
    }
  };
  handleActivateRef.current = handleActivate;


  const anyGate = !!(gate.data && (gate.data.accessKeyRequired || gate.data.captchaRequired || gate.data.loginRequired));

  // Ordered list of enabled gates with satisfaction state → drives the header,
  // progress bar, and numbered badges. Only reads gate.data; never invents gates.
  const gateItems = useMemo(() => {
    const g = gate.data;
    if (!g) return [] as { key: "login" | "key" | "captcha"; label: string; done: boolean }[];
    const out: { key: "login" | "key" | "captcha"; label: string; done: boolean }[] = [];
    if (g.loginRequired) out.push({ key: "login", label: "Sign in", done: !!authUserId });
    if (g.accessKeyRequired) out.push({ key: "key", label: "Access key", done: !!sessionToken });
    if (g.captchaRequired) out.push({ key: "captcha", label: "Human check", done: !!(captchaToken || captchaPassToken) });
    return out;
  }, [gate.data, authUserId, sessionToken, captchaToken, captchaPassToken]);
  const doneCount = gateItems.filter((g) => g.done).length;
  const allSatisfied = gateItems.length > 0 && doneCount === gateItems.length;




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
        <div className="flex items-center gap-3">
          {authUserId ? (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 text-[11px] uppercase tracking-widest text-emerald-100/90">
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <Link to="/account" className="font-mono normal-case tracking-normal hover:text-white transition" title="My activations">
                {authEmail}
              </Link>
              <button
                type="button"
                onClick={async () => { await supabase.auth.signOut(); }}
                className="ml-1 text-white/40 hover:text-white transition"
                title="Sign out"
              >
                ×
              </button>
            </div>
          ) : gate.data?.loginRequired ? (
            <Link to="/login" className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-[11px] uppercase tracking-widest text-white/80 transition">
              <Lock className="w-3.5 h-3.5" />
              Sign in
            </Link>
          ) : null}
          <a href="#activate" className="btn-red text-sm">Activate →</a>
        </div>
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

              {/* ---- ACCESS GATES ---- only visible for gates admin enabled */}
              {anyGate && (
                <div className="mt-6">
                  {/* Header strip: live count + progress bar */}
                  <div className="rounded-t-lg border border-white/10 border-b-0 bg-gradient-to-b from-white/[0.06] to-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ShieldCheck className={`w-4 h-4 ${allSatisfied ? "text-emerald-400" : "text-[#ff8a90]"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">
                          Security requirements
                        </div>
                        <div className="text-sm text-white/90 mt-0.5 truncate">
                          {allSatisfied
                            ? "All checks passed — ready to activate."
                            : `${doneCount} of ${gateItems.length} completed · finish the steps below.`}
                        </div>
                      </div>
                      <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest border ${
                        allSatisfied
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                          : "border-[#ff2a3a]/40 bg-[#ff2a3a]/10 text-[#ff8a90]"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${allSatisfied ? "bg-emerald-400" : "bg-[#ff2a3a] animate-pulse"}`} />
                        {allSatisfied ? "Ready" : "Action needed"}
                      </span>
                      <button
                        type="button"
                        onClick={resetAttempt}
                        disabled={submitting}
                        title="Clear captcha, key session and re-run enabled gates"
                        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest border border-white/10 bg-white/[0.04] text-white/70 hover:text-white hover:border-white/20 hover:bg-white/[0.08] transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3 h-3" /> Reset
                      </button>

                    </div>
                    <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full transition-[width] duration-500 ease-out ${
                          allSatisfied ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
                                       : "bg-gradient-to-r from-[#ff2a3a] to-[#ff8a90]"
                        }`}
                        style={{ width: `${(doneCount / gateItems.length) * 100}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {gateItems.map((g, i) => (
                        <span
                          key={g.key}
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-widest border ${
                            g.done
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                              : "border-white/10 bg-white/[0.04] text-white/55"
                          }`}
                        >
                          <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${
                            g.done ? "bg-emerald-500/30 text-emerald-100" : "bg-white/10 text-white/60"
                          }`}>
                            {g.done ? "✓" : i + 1}
                          </span>
                          {g.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-b-lg border border-white/10 border-t-0 bg-black/20 p-3 space-y-3">

                  {/* Login gate */}
                  {gate.data?.loginRequired && (
                    <div className={`rounded-lg border p-3 ${authUserId ? "border-emerald-500/30 bg-emerald-500/5" : loginError ? "border-red-500/40 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                      <div className="flex items-center gap-3">
                        <UserCheck className={`w-4 h-4 ${authUserId ? "text-emerald-400" : "text-amber-400"}`} />
                        <div className="flex-1 text-xs">
                          {authUserId ? (
                            <>Signed in as <span className="text-white font-mono">{authEmail}</span></>
                          ) : (
                            <>Sign-in required for activation.</>
                          )}
                        </div>
                        {!authUserId && (
                          <Link to="/login" className="text-xs text-[#ff8a90] hover:text-white underline underline-offset-2">Sign in →</Link>
                        )}
                      </div>
                      {!authUserId && !loginError && (
                        <p className="mt-1.5 pl-7 text-[11px] text-white/45 leading-snug">
                          Continue with Google — takes 5 seconds, one click.
                        </p>
                      )}
                      {loginError && !authUserId && (
                        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{loginError}</span>
                        </div>
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
                        <>
                          <p className="text-[11px] text-white/45 leading-snug mb-2">
                            Paste the key you received, then press Verify. Session and one-time keys are supported.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={accessKey}
                              onChange={(e) => { setAccessKey(e.target.value.toUpperCase()); if (keyError) setKeyError(null); }}
                              placeholder="NFX-XXXX-XXXX-XXXX"
                              className={`flex-1 bg-black/40 border rounded-md px-3 py-2 font-mono text-sm text-white placeholder:text-white/25 focus:outline-none ${keyError ? "border-red-500/50 focus:border-red-500/70" : "border-white/10 focus:border-[#ff2a3a]/60"}`}
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
                          {keyError && (
                            <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{keyError}</span>
                            </div>
                          )}
                        </>
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
                      <p className="text-[11px] text-white/45 leading-snug mb-2">
                        {captchaPassToken
                          ? "You have a captcha pass — no need to solve again for the next few minutes."
                          : "Solve the challenge once. Successful checks unlock a 10-minute pass on this device."}
                      </p>



                      {/* Live captcha status banner */}
                      {captchaHealth.data && captchaHealth.data.status !== "idle" && (
                        <div
                          className={`mb-2 rounded-md border px-3 py-2 text-[11px] flex items-center gap-2 ${
                            captchaHealth.data.status === "healthy"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                              : captchaHealth.data.status === "degraded"
                                ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                                : "border-red-500/30 bg-red-500/10 text-red-100"
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              captchaHealth.data.status === "healthy"
                                ? "bg-emerald-400 animate-pulse"
                                : captchaHealth.data.status === "degraded"
                                  ? "bg-amber-400 animate-pulse"
                                  : "bg-red-400 animate-pulse"
                            }`}
                          />
                          <span className="font-medium">
                            {captchaHealth.data.status === "healthy"
                              ? "Captcha service healthy"
                              : captchaHealth.data.status === "degraded"
                                ? "Captcha service degraded"
                                : "Captcha service disrupted"}
                          </span>
                          <span className="text-white/50 font-mono">
                            {Math.round(captchaHealth.data.successRate * 100)}% ok · {captchaHealth.data.total} tries / {captchaHealth.data.windowMinutes}m
                          </span>
                          {captchaHealth.data.status !== "healthy" && captchaHealth.data.lastFailureReason && (
                            <span className="ml-auto text-white/60 truncate max-w-[180px]" title={captchaHealth.data.lastFailureReason}>
                              {captchaHealth.data.lastFailureReason}
                            </span>
                          )}
                        </div>
                      )}

                      <div
                        ref={captchaWidgetRef}
                        className="min-h-[78px]"
                      />
                      {captchaError && (
                        <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
                          <span className="font-mono uppercase tracking-widest text-red-300/80 mr-2">Reason</span>
                          {captchaError}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </div>
              )}
              {/* Per-step activation progress — visible during submit */}
              {submitting && (
                <div className="mt-6 rounded-lg border border-[#ff2a3a]/30 bg-[#ff2a3a]/5 p-3">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] text-[#ff8a90] mb-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {stage === "checking-login" ? "Verifying sign-in"
                      : stage === "checking-key" ? "Verifying access key"
                      : stage === "checking-captcha" ? "Verifying human check"
                      : stage === "checking-cookie" ? "Verifying cookie pool"
                      : stage === "activating" ? "Activating on Netflix"
                      : "Working"}
                  </div>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#ff8a90] transition-[width] duration-500 ease-out"
                      style={{
                        width: stage === "checking-login" ? "20%"
                          : stage === "checking-key" ? "40%"
                          : stage === "checking-captcha" ? "60%"
                          : stage === "checking-cookie" ? "80%"
                          : stage === "activating" ? "95%" : "10%",
                      }}
                    />
                  </div>
                </div>
              )}

              {serviceError && !submitting && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mt-4 rounded-lg border border-[#ff2a3a]/40 bg-gradient-to-br from-[#ff2a3a]/10 via-black/40 to-black/20 p-4 shadow-[0_0_0_1px_rgba(255,42,58,0.15)_inset]"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-8 h-8 rounded-full bg-[#ff2a3a]/15 border border-[#ff2a3a]/40 flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-[#ff8a90]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#ff8a90]">
                          {serviceError.kind === "no_cookie" ? "Cookie pool empty" : "Activation exhausted"}
                        </span>
                        {serviceError.attempts != null && (
                          <span className="font-mono text-[10px] uppercase tracking-widest text-white/50">
                            · {serviceError.attempts} attempts
                          </span>
                        )}
                        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-white/40">
                          Code
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                `${serviceError.code} · ${serviceError.kind} · ${new Date(serviceError.at).toISOString()}${serviceError.attempts != null ? ` · attempts=${serviceError.attempts}` : ""}`,
                              ).then(() => toast.success("Error code copied", { description: "Share this with support." }))
                                .catch(() => toast.error("Copy failed"));
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.04] text-white/80 hover:text-white hover:border-white/25 transition"
                            title="Copy error code"
                          >
                            {serviceError.code}
                            <Copy className="w-3 h-3" />
                          </button>
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-white/90 leading-relaxed">
                        {serviceError.kind === "no_cookie"
                          ? "The activation pool is momentarily empty — every active cookie is locked in another request or being refreshed."
                          : `We tried ${serviceError.attempts ?? "several"} cookies and none accepted your code. This usually means cookies expired mid-request.`}
                      </p>
                      <p className="mt-1.5 text-xs text-white/60">
                        <span className="font-mono uppercase tracking-widest text-white/40">Next step · </span>
                        {serviceError.kind === "no_cookie"
                          ? "Wait a few seconds — cookies auto-unlock. Your TV code stays valid, no need to re-enter it."
                          : "Keep the same TV code visible and let us retry with a fresh cookie."}
                      </p>
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => { setServiceError(null); setRetryCountdown(0); setAutoRetry(true); handleActivate(); }}
                          disabled={retryCountdown > 0 && !autoRetry}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border border-[#ff2a3a]/50 bg-[#ff2a3a]/15 text-white hover:bg-[#ff2a3a]/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <RotateCcw className={`w-3 h-3 ${retryCountdown > 0 && autoRetry ? "animate-spin-slow" : ""}`} />
                          {retryCountdown > 0
                            ? (autoRetry ? `Auto-retry in ${retryCountdown}s` : `Retry in ${retryCountdown}s`)
                            : "Retry now"}
                        </button>
                        {retryCountdown > 0 && autoRetry && (
                          <button
                            type="button"
                            onClick={() => setAutoRetry(false)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border border-white/15 bg-white/[0.04] text-white/80 hover:text-white hover:border-white/30 transition"
                            title="Cancel auto-retry"
                          >
                            <X className="w-3 h-3" />
                            Cancel auto-retry
                          </button>
                        )}
                        <a
                          href="mailto:support@lovable.dev?subject=TV%20Activation%20Error"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border border-white/10 bg-white/[0.04] text-white/70 hover:text-white hover:border-white/25 transition"
                        >
                          <LifeBuoy className="w-3 h-3" />
                          Get help
                        </a>
                        <button
                          type="button"
                          onClick={() => { setServiceError(null); setRetryCountdown(0); setAutoRetry(false); }}
                          className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border border-white/10 bg-white/[0.04] text-white/50 hover:text-white/90 hover:border-white/20 transition"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}


              <button
                onClick={handleActivate}
                disabled={submitting}
                className="btn-red w-full mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {stage === "checking-login" ? "◆ Verifying sign-in…"
                  : stage === "checking-key" ? "◆ Verifying access key…"
                  : stage === "checking-captcha" ? "◆ Verifying human check…"
                  : stage === "checking-cookie" ? "◆ Verifying cookie…"
                  : stage === "activating" ? "◆ Activating on Netflix…"
                  : submitting ? "Working…"
                  : "Activate Now →"}
              </button>


              <div className="mt-5 pt-5 border-t border-white/10 flex justify-between font-mono text-[10px] uppercase tracking-widest text-white/40">
                <span>Encrypted End-to-End</span>
                <span className="text-[#ff2a3a]">● Online</span>
              </div>
            </div>
          </div>

          {/* LIVE POOL STATUS — mirrors server-side eligibility RPC */}
          <PoolStatusPanel data={poolStatus.data} loading={poolStatus.isLoading} />


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

  const expiresLabel = useMemo(() => {
    if (!payload.sessionExpiresAt) return null;
    const ms = payload.sessionExpiresAt - Date.now();
    if (ms <= 0) return "expired";
    const m = Math.max(1, Math.round(ms / 60000));
    return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
  }, [payload.sessionExpiresAt]);

  const capture = async () => {
    try {
      // Best-effort: copy a text receipt to clipboard so the user has proof.
      const a = payload.account;
      const gateLines = payload.gatesPassed.length
        ? [`Gates passed: ${payload.gatesPassed.map((g) => `${g.label} (${g.detail})`).join(", ")}`]
        : [];
      const expLine = payload.sessionExpiresAt
        ? [`Session expires: ${new Date(payload.sessionExpiresAt).toLocaleString()}`]
        : [];
      const lines = [
        `EMBERLORD · Netflix TV Activation`,
        `Code: ${payload.code}`,
        `Time: ${new Date().toLocaleString()}`,
        `Attempts: ${payload.attempts}`,
        `Policy: ${payload.policy}`,
        ...gateLines,
        ...expLine,
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

        {/* Gates passed receipt — only when at least one gate ran */}
        {payload.gatesPassed.length > 0 && (
          <div className="mt-5 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.3em] text-emerald-300 mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              Security checks passed
              {expiresLabel && (
                <span className="ml-auto normal-case tracking-normal text-[11px] text-emerald-100/80">
                  Session valid for <span className="font-mono text-white">{expiresLabel}</span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {payload.gatesPassed.map((g) => (
                <span
                  key={g.key}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[11px] text-emerald-100"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                  <span className="font-mono uppercase tracking-widest text-[10px] text-emerald-200/80">{g.label}</span>
                  <span className="text-emerald-100/80">·</span>
                  <span>{g.detail}</span>
                </span>
              ))}
            </div>
          </div>
        )}


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

