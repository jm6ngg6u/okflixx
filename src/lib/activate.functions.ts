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
  accessKey: z.string().max(64).optional().nullable(),
  accessSessionToken: z.string().max(128).optional().nullable(),
  fingerprint: z.string().max(256).optional().nullable(),
  authUserId: z.string().uuid().optional().nullable(),
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
        | "no_proxy"
        | "exhausted"
        | "server_error"
        | "access_key_required"
        | "access_key_invalid"
        | "login_required";
      attempts?: number;
      message?: string;
    };



function hashIp(ip: string): string {
  const salt = process.env.SUPABASE_PROJECT_ID ?? "okflix";
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

    // 3. Maintenance banner — manual switch OR scheduled window.
    const manualMaint = (await getSetting(supabaseAdmin, "maintenance_enabled", "0")) === "1";
    const startsRaw = await getSetting(supabaseAdmin, "maintenance_starts_at", "");
    const endsRaw = await getSetting(supabaseAdmin, "maintenance_ends_at", "");
    const startsAt = startsRaw ? Date.parse(startsRaw) : NaN;
    const endsAt = endsRaw ? Date.parse(endsRaw) : NaN;
    const nowMs = Date.now();
    const scheduledMaint = !isNaN(startsAt) && !isNaN(endsAt) && nowMs >= startsAt && nowMs < endsAt;
    if (manualMaint || scheduledMaint) {
      const message = await getSetting(
        supabaseAdmin,
        "maintenance_message",
        "The service is temporarily unavailable.",
      );
      const { setResponseStatus, setResponseHeader } = await import("@tanstack/react-start/server");
      // 503 + no-store so browsers, CDNs and SW caches never persist a
      // maintenance response and can't flash stale success on refresh.
      setResponseStatus(503);
      setResponseHeader("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
      setResponseHeader("retry-after", "60");
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


    // 3b. Access-gate checks (admin-toggleable: login / access key).
    const loginRequired = (await getSetting(supabaseAdmin, "login_required", "0")) === "1";
    const accessKeyRequired = (await getSetting(supabaseAdmin, "access_key_required", "0")) === "1";

    // Server-side identity — verify the Authorization bearer instead of trusting
    // client-provided authUserId. Empty when not signed in.
    let verifiedUserId: string | null = null;
    try {
      const authHeader = request?.headers.get("authorization") ?? "";
      const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
      if (token) {
        const { data: u } = await supabaseAdmin.auth.getUser(token);
        if (u?.user?.id && (u.user as any).email_confirmed_at) verifiedUserId = u.user.id;
      }
    } catch { /* ignore — treated as anonymous */ }

    if (loginRequired && !verifiedUserId) {
      return {
        ok: false,
        error: "login_required",
        message: "Please sign in and verify your email to activate a TV code.",
      };
    }

    // Per-user daily activation limit (only when signed in).
    if (verifiedUserId) {
      const globalDaily = Math.max(
        0,
        parseInt(await getSetting(supabaseAdmin, "user_daily_activation_limit", "10"), 10) || 0,
      );
      const { data: overrideRow } = await supabaseAdmin
        .from("user_activation_overrides")
        .select("daily_limit")
        .eq("user_id", verifiedUserId)
        .maybeSingle();
      const effectiveLimit =
        overrideRow && typeof overrideRow.daily_limit === "number"
          ? Math.max(0, overrideRow.daily_limit)
          : globalDaily;
      if (effectiveLimit > 0) {
        const { data: userRecent } = await supabaseAdmin.rpc("count_user_recent_attempts", {
          _user_id: verifiedUserId,
          _minutes: 24 * 60,
        });
        if ((userRecent ?? 0) >= effectiveLimit) {
          await supabaseAdmin.from("activation_attempts").insert({
            code,
            result: "rate_limited",
            ip_hash: ipHash,
            user_agent: userAgent,
            country,
            proxy_mode: false,
            user_id: verifiedUserId,
          });
          return {
            ok: false,
            error: "rate_limited",
            message: `Daily limit reached (${effectiveLimit} activations / 24h). Try again tomorrow.`,
          };
        }
      }
    }


    if (accessKeyRequired) {
      const fingerprint = data.fingerprint || `${userAgent ?? "ua"}::${ipHash}`;
      if (!data.accessKey && !data.accessSessionToken) {
        return {
          ok: false,
          error: "access_key_required",
          message: "This site requires an access key.",
        };
      }
      const { verifyAccessCredentials } = await import("@/lib/access-keys.functions");
      const check = await verifyAccessCredentials(supabaseAdmin, {
        code: data.accessKey ?? null,
        sessionToken: data.accessSessionToken ?? null,
        fingerprint,
        ipHash,
      });
      if (!check.ok) {
        return {
          ok: false,
          error: "access_key_invalid",
          message:
            check.reason === "session_expired"
              ? "Your 24-hour unlock expired. Enter your key again."
              : check.reason === "already_redeemed"
                ? "This key has already been used on another device."
                : check.reason === "expired"
                  ? "This access key has expired."
                  : check.reason === "disabled"
                    ? "This access key has been disabled."
                    : "Invalid access key.",
        };
      }
    }
    // Per-IP rate limit — a bot/scraper safety net. Skipped when:
    //   • the caller is signed-in (per-user daily limit already applies), OR
    //   • an access gate is ON (login_required / access_key_required) — the
    //     gate itself throttles abuse, so no extra IP limit is imposed.
    const gateActive = loginRequired || accessKeyRequired;
    if (!verifiedUserId && !gateActive) {
      const rlWindow = parseInt(await getSetting(supabaseAdmin, "rate_limit_per_10min", "10"), 10);
      // 0 = unlimited (skip the check entirely).
      if (rlWindow > 0) {
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
            user_id: verifiedUserId,
          });
          return {
            ok: false,
            error: "rate_limited",
            message: `Too many attempts from this network. Try again in a few minutes (limit ${rlWindow} / 10 min).`,
          };
        }
      }
    }


    // 5. Config for the loop.
    const proxyMode = (await getSetting(supabaseAdmin, "proxy_mode", "0")) === "1";
    // Silent internal rotation — the user never sees a per-attempt failure,
    // so we can afford a generous cap. Bumped default 3 → 10 so a wave of
    // free/on_hold/dead cookies doesn't exhaust the loop for the visitor.
    const maxAttempts = Math.max(
      1,
      Math.min(25, parseInt(await getSetting(supabaseAdmin, "max_activation_attempts", "10"), 10)),
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
          user_id: verifiedUserId,
          selection_reason: {
            policy,
            filters: eligibility,
            outcome: "no_eligible_cookie",
          },
        });
        return {
          ok: false,
          error: "no_cookie",
          attempts: attemptNumber,
          message: "One moment — finishing up. Please try again in a few seconds.",
        };
      }

      // Fetch picked cookie's stats at selection time (for the "why chosen" reasoning).
      const { data: pickedStats } = await supabaseAdmin
        .from("cookie_pool")
        .select("status, is_valid, total_uses, success_count, fail_count, last_used_at")
        .eq("id", cookie.id)
        .maybeSingle();
      const { data: eligibleCount } = await supabaseAdmin.rpc("count_eligible_cookies", {
        _include_statuses: eligibility.include_statuses,
        _require_valid: eligibility.require_valid,
        _min_success_rate: eligibility.min_success_rate,
        _min_total_uses: eligibility.min_total_uses,
      });
      const uses = pickedStats?.total_uses ?? 0;
      const succ = pickedStats?.success_count ?? 0;
      const sr = uses > 0 ? Math.round((succ / uses) * 1000) / 10 : null; // 1 decimal %
      const selectionReason = {
        policy,
        filters: eligibility,
        eligible_at_pick: (eligibleCount as number) ?? null,
        cookie: {
          status: pickedStats?.status ?? null,
          is_valid: pickedStats?.is_valid ?? null,
          total_uses: uses,
          success_count: succ,
          fail_count: pickedStats?.fail_count ?? 0,
          success_rate: sr,
          last_used_at: pickedStats?.last_used_at ?? null,
        },
        why:
          policy === "quality"
            ? sr != null
              ? `Highest-scoring cookie: ${sr}% success across ${uses} uses`
              : `Unused cookie — grace period (< ${eligibility.min_total_uses} uses required)`
            : policy === "random"
              ? `Random pick from ${eligibleCount ?? "?"} eligible cookie(s)`
              : uses === 0
                ? `Least-recently-used: never used before`
                : `Least-recently-used across ${eligibleCount ?? "?"} eligible cookie(s)`,
      };

      // 5b. Optionally lock a proxy. STRICT proxy mode: if enabled but no
      // proxy is available, do NOT fall back to direct — mark this attempt as
      // no_proxy so the "Route via proxy pool" toggle is honoured end-to-end.
      let proxyRow: any = null;
      if (proxyMode) {
        const { data: proxyRows } = await supabaseAdmin.rpc("pick_next_proxy");
        proxyRow = Array.isArray(proxyRows) ? proxyRows[0] : proxyRows;
        if (!proxyRow) {
          await supabaseAdmin.from("activation_attempts").insert({
            code,
            result: "no_proxy",
            ip_hash: ipHash,
            user_agent: userAgent,
            country,
            cookie_id: cookie.id,
            proxy_mode: true,
            attempt_number: attemptNumber,
            user_id: verifiedUserId,
            selection_reason: { ...selectionReason, outcome: "no_proxy_available" },
            error_message: "Proxy mode is ON but no proxies are available.",
          });
          return {
            ok: false,
            error: "no_proxy",
            attempts: attemptNumber,
            message: "One moment — finishing up. Please try again in a few seconds.",
          };
        }
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


      // 5c-pre. FAST PRE-CHECK — verify the cookie is actually usable before
      // burning an activation call on it. If /check comes back with anything
      // other than "active", the cookie is dead / invalid / free / on_hold
      // (or the worker couldn't reach Netflix through this cookie). In all
      // those cases we DELETE the cookie from the pool immediately and
      // silently rotate to the next candidate — the user never sees a retry,
      // an error, or any hint that this happened.
      //
      // "unknown" is treated as transient (network hiccup, bot page, etc.):
      // we release the cookie without deleting and rotate, so a good cookie
      // never gets nuked because of a single bad round-trip.
      const preCheck = await checkCookieViaWorker({
        cookies: cookie.cookies_json as { name: string; value: string; domain?: string }[],
        proxy: proxyPayload,
      });
      if (preCheck.status !== "active") {
        const transient = preCheck.status === "unknown" || preCheck.transient === true;
        await supabaseAdmin.from("activation_attempts").insert({
          code,
          result: transient ? "worker_error" : preCheck.status,
          ip_hash: ipHash,
          user_agent: userAgent,
          country,
          cookie_id: cookie.id,
          proxy_id: proxyRow?.id ?? null,
          proxy_mode: proxyMode,
          attempt_number: attemptNumber,
          user_id: verifiedUserId,
          error_message: preCheck.error ?? `pre_check:${preCheck.status}`,
          selection_reason: { ...selectionReason, outcome: `pre_check_${preCheck.status}` },
        });
        if (transient) {
          await supabaseAdmin.rpc("release_cookie", {
            _id: cookie.id,
            _success: false,
            _outcome: "pre_check_unknown",
          });
        } else {
          // dead / invalid / free / on_hold → gone from the pool immediately.
          await supabaseAdmin.from("cookie_pool").delete().eq("id", cookie.id);
        }
        if (proxyRow) {
          await supabaseAdmin.rpc("release_proxy", {
            _id: proxyRow.id,
            _success: true,
          });
        }
        // Rotate silently — do not count this against the visible attempt cap
        // aggressively; the loop's own `maxAttempts` still bounds us.
        continue;
      }

      // 5c. Call the worker with a verified-active cookie.
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
          user_id: verifiedUserId,
        duration_ms: outcome.duration_ms,
        error_message: (outcome as any).error ?? null,
        selection_reason: selectionReason,
      });

      // 5e. Update cookie / proxy state.
      // Any cookie that comes back non-active (dead / invalid / free / on_hold)
      // is unusable and must NEVER be picked again — delete it from the pool
      // immediately so the next attempt in this same request, and every
      // subsequent visitor, gets a fresh candidate. The 24h auto-check still
      // handles residual cleanup, but we don't wait for it.
      const success = outcome.status === "success";
      const unusable =
        isCookieDead(outcome.status) ||
        outcome.status === "free" ||
        outcome.status === "on_hold";
      if (unusable) {
        await supabaseAdmin.from("cookie_pool").delete().eq("id", cookie.id);
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
        // Broadcast a realtime tick so all live homepages bump the counter instantly.
        // Supabase Realtime requires the channel to be SUBSCRIBED before `.send()`
        // will actually deliver a broadcast to other clients.
        try {
          const ch = supabaseAdmin.channel("activation-success", {
            config: { broadcast: { self: false, ack: true } },
          });
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => resolve(), 1500);
            ch.subscribe((status) => {
              if (status === "SUBSCRIBED") {
                clearTimeout(timeout);
                resolve();
              }
            });
          });
          await ch.send({ type: "broadcast", event: "tick", payload: { at: Date.now() } });
          await supabaseAdmin.removeChannel(ch);
        } catch {}
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
      message: "One moment — finishing up. Please try again in a few seconds.",
    };
  });

