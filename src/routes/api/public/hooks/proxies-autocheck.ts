import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/proxies-autocheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest, recordJobStart, recordJobFinish } = await import(
          "@/lib/cron.server"
        );
        if (!verifyCronRequest(request))
          return new Response("Unauthorized", { status: 401 });
        const jobId = await recordJobStart("proxies-autocheck");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { checkProxyViaWorker } = await import("@/lib/worker.server");
        try {
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key,value")
            .in("key", ["proxy_auto_check_enabled", "proxy_autocheck_cleanup"]);
          const map: Record<string, string> = {};
          for (const s of settings ?? []) map[s.key] = s.value;
          if (map.proxy_auto_check_enabled === "0") {
            await recordJobFinish(jobId, true, { skipped: "proxy_auto_check_enabled=0" });
            return Response.json({ ok: true, skipped: true });
          }
          const { data: rows } = await supabaseAdmin
            .from("proxy_pool")
            .select("id, scheme, ip, port, username, password")
            .order("last_checked_at", { ascending: true, nullsFirst: true })
            .limit(500);

          let ok = 0,
            dead = 0;
          for (const p of rows ?? []) {
            const res = await checkProxyViaWorker({
              proxy: {
                scheme: p.scheme,
                ip: p.ip,
                port: p.port,
                username: p.username,
                password: p.password,
              },
            });
            await supabaseAdmin
              .from("proxy_pool")
              .update({
                is_valid: res.ok,
                last_error: res.error ?? null,
                last_latency_ms: res.latency_ms ?? null,
                country: res.country ?? null,
                last_checked_at: new Date().toISOString(),
              })
              .eq("id", p.id);
            if (res.ok) ok++;
            else dead++;
          }
          let removed_invalid = 0;
          if (map.proxy_autocheck_cleanup !== "0") {
            const { count: c } = await supabaseAdmin
              .from("proxy_pool").select("id", { count: "exact", head: true }).eq("is_valid", false);
            await supabaseAdmin.from("proxy_pool").delete().eq("is_valid", false);
            removed_invalid = c ?? 0;
          }
          const summary = { checked: (rows ?? []).length, ok_count: ok, dead, removed_invalid };
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
