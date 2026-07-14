import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listStaff, inviteStaff, revokeRole } from "@/lib/staff.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({ meta: [{ title: "Staff — Emberlord Admin" }, { name: "robots", content: "noindex" }] }),
  component: StaffPage,
});

function StaffPage() {
  const fetchStaff = useServerFn(listStaff);
  const doInvite = useServerFn(inviteStaff);
  const doRevoke = useServerFn(revokeRole);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["staff"], queryFn: () => fetchStaff() });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "moderator">("moderator");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Staff & roles</h1>
        <p className="text-sm text-muted-foreground">Invite by email — role is granted automatically when they first sign in.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-4 h-4" /> Invite staff</CardTitle>
          <CardDescription>Send an invite for an email address. On first sign-in the user is auto-promoted to the chosen role.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-[1fr_180px_auto] gap-2">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v: any) => setRole(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="moderator">Moderator</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="self-end">
            <Button
              onClick={async () => {
                if (!email) return;
                try {
                  await doInvite({ data: { email, role } });
                  toast.success("Invite created");
                  setEmail("");
                  qc.invalidateQueries({ queryKey: ["staff"] });
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed");
                }
              }}
            >
              Invite
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Current staff</CardTitle></CardHeader>
        <CardContent>
          {q.isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <div className="space-y-2">
              {(q.data?.staff ?? []).map((s: any) => (
                <div key={s.user_id + s.role} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{s.display_name ?? s.email ?? s.user_id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">{s.email ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.role === "admin" ? "default" : "secondary"}>{s.role}</Badge>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (!confirm("Revoke role?")) return;
                      try {
                        await doRevoke({ data: { user_id: s.user_id } });
                        qc.invalidateQueries({ queryKey: ["staff"] });
                      } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                    }}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {(q.data?.staff ?? []).length === 0 && (
                <div className="text-sm text-muted-foreground">No staff yet.</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pending invites</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(q.data?.invites ?? []).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="text-sm">{i.email}</div>
                <div className="flex gap-2">
                  <Badge>{i.role}</Badge>
                  <Badge variant={i.used_at ? "secondary" : "outline"}>{i.used_at ? "used" : "pending"}</Badge>
                </div>
              </div>
            ))}
            {(q.data?.invites ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground">No invites.</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
