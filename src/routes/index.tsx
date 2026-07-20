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
import { KeyRound, Lock, UserCheck, CheckCircle2, RotateCcw, AlertCircle, Loader2, Send, Instagram, Phone, Mail, Hash } from "lucide-react";
import logo from "@/assets/brand-logo.png";
import { useBrand } from "@/lib/branding-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

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
        ctx.fillText("okflix-fp", 2, 15);
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

const SESSION_KEY = "okflix_access_session";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OKFLIX — Activate Netflix on any TV" },
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
  const [openFeature, setOpenFeature] = useState<number | null>(null);
  const [openStep, setOpenStep] = useState<number | null>(null);
  // Single generic in-flight indicator; internal stages are not exposed.
  const [stage, setStage] = useState<"idle" | "working">("idle");
  // Live digit count from the CodeInput so Stage 01 (ENTER) fills instantly as user types.
  const [codeLen, setCodeLen] = useState(0);
  const [codeError, setCodeError] = useState<string | null>(null);


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
  // Auto-reconnects on network drop / tab wake / channel error with exponential backoff.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let retry = 0;
    let retryTimer: number | null = null;
    let cancelled = false;

    const onTick = () => {
      qc.setQueryData(["success-activation-count"], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          ok: true,
          count: (old.count ?? 0) + 1,
          totalSuccess: (old.totalSuccess ?? old.count ?? 0) + 1,
          todaySuccess: (old.todaySuccess ?? 0) + 1,
        };
      });
      qc.invalidateQueries({ queryKey: ["success-activation-count"] });
    };

    const connect = () => {
      if (cancelled) return;
      if (ch) supabase.removeChannel(ch);
      ch = supabase
        .channel(`activation-success-${Date.now()}`)
        .on("broadcast", { event: "tick" }, onTick)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            retry = 0;
            // Reconciliation refetch — catches any ticks missed while offline.
            qc.invalidateQueries({ queryKey: ["success-activation-count"] });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (cancelled) return;
            retry = Math.min(retry + 1, 6);
            const delay = Math.min(30_000, 1000 * 2 ** (retry - 1));
            if (retryTimer) window.clearTimeout(retryTimer);
            retryTimer = window.setTimeout(connect, delay);
          }
        });
    };

    connect();

    const onOnline = () => { retry = 0; connect(); };
    const onVisible = () => { if (document.visibilityState === "visible") connect(); };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (ch) supabase.removeChannel(ch);
    };
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
      setCodeError("Enter the full 8-character code from your TV.");
      codeRef.current?.shake();
      codeRef.current?.focusFirst();
      toast.error("Invalid TV code", { description: "Enter the full 8-character code shown on your TV screen." });
      return;
    }
    setCodeError(null);


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

      {/* NAV — floating pill (Florzin-style) */}
      <div className="relative z-20 px-3 sm:px-6 md:px-10 pt-4">
        <nav className="max-w-7xl mx-auto rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl shadow-[0_20px_60px_-30px_rgba(255,42,58,0.35)] px-3 md:px-4 py-2 flex items-center justify-between gap-3">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2.5 group shrink-0 pl-1 pr-2">
            <img src={logo} alt="OKFLIX" data-wave-origin className="h-9 w-9 object-contain logo-shine group-hover:scale-110 transition" width={36} height={36} />
            <span className="font-display brand-wordmark-nav tracking-tight wordmark-pulse inline text-[15px] sm:text-base"><Wordmark /></span>
          </Link>

          {/* Center pill */}
          <div className="hidden md:flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-1.5 py-1.5 text-sm text-white/70">
            <a href="#activate" className="px-4 py-1.5 rounded-full bg-white/10 text-white transition hover:bg-white/15">Activate</a>
            <a href="#features" className="px-4 py-1.5 rounded-full transition hover:text-white hover:bg-white/5">Features</a>
            <a href="#how-it-works" className="px-4 py-1.5 rounded-full transition hover:text-white hover:bg-white/5">Guide</a>
            <a href="#faq" className="px-4 py-1.5 rounded-full transition hover:text-white hover:bg-white/5">FAQ</a>
            <a href="#live" className="px-4 py-1.5 rounded-full transition hover:text-white hover:bg-white/5 inline-flex items-center gap-1.5">
              <span className="kicker-dot-wrap">
                <span className="kicker-dot-ping" />
                <span className="kicker-dot" />
              </span>
              {b.nav_link_live}
            </a>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {authUserId ? (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 text-[11px] uppercase tracking-widest text-emerald-100/90">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                <Link to="/account" className="font-mono normal-case tracking-normal hover:text-white transition max-w-[140px] truncate" title="My activations">
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
              <Link to="/login" className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-xs uppercase tracking-widest text-white/85 transition">
                <Lock className="w-3.5 h-3.5" />
                Sign in
              </Link>
            ) : null}
            <a href="#activate" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-black text-xs uppercase tracking-widest font-semibold hover:bg-white/90 transition shadow-[0_6px_20px_-6px_rgba(255,255,255,0.35)]">
              Activate <span aria-hidden>↗</span>
            </a>
          </div>
        </nav>
      </div>


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
                  className="okflix-honeypot"
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

      {/* FEATURES — editable via Branding Studio. Click a card to open its detail. */}
      <section id="features" className="relative section-pad-y section-pad-x">
        <div aria-hidden className="why-orb" />
        <div className="max-w-6xl mx-auto relative">
          <div className="text-center mb-10 sm:mb-14 md:mb-20 reveal">
            <div className="glow-border rounded-full inline-flex items-center gap-3 px-4 py-2 mb-5 font-mono uppercase tracking-[0.32em] text-[#ff2a3a] section-kicker-fluid">
              <span className="kicker-dot-wrap">
                <span className="kicker-dot-ping" />
                <span className="kicker-dot" />
              </span>
              {b.section_features_kicker}
            </div>
            <h2 className="font-display section-title-fluid tracking-tight">
              {b.section_features_title_1} <span className="text-shine">{b.section_features_title_2}</span>.
            </h2>
            {b.section_features_sub ? (
              <p className="mt-5 sm:mt-6 text-white/70 section-sub-fluid max-w-2xl mx-auto">
                {b.section_features_sub}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {[
              { n: 1, i: b.why_card_1_index, ic: b.why_card_1_icon, t: b.why_card_1_title, d: b.why_card_1_desc, mv: b.why_card_1_metric_value, ml: b.why_card_1_metric_label, det: b.why_card_1_detail },
              { n: 2, i: b.why_card_2_index, ic: b.why_card_2_icon, t: b.why_card_2_title, d: b.why_card_2_desc, mv: b.why_card_2_metric_value, ml: b.why_card_2_metric_label, det: b.why_card_2_detail },
              { n: 3, i: b.why_card_3_index, ic: b.why_card_3_icon, t: b.why_card_3_title, d: b.why_card_3_desc, mv: b.why_card_3_metric_value, ml: b.why_card_3_metric_label, det: b.why_card_3_detail },
              { n: 4, i: b.why_card_4_index, ic: b.why_card_4_icon, t: b.why_card_4_title, d: b.why_card_4_desc, mv: b.why_card_4_metric_value, ml: b.why_card_4_metric_label, det: b.why_card_4_detail },
            ].map((f) => (
              <button
                key={f.n}
                type="button"
                onClick={() => setOpenFeature(f.n)}
                className="why-card reveal group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a]/60 rounded-2xl"
                aria-label={`${f.t} — open details`}
              >
                <div className="why-card-inner h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4 sm:mb-6">
                    <div className="font-mono text-[10px] sm:text-xs text-[#ff2a3a] tracking-[0.32em]">{f.i}</div>
                    <div className="leading-none" style={{ fontSize: "clamp(1.5rem, 3.2vw, 2rem)" }} aria-hidden>{f.ic}</div>
                  </div>
                  <h3 className="font-display leading-[1.15] tracking-tight mb-2 sm:mb-3 text-shine" style={{ fontSize: "clamp(1.15rem, 2.2vw, 1.6rem)" }}>
                    {f.t}
                  </h3>
                  <p className="text-white/70 text-[13px] sm:text-sm leading-relaxed flex-1">
                    {f.d}
                  </p>
                  <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-white/[0.06] flex items-baseline justify-between gap-3">
                    <span className="font-display text-white leading-none" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>{f.mv}</span>
                    <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-white/55 text-right">
                      {f.ml}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <Dialog open={openFeature !== null} onOpenChange={(o) => !o && setOpenFeature(null)}>
          <DialogContent className="max-w-2xl bg-black/90 backdrop-blur-2xl border border-[#ff2a3a]/30 text-white">
            {openFeature !== null && (() => {
              const items = [
                { i: b.why_card_1_index, ic: b.why_card_1_icon, t: b.why_card_1_title, mv: b.why_card_1_metric_value, ml: b.why_card_1_metric_label, det: b.why_card_1_detail },
                { i: b.why_card_2_index, ic: b.why_card_2_icon, t: b.why_card_2_title, mv: b.why_card_2_metric_value, ml: b.why_card_2_metric_label, det: b.why_card_2_detail },
                { i: b.why_card_3_index, ic: b.why_card_3_icon, t: b.why_card_3_title, mv: b.why_card_3_metric_value, ml: b.why_card_3_metric_label, det: b.why_card_3_detail },
                { i: b.why_card_4_index, ic: b.why_card_4_icon, t: b.why_card_4_title, mv: b.why_card_4_metric_value, ml: b.why_card_4_metric_label, det: b.why_card_4_detail },
              ];
              const f = items[openFeature - 1];
              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center gap-4 mb-2">
                      <div className="text-4xl leading-none" aria-hidden>{f.ic}</div>
                      <div>
                        <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff2a3a]">{f.i} · Feature</div>
                        <DialogTitle className="font-display text-2xl sm:text-3xl leading-tight mt-1">{f.t}</DialogTitle>
                      </div>
                    </div>
                  </DialogHeader>
                  <DialogDescription className="text-white/70 text-[15px] leading-relaxed whitespace-pre-line">
                    {f.det}
                  </DialogDescription>
                  <div className="mt-5 pt-5 border-t border-white/10 flex items-baseline justify-between">
                    <span className="font-display text-3xl text-white leading-none">{f.mv}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/60">{f.ml}</span>
                  </div>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>
      </section>



      {/* HOW IT WORKS — STEP-BY-STEP GUIDE */}
      <section id="how-it-works" className="relative section-pad-y section-pad-x">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-14 md:mb-16 reveal">
            <div className="glow-border rounded-full inline-flex items-center gap-3 px-4 py-2 font-mono uppercase tracking-[0.3em] text-brand-accent mb-4 brand-section-kicker section-kicker-fluid">
              <span className="kicker-dot-wrap">
                <span className="kicker-dot-ping" />
                <span className="kicker-dot" />
              </span>
              {b.section_howto_kicker}
            </div>
            <h2 className="font-display section-title-fluid">{b.section_howto_title_1} <span className="text-shine">{b.section_howto_title_2}</span></h2>
            <p className="mt-4 sm:mt-5 text-white/70 section-sub-fluid max-w-2xl mx-auto px-2">{b.section_howto_sub}</p>
          </div>

          <ol className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map((n) => {
              const icon = b[`howto_step_${n}_icon` as keyof typeof b];
              const title = b[`howto_step_${n}_title` as keyof typeof b];
              const desc = b[`howto_step_${n}_desc` as keyof typeof b];
              return (
                <li key={n} className="contents">
                  <button
                    type="button"
                    onClick={() => setOpenStep(n)}
                    aria-label={`${title} — open details`}
                    className="why-card reveal group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a]/60 rounded-2xl"
                  >
                    <div className="why-card-inner h-full flex flex-col">
                      <div className="flex items-center gap-3 mb-3 sm:mb-4">
                        <span
                          aria-hidden
                          className="grid shrink-0 place-items-center rounded-full font-mono font-bold text-white bg-[color:var(--brand-accent)] shadow-[0_0_18px_rgba(255,42,58,0.55)]"
                          style={{ width: "clamp(2rem, 4.5vw, 2.4rem)", height: "clamp(2rem, 4.5vw, 2.4rem)", fontSize: "clamp(0.8rem, 1.4vw, 0.95rem)" }}
                        >
                          {n}
                        </span>
                        <span aria-hidden className="leading-none" style={{ fontSize: "clamp(1.5rem, 3vw, 1.9rem)" }}>{icon}</span>
                      </div>
                      <div className="font-display font-semibold mb-1.5 sm:mb-2 text-shine" style={{ fontSize: "clamp(1rem, 1.6vw, 1.15rem)" }}>{title}</div>
                      <p className="text-[13px] sm:text-sm text-white/65 leading-relaxed flex-1">{desc}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>

          <Dialog open={openStep !== null} onOpenChange={(o) => !o && setOpenStep(null)}>
            <DialogContent className="max-w-2xl bg-black/90 backdrop-blur-2xl border border-[#ff2a3a]/30 text-white">
              {openStep !== null && (() => {
                const n = openStep;
                const icon = b[`howto_step_${n}_icon` as keyof typeof b] as string;
                const title = b[`howto_step_${n}_title` as keyof typeof b] as string;
                const detail = (b[`howto_step_${n}_detail` as keyof typeof b] as string) || (b[`howto_step_${n}_desc` as keyof typeof b] as string);
                return (
                  <>
                    <DialogHeader>
                      <div className="flex items-center gap-4 mb-2">
                        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-mono text-base font-bold text-white bg-[color:var(--brand-accent)] shadow-[0_0_22px_rgba(255,42,58,0.6)]">
                          {n}
                        </span>
                        <div className="text-4xl leading-none" aria-hidden>{icon}</div>
                        <div>
                          <div className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff2a3a]">Step {String(n).padStart(2, "0")} · Guide</div>
                          <DialogTitle className="font-display text-2xl sm:text-3xl leading-tight mt-1">{title}</DialogTitle>
                        </div>
                      </div>
                    </DialogHeader>
                    <DialogDescription className="text-white/70 text-[15px] leading-relaxed whitespace-pre-line">
                      {detail}
                    </DialogDescription>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>


          <div className="mt-10 sm:mt-12 text-center reveal">
            <a href="#activate" className="btn-red inline-block">Enter your code</a>
          </div>
        </div>
      </section>



      {/* FAQ — editable via Branding Studio. Accordion opens on click. */}
      <section id="faq" className="relative section-pad-y section-pad-x">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10 sm:mb-14 md:mb-16 reveal">
            <div className="glow-border rounded-full inline-flex items-center gap-3 px-4 py-2 font-mono uppercase tracking-[0.3em] text-brand-accent mb-4 brand-section-kicker section-kicker-fluid">
              <span className="kicker-dot-wrap">
                <span className="kicker-dot-ping" />
                <span className="kicker-dot" />
              </span>
              {b.section_faq_kicker}
            </div>
            <h2 className="font-display section-title-fluid">
              {b.section_faq_title_1} <span className="text-shine">{b.section_faq_title_2}</span>
            </h2>
            {b.section_faq_sub ? (
              <p className="mt-4 sm:mt-5 text-white/60 max-w-2xl mx-auto px-2 section-sub-fluid">
                {b.section_faq_sub}
              </p>
            ) : null}
          </div>

          <Accordion type="single" collapsible className="w-full space-y-3 sm:space-y-4">
            {[1, 2, 3, 4, 5, 6].map((n) => {
              const q = b[`faq_${n}_q` as keyof typeof b] as string;
              const a = b[`faq_${n}_a` as keyof typeof b] as string;
              if (!q) return null;
              return (
                <AccordionItem
                  key={n}
                  value={`faq-${n}`}
                  className="faq-card border-0"
                >
                  <div className="faq-card-inner px-4 sm:px-6">
                    <AccordionTrigger className="hover:no-underline py-4 sm:py-6 gap-3 sm:gap-4 text-left">
                      <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                        <span className="font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#ff2a3a] shrink-0">
                          {String(n).padStart(2, "0")}
                        </span>
                        <span className="font-display leading-snug text-shine" style={{ fontSize: "clamp(0.95rem, 1.6vw, 1.25rem)" }}>
                          {q}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-white/70 text-[14px] sm:text-[15px] leading-relaxed pb-5 sm:pb-6 pl-[calc(0.5rem+2rem)] sm:pl-[calc(0.75rem+2.5rem)] pr-2 whitespace-pre-line">
                      {a}
                    </AccordionContent>
                  </div>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </section>



      {/* LIVE ACTIVATION FEED — system-owned realtime metrics. Copy editable in Branding Studio. */}
      <section id="live" className="relative section-pad-y section-pad-x">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10 sm:mb-14 md:mb-16 reveal">
            <div className="glow-border rounded-full inline-flex items-center gap-3 px-4 py-2 mb-5 font-mono uppercase tracking-[0.3em] text-[#ff2a3a] section-kicker-fluid">
              <span className="kicker-dot-wrap">
                <span className="kicker-dot-ping" />
                <span className="kicker-dot" />
              </span>
              {b.section_live_kicker}
            </div>
            <h2 className="font-display section-title-fluid tracking-tight">
              {b.section_live_title_1} <span className="text-shine">{b.section_live_title_2}</span>
            </h2>
            {b.section_live_sub ? (
              <p className="mt-5 sm:mt-6 text-white/70 section-sub-fluid max-w-2xl mx-auto">
                {b.section_live_sub}
              </p>
            ) : null}
          </div>

          {(() => {
            const d = successCount.data;
            const today = d?.todaySuccess ?? 0;
            const total = d?.totalSuccess ?? 0;
            const rate = d?.successRate ?? 0;
            const wrong = d?.totalWrongCode ?? 0;
            const expired = d?.totalExpiredCode ?? 0;
            const wrongToday = d?.todayWrongCode ?? 0;
            const expiredToday = d?.todayExpiredCode ?? 0;
            const hasAny = total + wrong + expired > 0;
            const loading = successCount.isLoading && !d;

            // Empty state — no successful activations recorded yet.
            if (!loading && !hasAny) {
              return (
                <div className="why-card reveal">
                  <div className="why-card-inner h-full flex flex-col items-center text-center py-14 sm:py-20">
                    <div className="font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#ff2a3a] inline-flex items-center gap-2 mb-6">
                      <span className="kicker-dot-wrap">
                        <span className="kicker-dot-ping" />
                        <span className="kicker-dot" />
                      </span>
                      STANDING BY
                    </div>
                    <h3 className="font-display text-2xl sm:text-3xl md:text-4xl leading-tight text-white max-w-xl">
                      Waiting for the first activation
                    </h3>
                    <p className="mt-4 text-white/55 text-sm sm:text-base max-w-lg leading-relaxed">
                      The moment a viewer links their TV, this feed lights up in real time — success count, daily total, and system success rate all update live.
                    </p>
                  </div>
                </div>
              );
            }

            const tiles = [
              { v: today.toLocaleString(), l: b.section_live_today_label, h: b.section_live_today_hint, suffix: null as string | null },
              { v: total.toLocaleString(), l: b.section_live_total_label, h: b.section_live_total_hint, suffix: null },
              { v: rate.toFixed(1), l: b.section_live_rate_label, h: b.section_live_rate_hint, suffix: "%" },
            ];
            void wrong; void expired; void wrongToday; void expiredToday;
            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                  {tiles.map((t, i) => (
                    <div key={i} className="why-card reveal">
                      <div className="why-card-inner h-full flex flex-col">
                        <div className="flex items-center justify-between mb-6">
                          <div className="font-mono text-[10px] sm:text-xs tracking-[0.28em] text-[#ff2a3a] inline-flex items-center gap-2">
                            <span className="kicker-dot-wrap">
                              <span className="kicker-dot-ping" />
                              <span className="kicker-dot" />
                            </span>
                            {b.section_live_pulse_label}
                          </div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">
                            {String(i + 1).padStart(2, "0")}
                          </div>
                        </div>
                        <div className="font-display metric-fluid tabular-nums text-white">
                          <span className="text-live">{t.v}</span>
                          {t.suffix ? <span className="text-white/70 ml-1" style={{ fontSize: "0.55em" }}>{t.suffix}</span> : null}
                        </div>
                        <div className="mt-6 pt-5 border-t border-white/[0.06]">
                          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/70">
                            {t.l}
                          </div>
                          {t.h ? (
                            <div className="mt-1.5 text-sm text-white/50 leading-relaxed">
                              {t.h}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

              </>
            );
          })()}


          {b.section_live_footnote ? (
            <p className="mt-10 text-center text-sm text-white/45 max-w-3xl mx-auto leading-relaxed reveal">
              {b.section_live_footnote}
            </p>
          ) : null}
        </div>
      </section>



      {/* CTA */}
      <section className="relative section-pad-y section-pad-x">
        <div className="relative max-w-3xl mx-auto text-center reveal">
          <div className="glow-border rounded-full inline-flex items-center gap-3 px-4 py-2 mb-5 font-mono uppercase tracking-[0.32em] text-[#ff2a3a] section-kicker-fluid">
            <span className="kicker-dot-wrap">
              <span className="kicker-dot-ping" />
              <span className="kicker-dot" />
            </span>
            Final step
          </div>
          <h2 className="font-display section-title-fluid">
            {b.section_cta_title_1} <span className="text-shine">{b.section_cta_title_2}</span>
          </h2>
          <p className="mt-5 sm:mt-6 text-white/65 section-sub-fluid max-w-xl mx-auto">
            Point your TV to <span className="text-white font-mono">netflix.com/tv8</span>, type the 8-character code on screen, and we'll pair a verified Premium session to your device in seconds — 4K where supported, zero setup, no card required.
          </p>
          <div className="mt-7 sm:mt-9 flex flex-wrap justify-center gap-3">
            <a href="#activate" className="btn-red">Activate my TV →</a>
            <a href="#how-it-works" className="btn-ghost">How it works</a>
          </div>
          <p className="mt-5 sm:mt-6 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.28em] text-white/40">
            Instant pairing · Premium tier · No sign-up card
          </p>
        </div>
      </section>

      {/* FOOTER — florzin-style multi-column, admin-editable via Branding Studio */}
      <footer className="relative border-t border-white/10 mt-20 bg-gradient-to-b from-black/60 to-black/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-16 grid gap-12 md:gap-10 md:grid-cols-12">
          {/* Brand column */}
          <div className="md:col-span-5 space-y-5">
            <Link to="/" className="flex items-center gap-2.5 group" data-wave-origin>
              <img src={logo} alt="" className="h-9 w-9 object-contain" width={36} height={36} loading="lazy" />
              <span className="font-display text-xl wordmark-pulse tracking-tight"><Wordmark /></span>
            </Link>
            
            <div className="pt-1"><ContactStrip /></div>
          </div>

          {/* Link columns */}
          <FooterCol title={b.footer_col_quick_title} className="md:col-span-3">
            <FooterHref href={b.footer_link_quick_1_href} label={b.footer_link_quick_1_label} />
            <FooterHref href={b.footer_link_quick_2_href} label={b.footer_link_quick_2_label} />
            <FooterHref href={b.footer_link_quick_3_href} label={b.footer_link_quick_3_label} />
            <FooterHref href={b.footer_link_quick_4_href} label={b.footer_link_quick_4_label} />
            <FooterHref href={b.footer_link_quick_5_href} label={b.footer_link_quick_5_label} />
          </FooterCol>

          <FooterCol title={b.footer_col_support_title} className="md:col-span-2">
            <FooterHref href={b.footer_link_support_1_href} label={b.footer_link_support_1_label} />
            <FooterHref href={b.footer_link_support_2_href} label={b.footer_link_support_2_label} />
            <FooterHref href={b.footer_link_support_3_href} label={b.footer_link_support_3_label} />
          </FooterCol>

          <FooterCol title={b.footer_col_legal_title} className="md:col-span-2">
            <FooterHref href={b.footer_link_legal_1_href} label={b.footer_link_legal_1_label} />
            <FooterHref href={b.footer_link_legal_2_href} label={b.footer_link_legal_2_label} />
            <FooterHref href={b.footer_link_legal_3_href} label={b.footer_link_legal_3_label} />
          </FooterCol>
        </div>

        <div className="border-t border-white/10">
          <div className="max-w-6xl mx-auto px-6 md:px-12 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40">{b.footer_legal}</div>
            <div className="text-[11px] text-white/35 leading-relaxed md:text-right md:max-w-xl">{b.footer_disclaimer}</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-4 ${className ?? ""}`}>
      <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#ff2a3a]">{title}</div>
      <ul className="space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterHref({ href, label }: { href: string; label: string }) {
  const l = (label ?? "").trim();
  const h = (href ?? "").trim();
  if (!l || !h) return null;
  const isExternal = /^https?:\/\//i.test(h);
  const inner = (
    <span className="inline-flex items-center gap-2 group">
      <span className="w-1 h-1 rounded-full bg-white/25 group-hover:bg-[#ff2a3a] transition" />
      <span>{l}</span>
    </span>
  );
  if (isExternal) {
    return (
      <li>
        <a href={h} target="_blank" rel="noreferrer" className="text-white/60 hover:text-white transition">{inner}</a>
      </li>
    );
  }
  // Parse "/path#hash", "/path", "#hash"
  let path = h;
  let hash: string | undefined;
  const hashIdx = h.indexOf("#");
  if (hashIdx >= 0) {
    hash = h.slice(hashIdx + 1) || undefined;
    path = h.slice(0, hashIdx) || "/";
  }
  if (!path.startsWith("/")) path = "/" + path;
  return (
    <li>
      <Link to={path} {...(hash ? { hash } : {})} className="text-white/60 hover:text-white transition">{inner}</Link>
    </li>
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

  const iconFor = (kind: string) => {
    if (kind === "telegram") return Send;
    if (kind === "instagram") return Instagram;
    if (kind === "email") return Mail;
    if (kind === "discord") return Hash;
    return Phone;
  };

  if (!q.data?.enabled || channels.length === 0) return null;

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

  useEffect(() => {
    if (count <= 0) {
      window.location.href = payload.redirectUrl;
      return;
    }
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [count, payload.redirectUrl]);

  const a = payload.account;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-xl animate-in fade-in duration-300 overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(255,42,58,0.25),transparent_70%)] animate-pulse" />
      </div>

      <div className="relative w-full max-w-md sm:max-w-lg lg:max-w-xl glass p-5 sm:p-7 border border-[#ff2a3a]/30 shadow-[0_0_0_1px_rgba(255,42,58,0.25),0_20px_80px_-20px_rgba(255,42,58,0.45)] animate-in zoom-in-95 duration-300 my-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-full border border-white/15 hover:border-white/40 hover:bg-white/5 text-white/70 hover:text-white flex items-center justify-center transition"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="relative w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-[#ff2a3a] to-[#b0060f] flex items-center justify-center shadow-[0_0_30px_rgba(255,42,58,0.55)]">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
            <span className="absolute inset-0 rounded-full ring-2 ring-[#ff2a3a]/40 animate-ping" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.3em] text-brand-accent truncate">{b.success_kicker}</div>
            <h3 className="font-display text-xl sm:text-2xl lg:text-3xl leading-tight mt-0.5 truncate">{b.success_title}</h3>
          </div>
        </div>

        <p className="mt-3 sm:mt-4 text-white/70 text-xs sm:text-sm leading-relaxed">
          TV connected with code <span className="font-mono text-white bg-white/10 px-1.5 py-0.5 rounded text-[11px] sm:text-xs">{payload.code}</span>.
          Redirecting in <span className="text-[#ff2a3a] font-mono">{count}s</span>
        </p>

        <div className="mt-4 sm:mt-5 grid grid-cols-2 gap-2 sm:gap-2.5">
          <Detail label="Plan" value={a.plan_name ?? "Premium"} accent />
          <Detail label="Quality" value={a.video_quality ?? "UHD"} accent />
          <Detail label="Country" value={`${flagEmoji(a.country)} ${a.country ?? "—"}`} />
          <Detail label="Screens" value={a.max_streams != null ? String(a.max_streams) : "—"} />
          <Detail label="Member" value={a.member_since ?? "—"} />
          <Detail label="Account" value={maskEmail(a.email)} mono />
        </div>

        <div className="mt-4 sm:mt-5 flex flex-col sm:flex-row gap-2 sm:gap-3">
          <a href={payload.redirectUrl} className="btn-red flex-1 text-center text-sm sm:text-base py-2.5 sm:py-3">
            Open Netflix →
          </a>
          <button onClick={onClose} className="btn-ghost text-sm sm:text-base py-2.5 sm:py-3 sm:flex-1">
            Activate another
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 sm:p-2.5 min-w-0 ${accent ? "border-[#ff2a3a]/30 bg-[#ff2a3a]/5" : "border-white/10 bg-white/[0.03]"}`}>
      <div className="font-mono text-[8px] sm:text-[9px] uppercase tracking-[0.25em] text-white/40 truncate">{label}</div>
      <div className={`mt-0.5 sm:mt-1 text-xs sm:text-sm truncate ${mono ? "font-mono" : ""} ${accent ? "text-white" : "text-white/85"}`}>{value}</div>
    </div>
  );
}



