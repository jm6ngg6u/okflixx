// Pool alert — POSTs to admin webhook when usable cookie count falls below threshold.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/pool-alert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest, recordJobStart, recordJobFinish } = await import(
          "@/lib/cron.server"
        );
        if (!verifyCronRequest(request))
          return new Response("Unauthorized", { status: 401 });
        const jobId = await recordJobStart("pool-alert");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        try {
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key,value")
            .in("key", ["pool_alert_threshold", "pool_alert_webhook"]);
          const map: Record<string, string> = {};
          for (const s of settings ?? []) map[s.key] = s.value;
          const threshold = parseInt(map.pool_alert_threshold ?? "5", 10);
          const webhook = map.pool_alert_webhook ?? "";

          const { count } = await supabaseAdmin
            .from("cookie_pool")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .eq("is_valid", true);

          const usable = count ?? 0;
          const summary: any = { usable, threshold };
          if (usable < threshold && webhook) {
            try {
              await fetch(webhook, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  event: "pool_low",
                  usable,
                  threshold,
                  at: new Date().toISOString(),
                }),
              });
              summary.alerted = true;
            } catch (e: any) {
              summary.alert_error = String(e?.message ?? e);
            }
          }
          await recordJobFinish(jobId, true, summary);
          return Response.json({ ok: true, ...summary });
        } catch (e: any) {
          await recordJobFinish(jobId, false, {}, String(e?.message ?? e));
          return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
        }
      },
    },
  },
});
