import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/proxies-autocheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest } = await import("@/lib/cron.server");
        if (!verifyCronRequest(request)) return new Response("Unauthorized", { status: 401 });
        const { runProxiesAutocheck } = await import("@/lib/autocheck.server");
        const res = await runProxiesAutocheck(false);
        return Response.json(res, { status: res.ok ? 200 : 500 });
      },
    },
  },
});
