import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, Trash2, KeyRound, Smartphone, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/security")({
  head: () => ({ meta: [{ title: "Security — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: SecurityPage,
});

function SecurityPage() {
  const [factors, setFactors] = useState<any[]>([]);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function startEnroll() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `OKFLIX ${new Date().toLocaleDateString()}` });
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
      toast.success("Authenticator activated");
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
    else { toast.success("Authenticator removed"); load(); }
  }

  const verified = factors.some((f) => f.status === "verified");

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Two-factor</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Security</h1>
          <p className="text-sm text-white/50 mt-2">TOTP authenticator for your admin account. Recommended for every staff member.</p>
        </div>
      </div>

      <div className={`glass p-5 flex items-center justify-between ${verified ? "border-emerald-500/30" : "border-amber-500/30"}`}>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${verified ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"}`} />
          <div>
            <div className="font-display text-lg">{verified ? "2FA active" : "2FA not configured"}</div>
            <div className="text-xs text-white/50">{verified ? "Your account is protected by TOTP." : "Add an authenticator below to enable 2FA."}</div>
          </div>
        </div>
        <ShieldCheck className={`w-6 h-6 ${verified ? "text-emerald-400" : "text-amber-400"}`} />
      </div>

      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Authenticator apps</div>
        </div>
        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-white/40">Loading…</p>
          ) : factors.length === 0 ? (
            <p className="text-sm text-white/50">No TOTP factor enrolled. Add one to enable 2FA.</p>
          ) : factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between border border-white/10 bg-white/[0.02] rounded-md px-4 py-3">
              <div>
                <div className="text-sm font-medium">{f.friendly_name ?? "TOTP"}</div>
                <div className="text-xs text-white/50 font-mono">Added {new Date(f.created_at).toLocaleDateString()}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={f.status === "verified"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"}>
                  {f.status}
                </Badge>
                <Button variant="ghost" size="icon" onClick={() => unenroll(f.id)} className="hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </Button>
              </div>
            </div>
          ))}

          {!enrolling ? (
            <Button onClick={startEnroll} disabled={busy} className="btn-red">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Add authenticator
            </Button>
          ) : (
            <div className="space-y-4 border border-[#ff2a3a]/30 bg-[#ff2a3a]/5 rounded-lg p-5">
              <div className="text-sm text-white/80">Scan in Google Authenticator, 1Password, Authy, or a compatible app:</div>
              <div className="bg-white p-3 rounded-md w-fit" dangerouslySetInnerHTML={{ __html: enrolling.qr }} />
              <div className="text-xs text-white/50">
                Or enter secret manually: <span className="font-mono text-white/80 select-all">{enrolling.secret}</span>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Enter 6-digit code to confirm</label>
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>{[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
                </InputOTP>
              </div>
              <div className="flex gap-2">
                <Button onClick={verifyEnroll} disabled={busy || otp.length < 6} className="btn-red">
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Verify & activate
                </Button>
                <Button variant="ghost" onClick={() => { setEnrolling(null); setOtp(""); }} className="text-white/60">Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
