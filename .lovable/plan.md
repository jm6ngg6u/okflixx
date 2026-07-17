# Restore admin email + password + TOTP

Keep Google sign-in on `/login` for regular TV-activation users. Rebuild `/auth` (admin) as email + password with mandatory TOTP for anyone holding the admin role. Uses Supabase's built-in MFA — no custom TOTP tables.

## What changes

**Auth providers (Supabase config)**
- Re-enable email provider (currently disabled from the Google-only switch).
- Keep Google enabled.
- Signups on the admin route are blocked in UI; only pre-existing admin users or invited staff can sign in. Public `/login` remains Google-only.

**`/auth` — admin sign-in flow (rebuild)**
1. Step 1: Email + password form.
2. On successful password sign-in, call `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`.
3. If the user has admin/moderator role:
   - `currentLevel === 'aal1'` and no TOTP factor → force enrollment (QR + verify).
   - `currentLevel === 'aal1'` and factor exists → show 6-digit TOTP challenge.
   - `currentLevel === 'aal2'` → redirect to `/admin`.
4. If the user has no admin role at all → sign them out and show "not authorized".
5. A small "Continue with Google" link stays as a fallback path (Google admins still supported; if they hold admin role and have no TOTP, they're forced into enrollment too).

**`/auth/mfa` — new subroute** (or inline modal on `/auth`)
- Enrollment view: `supabase.auth.mfa.enroll({ factorType: 'totp' })`, render QR + secret, verify with 6-digit code via `mfa.challenge` + `mfa.verify`.
- Challenge view: 6-digit input, `mfa.challenge` + `mfa.verify`, on success go to `/admin`.
- Recovery: on enrollment success, show 8 one-time recovery codes (stored hashed in `admin_recovery_codes`); user must copy/download before continuing.

**Admin route guard (`src/routes/admin.tsx`)**
- After confirming admin role, also check `getAuthenticatorAssuranceLevel()`:
  - Admin without TOTP enrolled → redirect to `/auth/mfa?enroll=1`.
  - Admin with TOTP but session at `aal1` → redirect to `/auth/mfa?challenge=1`.
  - Only `aal2` sessions enter `/admin`.

**Audit**
- Log every step to `auth_audit_log`: `password_signin_ok/fail`, `totp_enroll_start/ok`, `totp_challenge_ok/fail`, `recovery_code_used`, `admin_access_granted`.

## Database (one migration)

```sql
-- One-time recovery codes for admins who lose their authenticator
CREATE TABLE public.admin_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.admin_recovery_codes TO authenticated;
GRANT ALL ON public.admin_recovery_codes TO service_role;
ALTER TABLE public.admin_recovery_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recovery codes" ON public.admin_recovery_codes
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Inserts/updates go through security-definer server fns; no direct write policy.

CREATE INDEX admin_recovery_codes_user_id_idx
  ON public.admin_recovery_codes (user_id) WHERE used_at IS NULL;
```

Plus a security-definer RPC `consume_recovery_code(_user_id uuid, _code_hash text)` that atomically marks a code used and returns ok/reason.

## Files touched

- `src/routes/auth.tsx` — full rewrite: email+password form → MFA step → done.
- `src/routes/auth.mfa.tsx` — new: enrollment + challenge + recovery-code display.
- `src/routes/admin.tsx` — add AAL2 check after role check.
- `src/lib/mfa.functions.ts` — new: `generateRecoveryCodes`, `verifyRecoveryCode`, `getMyMfaStatus` server fns.
- `src/lib/auth-audit.functions.ts` — extend event types.
- Supabase auth: call `supabase--configure_auth` to re-enable email (auto-confirm off, HIBP on).

## What stays the same

- `/login` (Google) for regular activation users — unchanged.
- All existing admin gates (`has_role`, RLS, `admin_activity_log`, `admin_access_attempt`).
- Google as an alternative sign-in for admins who prefer it (still forced through the same TOTP gate).

## Notes / caveats

- The **first admin bootstrap** trigger (`handle_new_user_bootstrap`) currently promotes the first-ever signup to admin. This still works — but that first admin will be forced through TOTP enrollment on their next `/admin` visit.
- Password reset via email OTP will be re-enabled with the email provider; the previously deleted `/reset-password` route will be re-added.
- Session upgrade to `aal2` follows Supabase's standard flow — no custom JWT handling.
