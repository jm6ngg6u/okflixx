-- Admin one-time recovery codes for TOTP
CREATE TABLE public.admin_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz,
  used_ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_recovery_codes TO authenticated;
GRANT ALL ON public.admin_recovery_codes TO service_role;

ALTER TABLE public.admin_recovery_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own recovery codes read"
  ON public.admin_recovery_codes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX admin_recovery_codes_user_id_idx
  ON public.admin_recovery_codes (user_id) WHERE used_at IS NULL;

-- Atomically consume a recovery code; returns ok flag and reason
CREATE OR REPLACE FUNCTION public.consume_recovery_code(_user_id uuid, _code_hash text, _ip_hash text DEFAULT NULL)
RETURNS TABLE(ok boolean, reason text, remaining int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.admin_recovery_codes%ROWTYPE;
  _left int;
BEGIN
  SELECT * INTO _row FROM public.admin_recovery_codes
   WHERE user_id = _user_id AND code_hash = _code_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invalid'::text, 0; RETURN;
  END IF;
  IF _row.used_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_used'::text, 0; RETURN;
  END IF;
  UPDATE public.admin_recovery_codes
     SET used_at = now(), used_ip_hash = _ip_hash
   WHERE id = _row.id;
  SELECT COUNT(*)::int INTO _left FROM public.admin_recovery_codes
   WHERE user_id = _user_id AND used_at IS NULL;
  RETURN QUERY SELECT true, 'ok'::text, _left;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_recovery_code(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_recovery_code(uuid, text, text) TO service_role;

-- Helper: does the caller have any active TOTP factor? (checked via server fn using admin client)
-- No RPC needed; server functions read auth.mfa via supabase.auth.mfa on the user's session.