// Public live feed of activation stats. No auth, no PII — just scalars.
// `count` (all-time success) is retained for backward compatibility.
// Success rate = success / (success + wrong_code + expired_code). Only the
// three publicly-shown outcomes count toward the denominator, so bot noise
// and transient infra errors don't distort the number visitors see.
export const getSuccessActivationCount = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startIso = startOfToday.toISOString();

    const q = (result: string, since?: string) => {
      let b = supabaseAdmin.from("activation_attempts").select("id", { count: "exact", head: true }).eq("result", result);
      if (since) b = b.gte("created_at", since);
      return b;
    };

    const [totalSuccess, todaySuccess, totalWrong, todayWrong, totalExpired, todayExpired] = await Promise.all([
      q("success"),
      q("success", startIso),
      q("invalid_code"),
      q("invalid_code", startIso),
      q("expired_code"),
      q("expired_code", startIso),
    ]);

    const total = totalSuccess.count ?? 0;
    const today = todaySuccess.count ?? 0;
    const wrong = totalWrong.count ?? 0;
    const wrongToday = todayWrong.count ?? 0;
    const expired = totalExpired.count ?? 0;
    const expiredToday = todayExpired.count ?? 0;

    const denom = total + wrong + expired;
    const rate = denom > 0 ? Math.max(0, Math.min(100, (total / denom) * 100)) : 0;

    return {
      ok: true as const,
      count: total,
      totalSuccess: total,
      todaySuccess: today,
      totalWrongCode: wrong,
      todayWrongCode: wrongToday,
      totalExpiredCode: expired,
      todayExpiredCode: expiredToday,
      successRate: Number(rate.toFixed(1)),
    };
  } catch {
    return {
      ok: false as const,
      count: 0,
      totalSuccess: 0,
      todaySuccess: 0,
      totalWrongCode: 0,
      todayWrongCode: 0,
      totalExpiredCode: 0,
      todayExpiredCode: 0,
      successRate: 0,
    };
  }
});

