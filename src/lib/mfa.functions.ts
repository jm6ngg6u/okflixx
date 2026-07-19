import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256Hex(v: string): Promise<string> {
  const enc = new TextEncoder().encode(v);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readIp(): string {
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    getRequestIP({ xForwardedFor: true }) ??
    "0.0.0.0"
  );
}

// Generate a human-friendly recovery code: XXXX-XXXX-XXXX (base32-ish, no ambiguous chars)
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode(): string {
  const arr = new Uint8Array(12);
  globalThis.crypto.getRandomValues(arr);
  const chars = Array.from(arr, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Get MFA + role status for the current user
// ---------------------------------------------------------------------------

export const getMyMfaStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: isAdmin }, { data: isMod }, factorsRes] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
      supabase.auth.mfa.listFactors(),
    ]);

    const totpFactors = (factorsRes.data?.totp ?? []).filter(
      (f: any) => f.status === "verified",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count: recoveryLeft } = await supabaseAdmin
      .from("admin_recovery_codes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("used_at", null);

    return {
      userId,
      isAdmin: !!isAdmin,
      isModerator: !!isMod,
      isStaff: !!isAdmin || !!isMod,
      totpEnrolled: totpFactors.length > 0,
      totpFactorId: totpFactors[0]?.id ?? null,
      recoveryCodesRemaining: recoveryLeft ?? 0,
    };
  });

// ---------------------------------------------------------------------------
// Generate a fresh set of recovery codes (invalidates previous unused ones)
// ---------------------------------------------------------------------------

export const generateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Invalidate old unused codes
    await supabaseAdmin
      .from("admin_recovery_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("used_at", null);

    const codes: string[] = [];
    const rows: { user_id: string; code_hash: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const code = makeCode();
      codes.push(code);
      rows.push({ user_id: userId, code_hash: await sha256Hex(normalizeCode(code)) });
    }

    const { error } = await supabaseAdmin.from("admin_recovery_codes").insert(rows);
    if (error) throw new Error(error.message);




    return { codes };
  });

// ---------------------------------------------------------------------------
// Redeem a recovery code (used when the authenticator app is lost)
// Elevates the current session to aal2 by deleting other TOTP factors
// and requiring the user to re-enroll.
// ---------------------------------------------------------------------------

const RedeemInput = z.object({ code: z.string().min(6).max(40) });

export const redeemRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RedeemInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const codeHash = await sha256Hex(normalizeCode(data.code));
    const ipHash = await sha256Hex(readIp());

    const { data: res, error } = await supabaseAdmin.rpc("consume_recovery_code", {
      _user_id: userId,
      _code_hash: codeHash,
      _ip_hash: ipHash,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(res) ? res[0] : res;




    if (!row?.ok) return { ok: false as const, reason: row?.reason ?? "invalid" };

    // Remove existing TOTP factors so the user must re-enroll a new device
    const { data: factors } = await supabase.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.factor_type === "totp") {
        // Use admin client so we don't need aal2 to unenroll
        await supabaseAdmin.auth.admin.mfa.deleteFactor({ id: f.id, userId });
      }
    }

    return { ok: true as const, remaining: row.remaining as number };
  });

// ---------------------------------------------------------------------------
// Audit helpers for the auth flow
// ---------------------------------------------------------------------------

const AuditInput = z.object({
  event: z.string().max(64),
  email: z.string().email().optional().nullable(),
  success: z.boolean().default(true),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export const logMfaEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AuditInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("auth_audit_log").insert({
      user_id: userId,
      event: data.event,
      email: data.email ?? null,
      ip_hash: await sha256Hex(readIp()),
      user_agent: getRequestHeader("user-agent") ?? null,
      success: data.success,
      metadata: data.metadata ?? null,
    });
    return { ok: true };
  });
