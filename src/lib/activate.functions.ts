// Public activation flow — 3-attempt retry loop, proxy-mode aware, worker-backed.
// Mirrors bot.py: max_retries = 3, one active cookie per attempt, rotate on transient
// failure, mark dead only on true cookie_dead statuses.

import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { createHash } from "crypto";
import { z } from "zod";

const CODE_REGEX = /^[A-Z0-9]{8}$/;

const InputSchema = z.object({
  code: z.string().length(8),
  website: z.string().max(0).optional().default(""),
  elapsedMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
});

type ActivateResult =
  | {
      ok: true;
      message: string;
      attempts: number;
      redirectUrl: string;
      account: {
        email: string | null;
        country: string | null;
        plan_name: string | null;
        video_quality: string | null;
        max_streams: number | null;
        member_since: string | null;
        payment_method: string | null;
        name: string | null;
      };
      policy: string;
    }
  | {
      ok: false;
      error:
        | "invalid_code"
        | "rate_limited"
        | "bot_detected"
        | "maintenance"
        | "no_cookie"
        | "exhausted"
        | "server_error";
      attempts?: number;
      message?: string;
    };


function hashIp(ip: string): string {
  const salt = process.env.SUPABASE_PROJECT_ID ?? "emberlord";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

async function getSetting(supabaseAdmin: any, key: string, fallback: string): Promise<string> {
  const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) ?? fallback;
}

export type EligibilityRules = {
  include_statuses: string[];
  require_valid: boolean;
  min_success_rate: number; // 0..1
  min_total_uses: number;
};

export const DEFAULT_ELIGIBILITY: EligibilityRules = {
  include_statuses: ["active"],
  require_valid: true,
  min_success_rate: 0,
  min_total_uses: 0,
};

export async function loadEligibility(supabaseAdmin: any): Promise<EligibilityRules> {
  const raw = await getSetting(supabaseAdmin, "cookie_eligibility", "");
  if (!raw) return DEFAULT_ELIGIBILITY;
  try {
    const p = JSON.parse(raw);
    const statuses = Array.isArray(p.include_statuses) && p.include_statuses.length > 0
      ? p.include_statuses.filter((s: any) => typeof s === "string")
      : DEFAULT_ELIGIBILITY.include_statuses;
    return {
      include_statuses: statuses,
      require_valid: typeof p.require_valid === "boolean" ? p.require_valid : true,
      min_success_rate: Math.max(0, Math.min(1, Number(p.min_success_rate) || 0)),
      min_total_uses: Math.max(0, Math.min(1000, Math.round(Number(p.min_total_uses) || 0))),
    };
  } catch {
    return DEFAULT_ELIGIBILITY;
  }
}

