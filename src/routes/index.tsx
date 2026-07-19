import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LiveBackground } from "@/components/LiveBackground";
import { ClickRipple } from "@/components/ClickRipple";
import { CodeInput, type CodeInputHandle } from "@/components/CodeInput";
import { BackgroundSong } from "@/components/BackgroundSong";
import { getSuccessActivationCount, submitActivation } from "@/lib/activate.functions";
import { getGateConfig, redeemAccessKey } from "@/lib/access-keys.functions";
import { getPublicContacts } from "@/lib/settings.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KeyRound, Lock, UserCheck, CheckCircle2, RotateCcw, AlertCircle, Loader2, Send, Instagram, Phone } from "lucide-react";
import logo from "@/assets/brand-logo.png";
import { useBrand } from "@/lib/branding-context";

function Wordmark() {
  const b = useBrand();
  return (
    <>
      {b.name_prefix}
      <span className="text-brand-accent">{b.name_suffix}</span>
    </>
  );
}

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
  const b = useBrand();
  const codeRef = useRef<CodeInputHandle>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const mountedAtRef = useRef<number>(Date.now());
  const lastSubmitRef = useRef<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessPayload | null>(null);
  // Single generic in-flight indicator; internal stages are not exposed.
  const [stage, setStage] = useState<"idle" | "working">("idle");
  // Live digit count from the CodeInput so Stage 01 (ENTER) fills instantly as user types.
  const [codeLen, setCodeLen] = useState(0);

  const activate = useServerFn(submitActivation);
  const fetchGate = useServerFn(getGateConfig);
  const redeemFn = useServerFn(redeemAccessKey);
  const fetchSuccessCount = useServerFn(getSuccessActivationCount);
  const qc = useQueryClient();
  const successCount = useQuery({
    queryKey: ["success-activation-count"],
    queryFn: () => fetchSuccessCount(),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    staleTime: 1000,
  });



  // Realtime push on app_settings — banner flips within ~200ms.
  // A 30s poll is retained purely as a safety net for missed events.
  const gate = useQuery({
    queryKey: ["public-gate"],
    queryFn: () => fetchGate(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
  useEffect(() => {
    const ch = supabase
      .channel("public-gate-settings")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_settings" },
        (payload: any) => {
          const key = (payload.new?.key ?? payload.old?.key) as string | undefined;
          if (!key) return;
          if (
            key === "maintenance_enabled" ||
            key === "maintenance_message" ||
            key === "maintenance_starts_at" ||
            key === "maintenance_ends_at" ||
            key === "access_key_required" ||
            key === "login_required"
          ) {
            qc.invalidateQueries({ queryKey: ["public-gate"] });
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  // Live activation counter: system-owned, driven only by successful activation records.
  useEffect(() => {
    const ch = supabase
      .channel("activation-success")
      .on("broadcast", { event: "tick" }, () => {
        qc.setQueryData(["success-activation-count"], (old: any) => {
          if (!old || typeof old.count !== "number") return old;
          return { ...old, ok: true, count: old.count + 1 };
        });
        qc.invalidateQueries({ queryKey: ["success-activation-count"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Auto-tick every 30s so a scheduled window flips on/off in-place without user action.
  useEffect(() => {
    if (!gate.data?.maintenanceStartsAt && !gate.data?.maintenanceEndsAt) return;
    const t = window.setInterval(() => qc.invalidateQueries({ queryKey: ["public-gate"] }), 30_000);
    return () => window.clearInterval(t);
  }, [qc, gate.data?.maintenanceStartsAt, gate.data?.maintenanceEndsAt]);

  const [accessKey, setAccessKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<
    | { kind: "no_cookie" | "exhausted"; message: string; attempts?: number; code: string; at: number }
    | null
  >(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [autoRetry, setAutoRetry] = useState(true);

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

  const gateBlocks = useMemo(() => {
    const g = gate.data;
    if (!g) return { needsLogin: false, needsKey: false, hasSession: false };
    return {
      needsLogin: g.loginRequired && !authUserId,
      needsKey: g.accessKeyRequired && !accessKey && !sessionToken,
      hasSession: !!sessionToken,
    };
  }, [gate.data, authUserId, accessKey, sessionToken]);


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
  // access key input / 24h session / inline errors.
  const resetAttempt = () => {
    setAccessKey("");
    setKeyError(null);
    if (sessionToken) {
      localStorage.removeItem(SESSION_KEY);
      setSessionToken(null);
    }
    setLoginError(null);
    toast("Attempt reset", { description: "Re-run the checks below." });
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
      setLoginError("Please sign in to continue.");
      toast.error("Sign in required");
      return;
    }
    if (gateBlocks.needsKey) {
      setKeyError("Please enter your access key.");
      toast.error("Access key required");
      return;
    }

    setLoginError(null); setKeyError(null); setServiceError(null); setRetryCountdown(0);
    setSubmitting(true);
    setStage("working");

    try {
      const result = await activate({
        data: {
          code,
          website: honeypotRef.current?.value ?? "",
          elapsedMs: now - mountedAtRef.current,
          accessKey: accessKey || null,
          accessSessionToken: sessionToken,
          fingerprint: fingerprint || null,
          authUserId,
        },
      });
      if (result.ok) {
        setSuccess({
          code,
          redirectUrl: result.redirectUrl,
          account: result.account,
        });
        qc.invalidateQueries({ queryKey: ["success-activation-count"] });

      } else if (result.error === "invalid_code") {
        toast.error("Invalid TV code", { description: "Please check the code shown on your TV and try again." });
      } else if (result.error === "maintenance") {
        toast.error("Service temporarily unavailable", { description: "Please try again in a moment." });
      } else if (result.error === "login_required") {
        setLoginError("Please sign in to continue.");
        toast.error("Sign in required");
      } else if (result.error === "access_key_required" || result.error === "access_key_invalid") {
        if (result.error === "access_key_invalid" && sessionToken) {
          localStorage.removeItem(SESSION_KEY);
          setSessionToken(null);
        }
        setKeyError("Please enter a valid access key.");
        toast.error("Access key required");
      } else if (result.error === "no_cookie" || result.error === "exhausted") {
        setServiceError({
          kind: result.error === "no_cookie" ? "no_cookie" : "exhausted",
          message: "We couldn't activate your TV right now. Please try again in a moment.",
          code: "",
          at: Date.now(),
        });
        setRetryCountdown(20);
        setAutoRetry(true);
        toast.error("Activation failed", { description: "Please try again in a moment." });
      } else {
        toast.error("Activation failed", { description: "Please try again in a moment." });
      }
    } catch (err) {
      console.error(err);
      toast.error("Activation failed", { description: "Please check your connection and try again." });
    } finally {
      setStage("idle");
      setSubmitting(false);
    }
  };
  handleActivateRef.current = handleActivate;



  const anyGate = !!(gate.data && (gate.data.accessKeyRequired || gate.data.loginRequired));

  const gateItems = useMemo(() => {
    const g = gate.data;
    if (!g) return [] as { key: "login" | "key"; label: string; done: boolean }[];
    const out: { key: "login" | "key"; label: string; done: boolean }[] = [];
    if (g.loginRequired) out.push({ key: "login", label: "Sign in", done: !!authUserId });
    if (g.accessKeyRequired) out.push({ key: "key", label: "Access key", done: !!sessionToken });
    return out;
  }, [gate.data, authUserId, sessionToken]);
  const doneCount = gateItems.filter((g) => g.done).length;
  const allSatisfied = gateItems.length > 0 && doneCount === gateItems.length;





  const homeScale = Math.max(60, Math.min(160, parseInt((b as any).home_scale || "100", 10) || 100)) / 100;
  return (
    <div
      className="relative min-h-screen text-white"
      style={{ ["--brand-surface-scale" as any]: homeScale }}
    >
      <LiveBackground />
      {success && <SuccessOverlay payload={success} onClose={() => setSuccess(null)} />}

      <ClickRipple />
      <BackgroundSong />

      {/* NAV */}
      <nav className="relative z-20 flex items-center justify-between px-6 md:px-12 py-5 max-w-7xl mx-auto">
        <Link to="/" className="flex items-center gap-3 group">
          <img src={logo} alt="Emberlord" data-wave-origin className="h-10 w-10 object-contain logo-shine group-hover:scale-110 transition" width={40} height={40} />
          <span className="font-display brand-wordmark-nav tracking-tight wordmark-pulse"><Wordmark /></span>
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

      {/* MAINTENANCE BANNER — visible while admin has maintenance ON */}
      {gate.data?.maintenance && (
        <div className="relative z-20 max-w-5xl mx-auto px-6 md:px-12 -mt-2 mb-2">
          <div
            role="alert"
            aria-live="polite"
            className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-r from-amber-500/[0.10] via-[#ff2a3a]/[0.10] to-amber-500/[0.10] backdrop-blur-xl px-5 md:px-7 py-4 md:py-5 shadow-[0_0_40px_-10px_rgba(255,42,58,0.45)]"
          >
            <div className="absolute inset-0 pointer-events-none opacity-40 [background:radial-gradient(600px_120px_at_20%_0%,rgba(255,180,80,0.18),transparent),radial-gradient(600px_120px_at_80%_100%,rgba(255,42,58,0.18),transparent)]" />
            <div className="relative flex items-start gap-4">
              <div className="shrink-0 mt-0.5">
                <div className="relative">
                  <img src={logo} alt="" className="h-10 w-10 object-contain logo-shine" width={40} height={40} />
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400" />
                  </span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-300/90">Maintenance in progress</span>
                  <span className="hidden sm:inline-block h-px flex-1 bg-gradient-to-r from-amber-400/40 to-transparent" />
                </div>
                <h2 className="font-display text-lg md:text-xl leading-tight text-white">
                  <span className="text-shine">Service temporarily unavailable</span>
                </h2>
                <p className="mt-1 text-sm md:text-[15px] text-white/75 leading-relaxed">
                  {gate.data.maintenanceMessage || "We're performing scheduled maintenance. New activations are paused — please check back shortly."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* HERO — CENTERED */}
      <section id="activate" className="relative">
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 md:px-12 pt-10 sm:pt-14 md:pt-16 pb-16 sm:pb-20 md:pb-24 text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur text-[11px] sm:text-xs text-white/75 mb-6 sm:mb-8 reveal max-w-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff2a3a] animate-pulse shrink-0" />
            <span className="font-mono uppercase tracking-widest brand-hero-kicker truncate">{b.hero_kicker}</span>
          </div>

          <h1 className="font-display brand-hero-title leading-[0.98] tracking-tight reveal">
            {b.hero_headline_1} <br />
            <span className="text-shine">{b.hero_headline_2}</span>
          </h1>

          <p className="mt-5 sm:mt-6 max-w-lg text-white/65 text-[15px] sm:text-base md:text-lg leading-relaxed reveal brand-hero-sub px-1">
            {b.hero_sub}
          </p>

          {/* CODE PANEL — CENTER (system-owned copy, not editable via Branding Studio) */}
          <div id="code-panel" className="reveal mt-8 sm:mt-10 w-full max-w-xl">
            <div className="relative activation-panel p-4 sm:p-6 md:p-8 overflow-hidden">
              <div aria-hidden className="activation-panel-ambient" />
              <div aria-hidden className="activation-panel-grid" />

              {/* Stage rail — SYSTEM stages, live-driven by input + pipeline state */}
              <div className="relative mb-5 sm:mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 sm:px-4">
                <div className="min-w-0 text-left font-mono text-[10px] uppercase tracking-[0.24em] text-white/58">
                  <span className="text-brand-accent">STEP 01</span>
                  <span className="text-white/25 mx-2">/</span>
                  <span className="truncate align-baseline">{codeLen === 0 ? "ENTER CODE" : codeLen < 8 ? `TYPING · ${codeLen}/8` : submitting ? "LINKING" : "READY"}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5" aria-label="Activation stages">
                  {["ENTER", "VERIFY", "LINK"].map((s, i) => {
                    // Deterministic, instant progression:
                    //  ENTER  active as soon as any digit typed
                    //  VERIFY active once all 8 digits present OR submitting
                    //  LINK   active while submitting
                    const enterActive = codeLen > 0;
                    const verifyActive = codeLen === 8 || submitting;
                    const linkActive = submitting;
                    const active = i === 0 ? enterActive : i === 1 ? verifyActive : linkActive;
                    return (
                      <span
                        key={s}
                        title={s}
                          className={`h-1.5 rounded-full transition-all duration-300 ${active ? "w-7 bg-brand-accent shadow-[0_0_14px_rgba(var(--brand-accent-rgb),0.6)]" : "w-2 bg-white/15"}`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="relative text-left">
                <div className="mb-5 flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <h3 className="font-display brand-card-title leading-tight">
                      <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span>Enter your</span>
                        <span className="text-shine">TV code</span>
                      </span>
                    </h3>
                    <p className="mt-2 text-white/58 text-sm leading-relaxed">
                      Type the 8-character code from your TV screen. It updates instantly as you enter each character.
                    </p>
                  </div>
                  <div className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-accent animate-pulse" />
                    8 characters
                  </div>
                </div>

                <CodeInput ref={codeRef} onChange={(filled) => setCodeLen(filled)} />


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
              </div>

              {/* ---- ACCESS GATES ---- only visible for gates admin enabled */}
              {anyGate && (
                <div className="mt-5 sm:mt-6">
                  {/* Header strip removed per request */}


                  <div className="glow-border rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:p-4 space-y-3 backdrop-blur-md">

                  {/* Login gate */}
                  {gate.data?.loginRequired && (
                    <div className={`rounded-xl border p-3 ${authUserId ? "border-[rgba(var(--brand-accent-rgb),0.42)] bg-[rgba(var(--brand-accent-rgb),0.08)]" : loginError ? "border-[rgba(var(--brand-accent-rgb),0.56)] bg-[rgba(var(--brand-accent-rgb),0.10)]" : "border-[rgba(var(--brand-accent-rgb),0.38)] bg-[rgba(var(--brand-accent-rgb),0.06)]"}`}>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                        <UserCheck className="w-4 h-4 text-[#ff8a90] drop-shadow-[0_0_10px_rgba(var(--brand-accent-rgb),0.75)]" />
                        <div className="min-w-0 text-xs text-white/78">
                          {authUserId ? (
                            <>Signed in as <span className="text-white font-mono break-all">{authEmail}</span></>
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
                    <div className={`rounded-xl border p-3 ${sessionToken ? "border-[rgba(var(--brand-accent-rgb),0.44)] bg-[rgba(var(--brand-accent-rgb),0.08)]" : "border-[rgba(var(--brand-accent-rgb),0.26)] bg-white/[0.03]"}`}>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] sm:flex sm:items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">
                        <KeyRound className="w-3.5 h-3.5 text-[#ff8a90]" />
                        <span>Access key required</span>
                        {sessionToken && (
                          <span className="ml-auto inline-flex items-center gap-1 text-[#ffb0b5] text-[10px]">
                            <CheckCircle2 className="w-3 h-3" /> 24h unlock active
                          </span>
                        )}
                      </div>
                      {!sessionToken ? (
                        <>
                          <p className="text-[11px] text-white/45 leading-snug mb-2">
                            Paste the key you received, then press Verify. Session and one-time keys are supported.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={accessKey}
                              onChange={(e) => { setAccessKey(e.target.value.toUpperCase()); if (keyError) setKeyError(null); }}
                              placeholder="NFX-XXXX-XXXX-XXXX"
                              className={`min-w-0 flex-1 bg-black/25 border rounded-md px-3 py-2 font-mono text-sm text-white placeholder:text-white/25 focus:outline-none ${keyError ? "border-red-500/50 focus:border-red-500/70" : "border-white/10 focus:border-[#ff2a3a]/60"}`}
                              autoComplete="off"
                            />
                            <button
                              type="button"
                              onClick={redeemKey}
                              disabled={redeeming || !accessKey.trim()}
                              className="w-full sm:w-auto px-3 py-2 rounded-md bg-white/10 hover:bg-white/15 border border-white/10 text-xs uppercase tracking-widest text-white/80 disabled:opacity-50"
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



                  </div>
                </div>
              )}
              {/* SYSTEM progress — three stages, always in sync with the pipeline. Not editable. */}
              {submitting && (
                <div className="mt-6 rounded-2xl border border-[rgba(var(--brand-accent-rgb),0.30)] bg-white/[0.04] backdrop-blur-md p-4">
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-[#ff8a90] mb-3">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Activating — please keep this tab open
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                    {[
                      { k: "Verifying code", d: "01" },
                      { k: "Linking device", d: "02" },
                      { k: "Finalizing", d: "03" },
                    ].map((s, i) => (
                      <div
                        key={s.k}
                        className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5"
                      >
                        <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/40">{s.d}</div>
                        <div className="text-[11px] text-white/80 truncate">{s.k}</div>
                        <div className="mt-1 h-0.5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#ff8a90]"
                            style={{ animation: `stage-fill 1.8s ease-out ${i * 0.6}s forwards`, width: "0%" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#ff2a3a] to-[#ff8a90] activation-progress-bar" />
                  </div>
                  <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
                    Secure channel · Encrypted · No credentials required
                  </p>
                </div>
              )}

              {serviceError && !submitting && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mt-4 rounded-xl border border-[#ff2a3a]/40 bg-gradient-to-br from-[#ff2a3a]/10 via-black/40 to-black/20 p-4 animate-fade-in"
                >
                  <div className="flex items-start gap-3">
                    <div className="shrink-0 w-9 h-9 rounded-full bg-[#ff2a3a]/15 border border-[#ff2a3a]/40 flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-[#ff8a90]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#ff8a90]">
                        Activation didn't complete
                      </div>
                      <p className="mt-2 text-sm text-white/90 leading-relaxed">
                        Something interrupted the link to your TV. Double-check the on-screen code, then try again — no charges, no lockouts.
                      </p>
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => { setServiceError(null); setRetryCountdown(0); setAutoRetry(true); handleActivate(); }}
                          disabled={retryCountdown > 0 && !autoRetry}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono uppercase tracking-widest border border-[#ff2a3a]/50 bg-[#ff2a3a]/15 text-white hover:bg-[#ff2a3a]/25 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <RotateCcw className={`w-3 h-3 ${retryCountdown > 0 && autoRetry ? "animate-spin-slow" : ""}`} />
                          {retryCountdown > 0 ? `Retry in ${retryCountdown}s` : "Retry activation"}
                        </button>
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
                disabled={submitting || !!gate.data?.maintenance}
                className="btn-red w-full mt-5 disabled:opacity-60 disabled:cursor-not-allowed group relative overflow-hidden"
              >
                <span className="relative z-10 inline-flex items-center gap-2">
                  {gate.data?.maintenance ? (
                    <>Temporarily unavailable</>
                  ) : submitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Activating your TV…</>
                  ) : (
                    <>Activate my TV <span aria-hidden>→</span></>
                  )}
                </span>
                {!submitting && !gate.data?.maintenance && (
                  <span aria-hidden className="absolute inset-y-0 -left-1/3 w-1/3 bg-white/20 skew-x-[-20deg] translate-x-0 group-hover:translate-x-[400%] transition-transform duration-700" />
                )}
              </button>



              <div className="mt-5 pt-5 border-t border-white/10 flex flex-wrap justify-between gap-2 font-mono text-[10px] uppercase tracking-widest text-white/40">
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

      {/* WHY EMBERLORD — system-owned, not editable in Branding Studio. */}
      <section id="features" className="relative py-24 sm:py-28 md:py-32 px-4 sm:px-6 md:px-12">
        <div aria-hidden className="why-orb" />
        <div className="max-w-6xl mx-auto relative">
          <div className="text-center mb-14 md:mb-20 reveal">
            <div className="font-mono uppercase tracking-[0.32em] text-[#ff2a3a] text-[11px] sm:text-xs mb-5 inline-flex items-center gap-3">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff2a3a] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#ff2a3a]" />
              </span>
              {b.section_features_kicker}
            </div>
            <h2 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[1.02] tracking-tight">
              {b.section_features_title_1} <span className="text-shine">{b.section_features_title_2}</span>.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
            {[
              { i: b.why_card_1_index, t: b.why_card_1_title, d: b.why_card_1_desc, live: b.why_card_1_live },
              { i: b.why_card_2_index, t: b.why_card_2_title, d: b.why_card_2_desc, live: b.why_card_2_live },
              { i: b.why_card_3_index, t: b.why_card_3_title, d: b.why_card_3_desc, live: `${(successCount.data?.count ?? 0).toLocaleString()} ${b.why_card_3_live_suffix}` },
            ].map((f) => (
              <article key={f.t} className="why-card reveal group">
                <div className="why-card-inner">
                  <div className="flex items-center justify-between mb-8">
                    <div className="font-mono text-xs sm:text-sm text-[#ff2a3a] tracking-[0.32em]">{f.i}</div>
                    <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-70" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#22c55e]" />
                      </span>
                      Live
                    </div>
                  </div>
                  <h3 className="font-display text-2xl sm:text-3xl md:text-[2rem] leading-[1.1] tracking-tight mb-4">
                    {f.t}
                  </h3>
                  <p className="text-white/60 text-sm sm:text-[15px] leading-relaxed">
                    {f.d}
                  </p>
                  <div className="mt-8 pt-5 border-t border-white/[0.06]">
                    <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.24em] text-white/55 truncate block">
                      {f.live}
                    </span>
                  </div>

                </div>
              </article>
            ))}
          </div>
        </div>
      </section>


      {/* PLAN — SINGLE FREE PREMIUM */}
      <section id="plans" className="relative py-28 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 reveal">
            <div className="font-mono uppercase tracking-[0.3em] text-brand-accent mb-4 brand-section-kicker">{b.section_plan_kicker}</div>
            <h2 className="font-display brand-section-title">{b.section_plan_title_1} <span className="text-live">{b.section_plan_title_2}</span></h2>
            <p className="mt-5 text-white/60 max-w-xl mx-auto">Premium UHD unlocked for every activated TV — every country, every device. No card, no trial, no catch.</p>
          </div>

          <div className="glass glow-ring-anim p-10 md:p-12 reveal text-center">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[#ff2a3a] mb-4">◆ Premium UHD · Global</div>
            <div className="font-display brand-card-title mb-2">Emberlord Premium</div>
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
            <div className="font-mono uppercase tracking-[0.3em] text-brand-accent mb-4 brand-section-kicker">{b.section_devices_kicker}</div>
            <h2 className="font-display brand-section-title">{b.section_devices_title_1} <span className="text-shine">{b.section_devices_title_2}</span></h2>
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

      {/* COMPATIBILITY STRIP — system-owned. Not editable in Branding Studio.
          Trust badges + continuously scrolling device marquee. */}
      <section aria-label="Compatible devices and trust indicators" className="compat-strip">
        <div className="compat-badges">
          <span className="cb">99.99% Uptime</span>
          <span className="cb">AES-256 Encrypted</span>
          <span className="cb">24/7 Support</span>
          <span className="cb">4K · HDR · Dolby</span>
        </div>
        <div className="compat-marquee" role="marquee" aria-live="off">
          <div className="compat-track">
            {(() => {
              const brands = [
                "Samsung Tizen", "Smart TV", "Apple TV", "Roku",
                "Fire TV", "Chromecast", "LG WebOS", "Android TV",
                "Nvidia Shield", "PS5", "Xbox Series X", "Vizio SmartCast",
                "TCL Google TV", "Hisense VIDAA", "Panasonic My Home",
              ];
              const loop = [...brands, ...brands];
              return loop.map((name, i) => (
                <span className="compat-item" key={`${name}-${i}`}>
                  <span className="dot" aria-hidden />
                  {name}
                </span>
              ));
            })()}
          </div>
        </div>
      </section>


      {/* LIVE ACTIVATIONS — system-owned realtime count. Not editable in Branding Studio. */}
      <section id="reviews" className="relative py-20 sm:py-24 md:py-28 px-4 sm:px-6 md:px-12">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 md:mb-16 reveal flex justify-center">
            <div className="activation-panel live-count-panel relative w-full max-w-3xl text-center px-6 sm:px-10 py-10 sm:py-14">
              <div className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.28em] sm:tracking-[0.3em] text-[#ff2a3a] mb-4 break-words">
                // Live activations
              </div>
              <h2 className="font-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl leading-[1.05] tracking-tight">
                <span className="text-live tabular-nums inline-flex items-center gap-2 align-baseline">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#ff2a3a] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#ff2a3a]" />
                  </span>
                  <span className="break-normal">{(successCount.data?.count ?? 0).toLocaleString()}</span>
                </span>{" "}
                <span className="block sm:inline text-white/90">successful TV activations</span>
              </h2>
              <p className="mt-4 text-sm sm:text-base text-white/55 leading-relaxed max-w-2xl mx-auto">
                This number is automatic and updates from completed activations only.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {[
              { q: "Activated in under 20 seconds. Genuinely smooth.", n: "M. Ortega" },
              { q: "The code flow just works. No hoops, no spam.", n: "J. Chen" },
              { q: "Fastest TV setup I've ever done. Support was instant.", n: "S. Nakamura" },
            ].map((t, i) => (
              <div key={`${t.n}-${i}`} className="glass glass-hover p-6 sm:p-8 reveal">
                <div className="text-[#ff2a3a] text-sm mb-4">★ ★ ★ ★ ★</div>
                <p className="text-white/85 leading-relaxed text-[15px] sm:text-base">"{t.q}"</p>
                <div className="mt-6 pt-4 border-t border-white/10 flex justify-between items-center gap-2 text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/50">
                  <span className="truncate">{t.n}</span>
                  <span className="text-[#ff2a3a] shrink-0">Verified</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* CTA */}
      <section className="relative py-32 px-6 md:px-12">
        <div className="relative max-w-3xl mx-auto text-center reveal">
          <h2 className="font-display text-5xl md:text-7xl leading-[0.98]">{b.section_cta_title_1} <span className="text-shine">{b.section_cta_title_2}</span></h2>
          <p className="mt-6 text-white/60 max-w-lg mx-auto">Your TV is waiting. Grab your code and start streaming in seconds.</p>
          <div className="mt-9 flex justify-center gap-3">
            <a href="#activate" className="btn-red">Activate TV →</a>
            <a href="#plans" className="btn-ghost">Free Premium</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative border-t border-white/5 py-10 px-6 md:px-12 bg-black/40 backdrop-blur">
        <div className="max-w-6xl mx-auto flex flex-col gap-6">
          <ContactStrip />
          <div className="flex flex-col md:flex-row justify-between gap-4 items-center">
            <div className="flex items-center gap-2">
              <img src={logo} alt="Emberlord" className="h-7 w-7 object-contain" width={28} height={28} loading="lazy" />
              <span className="font-display text-lg wordmark-pulse"><Wordmark /></span>
            </div>
            <div className="font-mono text-xs uppercase tracking-widest text-white/40">{b.footer_legal}</div>
            <div className="flex gap-6 text-xs text-white/40">
              <a href="#" className="hover:text-white">Privacy</a>
              <a href="#" className="hover:text-white">Terms</a>
              <a href="#" className="hover:text-white">Help</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ContactStrip() {
  const fetchContacts = useServerFn(getPublicContacts);
  const q = useQuery({
    queryKey: ["public-contacts"],
    queryFn: () => fetchContacts(),
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const channels = q.data?.channels ?? [];
  const debugOn = typeof window !== "undefined" && /(?:^|[?&])debug=contacts(?:&|$)/.test(window.location.search);

  const iconFor = (kind: string) => {
    if (kind === "telegram") return Send;
    if (kind === "instagram") return Instagram;
    return Phone;
  };

  if (!q.data?.enabled || channels.length === 0) {
    if (!debugOn) return null;
    return (
      <div className="mx-auto max-w-2xl rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-100 text-xs font-mono p-3 space-y-2">
        <div className="uppercase tracking-widest text-[10px] text-amber-300">// Contact debug (?debug=contacts)</div>
        <div>Channels visible: <b>{String(channels.length)}</b></div>
        {(q.data?.debug?.channels ?? []).map((c: any) => (
          <div key={c.kind} className="flex flex-wrap gap-x-2">
            <span className="text-amber-300">{c.kind}:</span>
            <span>enabled={String(c.enabled)}</span>
            <span>raw=&quot;{c.rawHandle || "—"}&quot;</span>
            <span>norm=&quot;{c.normalizedHandle || "—"}&quot;</span>
            <span>visible={String(c.visible)}</span>
            <span>reason={c.reason}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {channels.map((c) => {
        const Icon = iconFor(c.kind);
        const hasName = !!(c.name && c.name.trim());
        const aria = hasName ? c.name : c.kind;
        return (
          <a
            key={c.kind}
            href={c.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={aria}
            title={aria}
            className={
              hasName
                ? "group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-white/70 hover:text-white hover:border-[#ff2a3a]/40 hover:bg-[#ff2a3a]/[0.06] transition"
                : "group inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/70 hover:text-[#ff2a3a] hover:border-[#ff2a3a]/40 hover:bg-[#ff2a3a]/[0.06] transition w-9 h-9"
            }
          >
            <Icon className={hasName ? "w-3.5 h-3.5" : "w-4 h-4"} strokeWidth={2} />
            {hasName && (
              <span className="text-[11px] font-mono uppercase tracking-widest">{c.name}</span>
            )}
          </a>
        );
      })}
      {debugOn && q.data?.debug && (
        <div className="w-full mx-auto max-w-2xl rounded-md border border-white/10 bg-black/60 text-[10px] text-white/60 font-mono p-2">
          debug: {q.data.debug.channels.filter((c: any) => c.visible).map((c: any) => `${c.kind}=${c.display}`).join(" · ")}
        </div>
      )}
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
  const b = useBrand();
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
      const a = payload.account;
      const lines = [
        `EMBERLORD · Netflix TV Activation`,
        `Code: ${payload.code}`,
        `Time: ${new Date().toLocaleString()}`,
        `Plan: ${a.plan_name ?? "Premium"} · ${a.video_quality ?? "UHD"}`,
        `Country: ${a.country ?? "—"}`,
        `Screens: ${a.max_streams ?? "—"}`,
        `Member since: ${a.member_since ?? "—"}`,
      ].join("\n");
      await navigator.clipboard.writeText(lines);
      setCaptured(true);
      toast.success("Receipt copied");
      window.setTimeout(() => setCaptured(false), 2000);
    } catch {
      toast.error("Clipboard unavailable");
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
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-full bg-gradient-to-br from-[#ff2a3a] to-[#b0060f] flex items-center justify-center shadow-[0_0_40px_rgba(255,42,58,0.6)]">
              <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span className="absolute inset-0 rounded-full ring-2 ring-[#ff2a3a]/40 animate-ping" />
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-brand-accent">{b.success_kicker}</div>
              <h3 className="font-display text-3xl md:text-4xl leading-none mt-1">{b.success_title}</h3>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none" aria-label="Close">✕</button>
        </div>

        <p className="mt-4 text-white/70 text-sm md:text-base">
          Your TV is now connected to Netflix using code <span className="font-mono text-white bg-white/10 px-2 py-0.5 rounded">{payload.code}</span>.
          Redirecting in <span className="text-[#ff2a3a] font-mono">{count}s</span>…
        </p>

        <div className="mt-6 grid sm:grid-cols-2 gap-3">
          <Detail label="Plan" value={a.plan_name ?? "Premium"} accent />
          <Detail label="Quality" value={a.video_quality ?? "UHD"} accent />
          <Detail label="Country" value={`${flagEmoji(a.country)}  ${a.country ?? "Global"}`} />
          <Detail label="Screens" value={a.max_streams != null ? String(a.max_streams) : "Unlimited"} />
          <Detail label="Member since" value={a.member_since ?? "—"} />
          <Detail label="Account" value={maskEmail(a.email)} mono />
        </div>

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



