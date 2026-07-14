import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({ meta: [{ title: "Settings — Admin" }, { name: "robots", content: "noindex" }] }),
  component: () => (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><SettingsIcon className="w-6 h-6" /> Settings</h1>
      </div>
      <Card><CardHeader><CardTitle className="text-base">Coming in Phase 2</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Maintenance mode toggle, rate-limit thresholds, auto-check schedules, CSV export.</CardContent></Card>
    </div>
  ),
});
