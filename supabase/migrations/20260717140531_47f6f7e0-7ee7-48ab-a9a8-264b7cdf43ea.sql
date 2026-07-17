-- ============ ACCESS KEYS ============
CREATE TABLE IF NOT EXISTS public.access_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  code_prefix TEXT NOT NULL,
  key_type TEXT NOT NULL CHECK (key_type IN ('unlimited','single_use','session_24h')),
  label TEXT,
  notes TEXT,
  disabled BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  redeemer_ip_hash TEXT,
  redeemer_fingerprint_hash TEXT,
  first_redeemed_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_keys TO authenticated;
GRANT ALL ON public.access_keys TO service_role;
ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage access keys"
  ON public.access_keys FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_access_keys_type ON public.access_keys(key_type);
CREATE INDEX IF NOT EXISTS idx_access_keys_disabled ON public.access_keys(disabled);

-- ============ REDEMPTIONS LOG ============
CREATE TABLE IF NOT EXISTS public.access_key_redemptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_id UUID REFERENCES public.access_keys(id) ON DELETE SET NULL,
  code_prefix TEXT,
  activation_code TEXT,
  ip_hash TEXT,
  fingerprint_hash TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.access_key_redemptions TO authenticated;
GRANT ALL ON public.access_key_redemptions TO service_role;
ALTER TABLE public.access_key_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read redemptions"
  ON public.access_key_redemptions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'moderator'));

CREATE INDEX IF NOT EXISTS idx_redemptions_created ON public.access_key_redemptions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemptions_key ON public.access_key_redemptions(key_id);

-- ============ 24H SESSIONS ============
CREATE TABLE IF NOT EXISTS public.access_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_token_hash TEXT NOT NULL UNIQUE,
  key_id UUID REFERENCES public.access_keys(id) ON DELETE CASCADE,
  ip_hash TEXT,
  fingerprint_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  uses_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.access_sessions TO authenticated;
GRANT ALL ON public.access_sessions TO service_role;
ALTER TABLE public.access_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read sessions"
  ON public.access_sessions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.access_sessions(expires_at);

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.access_keys_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_access_keys_updated ON public.access_keys;
CREATE TRIGGER trg_access_keys_updated
  BEFORE UPDATE ON public.access_keys
  FOR EACH ROW EXECUTE FUNCTION public.access_keys_touch_updated_at();

-- ============ SETTINGS DEFAULTS ============
INSERT INTO public.app_settings(key,value) VALUES
  ('access_key_required','0'),
  ('captcha_required','0'),
  ('login_required','0'),
  ('captcha_provider','turnstile'),
  ('captcha_site_key','')
ON CONFLICT (key) DO NOTHING;

-- ============ HELPER RPCs ============
-- Validate & consume a key atomically. Returns validity + optional session token for 24h mode.
CREATE OR REPLACE FUNCTION public.consume_access_key(
  _code_hash TEXT,
  _ip_hash TEXT,
  _fingerprint_hash TEXT
)
RETURNS TABLE(
  ok BOOLEAN,
  key_id UUID,
  key_type TEXT,
  reason TEXT,
  remaining_uses INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _row public.access_keys%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.access_keys WHERE code_hash = _code_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, 'invalid_key'::TEXT, 0;
    RETURN;
  END IF;
  IF _row.disabled THEN
    RETURN QUERY SELECT false, _row.id, _row.key_type, 'disabled'::TEXT, 0; RETURN;
  END IF;
  IF _row.expires_at IS NOT NULL AND _row.expires_at < now() THEN
    RETURN QUERY SELECT false, _row.id, _row.key_type, 'expired'::TEXT, 0; RETURN;
  END IF;

  IF _row.key_type = 'single_use' THEN
    IF _row.uses_count > 0 THEN
      -- allow same redeemer to reuse
      IF _row.redeemer_ip_hash IS NOT DISTINCT FROM _ip_hash
         AND _row.redeemer_fingerprint_hash IS NOT DISTINCT FROM _fingerprint_hash THEN
        UPDATE public.access_keys
           SET uses_count = uses_count + 1, last_used_at = now()
         WHERE id = _row.id;
        RETURN QUERY SELECT true, _row.id, _row.key_type, 'ok'::TEXT, 0; RETURN;
      ELSE
        RETURN QUERY SELECT false, _row.id, _row.key_type, 'already_redeemed'::TEXT, 0; RETURN;
      END IF;
    END IF;
    UPDATE public.access_keys
       SET uses_count = 1,
           first_redeemed_at = now(),
           last_used_at = now(),
           redeemer_ip_hash = _ip_hash,
           redeemer_fingerprint_hash = _fingerprint_hash
     WHERE id = _row.id;
    RETURN QUERY SELECT true, _row.id, _row.key_type, 'ok'::TEXT, 0; RETURN;
  END IF;

  -- unlimited or session_24h
  IF _row.max_uses IS NOT NULL AND _row.uses_count >= _row.max_uses THEN
    RETURN QUERY SELECT false, _row.id, _row.key_type, 'quota_exceeded'::TEXT, 0; RETURN;
  END IF;

  UPDATE public.access_keys
     SET uses_count = uses_count + 1,
         first_redeemed_at = COALESCE(first_redeemed_at, now()),
         last_used_at = now()
   WHERE id = _row.id;

  RETURN QUERY SELECT true, _row.id, _row.key_type, 'ok'::TEXT,
                       COALESCE(_row.max_uses - (_row.uses_count + 1), -1);
END; $$;

REVOKE ALL ON FUNCTION public.consume_access_key(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_access_key(TEXT,TEXT,TEXT) TO service_role;

-- Clean expired 24h sessions
CREATE OR REPLACE FUNCTION public.purge_expired_access_sessions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n INTEGER;
BEGIN
  DELETE FROM public.access_sessions WHERE expires_at < now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;
GRANT EXECUTE ON FUNCTION public.purge_expired_access_sessions() TO service_role;