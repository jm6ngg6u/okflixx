import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// User: my activation status.
// ---------------------------------------------------------------------------
export const getMyActivationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: limitRow } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "user_daily_activation_limit")
      .maybeSingle();
    const dailyLimit = Math.max(1, parseInt(limitRow?.value ?? "10", 10));

    const { data: used } = await supabaseAdmin.rpc("count_user_recent_attempts", {
      _user_id: userId,
      _minutes: 24 * 60,
    });
    const usedCount = used ?? 0;
    const remaining = Math.max(0, dailyLimit - usedCount);

    const { data: recent } = await supabase
      .from("activation_attempts")
      .select("id, code, result, error_message, country, created_at, duration_ms")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);

    const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: oldest } = await supabaseAdmin
      .from("activation_attempts")
      .select("created_at")
      .eq("user_id", userId)
      .gte("created_at", since24)
      .order("created_at", { ascending: true })
      .limit(1);
    const nextResetAt = oldest?.[0]?.created_at
      ? new Date(new Date(oldest[0].created_at).getTime() + 24 * 3600_000).toISOString()
      : null;

    const lastBlocked = (recent ?? []).find((r: any) => r.result === "rate_limited");

    return {
      email: claims?.email ?? null,
      dailyLimit,
      used: usedCount,
      remaining,
      blocked: remaining === 0,
      nextResetAt,
      lastBlocked: lastBlocked
        ? {
            at: lastBlocked.created_at,
            code: lastBlocked.code,
            reason: `Daily limit reached — ${dailyLimit} activations per 24h.`,
          }
        : null,
      recent: recent ?? [],
    };
  });
