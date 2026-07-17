import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldCheck, Loader2, Copy, Download, AlertTriangle } from "lucide-react";
import { generateRecoveryCodes, logMfaEvent } from "@/lib/mfa.functions";

const searchSchema = z.object({
  mode: z.enum(["enroll", "challenge"]).default("enroll"),
});

export const Route = createFileRoute("/auth/mfa")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Two-factor setup — Emberlord" }, { name: "robots", content: "noindex" }] }),
  component: MfaPage,
});

function MfaPage() {
  const navigate = useNavigate();
  const { mode } = Route.useSearch();

  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [phase, setPhase] = useState<"loading" | "enroll" | "codes" | "challenge">("loading");
  const [codes, setCodes] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/auth" });
        return;
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2" && mode === "enroll") {
        navigate({ to: "/admin" });
        return;
      }
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).find((f: any) => f.status === "verified");

      if (verified && mode === "challenge") {
        setFactorId(verified.id);
        setPhase("challenge");
        return;
      }

      // Enrollment path — clean any stale unverified factors first
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data: en, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Emberlord Admin" });
      if (error) {
        toast.error(error.message);
        return;
      }
      setFactorId(en.id);
      setQr(en.totp.qr_code);
      setSecret(en.totp.secret);
      setPhase("enroll");
      await logMfaEvent({ data: { event: "totp_enroll_start", success: true } }).catch(() => {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  async function verifyEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || busy) return;
    const code = otp.replace(/\D/g, "");
    if (code.length !== 6) return toast.error("Enter the 6-digit code");
    setBusy(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
      if (vErr) {
        await logMfaEvent({ data: { event: "totp_enroll_fail", success: false, metadata: { reason: vErr.message } } }).catch(() => {});
        toast.error(vErr.message);
        setBusy(false);
        return;
      }
      await logMfaEvent({ data: { event: "totp_enroll_ok", success: true } }).catch(() => {});
      // Generate recovery codes
      const res = await generateRecoveryCodes();
      setCodes(res.codes);
      setPhase("codes");
      setBusy(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Verification failed");
      setBusy(false);
    }
  }

  async function verifyChallenge(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || busy) return;
    const code = otp.replace(/\D/g, "");
    if (code.length !== 6) return toast.error("Enter the 6-digit code");
    setBusy(true);
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
      if (vErr) {
        await logMfaEvent({ data: { event: "totp_challenge_fail", success: false, metadata: { reason: vErr.message } } }).catch(() => {});
        toast.error(vErr.message);
        setBusy(false);
        return;
      }
      await logMfaEvent({ data: { event: "totp_challenge_ok", success: true } }).catch(() => {});
      navigate({ to: "/admin" });
    } catch (err: any) {
      toast.error(err?.message ?? "Verification failed");
      setBusy(false);
    }
  }

  function copyCodes() {
    navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Recovery codes copied");
  }
  function downloadCodes() {
    const blob = new Blob(
      [`Emberlord Admin Recovery Codes\nGenerated: ${new Date().toISOString()}\n\n${codes.join("\n")}\n\nStore securely. Each code works once.`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "emberlord-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0b0d] px-4 py-10">
      <Card className="w-full max-w-md border-white/10 bg-[#111114]">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-emerald-400" />
          </div>
          <CardTitle className="text-white text-2xl">
            {phase === "challenge" ? "Two-factor verification" : phase === "codes" ? "Save recovery codes" : "Set up two-factor"}
          </CardTitle>
          <p className="text-sm text-white/60">
            {phase === "challenge"
              ? "Enter the 6-digit code from your authenticator app."
              : phase === "codes"
                ? "These codes let you sign in if you lose your authenticator. Each works once."
                : "Scan the QR code with Google Authenticator, 1Password, or Authy."}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {phase === "loading" && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-white/40" />
            </div>
          )}

          {phase === "enroll" && (
            <>
              {qr && (
                <div className="flex justify-center">
                  <div
                    className="bg-white p-3 rounded-lg"
                    dangerouslySetInnerHTML={{ __html: qr }}
                  />
                </div>
              )}
              {secret && (
                <div className="space-y-1.5">
                  <Label className="text-white/70 text-xs uppercase tracking-wider">Manual secret</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-[#0b0b0d] border border-white/10 rounded px-3 py-2 text-xs font-mono text-white/80 break-all">
                      {secret}
                    </code>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-white/60"
                      onClick={() => { navigator.clipboard.writeText(secret); toast.success("Secret copied"); }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              <form onSubmit={verifyEnroll} className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-white/70 text-xs uppercase tracking-wider">6-digit code</Label>
                  <Input
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    className="bg-[#0b0b0d] border-white/10 text-white h-14 text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                  />
                </div>
                <Button type="submit" disabled={busy || otp.length !== 6} className="w-full h-11 btn-red font-medium">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enable two-factor"}
                </Button>
              </form>
            </>
          )}

          {phase === "codes" && (
            <>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex gap-2 text-xs text-amber-200/90">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p>Store these somewhere safe now. You will not see them again.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                {codes.map((c) => (
                  <code key={c} className="bg-[#0b0b0d] border border-white/10 rounded px-2 py-1.5 text-white/80 text-center">
                    {c}
                  </code>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={copyCodes} className="border-white/15">
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </Button>
                <Button type="button" variant="outline" onClick={downloadCodes} className="border-white/15">
                  <Download className="h-4 w-4 mr-2" /> Download
                </Button>
              </div>
              <Button
                type="button"
                onClick={() => navigate({ to: "/admin" })}
                className="w-full h-11 btn-red font-medium"
              >
                I saved my codes — continue
              </Button>
            </>
          )}

          {phase === "challenge" && (
            <form onSubmit={verifyChallenge} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs uppercase tracking-wider">6-digit code</Label>
                <Input
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
