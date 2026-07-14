import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/security")({
  head: () => ({ meta: [{ title: "Security — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: SecurityPage,
});

function SecurityPage() {
  const [factors, setFactors] = useState<any[]>([]);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp ?? []);
  }
  useEffect(() => { load(); }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Emberlord ${new Date().toLocaleDateString()}` });
      if (error) throw error;
      setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err: any) { toast.error(err.message ?? "Enroll failed"); }
    finally { setBusy(false); }
  }

  async function verifyEnroll() {
    if (!enrolling) return;
    setBusy(true);
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
      if (ch.error) throw ch.error;
      const v = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: ch.data.id, code: otp });
      if (v.error) throw v.error;
      toast.success("TOTP enrolled ✓");
      setEnrolling(null);
      setOtp("");
      load();
    } catch (err: any) { toast.error(err.message ?? "Verify failed"); }
    finally { setBusy(false); }
  }

  async function unenroll(factorId: string) {
    if (!confirm("Remove this authenticator? You'll lose 2FA on this account.")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) toast.error(error.message);
    else { toast.success("Removed"); load(); }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Security</h1>
        <p className="text-sm text-muted-foreground">Two-factor authentication (TOTP) for your admin account.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Authenticator apps</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {factors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No TOTP factor enrolled. Add one below.</p>
          ) : factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between border border-border/40 rounded-md px-3 py-2">
              <div>
                <div className="text-sm font-medium">{f.friendly_name ?? "TOTP"}</div>
                <div className="text-xs text-muted-foreground">Added {new Date(f.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={f.status === "verified" ? "default" : "secondary"}>{f.status}</Badge>
                <Button variant="ghost" size="icon" onClick={() => unenroll(f.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}

          {!enrolling ? (
            <Button onClick={startEnroll} disabled={busy}>Add authenticator</Button>
          ) : (
            <div className="space-y-3 border border-border/40 rounded-md p-4">
              <p className="text-sm">Scan this QR in Google Authenticator / 1Password / Authy:</p>
              <div className="bg-white p-3 rounded-md w-fit" dangerouslySetInnerHTML={{ __html: enrolling.qr }} />
              <p className="text-xs text-muted-foreground">Or enter secret manually: <span className="font-mono">{enrolling.secret}</span></p>
              <div className="space-y-2">
                <label className="text-sm">Enter 6-digit code to confirm:</label>
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>{[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
                </InputOTP>
              </div>
              <div className="flex gap-2">
                <Button onClick={verifyEnroll} disabled={busy || otp.length < 6}>Verify & activate</Button>
                <Button variant="ghost" onClick={() => { setEnrolling(null); setOtp(""); }}>Cancel</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
