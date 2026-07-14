import { createFileRoute } from "@tanstack/react-router";

// Public cron endpoint — no user auth. Guard with a shared secret in the body/header.
// Invoked by pg_cron via net.http_post on a schedule.
export const Route = createFileRoute("/api/public/hooks/pool-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.POOL_CHECK_SECRET;
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (secret && provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rows } = await supabaseAdmin
          .from("cookie_pool")
          .select("id, cookies_json")
          .order("last_checked_at", { ascending: true, nullsFirst: true })
          .limit(50);

        let checked = 0, active = 0, invalid = 0;
        for (const r of rows ?? []) {
          try {
            const pairs = r.cookies_json as { name: string; value: string }[];
            const cookie = pairs.map((c) => `${c.name}=${c.value}`).join("; ");
            const res = await fetch("https://www.netflix.com/YourAccount", {
              headers: {
                cookie,
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
              },
              redirect: "follow",
            });
            const html = await res.text();
            let status: "active" | "on_hold" | "free" | "invalid" = "invalid";
            let is_valid = false;
            if (!res.url.toLowerCase().includes("/login")) {
              if (/on.?hold/i.test(html)) status = "on_hold";
              else if (/free\s*trial/i.test(html)) { status = "free"; is_valid = true; }
              else { status = "active"; is_valid = true; }
            }
            await supabaseAdmin.from("cookie_pool").update({
              status, is_valid, last_checked_at: new Date().toISOString(),
            }).eq("id", r.id);
            checked++;
            if (status === "active") active++;
            if (status === "invalid") invalid++;
          } catch (e) {
            console.error("[cron pool-check]", e);
          }
        }
        return Response.json({ ok: true, checked, active, invalid });
      },
    },
  },
});
