import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ShieldCheck, Trash2, KeyRound, Smartphone, Loader2, Copy, Download,
  Printer, RefreshCw, Eye, EyeOff, AlertTriangle,
} from "lucide-react";
import { generateRecoveryCodes, listRecoveryCodes } from "@/lib/mfa.functions";

export const Route = createFileRoute("/admin/security")({
  head: () => ({ meta: [{ title: "Security — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: SecurityPage,
});

type Factor = { id: string; friendly_name: string | null; status: string; created_at: string };

function useVisibilityGate() {
  const [visible, setVisible] = useState(typeof document === "undefined" ? true : document.visibilityState === "visible");
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return visible;
}

function SecurityPage() {
  const qc = useQueryClient();
  const visible = useVisibilityGate();
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string; name: string } | null>(null);
  const [friendlyName, setFriendlyName] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [aal, setAal] = useState<"aal1" | "aal2" | null>(null);
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [reveal, setReveal] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const genRecovery = useServerFn(generateRecoveryCodes);
  const listRecovery = useServerFn(listRecoveryCodes);
  const abandonedRef = useRef(false);

  // fetch userId once for realtime filter
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  // AAL polling (~2s)
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const tick = async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (alive) setAal((data?.currentLevel as any) ?? null);
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [visible]);

  const factorsQ = useQuery({
    queryKey: ["mfa-factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return (data?.totp ?? []) as Factor[];
    },
    refetchInterval: visible ? 2000 : false,
    refetchOnWindowFocus: true,
  });

  const recoveryQ = useQuery({
    queryKey: ["mfa-recovery-summary"],
    queryFn: async () => await listRecovery(),
    refetchInterval: visible ? 2000 : false,
    refetchOnWindowFocus: true,
  });

  // Realtime on admin_recovery_codes → invalidate summary
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`mfa-recovery-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "admin_recovery_codes", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: ["mfa-recovery-summary"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const factors = factorsQ.data ?? [];
  const verified = factors.some((f) => f.status === "verified");
  const remaining = recoveryQ.data?.remaining ?? 0;
  const hasCodes = (recoveryQ.data?.total ?? 0) > 0;
  const lowCodes = hasCodes && remaining <= 2;

  const startEnroll = async () => {
    setBusy(true);
    abandonedRef.current = false;
    try {
      // Clean any stale unverified TOTP factors first
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const nm = friendlyName.trim() || `OKFLIX ${new Date().toLocaleDateString()}`;
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp", issuer: "OKFLIX Admin", friendlyName: nm,
      });
      if (error) throw error;
      setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret, name: nm });
      setOtp("");
      qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    } catch (err: any) {
      toast.error(err.message ?? "Enroll failed");
    } finally { setBusy(false); }
  };

  const verifyEnroll = async () => {
    if (!enrolling) return;
    setBusy(true);
    try {
      const ch = await supabase.auth.mfa.challenge({ factorId: enrolling.id });
      if (ch.error) throw ch.error;
      const v = await supabase.auth.mfa.verify({ factorId: enrolling.id, challengeId: ch.data.id, code: otp });
      if (v.error) throw v.error;
      toast.success("Authenticator activated");
      // If user has no recovery codes yet, generate them now
      if (!hasCodes) {
        const res = await genRecovery();
        setFreshCodes(res.codes);
        setReveal(true);
      }
      setEnrolling(null); setOtp("");
      qc.invalidateQueries({ queryKey: ["mfa-factors"] });
      qc.invalidateQueries({ queryKey: ["mfa-recovery-summary"] });
    } catch (err: any) { toast.error(err.message ?? "Verify failed"); }
    finally { setBusy(false); }
  };

  const discardEnroll = useCallback(async () => {
    if (!enrolling) return;
    abandonedRef.current = true;
    try { await supabase.auth.mfa.unenroll({ factorId: enrolling.id }); } catch {}
    setEnrolling(null); setOtp("");
    qc.invalidateQueries({ queryKey: ["mfa-factors"] });
  }, [enrolling, qc]);

  // Auto-clean stale unverified on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      for (const f of data?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unenroll = async (factorId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success("Authenticator removed");
      qc.invalidateQueries({ queryKey: ["mfa-factors"] });
    } catch (err: any) { toast.error(err.message ?? "Remove failed"); }
    finally { setBusy(false); }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await genRecovery();
      setFreshCodes(res.codes);
      setReveal(true);
      toast.success("Recovery codes regenerated");
      qc.invalidateQueries({ queryKey: ["mfa-recovery-summary"] });
    } catch (err: any) { toast.error(err.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const copyCodes = () => {
    if (!freshCodes) return;
    navigator.clipboard.writeText(freshCodes.join("\n"));
    toast.success("Copied");
  };
  const downloadCodes = () => {
    if (!freshCodes) return;
    const blob = new Blob(
      [`OKFLIX Admin Recovery Codes\nGenerated: ${new Date().toISOString()}\n\n${freshCodes.join("\n")}\n\nStore securely. Each code works once.`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "okflix-recovery-codes.txt"; a.click();
    URL.revokeObjectURL(url);
  };
  const printCodes = () => {
    if (!freshCodes) return;
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(`<pre style="font:14px monospace;padding:24px">OKFLIX Admin Recovery Codes\n\n${freshCodes.join("\n")}</pre>`);
    w.document.close(); w.focus(); w.print();
  };

  const aalChip = useMemo(() => {
    if (aal === "aal2") return { text: "AAL2 · secured", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" };
    if (verified) return { text: "AAL1 · TOTP pending", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
    return { text: "AAL1 · TOTP off", cls: "bg-white/10 text-white/60 border-white/20" };
  }, [aal, verified]);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-[#ff2a3a]" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Two-factor</div>
            <h1 className="font-display text-3xl md:text-4xl leading-none">Security</h1>
            <p className="text-sm text-white/50 mt-2">TOTP authenticator for your admin account. Recommended for every staff member.</p>
          </div>
        </div>
        <Badge variant="outline" className={`${aalChip.cls} whitespace-nowrap font-mono text-[10px] uppercase tracking-widest`}>
          {aalChip.text}
        </Badge>
      </div>

      {/* Status card */}
      <div className={`glass p-5 flex items-center justify-between ${verified ? "border-emerald-500/30" : "border-amber-500/30"}`}>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${verified ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"}`} />
          <div>
            <div className="font-display text-lg">{verified ? "2FA active" : "2FA not configured"}</div>
            <div className="text-xs text-white/50">
              {verified ? "Your account is protected by TOTP." : "Add an authenticator below to enable 2FA."}
            </div>
          </div>
        </div>
        <ShieldCheck className={`w-6 h-6 ${verified ? "text-emerald-400" : "text-amber-400"}`} />
      </div>

      {/* Authenticator factors */}
      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Authenticator apps</div>
        </div>
        <div className="p-5 space-y-3">
          {factorsQ.isLoading ? (
            <p className="text-sm text-white/40">Loading…</p>
          ) : factors.length === 0 ? (
            <p className="text-sm text-white/50">No TOTP factor enrolled. Add one to enable 2FA.</p>
          ) : factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between border border-white/10 bg-white/[0.02] rounded-md px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{f.friendly_name ?? "TOTP"}</div>
                <div className="text-[11px] text-white/50 font-mono truncate">
                  #{f.id.slice(0, 8)} · added {new Date(f.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={f.status === "verified"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"}>
                  {f.status}
                </Badge>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={busy} className="hover:bg-red-500/10" aria-label="Remove factor">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove {f.friendly_name ?? "authenticator"}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You'll lose 2FA protection on this device. You can re-enroll any time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => unenroll(f.id)} className="btn-red">Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}

          {!enrolling ? (
            <div className="pt-2 space-y-2">
              <Label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Friendly name (optional)</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={friendlyName}
                  onChange={(e) => setFriendlyName(e.target.value)}
                  placeholder="e.g. Pixel 8 · 1Password"
                  className="bg-white/[0.03] border-white/10 text-white h-11"
                  maxLength={64}
                />
                <Button onClick={startEnroll} disabled={busy} className="btn-red min-h-11">
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
                  Start enrollment
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 border border-[#ff2a3a]/30 bg-[#ff2a3a]/5 rounded-lg p-5">
              <div className="text-sm text-white/80">Scan in Google Authenticator, 1Password, Authy, or a compatible app:</div>
              <div className="bg-white p-3 rounded-md w-fit" aria-label="Scan with your authenticator app"
                   dangerouslySetInnerHTML={{ __html: enrolling.qr }} />
              <div className="text-xs text-white/60 space-y-1.5">
                <div className="uppercase font-mono tracking-widest text-[10px] text-white/40">Or enter secret manually</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs font-mono text-white/80 break-all select-all" aria-label="TOTP secret">
                    {enrolling.secret}
                  </code>
                  <Button size="icon" variant="ghost" className="text-white/60"
                    onClick={() => { navigator.clipboard.writeText(enrolling.secret); toast.success("Secret copied"); }}
                    aria-label="Copy secret">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Enter 6-digit code to confirm</label>
                <InputOTP maxLength={6} value={otp} onChange={setOtp} inputMode="numeric" autoFocus>
                  <InputOTPGroup>{[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup>
                </InputOTP>
              </div>
              <div className="flex gap-2">
                <Button onClick={verifyEnroll} disabled={busy || otp.length < 6} className="btn-red">
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Verify & activate
                </Button>
                <Button variant="ghost" onClick={discardEnroll} className="text-white/60">Discard</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recovery codes */}
      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#ff2a3a]" />
            <div className="font-display text-lg">Recovery codes</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={lowCodes
              ? "bg-red-500/15 text-red-300 border-red-500/30"
              : hasCodes ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-white/10 text-white/60 border-white/20"}>
              {recoveryQ.isLoading ? "…" : `${remaining} of ${recoveryQ.data?.total ?? 0} left`}
            </Badge>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="border-white/15">
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Regenerate
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Regenerate recovery codes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All existing codes will be invalidated immediately. You'll see the new codes once — save them somewhere safe.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={regenerate} className="btn-red">Regenerate</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {lowCodes && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex gap-2 text-xs text-red-100">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-300" />
              <div><span className="font-medium">Running low — regenerate now.</span> You have {remaining} recovery code{remaining === 1 ? "" : "s"} left.</div>
            </div>
          )}

          {!freshCodes ? (
            <p className="text-sm text-white/50">
              {hasCodes
                ? `You have ${remaining} unused recovery code${remaining === 1 ? "" : "s"}. For security, plaintext codes are never re-shown — regenerate to view a fresh set.`
                : "No recovery codes yet. Verify a TOTP factor above to generate 10 one-time codes, or click Regenerate."}
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex gap-2 text-xs text-amber-200/90">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p><span className="font-medium">One-time — save now.</span> These codes will not be shown again after you leave this page.</p>
              </div>
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setReveal((v) => !v)} className="text-white/60">
                  {reveal ? <><EyeOff className="w-3.5 h-3.5 mr-1.5" /> Hide</> : <><Eye className="w-3.5 h-3.5 mr-1.5" /> Reveal</>}
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
                {freshCodes.map((c, i) => (
                  <code key={i} className="bg-black/40 border border-white/10 rounded px-2 py-2 text-white/80 text-center tracking-wider">
                    {reveal ? c : "•••• •••• ••••"}
                  </code>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyCodes} className="border-white/15"><Copy className="w-3.5 h-3.5 mr-1.5" /> Copy all</Button>
                <Button variant="outline" size="sm" onClick={downloadCodes} className="border-white/15"><Download className="w-3.5 h-3.5 mr-1.5" /> Download .txt</Button>
                <Button variant="outline" size="sm" onClick={printCodes} className="border-white/15"><Printer className="w-3.5 h-3.5 mr-1.5" /> Print</Button>
                <Button variant="ghost" size="sm" onClick={() => setFreshCodes(null)} className="text-white/50 ml-auto">Done — I saved them</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
