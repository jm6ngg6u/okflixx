import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/cookies-autocheck")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronRequest } = await import("@/lib/cron.server");
        if (!(await verifyCronRequest(request))) return new Response("Unauthorized", { status: 401 });
        const { runCookiesAutocheck } = await import("@/lib/autocheck.server");
        const res = await runCookiesAutocheck(false);
        return Response.json(res, { status: res.ok ? 200 : 500 });
      },
    },
  },
});
