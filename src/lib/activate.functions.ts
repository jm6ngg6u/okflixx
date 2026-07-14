import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { createHash } from "crypto";
import { z } from "zod";

const CODE_REGEX = /^[A-Z0-9]{8}$/;

const InputSchema = z.object({
  code: z.string().length(8),
  // Honeypot — bots love to fill hidden fields; humans never see this.
  website: z.string().max(0).optional().default(""),
  // Client-computed "time on page" — helps distinguish humans (>1500ms) from instant bots.
  elapsedMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
});

type ActivateResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; error: "invalid_code" | "rate_limited" | "bot_detected" | "server_error" };

function hashIp(ip: string): string {
  // We store a salted hash, not the raw IP, so the DB never holds PII.
  const salt = process.env.SUPABASE_PROJECT_ID ?? "emberlord";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export const submitActivation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<ActivateResult> => {
    // 1. Honeypot / timing bot detection.
    if (data.website && data.website.length > 0) return { ok: false, error: "bot_detected" };
    if (data.elapsedMs < 1500) return { ok: false, error: "bot_detected" };

    // 2. Format validation.
    const code = data.code.toUpperCase();
    if (!CODE_REGEX.test(code)) return { ok: false, error: "invalid_code" };

    // 3. Derive request fingerprint.
    const request = getRequest();
    const rawIp =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      getRequestIP({ xForwardedFor: true }) ??
      "unknown";
    const ipHash = hashIp(rawIp);
    const userAgent = request?.headers.get("user-agent")?.slice(0, 500) ?? null;
    const country = getRequestHeader("cf-ipcountry") ?? null;

    // 4. Rate limit: max 10 attempts / 10 minutes per IP.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: recent, error: rpcErr } = await supabaseAdmin.rpc("count_recent_attempts", {
      _ip_hash: ipHash,
      _minutes: 10,
    });
    if (rpcErr) {
      console.error("[activate] rate check failed", rpcErr);
      return { ok: false, error: "server_error" };
    }
    if ((recent ?? 0) >= 10) {
      // Log the rate-limit hit too (helps you see abuse patterns).
      await supabaseAdmin.from("activation_attempts").insert({
        ip_hash: ipHash,
        user_agent: userAgent,
        code,
        result: "rate_limited",
        country,
      });
      return { ok: false, error: "rate_limited" };
    }

    // 5. Log successful attempt.
    const { error: insErr } = await supabaseAdmin.from("activation_attempts").insert({
      ip_hash: ipHash,
      user_agent: userAgent,
      code,
      result: "success",
      country,
    });
    if (insErr) console.error("[activate] log insert failed", insErr);

    // 6. Send them to Netflix's real TV activation URL with their code.
    return { ok: true, redirectUrl: `https://www.netflix.com/tv8?code=${encodeURIComponent(code)}` };
  });
