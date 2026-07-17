
-- 1. auth_audit_log ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,                 -- signin | signup | otp_send | otp_verify | password_reset
  email text,
  user_id uuid,
  success boolean NOT NULL DEFAULT false,
  reason text,
  ip_hash text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_audit_log_created_at_idx ON public.auth_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS auth_audit_log_email_idx ON public.auth_audit_log (lower(email));
CREATE INDEX IF NOT EXISTS auth_audit_log_event_idx ON public.auth_audit_log (event);

GRANT SELECT ON public.auth_audit_log TO authenticated;
GRANT ALL ON public.auth_audit_log TO service_role;
ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view auth audit log" ON public.auth_audit_log;
CREATE POLICY "Staff can view auth audit log"
  ON public.auth_audit_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'moderator'::app_role)
  );

-- 2. otp_attempts -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.otp_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_hash text,
  kind text NOT NULL DEFAULT 'signup', -- signup | recovery
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_attempts_email_created_idx
  ON public.otp_attempts (lower(email), created_at DESC);

GRANT ALL ON public.otp_attempts TO service_role;
ALTER TABLE public.otp_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: server-only via service role.

-- 3. Settings defaults ------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES
  ('otp_resend_cooldown_seconds', '60'),
  ('otp_max_per_window', '5'),
  ('otp_window_minutes', '15')
ON CONFLICT (key) DO NOTHING;

-- 4. Helper: check OTP rate limit ------------------------------------------
CREATE OR REPLACE FUNCTION public.check_otp_rate_limit(
  _email text,
  _kind text DEFAULT 'signup',
  _cooldown_seconds int DEFAULT 60,
  _max_per_window int DEFAULT 5,
  _window_minutes int DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _last timestamptz;
  _count int;
  _cooldown_remaining int := 0;
  _allowed boolean := true;
  _reason text := 'ok';
  _next timestamptz;
BEGIN
  SELECT MAX(created_at) INTO _last
    FROM public.otp_attempts
   WHERE lower(email) = lower(_email) AND kind = _kind;

  SELECT COUNT(*) INTO _count
    FROM public.otp_attempts
   WHERE lower(email) = lower(_email)
     AND kind = _kind
     AND created_at > now() - (_window_minutes || ' minutes')::interval;

  IF _last IS NOT NULL THEN
    _cooldown_remaining := GREATEST(
      0,
      _cooldown_seconds - EXTRACT(EPOCH FROM (now() - _last))::int
    );
  END IF;

  IF _cooldown_remaining > 0 THEN
    _allowed := false;
    _reason := 'cooldown';
    _next := _last + (_cooldown_seconds || ' seconds')::interval;
  ELSIF _count >= _max_per_window THEN
    _allowed := false;
    _reason := 'max_exceeded';
    _next := (SELECT MIN(created_at) FROM public.otp_attempts
               WHERE lower(email) = lower(_email) AND kind = _kind
                 AND created_at > now() - (_window_minutes || ' minutes')::interval)
             + (_window_minutes || ' minutes')::interval;
  END IF;

  RETURN jsonb_build_object(
    'allowed', _allowed,
    'reason', _reason,
    'cooldown_remaining', _cooldown_remaining,
    'sent_in_window', _count,
    'max_per_window', _max_per_window,
    'window_minutes', _window_minutes,
    'next_allowed_at', _next
  );
END;
$$;

-- 5. Helper: record OTP attempt --------------------------------------------
CREATE OR REPLACE FUNCTION public.record_otp_attempt(
  _email text,
  _kind text DEFAULT 'signup',
  _ip_hash text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.otp_attempts (email, kind, ip_hash)
  VALUES (lower(_email), _kind, _ip_hash);
$$;

-- 6. Helper: purge old rows -------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_auth_audit_log(_days int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  DELETE FROM public.auth_audit_log WHERE created_at < now() - (_days || ' days')::interval;
  GET DIAGNOSTICS _n = ROW_COUNT;
  DELETE FROM public.otp_attempts WHERE created_at < now() - INTERVAL '2 days';
  RETURN _n;
END;
$$;
