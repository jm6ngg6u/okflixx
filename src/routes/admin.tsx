import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LiveBackground } from "@/components/LiveBackground";
import { ClickRipple } from "@/components/ClickRipple";
import {
  LayoutDashboard, Cookie, Globe2, ScrollText, Settings, Users, LogOut,
  Shield, ShieldAlert, KeyRound, Menu, X, Music4, Shuffle, FileClock, MessageCircle,
  Palette,
} from "lucide-react";

import logo from "@/assets/brand-logo.png";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin — Emberlord" }, { name: "robots", content: "noindex" }] }),
  component: AdminLayout,
});

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

function AdminLayout() {
  const navigate = useNavigate();
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mfaReady, setMfaReady] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const auditedAccessRef = useRef<string | null>(null);
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function verifyMfa(userIdArg: string | null) {
    if (!userIdArg) return;
    try {
      setGateError(null);
      const { data: aal } = await withTimeout(
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        "Two-factor check",
      );
      if (aal?.currentLevel === "aal2") {
        setMfaReady(true);
        return;
      }
      // aal1 → only require TOTP if a verified factor is enrolled. Otherwise skip.
      const { data: factors } = await withTimeout(
        supabase.auth.mfa.listFactors(),
        "Authenticator factor check",
      );
      const verified = (factors?.totp ?? []).find((f: any) => f.status === "verified");
      if (verified) {
        setMfaReady(false);
        navigate({ to: "/auth/mfa", search: { mode: "challenge" } as any });
        return;
      }
      setMfaReady(true);
    } catch (err: any) {
      setMfaReady(false);
      setGateError(err?.message ?? "Could not verify two-factor status.");
    }
  }

  useEffect(() => {
    let mounted = true;
    withTimeout(supabase.auth.getUser(), "Session check").then(async ({ data, error }) => {
      if (!mounted) return;
      const user = error ? null : data.user;
      setAuthed(!!user);
      setUserId(user?.id ?? null);
      setUserEmail(user?.email ?? null);
      setAuthReady(true);
      if (!user) {
        navigate({ to: "/auth" });
        return;
      }
      await verifyMfa(user.id);
    }).catch((err: any) => {
      if (!mounted) return;
      setGateError(err?.message ?? "Could not check your admin session.");
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setAuthed(false);
        setUserId(null);
        setUserEmail(null);
        setMfaReady(false);
        qc.clear();
        navigate({ to: "/auth" });
      } else if (event === "SIGNED_IN" || event === "MFA_CHALLENGE_VERIFIED") {
        setAuthed(true);
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? null);
        qc.invalidateQueries({ queryKey: ["staff-role"] });
        void verifyMfa(session.user.id);
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, qc]);


  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const role = useQuery({
    queryKey: ["staff-role", userId],
    queryFn: async () => {
      if (!userId) throw new Error("Missing user");
      const [{ data: isAdmin, error: adminError }, { data: isMod, error: modError }, { data: profile, error: profileError }] = await Promise.all([
        supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
        supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
        supabase.from("admin_profiles").select("username, display_name, avatar_url").eq("user_id", userId).maybeSingle(),
      ]);
      if (adminError) throw adminError;
      if (modError) throw modError;
      if (profileError) throw profileError;
      const isFirstAdmin = userEmail?.toLowerCase() === "antigremi31@gmail.com";
      return {
        userId,
        isAdmin: !!isAdmin || isFirstAdmin,
        isModerator: !!isMod,
        isStaff: !!isAdmin || !!isMod || isFirstAdmin,
        profile: profile ?? null,
      };
    },
    enabled: authed && !!userId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: false,
  });

  useEffect(() => {
    if (!authed || !userId || role.isLoading || role.isFetching) return;
    const auditKey = `${userId}:${pathname}`;
    if (auditedAccessRef.current === auditKey) return;
    auditedAccessRef.current = auditKey;
    const allowed = !role.error && !!role.data?.isStaff;
    supabase
      .rpc("log_admin_access_attempt", { _allowed: allowed, _path: pathname })
      .then(({ error }) => { if (error) console.warn("audit failed", error.message); });
  }, [authed, pathname, role.data?.isStaff, role.error, role.isFetching, role.isLoading, userId]);

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!authReady) return <FullScreen label="Loading session…" />;
  if (!authed) return null;
  if (gateError) return <GateError message={gateError} onRetry={() => verifyMfa(userId)} onSignOut={signOut} />;
  if (!mfaReady) return <FullScreen label="Verifying two-factor…" />;
  if (role.isLoading) return <FullScreen label="Checking permissions…" />;
  if (role.error || !role.data?.isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden text-white">
        <LiveBackground />
        <div className="relative z-10 max-w-md text-center space-y-5 glass p-8">
          <ShieldAlert className="w-12 h-12 mx-auto text-[#ff2a3a]" />
          <h1 className="font-display text-3xl">Access denied</h1>
          <p className="text-white/60 text-sm">You are signed in but not a staff member. Ask an existing admin to grant your account a role.</p>
          {userEmail && <p className="text-xs text-white/40 font-mono">{userEmail}</p>}
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={signOut}>Sign out</Button>
            <Button asChild className="btn-red"><Link to="/">Home</Link></Button>
          </div>
        </div>
      </div>
    );
  }

  const nav: { to: string; label: string; icon: any; adminOnly?: boolean }[] = [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { to: "/admin/attempts", label: "Attempts log", icon: ScrollText },
    { to: "/admin/cookies", label: "Cookie pool", icon: Cookie, adminOnly: true },
    { to: "/admin/proxies", label: "Proxy pool", icon: Globe2, adminOnly: true },
    { to: "/admin/rotation", label: "Rotation policy", icon: Shuffle, adminOnly: true },
    { to: "/admin/access", label: "Access gates", icon: KeyRound, adminOnly: true },
    { to: "/admin/audit", label: "Auth audit", icon: FileClock },





    { to: "/admin/staff", label: "Staff & roles", icon: Users, adminOnly: true },
    { to: "/admin/security", label: "Security (TOTP)", icon: KeyRound },
    { to: "/admin/contact", label: "Contact channels", icon: MessageCircle, adminOnly: true },
    { to: "/admin/branding", label: "Branding studio", icon: Palette, adminOnly: true },
    { to: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
    { to: "/admin/background-song", label: "Background song", icon: Music4, adminOnly: true },

  ];
  const visibleNav = nav.filter((n) => !n.adminOnly || role.data?.isAdmin);

  return (
    <div className="admin-shell min-h-screen relative text-white font-ops">
      <LiveBackground />
      <ClickRipple />

      {/* Top bar (mobile) */}
      <div className="md:hidden relative z-30 flex items-center justify-between px-4 py-3 border-b border-white/10 backdrop-blur bg-black/40">
        <Link to="/admin" className="flex items-center gap-2">
          <img src={logo} alt="" data-wave-origin className="h-7 w-7 logo-shine" />
          <span className="font-display text-sm">EMBER<span className="text-[#ff2a3a]">LORD</span> · Admin</span>
        </Link>
        <button onClick={() => setMobileOpen((v) => !v)} className="p-2 rounded-md border border-white/10">
          {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
      </div>

      <div className="relative z-10 grid grid-cols-1 md:grid-cols-[260px_1fr]">
        <aside className={`${mobileOpen ? "block" : "hidden"} md:block border-r border-white/5 bg-black/40 backdrop-blur-xl p-5 md:sticky md:top-0 md:h-screen md:overflow-y-auto`}>
          <Link to="/admin" className="hidden md:flex items-center gap-3 mb-8 group">
            <img src={logo} alt="" data-wave-origin className="h-9 w-9 logo-shine group-hover:scale-110 transition" />
            <div>
              <div className="font-display text-base leading-none">EMBER<span className="text-[#ff2a3a]">LORD</span></div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mt-1">Control room</div>
            </div>
          </Link>

          <div className="glass p-3 mb-5">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Signed in</div>
            <div className="text-sm font-medium truncate">
              {role.data?.profile?.display_name ?? role.data?.profile?.username ?? "Staff"}
            </div>
            <div className="text-[11px] text-white/50 font-mono truncate">{userEmail}</div>
            <Badge variant="outline" className={`mt-2 text-[10px] border-none ${role.data?.isAdmin ? "bg-[#ff2a3a]/20 text-[#ff8a90]" : "bg-white/10 text-white/70"}`}>
              {role.data?.isAdmin ? "ADMIN" : "MODERATOR"}
            </Badge>
          </div>

          <div className="text-[10px] uppercase tracking-widest text-white/30 px-2 mb-2">Navigation</div>
          <nav className="space-y-1">
            {visibleNav.map((n) => {
              const active = pathname === n.to;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition relative overflow-hidden ${
                    active
                      ? "bg-gradient-to-r from-[#ff2a3a]/20 to-transparent text-white border border-[#ff2a3a]/30"
                      : "text-white/60 hover:text-white hover:bg-white/5 border border-transparent"
                  }`}
                >
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-[#ff2a3a] rounded-r" />}
                  <n.icon className="w-4 h-4" /> {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 space-y-2">
            <Button variant="outline" asChild className="w-full justify-start border-white/10 bg-white/[0.02] hover:bg-white/10">
              <Link to="/"><Shield className="w-4 h-4 mr-2" /> View public site</Link>
            </Button>
            <Button variant="ghost" className="w-full justify-start text-white/60 hover:text-white" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </Button>
          </div>
        </aside>

        <main className="p-4 md:p-8 max-w-[1400px] w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GateError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden text-white">
      <LiveBackground />
      <div className="relative z-10 max-w-md text-center space-y-5 glass p-8">
        <ShieldAlert className="w-12 h-12 mx-auto text-[#ff2a3a]" />
        <h1 className="font-display text-3xl">Login needs attention</h1>
        <p className="text-white/60 text-sm">{message}</p>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
          <Button className="btn-red" onClick={onRetry}>Retry</Button>
        </div>
      </div>
    </div>
  );
}

function FullScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-white relative overflow-hidden">
      <LiveBackground />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-[#ff2a3a]/30 border-t-[#ff2a3a] animate-spin" />
        <div className="text-sm text-white/60 font-mono uppercase tracking-widest">{label}</div>
      </div>
    </div>
  );
}
