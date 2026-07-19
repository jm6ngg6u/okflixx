import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset Password — OKFLIX" },
      { name: "description", content: "Set a new password for your OKFLIX account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase places tokens in the URL hash on recovery redirect.
    // The client picks them up automatically; we just need to confirm a session.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const isRecovery = /type=recovery/.test(hash) || /access_token=/.test(hash);
    setHasRecovery(isRecovery);
    (async () => {
      // Wait a tick for Supabase to hydrate from the URL.
      await new Promise((r) => setTimeout(r, 300));
      const { data } = await supabase.auth.getSession();
      setHasRecovery((prev) => prev || !!data.session);
      setReady(true);
    })();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Could not update password.");
      return;
    }
    setDone(true);
    toast.success("Password updated. You can sign in now.");
    setTimeout(() => navigate({ to: "/auth" }), 1500);
  };

  return (
    <div className="min-h-dvh grid place-items-center px-4 py-10 bg-background text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card/80 backdrop-blur p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>
        </div>

        {!ready ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Verifying link…
          </div>
        ) : done ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your password has been updated. Redirecting to sign in…
            </p>
          </div>
        ) : !hasRecovery ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This link is invalid or has expired. Request a new password reset email from the sign-in page.
            </p>
            <Button asChild className="w-full">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" aria-label="Reset password form">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              <span className="ml-2">{submitting ? "Updating…" : "Update password"}</span>
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
