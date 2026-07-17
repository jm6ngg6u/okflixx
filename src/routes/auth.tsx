import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield, KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { logMfaEvent } from "@/lib/mfa.functions";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin Sign In — Emberlord" }, { name: "robots", content: "noindex" }] }),
  component: AuthPage,
});

type Step = "credentials" | "totp" | "recovery";

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
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);

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
          // Signed in at aal1 with no factor → send to enrollment
          navigate({ to: "/auth/mfa", search: { mode: "enroll" } as any });
        }
      } catch (err: any) {
        setStatus("");
        setErrorMessage(err?.message ?? "Could not check the current admin session. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setStep("totp");
        setStatus("");
        setBusy(false);
      } else {
        setStatus("Opening two-factor setup…");
        navigate({ to: "/auth/mfa", search: { mode: "enroll" } as any });
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
    setBusy(true);
    setErrorMessage(null);
    setStatus("Opening Google sign-in…");
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/auth",
        extraParams: { prompt: "select_account consent" },
      });
      if (result.error) {
        toast.error(result.error.message ?? "Sign-in failed");
        setStatus("");
        setBusy(false);
        return;
      }
      if (result.redirected) return;
      // After Google → same MFA flow
      window.location.reload();
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Sign-in failed");
      toast.error(err?.message ?? "Sign-in failed");
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
      navigate({ to: "/auth/mfa", search: { mode: "enroll" } as any });
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Recovery failed");
      toast.error(err?.message ?? "Recovery failed");
      setStatus("");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0b0d] px-4">
      <Card className="w-full max-w-md border-white/10 bg-[#111114]">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <Shield className="h-7 w-7 text-red-400" />
          </div>
          <CardTitle className="text-white text-2xl">
            {step === "credentials" ? "Admin sign in" : step === "totp" ? "Two-factor verification" : "Recover access"}
          </CardTitle>
          <p className="text-sm text-white/60">
            {step === "credentials"
              ? "Sign in with your admin email and password."
              : step === "totp"
                ? "Enter the 6-digit code from your authenticator app."
                : "Enter a one-time recovery code to reset your authenticator."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100 flex gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-300" />
              <span>{errorMessage}</span>
            </div>
          )}
          {status && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-red-300" />
              <span>{status}</span>
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
        </CardContent>
      </Card>
    </div>
  );
}
