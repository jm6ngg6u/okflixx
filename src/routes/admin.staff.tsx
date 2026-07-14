import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

export const Route = createFileRoute("/admin/staff")({
  head: () => ({ meta: [{ title: "Staff — Admin" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Users className="w-6 h-6" /> Staff & roles</h1>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Coming in Phase 2</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Manage staff accounts, grant/revoke <code>admin</code> and <code>moderator</code> roles, view admin activity log.</CardContent></Card>
    </div>
  ),
});
