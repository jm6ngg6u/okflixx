import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listStaff, inviteStaff, revokeRole } from "@/lib/staff.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, UserPlus, Trash2, Mail, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({ meta: [{ title: "Staff — OKFLIX Admin" }, { name: "robots", content: "noindex" }] }),
  component: StaffPage,
});

function StaffPage() {
  const fetchStaff = useServerFn(listStaff);
  const doInvite = useServerFn(inviteStaff);
  const doRevoke = useServerFn(revokeRole);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["staff"],
    queryFn: () => fetchStaff(),
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "hidden" ? false : 2000),
    refetchOnWindowFocus: true,
  });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">("moderator");
  const [busy, setBusy] = useState(false);

  // Realtime cross-tab sync (~2s) for role grants/revokes and invites.
  useEffect(() => {
    const ch = supabase
      .channel("admin-staff")
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () =>
        qc.invalidateQueries({ queryKey: ["staff"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_invites" }, () =>
        qc.invalidateQueries({ queryKey: ["staff"] }),
      )
      .subscribe();
    const onVis = () => {
      if (document.visibilityState === "visible") qc.invalidateQueries({ queryKey: ["staff"] });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [qc]);

  const staff = q.data?.staff ?? [];
  const invites = q.data?.invites ?? [];

  async function invite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await doInvite({ data: { email: trimmed, role } });
      toast.success(`Invite sent · promoted on first sign-in`);
      setEmail("");
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e: any) {
      const msg = String(e?.message ?? "Failed");
      if (/duplicate|unique|staff_invites_pending_email_uniq/i.test(msg)) {
        toast.error("A pending invite for that email already exists.");
      } else {
        toast.error(msg);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-[#ff2a3a]/20 to-[#b0060f]/10 border border-[#ff2a3a]/20 flex items-center justify-center">
          <Users className="w-5 h-5 text-[#ff2a3a]" />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#ff2a3a] mb-1">// Access</div>
          <h1 className="font-display text-3xl md:text-4xl leading-none">Staff & roles</h1>
          <p className="text-sm text-white/50 mt-2">Invite by email. Role is granted automatically on the invitee's first sign-in.</p>
        </div>
      </div>

      <div className="glass p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Invite staff</div>
        </div>
        <div className="grid sm:grid-cols-[1fr_180px_auto] gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" className="bg-white/5 border-white/10" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-white/40 font-mono">Role</label>
            <Select value={role} onValueChange={(v: any) => setRole(v)}>
              <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin — full access</SelectItem>
                <SelectItem value="moderator">Moderator — read + attempts</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="self-end">
            <Button onClick={invite} disabled={!email.trim() || busy} className="btn-red w-full sm:w-auto">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
              Invite
            </Button>
          </div>
        </div>
      </div>

      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Current staff <span className="text-white/40 text-sm">({staff.length})</span></div>
        </div>
        <div className="divide-y divide-white/5">
          {q.isLoading ? (
            <div className="p-8 text-center text-white/40 text-sm">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="p-8 text-center text-white/40 text-sm">No staff yet.</div>
          ) : staff.map((s: any) => (
            <div key={s.user_id + s.role} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.03] transition">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{s.display_name ?? s.email ?? s.user_id.slice(0, 8)}</div>
                <div className="text-xs text-white/50 font-mono truncate">{s.email ?? s.user_id.slice(0, 12)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className={s.role === "admin" ? "bg-[#ff2a3a]/15 text-[#ff8a90] border-[#ff2a3a]/30" : "bg-white/10 text-white/70 border-white/15"}>
                  {s.role}
                </Badge>
                <Button size="sm" variant="ghost" onClick={async () => {
                  if (!confirm(`Revoke ${s.role} from ${s.email ?? s.user_id.slice(0, 8)}?`)) return;
                  try {
                    await doRevoke({ data: { user_id: s.user_id } });
                    toast.success("Role revoked");
                    qc.invalidateQueries({ queryKey: ["staff"] });
                  } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }} className="hover:bg-red-500/10">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="glass overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#ff2a3a]" />
          <div className="font-display text-lg">Pending invites <span className="text-white/40 text-sm">({invites.filter((i: any) => !i.used_at).length})</span></div>
        </div>
        <div className="divide-y divide-white/5">
          {invites.length === 0 ? (
            <div className="p-8 text-center text-white/40 text-sm">No invites.</div>
          ) : invites.map((i: any) => (
            <div key={i.id} className="flex items-center justify-between px-5 py-3">
              <div className="text-sm font-mono">{i.email}</div>
              <div className="flex gap-2">
                <Badge variant="outline" className="bg-white/10 text-white/70 border-white/15">{i.role}</Badge>
                <Badge variant="outline" className={i.used_at
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"}>
                  {i.used_at ? "used" : "pending"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
