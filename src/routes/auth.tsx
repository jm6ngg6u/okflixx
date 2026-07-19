import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Shield, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { logMfaEvent } from "@/lib/mfa.functions";
import { useBrand } from "@/lib/branding-context";
import logo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin Sign In — OKFLIX" }, { name: "robots", content: "noindex" }] }),
  component: AuthPage,
});

type Step = "credentials" | "totp" | "recovery";
type MfaMode = "enroll" | "challenge";

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please retry.`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function AuthPage() {
  const navigate = useNavigate();
  const brand = useBrand();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [mfaRedirectMode, setMfaRedirectMode] = useState<MfaMode | null>(null);

  const openMfa = useCallback((mode: MfaMode) => {
    const target = `/auth/mfa?mode=${mode}`;
    setMfaRedirectMode(mode);
    setStatus(mode === "enroll" ? "Opening two-factor setup…" : "Opening two-factor verification…");

    const fallbackTimer = window.setTimeout(() => {
      if (window.location.pathname !== "/auth/mfa") {
        window.location.assign(target);
      }
    }, 900);

    void navigate({ to: "/auth/mfa", search: { mode } as any }).catch(() => {
      window.clearTimeout(fallbackTimer);
      window.location.assign(target);
    });
  }, [navigate]);

  // If already signed in with aal2 → straight to /admin.
  // If signed in at aal1 with a factor → jump to TOTP step.
  useEffect(() => {
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) return;
        setStatus("Checking two-factor status…");
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal?.currentLevel === "aal2") {
          navigate({ to: "/admin" });
          return;
        }
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const verified = (factors?.totp ?? []).find((f: any) => f.status === "verified");
        if (verified) {
          setFactorId(verified.id);
          setStep("totp");
          setStatus("");
        } else {
          // No verified factor → TOTP is optional. Go straight to admin.
          navigate({ to: "/admin" });
        }
      } catch (err: any) {
        setStatus("");
        setErrorMessage(err?.message ?? "Could not check the current admin session. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, openMfa]);

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    setStatus("Signing in…");
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        }),
        "Password sign-in",
      );
      if (error) {
        void logMfaEvent({
          data: { event: "password_signin_fail", email: email.trim(), success: false, metadata: { reason: error.message } },
        }).catch(() => {});
        setErrorMessage(error.message);
        toast.error(error.message);
        setStatus("");
        setBusy(false);
        return;
      }
      if (!data.session) {
        setErrorMessage("The backend accepted the password but did not return a session. Try again.");
        toast.error("No session returned");
        setStatus("");
        setBusy(false);
        return;
      }
      setStatus("Checking authenticator…");
      void logMfaEvent({
        data: { event: "password_signin_ok", email: email.trim(), success: true },
      }).catch(() => {});

      const { data: factors, error: factorsError } = await withTimeout(
        supabase.auth.mfa.listFactors(),
        "Authenticator check",
      );
      if (factorsError) throw factorsError;
      const verified = (factors?.totp ?? []).find((f: any) => f.status === "verified");
      if (verified) {
        setFactorId(verified.id);
        setMfaRedirectMode(null);
        setStep("totp");
        setStatus("");
        setBusy(false);
      } else {
        // No TOTP enrolled → allow entry. User can enable it later at /admin/security.
        setStatus("Opening admin panel…");
        toast.success("Signed in");
        navigate({ to: "/admin" });
      }
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Sign-in failed after password verification. Please retry.");
      toast.error(err?.message ?? "Sign-in failed");
      setStatus("");
      setBusy(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !factorId) return;
    setBusy(true);
    setErrorMessage(null);
    setStatus("Verifying code…");
    try {
      const code = otp.replace(/\D/g, "");
      if (code.length !== 6) {
        toast.error("Enter the 6-digit code");
        setStatus("");
        setBusy(false);
        return;
      }
      const { data: ch, error: chErr } = await withTimeout(
        supabase.auth.mfa.challenge({ factorId }),
        "Authenticator challenge",
      );
      if (chErr) throw chErr;
      const { error: vErr } = await withTimeout(
        supabase.auth.mfa.verify({
          factorId,
          challengeId: ch.id,
          code,
        }),
        "Authenticator verification",
      );
      if (vErr) {
        void logMfaEvent({ data: { event: "totp_challenge_fail", success: false, metadata: { reason: vErr.message } } }).catch(() => {});
        setErrorMessage(vErr.message);
        toast.error(vErr.message);
        setStatus("");
        setBusy(false);
        return;
      }
      void logMfaEvent({ data: { event: "totp_challenge_ok", success: true } }).catch(() => {});
      setStatus("Opening admin panel…");
      toast.success("Verified");
      navigate({ to: "/admin" });
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Verification failed. Please retry.");
      toast.error(err?.message ?? "Verification failed");
      setStatus("");
      setBusy(false);
    }
  }

  async function handleGoogle() {
    // Admin sign-in is intentionally password + TOTP only. Google is exposed
    // as a convenience for admins whose accounts already exist, but we use
    // Supabase's full-page redirect (no popup) so it always works even inside
    // iframe previews. The account still lands back on /auth and follows the
    // same TOTP flow before /admin.
    setBusy(true);
    setErrorMessage(null);
    setStatus("Opening Google sign-in…");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/auth",
          queryParams: { prompt: "select_account consent" },
        },
      });
      if (error) {
        setErrorMessage(error.message);
        toast.error(error.message);
        setStatus("");
        setBusy(false);
      }
      // On success the browser navigates away — nothing else to do.
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Google sign-in failed.");
      toast.error(err?.message ?? "Google sign-in failed.");
      setStatus("");
      setBusy(false);
    }
  }

  async function goRecovery() {
    setStep("recovery");
  }

  async function handleRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    setStatus("Checking recovery code…");
    try {
      const { redeemRecoveryCode } = await import("@/lib/mfa.functions");
      const res = await redeemRecoveryCode({ data: { code: recovery } });
      if (!res.ok) {
        toast.error(res.reason === "already_used" ? "This code was already used" : "Invalid recovery code");
        setStatus("");
        setBusy(false);
        return;
      }
      toast.success("Recovery accepted — enroll a new authenticator");
      openMfa("enroll");
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Recovery failed");
      toast.error(err?.message ?? "Recovery failed");
      setStatus("");
      setBusy(false);
    }
  }

  const brandName = `${brand?.name_prefix ?? "EMBER"}${brand?.name_suffix ?? "LORD"}`;
  const namePrefix = brand?.name_prefix ?? "EMBER";
  const nameSuffix = brand?.name_suffix ?? "LORD";
  const heroLogo = brand?.logo_url || logo;

  const stepTitle =
    step === "credentials"
      ? "Admin sign in"
      : step === "totp"
        ? "Two-factor verification"
        : "Recover access";
  const stepSubtitle =
    step === "credentials"
      ? "Restricted area. Sign in with your admin email and password."
      : step === "totp"
        ? "Enter the 6-digit code from your authenticator app."
        : "Enter a one-time recovery code to reset your authenticator.";

  const loginScale = Math.max(60, Math.min(160, parseInt((brand as any).login_scale || "100", 10) || 100)) / 100;
  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-[#050505] text-white"
      style={{ fontFamily: "var(--brand-font-body, Inter), sans-serif", ["--brand-surface-scale" as any]: loginScale }}
    >
      {/* Background beams — same visual language as /login */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-[#ff2a3a] opacity-[0.12] blur-[150px]" />
        <div className="absolute top-1/3 -right-52 h-[520px] w-[520px] rounded-full bg-[#7a0010] opacity-[0.24] blur-[170px]" />
        <div className="absolute bottom-[-8rem] left-1/4 h-[400px] w-[400px] rounded-full bg-[#ff2a3a] opacity-[0.09] blur-[150px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#050505_92%)]" />
      </div>

      {/* Top bar — logo + wordmark, same as /login */}
      <header className="relative z-10 mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-5 sm:px-6 sm:py-6">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff2a3a] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          aria-label={`${brandName} home`}
        >
          <img src={heroLogo} alt="" className="header-logo-glow h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
          <span
            className="truncate text-base font-extrabold tracking-[0.14em] sm:text-lg"
            style={{
              fontFamily: "var(--brand-font-display, Sora), sans-serif",
              textShadow: "0 0 18px rgba(255,42,58,0.55)",
            }}
          >
            <span className="text-white">{namePrefix}</span>
            <span className="bg-gradient-to-r from-[#ff2a3a] via-[#ff6b3d] to-[#ff2a3a] bg-clip-text text-transparent [background-size:200%_100%] motion-safe:animate-[shine_var(--brand-shine-duration,4.8s)_linear_infinite]">
              {nameSuffix}
            </span>
          </span>
        </Link>
        <Link
          to="/"
          className="shrink-0 rounded-md px-1 text-[10px] uppercase tracking-[0.22em] text-white/50 transition hover:text-white sm:text-xs"
          style={{ fontFamily: "var(--brand-font-body, Inter), sans-serif" }}
        >
          ← Back to site
        </Link>
      </header>

      <main className="relative z-10 mx-auto flex max-w-md items-center justify-center px-4 pb-16 pt-4 sm:px-6 sm:pt-8">
        <div className="relative w-full">
          {/* Glow halo */}
          <div
            className="absolute -inset-px rounded-2xl bg-gradient-to-b from-[#ff2a3a]/40 via-white/5 to-transparent opacity-70 blur-[1px]"
            aria-hidden="true"
          />
          <div className="relative rounded-2xl border border-white/10 bg-[#0b0b0d]/90 p-6 shadow-[0_40px_120px_-30px_rgba(255,42,58,0.35)] backdrop-blur-xl sm:p-8">
            <div className="text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#ff2a3a]/10 ring-1 ring-[#ff2a3a]/30 shadow-[0_0_24px_-4px_rgba(255,42,58,0.55)]">
                <Shield className="h-7 w-7 text-[#ff5a68]" aria-hidden="true" />
              </div>
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#ff5a68]"
                style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
              >
                Restricted · Admin only
              </div>
              <h1
                className="text-2xl font-bold tracking-tight text-white sm:text-[1.75rem]"
                style={{ fontFamily: "var(--brand-font-display, Sora), sans-serif" }}
              >
                {stepTitle}
              </h1>
              <p className="text-sm text-white/60">{stepSubtitle}</p>
            </div>

            <div className="mt-6 space-y-4">
              {errorMessage && (
                <div className="flex gap-2 rounded-lg border border-[#ff2a3a]/40 bg-[#ff2a3a]/[0.08] p-3 text-sm text-red-100" role="alert">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-[#ff5a68]" />
                  <span className="leading-snug">{errorMessage}</span>
                </div>
              )}
          {status && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-red-300" />
              <span>{status}</span>
            </div>
          )}
          {mfaRedirectMode && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100 space-y-3">
              <p className="text-emerald-100/80">
                Your password is accepted. This account needs authenticator setup before the admin panel can open.
              </p>
              <Button
                type="button"
                onClick={() => window.location.assign(`/auth/mfa?mode=${mfaRedirectMode}`)}
                className="w-full h-10 btn-red font-medium"
              >
                Open two-factor setup now
              </Button>
            </div>
          )}
          {step === "credentials" && (
            <>
              <form onSubmit={handlePasswordSignIn} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-white/70 text-xs uppercase tracking-wider">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-[#0b0b0d] border-white/10 text-white h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-white/70 text-xs uppercase tracking-wider">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-[#0b0b0d] border-white/10 text-white h-11"
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full h-11 btn-red font-medium">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
                </Button>
              </form>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                  <span className="bg-[#111114] px-2 text-white/40">or</span>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                variant="outline"
                className="w-full h-11 bg-transparent border-white/15 text-white hover:bg-white/5"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </Button>
            </>
          )}

          {step === "totp" && (
            <>
              <form onSubmit={handleTotp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="otp" className="text-white/70 text-xs uppercase tracking-wider">6-digit code</Label>
                  <Input
                    id="otp"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    autoFocus
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    className="bg-[#0b0b0d] border-white/10 text-white h-14 text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                  />
                </div>
                <Button type="submit" disabled={busy || otp.length !== 6} className="w-full h-11 btn-red font-medium">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                </Button>
              </form>
              <button
                type="button"
                onClick={goRecovery}
                className="w-full text-xs text-white/50 hover:text-white/80 flex items-center justify-center gap-1.5"
              >
                <KeyRound className="h-3 w-3" /> Use a recovery code instead
              </button>
            </>
          )}

          {step === "recovery" && (
            <>
              <form onSubmit={handleRecovery} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rec" className="text-white/70 text-xs uppercase tracking-wider">Recovery code</Label>
                  <Input
                    id="rec"
                    required
                    autoFocus
                    value={recovery}
                    onChange={(e) => setRecovery(e.target.value.toUpperCase())}
                    className="bg-[#0b0b0d] border-white/10 text-white h-11 font-mono tracking-wider"
                    placeholder="XXXX-XXXX-XXXX"
                  />
                </div>
                <Button type="submit" disabled={busy || recovery.length < 6} className="w-full h-11 btn-red font-medium">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Use recovery code"}
                </Button>
              </form>
              <button
                type="button"
                onClick={() => setStep("totp")}
                className="w-full text-xs text-white/50 hover:text-white/80"
              >
                Back to verification
              </button>
            </>
          )}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @keyframes shine {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes header-logo-glow {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(255,42,58,0.55)); }
          50%      { filter: drop-shadow(0 0 18px rgba(255,42,58,0.95)); }
        }
        .header-logo-glow { animation: header-logo-glow 2.6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
