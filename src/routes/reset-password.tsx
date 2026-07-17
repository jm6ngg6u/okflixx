import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KeyRound, ArrowLeft, CheckCircle2 } from "lucide-react";
import logo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Emberlord" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the recovery link lands on this page.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // Also check if a session already exists (recovery link was clicked).
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (!/[A-Z]/.test(password)) { toast.error("Include at least one uppercase letter."); return; }
    if (!/[0-9]/.test(password)) { toast.error("Include at least one number."); return; }
    if (password !== confirm) { toast.error("Passwords don't match."); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated.");
      setTimeout(() => navigate({ to: "/login" }), 1200);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050507] text-white flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40" style={{
        background: "radial-gradient(60% 40% at 50% 0%, rgba(255,42,58,0.18), transparent 60%)",
      }} />
      <div className="relative w-full max-w-md">
        <Link to="/login" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-white/50 hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </Link>
        <div className="rounded-2xl border border-white/10 bg-[#0b0b0d]/90 backdrop-blur-xl">
          <div className="p-6 border-b border-white/5 text-center">
            <img src={logo} alt="Emberlord" className="mx-auto h-10 w-auto mb-3" />
            <h1 className="text-lg font-semibold tracking-tight">Set a new password</h1>
            <p className="text-xs text-white/50 mt-1">
              {ready ? "Choose a strong password to protect your account." : "Verifying reset link…"}
            </p>
          </div>
          <div className="p-6">
            {done ? (
              <div className="text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                </div>
                <p className="text-sm text-white/70">Password updated. Redirecting to sign in…</p>
              </div>
            ) : !ready ? (
              <div className="text-center py-8">
                <div className="mx-auto w-8 h-8 border-2 border-white/10 border-t-[#ff2a3a] rounded-full animate-spin" />
                <p className="mt-3 text-xs uppercase tracking-widest text-white/40">Checking reset link</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/50">New password</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#ff2a3a]/60"
                    placeholder="8+ chars, 1 uppercase, 1 number"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-white/50">Confirm password</label>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="mt-1 w-full bg-black/40 border border-white/10 rounded-md px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#ff2a3a]/60"
                    placeholder="Re-enter password"
                  />
                </div>
                <button type="submit" disabled={busy} className="w-full py-3 rounded-md bg-[#ff2a3a] hover:bg-[#ff3a4a] text-white text-sm font-semibold uppercase tracking-widest disabled:opacity-50 transition">
                  {busy ? "Updating…" : "Update password"}
                </button>
              </form>
            )}
          </div>
          <div className="px-6 py-4 border-t border-white/5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest text-white/30">
            <KeyRound className="w-3 h-3" />
            <span>Encrypted · Zero-log passwords</span>
          </div>
        </div>
      </div>
    </div>
  );
}
