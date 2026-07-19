// 24 h auto-cleanup — dead cookies, stale free/on_hold, dead proxies, old logs.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-cleanup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest, recordJobStart, recordJobFinish } = await import(
          "@/lib/cron.server"
        );
        if (!(await verifyCronRequest(request)))
          return new Response("Unauthorized", { status: 401 });
        const jobId = await recordJobStart("auto-cleanup");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { data: enabled } = await supabaseAdmin
            .from("app_settings")
            .select("value")
            .eq("key", "auto_cleanup_enabled")
            .maybeSingle();
          if (enabled?.value !== "1") {
            await recordJobFinish(jobId, true, { skipped: "auto_cleanup_enabled=0" });
            return Response.json({ ok: true, skipped: true });
          }
          const { data, error } = await supabaseAdmin.rpc("run_auto_cleanup");
          if (error) throw error;
          await recordJobFinish(jobId, true, (data as any) ?? {});
          return Response.json({ ok: true, ...(data as any) });
        } catch (e: any) {
          await recordJobFinish(jobId, false, {}, String(e?.message ?? e));
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
