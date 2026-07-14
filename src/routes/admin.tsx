import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getMyStaffRole } from "@/lib/admin.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Cookie, Globe2, ScrollText, Settings, Users, LogOut,
  Shield, ShieldAlert, KeyRound,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin — Emberlord" }, { name: "robots", content: "noindex" }] }),
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const [authReady, setAuthReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const fetchRole = useServerFn(getMyStaffRole);
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthed(!!data.session);
      setAuthReady(true);
      if (!data.session) navigate({ to: "/auth" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setAuthed(false);
        qc.clear();
        navigate({ to: "/auth" });
      } else if (event === "SIGNED_IN") {
        setAuthed(true);
      }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [navigate, qc]);

  const role = useQuery({
    queryKey: ["staff-role"],
    queryFn: () => fetchRole(),
    enabled: authed,
    retry: false,
  });

  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (!authReady) return <FullScreenLoading label="Loading session…" />;
  if (!authed) return null;
  if (role.isLoading) return <FullScreenLoading label="Checking permissions…" />;
  if (role.error || !role.data?.isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-4">
          <ShieldAlert className="w-12 h-12 mx-auto text-destructive" />
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="text-muted-foreground">
            You are signed in but not a staff member. Ask an existing admin to grant your account a role.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={signOut}>Sign out</Button>
            <Button asChild><Link to="/">Home</Link></Button>
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
    { to: "/admin/staff", label: "Staff & roles", icon: Users, adminOnly: true },
    { to: "/admin/security", label: "Security (TOTP)", icon: KeyRound },
    { to: "/admin/settings", label: "Settings", icon: Settings, adminOnly: true },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground grid grid-cols-1 md:grid-cols-[240px_1fr]">
      <aside className="border-r border-border/50 bg-card/40 backdrop-blur p-4 md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        <div className="flex items-center gap-2 mb-6 px-2">
          <Shield className="w-5 h-5 text-primary" />
          <div className="font-bold">Emberlord Admin</div>
        </div>
        <div className="text-xs text-muted-foreground px-2 mb-1">Signed in as</div>
        <div className="px-2 mb-4">
          <div className="text-sm font-medium">{role.data?.profile?.display_name ?? role.data?.profile?.username ?? "Staff"}</div>
          <Badge variant={role.data?.isAdmin ? "default" : "secondary"} className="mt-1 text-[10px]">
            {role.data?.isAdmin ? "ADMIN" : "MODERATOR"}
          </Badge>
        </div>
        <nav className="space-y-1">
          {nav.filter((n) => !n.adminOnly || role.data?.isAdmin).map((n) => {
            const active = pathname === n.to;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                }`}
              >
                <n.icon className="w-4 h-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <Button variant="ghost" className="w-full justify-start mt-6 text-muted-foreground" onClick={signOut}>
          <LogOut className="w-4 h-4 mr-2" /> Sign out
        </Button>
      </aside>
      <main className="p-4 md:p-8 max-w-[1400px] w-full">
        <Outlet />
      </main>
    </div>
  );
}

function FullScreenLoading({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-sm text-muted-foreground animate-pulse">{label}</div>
    </div>
  );
}