export const submitActivation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ActivateResult> => {
    // 1. Anti-bot: honeypot + minimum time-on-page.
    if (data.website && data.website.length > 0) return { ok: false, error: "bot_detected" };
    if (data.elapsedMs < 1500) return { ok: false, error: "bot_detected" };

    const code = data.code.toUpperCase();
    if (!CODE_REGEX.test(code)) return { ok: false, error: "invalid_code" };

    // 2. Derive request fingerprint.
    const request = getRequest();
    const rawIp =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      getRequestIP({ xForwardedFor: true }) ??
      "unknown";
    const ipHash = hashIp(rawIp);
    const userAgent = request?.headers.get("user-agent")?.slice(0, 500) ?? null;
    const country = getRequestHeader("cf-ipcountry") ?? null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { checkCookieViaWorker, activateTVViaWorker, isCookieDead } = await import(
      "@/lib/worker.server"
    );

    // 3. Maintenance banner.
    if ((await getSetting(supabaseAdmin, "maintenance_enabled", "0")) === "1") {
      const message = await getSetting(
        supabaseAdmin,
        "maintenance_message",
        "The service is temporarily unavailable.",
      );
      await supabaseAdmin.from("activation_attempts").insert({
        code,
        result: "maintenance",
        ip_hash: ipHash,
        user_agent: userAgent,
        country,
        proxy_mode: false,
      });
      return { ok: false, error: "maintenance", message };
    }

    // 4. Rate limit.
    const rlWindow = parseInt(await getSetting(supabaseAdmin, "rate_limit_per_10min", "10"), 10);
    const { data: recent } = await supabaseAdmin.rpc("count_recent_attempts", {
      _ip_hash: ipHash,
      _minutes: 10,
    });
    if ((recent ?? 0) >= rlWindow) {
      await supabaseAdmin.from("activation_attempts").insert({
        code,
        result: "rate_limited",
        ip_hash: ipHash,
        user_agent: userAgent,
        country,
        proxy_mode: false,
      });
      return { ok: false, error: "rate_limited" };
    }

    // 5. Config for the loop.
    const proxyMode = (await getSetting(supabaseAdmin, "proxy_mode", "0")) === "1";
    const maxAttempts = Math.max(
      1,
      Math.min(10, parseInt(await getSetting(supabaseAdmin, "max_activation_attempts", "3"), 10)),
    );
    const rawPolicy = (await getSetting(supabaseAdmin, "cookie_rotation_policy", "round_robin")).toLowerCase();
    const policy: "round_robin" | "random" | "quality" =
      rawPolicy === "random" || rawPolicy === "quality" ? (rawPolicy as any) : "round_robin";
    const eligibility = await loadEligibility(supabaseAdmin);

    let attemptNumber = 0;
    for (attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
      // 5a. Lock a cookie via the configured rotation policy + eligibility filters.
      const { data: cookieRows, error: pickErr } = await supabaseAdmin.rpc(
        "pick_next_cookie_filtered",
        {
          _policy: policy,
          _include_statuses: eligibility.include_statuses,
          _require_valid: eligibility.require_valid,
          _min_success_rate: eligibility.min_success_rate,
          _min_total_uses: eligibility.min_total_uses,
        },
      );
      const cookie = Array.isArray(cookieRows) ? cookieRows[0] : cookieRows;

      if (pickErr || !cookie) {
        await supabaseAdmin.from("activation_attempts").insert({
          code,
          result: "no_cookie",
          ip_hash: ipHash,
          user_agent: userAgent,
          country,
          proxy_mode: proxyMode,
          attempt_number: attemptNumber,
        });
        return {
          ok: false,
          error: "no_cookie",
          attempts: attemptNumber,
          message: "Cookie pool is empty — please try again shortly.",
        };
      }

      // 5b. Optionally lock a proxy.
      let proxyRow: any = null;
      if (proxyMode) {
        const { data: proxyRows } = await supabaseAdmin.rpc("pick_next_proxy");
        proxyRow = Array.isArray(proxyRows) ? proxyRows[0] : proxyRows;
        // If proxy mode is ON but no proxy is available, fall back to direct
        // rather than failing — matches the bot's fail-open behaviour.
      }

      const proxyPayload = proxyRow
        ? {
            scheme: proxyRow.scheme,
            ip: proxyRow.ip,
            port: proxyRow.port,
            username: proxyRow.username ?? null,
            password: proxyRow.password ?? null,
          }
        : null;

      // 5c. Call the worker.
      const outcome = await activateTVViaWorker({
        code,
        cookies: cookie.cookies_json as { name: string; value: string; domain?: string }[],
        proxy: proxyPayload,
      });

      // 5d. Log attempt.
      await supabaseAdmin.from("activation_attempts").insert({
        code,
        result: outcome.status,
        ip_hash: ipHash,
        user_agent: userAgent,
        country,
        cookie_id: cookie.id,
        proxy_id: proxyRow?.id ?? null,
        proxy_mode: proxyMode,
        attempt_number: attemptNumber,
        duration_ms: outcome.duration_ms,
        error_message: (outcome as any).error ?? null,
      });

      // 5e. Update cookie / proxy state.
      const success = outcome.status === "success";
      if (isCookieDead(outcome.status)) {
        await supabaseAdmin.rpc("mark_cookie_invalid", {
          _id: cookie.id,
          _reason: ((outcome as any).error ?? outcome.status) as string,
        });
      } else if (outcome.status === "free" || outcome.status === "on_hold") {
        await supabaseAdmin
          .from("cookie_pool")
          .update({
            status: outcome.status,
            is_valid: false,
            is_locked: false,
            locked_at: null,
            last_used_at: new Date().toISOString(),
            last_error: ((outcome as any).error ?? outcome.status) as string,
          })
          .eq("id", cookie.id);
      } else {
        await supabaseAdmin.rpc("release_cookie", {
          _id: cookie.id,
          _success: success,
          _outcome: success ? undefined : outcome.status,
        });
      }
      if (proxyRow) {
        await supabaseAdmin.rpc("release_proxy", {
          _id: proxyRow.id,
          _success: outcome.status !== "worker_error",
          _err: outcome.status === "worker_error" ? ((outcome as any).error as string) : undefined,
        });
      }


      // 5f. Terminal decisions.
      if (success) {
        // Fetch stored account metadata for the success screen.
        const { data: meta } = await supabaseAdmin
          .from("cookie_pool")
          .select("email,country,plan_name,video_quality,max_streams,member_since,payment_method,name")
          .eq("id", cookie.id)
          .maybeSingle();
        return {
          ok: true,
          attempts: attemptNumber,
          message: "Activation successful — Netflix is unlocking on your TV.",
          redirectUrl: `https://www.netflix.com/tv8?code=${encodeURIComponent(code)}`,
          policy,
          account: {
            email: meta?.email ?? null,
            country: meta?.country ?? null,
            plan_name: meta?.plan_name ?? null,
            video_quality: meta?.video_quality ?? null,
            max_streams: meta?.max_streams ?? null,
            member_since: meta?.member_since ?? null,
            payment_method: meta?.payment_method ?? null,
            name: meta?.name ?? null,
          },
        };
      }

      if (outcome.status === "invalid_code" || outcome.status === "expired_code") {
        return {
          ok: false,
          error: "invalid_code",
          attempts: attemptNumber,
          message: "That code is invalid or has expired. Check your TV screen and try again.",
        };
      }
      // otherwise: transient → loop with a fresh cookie
    }

    return {
      ok: false,
      error: "exhausted",
      attempts: maxAttempts,
      message: "We couldn't activate this code after several attempts — please try again shortly.",
    };
  });
