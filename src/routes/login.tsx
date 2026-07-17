import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getGateConfig } from "@/lib/access-keys.functions";
import { checkOtpLimit, recordOtpSent, logAuthEvent } from "@/lib/auth-audit.functions";
import { toast } from "sonner";
import { LogIn, UserPlus, MailCheck, ShieldCheck, KeyRound, ArrowLeft } from "lucide-react";
import logo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Emberlord" },
      { name: "description", content: "Sign in or create an account to activate your TV." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

type Stage = "form" | "verify-otp" | "reset-sent";

function LoginPage() {
  const navigate = useNavigate();
  const fetchGate = useServerFn(getGateConfig);
  const checkOtp = useServerFn(checkOtpLimit);
  const recordOtp = useServerFn(recordOtpSent);
  const logEvent = useServerFn(logAuthEvent);
  const gate = useQuery({ queryKey: ["login-gate"], queryFn: () => fetchGate(), staleTime: 15_000 });

  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpFails, setOtpFails] = useState(0);
  const [otpLockUntil, setOtpLockUntil] = useState<number | null>(null);
  const MAX_OTP_VERIFY_ATTEMPTS = 5;

  const safeLog = (payload: Parameters<typeof logAuthEvent>[0] extends { data: infer T } ? T : any) => {
    logEvent({ data: payload as any }).catch(() => { /* swallow */ });
  };

  // Captcha state (respects the same gate config as landing).
  const [captchaToken, setCaptchaToken] = useState("");
  const captchaWidgetRef = useRef<HTMLDivElement>(null);
  const captchaRenderedRef = useRef(false);
  const captchaWidgetIdRef = useRef<string | null>(null);

  // If already signed in, bounce to home.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);

  // Countdown timer for resend button.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Load captcha widget (Turnstile / hCaptcha) when required.
  useEffect(() => {
    if (!gate.data?.captchaRequired || !gate.data.captchaSiteKey) return;
    if (stage !== "form") return;
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
            const id = api.render(captchaWidgetRef.current, {
              sitekey: gate.data!.captchaSiteKey,
              theme: "dark",
              callback: (token: string) => setCaptchaToken(token),
              "expired-callback": () => setCaptchaToken(""),
              "error-callback": () => setCaptchaToken(""),
            });
            captchaWidgetIdRef.current = id ?? null;
            captchaRenderedRef.current = true;
          } catch { /* already rendered */ }
          return;
        }
        if (Date.now() - start > 8000) return;
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => { cancelled = true; };
  }, [gate.data?.captchaRequired, gate.data?.captchaSiteKey, gate.data?.captchaProvider, stage, mode]);

  function resetCaptcha() {
    if (!captchaRenderedRef.current) return;
    try {
      const api: any = gate.data?.captchaProvider === "hcaptcha" ? (window as any).hcaptcha : (window as any).turnstile;
      if (captchaWidgetIdRef.current) api?.reset(captchaWidgetIdRef.current);
      else api?.reset();
    } catch { /* ignore */ }
    setCaptchaToken("");
  }

  const captchaOk = !gate.data?.captchaRequired || !!captchaToken;

  function validateForm(): string | null {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (mode !== "forgot") {
      if (password.length < 8) return "Password must be at least 8 characters.";
      if (mode === "signup" && !/[A-Z]/.test(password)) return "Include at least one uppercase letter.";
      if (mode === "signup" && !/[0-9]/.test(password)) return "Include at least one number.";
    }
    if (!captchaOk) return "Complete the captcha.";
    return null;
  }

  async function guardOtpRateLimit(kind: "signup" | "recovery"): Promise<boolean> {
    try {
      const r = await checkOtp({ data: { email: email.trim(), kind } });
      if (!r.allowed) {
        if (r.reason === "cooldown") {
          setResendCooldown(r.cooldown_remaining || 30);
          toast.error(`Wait ${r.cooldown_remaining}s before requesting a new code.`);
        } else {
          toast.error(`Too many codes requested — try again after ${r.window_minutes} minutes.`);
        }
        safeLog({ event: "otp_send", email: email.trim(), success: false, reason: `rate_limit:${r.reason}` });
        return false;
      }
      return true;
    } catch {
      // If the rate-limit check itself fails, fall through so the user isn't blocked by an outage.
      return true;
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const err = validateForm(); if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (error) throw error;
      safeLog({ event: "signin", email: email.trim(), success: true });
      toast.success("Signed in.");
      navigate({ to: "/" });
    } catch (e: any) {
      const msg = String(e.message ?? "");
      safeLog({ event: "signin", email: email.trim(), success: false, reason: msg.slice(0, 180) });
      if (/email not confirmed/i.test(msg)) {
        toast.info("Verify your email first — we'll send a fresh code.");
        await sendOtpEmail();
        setStage("verify-otp");
      } else {
        toast.error(msg || "Sign-in failed");
      }
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    const err = validateForm(); if (err) { toast.error(err); return; }
    if (!(await guardOtpRateLimit("signup"))) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          captchaToken: captchaToken || undefined,
        },
      });
      if (error) throw error;
      await recordOtp({ data: { email: email.trim(), kind: "signup" } }).catch(() => {});
      safeLog({ event: "signup", email: email.trim(), success: true });
      safeLog({ event: "otp_send", email: email.trim(), success: true, reason: "signup" });
      toast.success("Verification code sent — check your email.");
      setResendCooldown(60);
      setOtpFails(0);
      setOtpLockUntil(null);
      setStage("verify-otp");
    } catch (e: any) {
      const msg = e.message ?? "Sign-up failed";
      safeLog({ event: "signup", email: email.trim(), success: false, reason: String(msg).slice(0, 180) });
      toast.error(msg);
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  async function sendOtpEmail() {
    if (!(await guardOtpRateLimit("signup"))) return;
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: captchaToken ? { captchaToken } : undefined,
    });
    if (!error) {
      await recordOtp({ data: { email: email.trim(), kind: "signup" } }).catch(() => {});
      safeLog({ event: "otp_send", email: email.trim(), success: true, reason: "resend-inline" });
    } else {
      safeLog({ event: "otp_send", email: email.trim(), success: false, reason: String(error.message).slice(0, 180) });
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    if (!(await guardOtpRateLimit("signup"))) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (error) throw error;
      await recordOtp({ data: { email: email.trim(), kind: "signup" } }).catch(() => {});
      safeLog({ event: "otp_send", email: email.trim(), success: true, reason: "resend" });
      toast.success("New code sent.");
      setResendCooldown(60);
    } catch (e: any) {
      safeLog({ event: "otp_send", email: email.trim(), success: false, reason: String(e.message ?? "").slice(0, 180) });
      toast.error(e.message ?? "Failed to resend");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otpLockUntil && Date.now() < otpLockUntil) {
      const s = Math.ceil((otpLockUntil - Date.now()) / 1000);
      toast.error(`Too many wrong codes — locked for ${s}s.`);
      return;
    }
    if (otp.length < 6) { toast.error("Enter the 6-digit code from your email."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: "email",
      });
      if (error) throw error;
      safeLog({ event: "otp_verify", email: email.trim(), success: true });
      toast.success("Email verified — you're signed in.");
      navigate({ to: "/" });
    } catch (e: any) {
      const next = otpFails + 1;
      setOtpFails(next);
      safeLog({ event: "otp_verify", email: email.trim(), success: false, reason: String(e.message ?? "").slice(0, 180), metadata: { attempt: next } });
      if (next >= MAX_OTP_VERIFY_ATTEMPTS) {
        setOtpLockUntil(Date.now() + 15 * 60_000);
        toast.error(`Maximum ${MAX_OTP_VERIFY_ATTEMPTS} attempts reached — locked for 15 minutes.`);
      } else {
        toast.error(`${e.message ?? "Invalid or expired code"} (attempt ${next}/${MAX_OTP_VERIFY_ATTEMPTS})`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    const err = validateForm(); if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken: captchaToken || undefined,
      });
      if (error) throw error;
      safeLog({ event: "password_reset", email: email.trim(), success: true });
      setStage("reset-sent");
      toast.success("Reset link sent — check your email.");
    } catch (e: any) {
      safeLog({ event: "password_reset", email: email.trim(), success: false, reason: String(e.message ?? "").slice(0, 180) });
      toast.error(e.message ?? "Failed to send reset email");
      resetCaptcha();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050507] text-white flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{
        background: "radial-gradient(60% 40% at 50% 0%, rgba(255,42,58,0.18), transparent 60%), radial-gradient(50% 50% at 80% 100%, rgba(255,42,58,0.10), transparent 60%)",
      }} />

      <div className="relative w-full max-w-md">
        <Link to="/" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-white/50 hover:text-white transition">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to site
        </Link>

        <div className="rounded-2xl border border-white/10 bg-[#0b0b0d]/90 backdrop-blur-xl shadow-[0_40px_80px_-30px_rgba(255,42,58,0.35)]">
          {/* Header */}
          <div className="p-6 border-b border-white/5 text-center">
            <img src={logo} alt="Emberlord" className="mx-auto h-10 w-auto mb-3" />
            <h1 className="text-lg font-semibold tracking-tight">
              {stage === "verify-otp" ? "Verify your email" : stage === "reset-sent" ? "Check your inbox" : mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset password" : "Sign in"}
            </h1>
            <p className="text-xs text-white/50 mt-1">
              {stage === "verify-otp"
                ? "Enter the 6-digit code we emailed to you."
                : stage === "reset-sent"
                ? "Follow the link in your email to set a new password."
                : mode === "signup"
                ? "Email + password. We'll send a 6-digit code to confirm."
                : mode === "forgot"
                ? "We'll email you a secure reset link."
                : "Sign in to activate your TV."}
            </p>
          </div>

          {/* Mode tabs */}
          {stage === "form" && (
            <div className="grid grid-cols-2 gap-1 p-1.5 m-4 mb-0 rounded-lg bg-white/[0.03] border border-white/5">
              <button
                type="button"
                onClick={() => { setMode("signin"); }}
                className={`text-[11px] uppercase tracking-widest py-2 rounded-md transition ${mode === "signin" ? "bg-[#ff2a3a]/15 text-white border border-[#ff2a3a]/30" : "text-white/50 hover:text-white/80"}`}
              >
                <LogIn className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
                Sign in
              </button>
              <button
                type="button"
                onClick={() => { setMode("signup"); }}
                className={`text-[11px] uppercase tracking-widest py-2 rounded-md transition ${mode === "signup" ? "bg-[#ff2a3a]/15 text-white border border-[#ff2a3a]/30" : "text-white/50 hover:text-white/80"}`}
              >
                <UserPlus className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
                Sign up
              </button>
            </div>
          )}

          {/* Body */}
          <div className="p-6">
            {stage === "form" && mode !== "forgot" && (
              <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/50">Email</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#ff2a3a]/60 focus:ring-1 focus:ring-[#ff2a3a]/30"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-widest text-white/50">Password</label>
                    <button type="button" onClick={() => setShowPw((v) => !v)} className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white/70">
                      {showPw ? "Hide" : "Show"}
                    </button>
                  </div>
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#ff2a3a]/60 focus:ring-1 focus:ring-[#ff2a3a]/30"
                    placeholder={mode === "signup" ? "8+ chars, 1 uppercase, 1 number" : "••••••••"}
                  />
                  {mode === "signup" && (
                    <div className="mt-2 flex gap-1">
                      <PwStrengthBars password={password} />
                    </div>
                  )}
                </div>

                {/* Captcha */}
                {gate.data?.captchaRequired && gate.data.captchaSiteKey && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#ff8a90]" />
                      <span>Verify you're human</span>
                    </div>
                    <div ref={captchaWidgetRef} className="flex justify-center" />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3 rounded-md bg-[#ff2a3a] hover:bg-[#ff3a4a] text-white text-sm font-semibold uppercase tracking-widest disabled:opacity-50 transition shadow-[0_0_30px_-8px_rgba(255,42,58,0.6)]"
                >
                  {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
                </button>

                {mode === "signin" && (
                  <button type="button" onClick={() => setMode("forgot")} className="w-full text-[11px] uppercase tracking-widest text-white/40 hover:text-white/70 transition">
                    Forgot password?
                  </button>
                )}
              </form>
            )}

            {stage === "form" && mode === "forgot" && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/50">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#ff2a3a]/60 focus:ring-1 focus:ring-[#ff2a3a]/30"
                    placeholder="you@example.com"
                  />
                </div>
                {gate.data?.captchaRequired && gate.data.captchaSiteKey && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#ff8a90]" />
                      <span>Verify you're human</span>
                    </div>
                    <div ref={captchaWidgetRef} className="flex justify-center" />
                  </div>
                )}
                <button type="submit" disabled={busy} className="w-full py-3 rounded-md bg-[#ff2a3a] hover:bg-[#ff3a4a] text-white text-sm font-semibold uppercase tracking-widest disabled:opacity-50 transition">
                  {busy ? "Sending…" : "Send reset link"}
                </button>
                <button type="button" onClick={() => setMode("signin")} className="w-full text-[11px] uppercase tracking-widest text-white/40 hover:text-white/70 transition">
                  ← Back to sign in
                </button>
              </form>
            )}

            {stage === "verify-otp" && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 flex items-start gap-3">
                  <MailCheck className="w-4 h-4 text-emerald-400 mt-0.5" />
                  <div className="text-xs text-emerald-100/90">
                    Sent to <span className="font-mono">{email}</span>. Enter the 6-digit code from that email.
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/50">Verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-3 text-center text-2xl font-mono tracking-[0.4em] text-white placeholder:text-white/20 focus:outline-none focus:border-[#ff2a3a]/60"
                    placeholder="000000"
                  />
                </div>
                {otpLockUntil && Date.now() < otpLockUntil && (
                  <div className="rounded-md border border-red-500/25 bg-red-500/5 p-2.5 text-[11px] text-red-200">
                    Too many wrong codes. Try again in {Math.ceil((otpLockUntil - Date.now()) / 1000)}s.
                  </div>
                )}
                {otpFails > 0 && (!otpLockUntil || Date.now() >= otpLockUntil) && (
                  <div className="text-[10px] uppercase tracking-widest text-amber-300/80">
                    Attempts used: {otpFails}/{MAX_OTP_VERIFY_ATTEMPTS}
                  </div>
                )}
                <button type="submit" disabled={busy || otp.length < 6 || !!(otpLockUntil && Date.now() < otpLockUntil)} className="w-full py-3 rounded-md bg-[#ff2a3a] hover:bg-[#ff3a4a] text-white text-sm font-semibold uppercase tracking-widest disabled:opacity-50 transition">
                  {busy ? "Verifying…" : "Verify & sign in"}
                </button>
                <div className="flex items-center justify-between text-[11px] uppercase tracking-widest">
                  <button type="button" onClick={() => setStage("form")} className="text-white/40 hover:text-white/70">← Back</button>
                  <button type="button" onClick={handleResend} disabled={resendCooldown > 0 || busy} className="text-white/60 hover:text-white disabled:text-white/25">
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                  </button>
                </div>
              </form>
            )}

            {stage === "reset-sent" && (
              <div className="space-y-4 text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <MailCheck className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm text-white/70">
                  We sent a reset link to <span className="font-mono text-white">{email}</span>. Follow the link to set a new password.
                </p>
                <button
                  type="button"
                  onClick={() => { setStage("form"); setMode("signin"); }}
                  className="text-[11px] uppercase tracking-widest text-white/40 hover:text-white/70"
                >
                  ← Back to sign in
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-white/5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-white/30">
            <KeyRound className="w-3 h-3" />
            <span>Encrypted · Zero-log passwords</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PwStrengthBars({ password }: { password: string }) {
  const score =
    (password.length >= 8 ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);
  const colors = ["bg-white/10", "bg-red-500/60", "bg-amber-500/60", "bg-emerald-500/60", "bg-emerald-400"];
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`h-1 flex-1 rounded ${i < score ? colors[score] : "bg-white/5"}`} />
      ))}
    </>
  );
}
