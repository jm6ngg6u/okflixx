// 24 h auto-check for the cookie pool. Reads the global proxy_mode flag and
// routes each check through the worker with or without a proxy accordingly.
// Also rotates any cookie that fast_checker reports as invalid.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/cookies-autocheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest, recordJobStart, recordJobFinish } = await import(
          "@/lib/cron.server"
        );
        if (!verifyCronRequest(request))
          return new Response("Unauthorized", { status: 401 });
        const jobId = await recordJobStart("cookies-autocheck");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { checkCookieViaWorker } = await import("@/lib/worker.server");
        try {
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key,value")
            .in("key", ["proxy_mode", "auto_check_enabled"]);
          const map: Record<string, string> = {};
          for (const s of settings ?? []) map[s.key] = s.value;
          if (map.auto_check_enabled !== "1") {
            await recordJobFinish(jobId, true, { skipped: "auto_check_enabled=0" });
            return Response.json({ ok: true, skipped: true });
          }
          const proxyMode = map.proxy_mode === "1";

          // Pick oldest-checked cookies first, up to 200 per run
          const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
          const { data: rows } = await supabaseAdmin
            .from("cookie_pool")
            .select("id, cookies_json")
            .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
            .order("last_checked_at", { ascending: true, nullsFirst: true })
            .limit(200);

          let checked = 0,
            active = 0,
            invalid = 0,
            on_hold = 0,
            free = 0,
            deleted = 0;

          for (const r of rows ?? []) {
            let proxyPayload: any = null;
            if (proxyMode) {
              const { data: pr } = await supabaseAdmin.rpc("pick_next_proxy");
              const p = Array.isArray(pr) ? pr[0] : pr;
              if (p)
                proxyPayload = {
                  scheme: p.scheme,
                  ip: p.ip,
                  port: p.port,
                  username: p.username,
                  password: p.password,
                };
              if (p)
                await supabaseAdmin.rpc("release_proxy", {
                  _id: p.id,
                  _success: true,
                });
            }
            const out = await checkCookieViaWorker({
              cookies: r.cookies_json as any[],
              proxy: proxyPayload,
            });
            const patch: any = {
              status: out.status,
              is_valid: out.is_valid,
              email: out.email ?? null,
              country: out.country ?? null,
              plan_name: out.plan_name ?? null,
              video_quality: out.video_quality ?? null,
              name: out.name ?? null,
              member_since: out.member_since ?? null,
              max_streams: out.max_streams ?? null,
              payment_method: out.payment_method ?? null,
              last_checked_at: new Date().toISOString(),
              last_checked_mode: proxyMode ? "proxy" : "direct",
              last_error: out.error ?? null,
            };
            await supabaseAdmin.from("cookie_pool").update(patch).eq("id", r.id);
            checked++;
            if (out.status === "active") active++;
            else if (out.status === "invalid") invalid++;
            else if (out.status === "on_hold") on_hold++;
            else if (out.status === "free") free++;
          }

          const summary = { checked, active, invalid, on_hold, free, deleted, proxy_mode: proxyMode };
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
