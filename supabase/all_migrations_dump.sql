
CREATE TABLE public.activation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  user_agent text,
  code text NOT NULL,
  result text NOT NULL,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activation_attempts_ip_time_idx ON public.activation_attempts (ip_hash, created_at DESC);
CREATE INDEX activation_attempts_created_at_idx ON public.activation_attempts (created_at DESC);

GRANT ALL ON public.activation_attempts TO service_role;

ALTER TABLE public.activation_attempts ENABLE ROW LEVEL SECURITY;

-- No public policies — only service role (server code) can read/write.

-- Rate-limit helper: returns number of attempts for an IP hash in the last N minutes.
CREATE OR REPLACE FUNCTION public.count_recent_attempts(_ip_hash text, _minutes int)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.activation_attempts
  WHERE ip_hash = _ip_hash
    AND created_at > now() - (_minutes || ' minutes')::interval;
$$;

REVOKE EXECUTE ON FUNCTION public.count_recent_attempts(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_recent_attempts(text, int) TO service_role;

-- 1) Roles enum + user_roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "Users see their own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2) Admin profile
CREATE TABLE public.admin_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.admin_profiles TO authenticated;
GRANT ALL ON public.admin_profiles TO service_role;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff see admin profiles"
  ON public.admin_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator') OR user_id = auth.uid());
CREATE POLICY "Users update own admin profile"
  ON public.admin_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins manage all admin profiles"
  ON public.admin_profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) Admin activity log
CREATE TABLE public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.admin_activity_log TO authenticated;
GRANT ALL ON public.admin_activity_log TO service_role;
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read activity log"
  ON public.admin_activity_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Admins insert activity log"
  ON public.admin_activity_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE INDEX idx_admin_activity_created ON public.admin_activity_log(created_at DESC);

-- 4) Cookie pool (mirrors database.py cookie_pool with sensible types)
CREATE TABLE public.cookie_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text,
  cookies_json jsonb NOT NULL,        -- parsed cookie dict
  fingerprint text UNIQUE,             -- NetflixId pg= fingerprint for dedup
  email text DEFAULT '',
  country text DEFAULT '',
  plan_name text DEFAULT '',
  video_quality text DEFAULT '',
  name text DEFAULT '',
  payment_method text DEFAULT '',
  status text NOT NULL DEFAULT 'unknown',   -- active | on_hold | free | invalid | unknown
  is_valid boolean NOT NULL DEFAULT true,
  total_uses integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cookie_pool TO authenticated;
GRANT ALL ON public.cookie_pool TO service_role;
ALTER TABLE public.cookie_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read cookies" ON public.cookie_pool FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Admins manage cookies" ON public.cookie_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_cookie_pool_valid ON public.cookie_pool(is_valid, status);
CREATE INDEX idx_cookie_pool_last_used ON public.cookie_pool(last_used_at);

-- 5) Proxy pool
CREATE TABLE public.proxy_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw text NOT NULL,
  scheme text NOT NULL DEFAULT 'http',
  ip text NOT NULL,
  port text NOT NULL,
  username text,
  password text,
  is_valid boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.proxy_pool TO authenticated;
GRANT ALL ON public.proxy_pool TO service_role;
ALTER TABLE public.proxy_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read proxies" ON public.proxy_pool FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Admins manage proxies" ON public.proxy_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_proxy_pool_valid ON public.proxy_pool(is_valid);

-- 6) App settings
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read settings" ON public.app_settings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "Admins manage settings" ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed default settings
INSERT INTO public.app_settings (key, value) VALUES
  ('maintenance_mode', 'false'::jsonb),
  ('rate_limit_per_10min', '10'::jsonb),
  ('cookie_auto_check_hours', '24'::jsonb),
  ('proxy_auto_check_hours', '24'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7) Activation attempts: staff read access
CREATE POLICY "Staff read activation attempts"
  ON public.activation_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
GRANT SELECT ON public.activation_attempts TO authenticated;

-- 8) Auto-populate admin_profiles + first-user-is-admin trigger
CREATE OR REPLACE FUNCTION public.handle_new_admin_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _username text;
  _is_first boolean;
BEGIN
  _username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));
  INSERT INTO public.admin_profiles (user_id, username, display_name)
  VALUES (NEW.id, _username, COALESCE(NEW.raw_user_meta_data->>'display_name', _username))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO _is_first;
  IF _is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_admin
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_admin_user();

-- 9) Updated-at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_admin_profiles_updated BEFORE UPDATE ON public.admin_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_cookie_pool_updated BEFORE UPDATE ON public.cookie_pool
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_proxy_pool_updated BEFORE UPDATE ON public.proxy_pool
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_app_settings_updated BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ==================== ROLES ====================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator');

CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- overload accepting TEXT to preserve existing rpc('has_role', {_role: 'admin'}) calls
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, _role::public.app_role)
$$;

CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== ADMIN PROFILES ====================
CREATE TABLE public.admin_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.admin_profiles TO authenticated;
GRANT ALL ON public.admin_profiles TO service_role;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.admin_profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own profile write" ON public.admin_profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own profile insert" ON public.admin_profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "staff can read all profiles" ON public.admin_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

-- ==================== SETTINGS ====================
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings public read" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "admins write settings" ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (key, value) VALUES
  ('proxy_mode', '0'),
  ('maintenance_enabled', '0'),
  ('maintenance_message', 'The service is temporarily unavailable for maintenance. Please try again shortly.'),
  ('max_activation_attempts', '3'),
  ('auto_check_enabled', '1'),
  ('auto_check_interval_hours', '24'),
  ('auto_cleanup_enabled', '1'),
  ('auto_cleanup_days', '7'),
  ('pool_alert_threshold', '5'),
  ('pool_alert_webhook', ''),
  ('rate_limit_per_10min', '10'),
  ('default_locale', 'en');

-- ==================== COOKIE POOL ====================
CREATE TABLE public.cookie_pool (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT,
  cookies_json JSONB NOT NULL,
  fingerprint TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',   -- active | on_hold | free | invalid | unknown
  is_valid BOOLEAN NOT NULL DEFAULT false,
  email TEXT,
  name TEXT,
  country TEXT,
  plan_name TEXT,
  video_quality TEXT,
  member_since TEXT,
  max_streams INT,
  payment_method TEXT,
  total_uses INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  fail_count INT NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  locked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_checked_mode TEXT,                     -- 'proxy' | 'direct'
  last_error TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cookie_pool_status_idx ON public.cookie_pool(status);
CREATE INDEX cookie_pool_last_used_idx ON public.cookie_pool(last_used_at NULLS FIRST);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cookie_pool TO authenticated;
GRANT ALL ON public.cookie_pool TO service_role;
ALTER TABLE public.cookie_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read cookies" ON public.cookie_pool FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "admins write cookies" ON public.cookie_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== PROXY POOL ====================
CREATE TABLE public.proxy_pool (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  raw TEXT UNIQUE NOT NULL,
  scheme TEXT NOT NULL DEFAULT 'http',
  ip TEXT NOT NULL,
  port TEXT NOT NULL,
  username TEXT,
  password TEXT,
  country TEXT,
  is_valid BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  locked_at TIMESTAMPTZ,
  last_latency_ms INT,
  last_checked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_error TEXT,
  total_uses INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX proxy_pool_valid_idx ON public.proxy_pool(is_valid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proxy_pool TO authenticated;
GRANT ALL ON public.proxy_pool TO service_role;
ALTER TABLE public.proxy_pool ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read proxies" ON public.proxy_pool FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "admins write proxies" ON public.proxy_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== ACTIVATION ATTEMPTS ====================
CREATE TABLE public.activation_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL,
  result TEXT NOT NULL,                       -- success | rate_limited | bot_detected | invalid_code | auth_expired | tv8_unavailable | no_cookie | worker_error | expired_code | maintenance | other
  ip_hash TEXT,
  user_agent TEXT,
  country TEXT,
  cookie_id UUID REFERENCES public.cookie_pool(id) ON DELETE SET NULL,
  proxy_id UUID REFERENCES public.proxy_pool(id) ON DELETE SET NULL,
  proxy_mode BOOLEAN NOT NULL DEFAULT false,
  attempt_number INT NOT NULL DEFAULT 1,
  duration_ms INT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX aa_created_idx ON public.activation_attempts(created_at DESC);
CREATE INDEX aa_result_idx ON public.activation_attempts(result);
CREATE INDEX aa_ip_idx ON public.activation_attempts(ip_hash);
GRANT SELECT, INSERT ON public.activation_attempts TO authenticated;
GRANT ALL ON public.activation_attempts TO service_role;
ALTER TABLE public.activation_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read attempts" ON public.activation_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

CREATE OR REPLACE FUNCTION public.count_recent_attempts(_ip_hash TEXT, _minutes INT)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INT FROM public.activation_attempts
   WHERE ip_hash = _ip_hash AND created_at > now() - (_minutes || ' minutes')::INTERVAL
$$;

-- ==================== ADMIN ACTIVITY LOG ====================
CREATE TABLE public.admin_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label TEXT,                           -- 'system' when admin_id is null
  action TEXT NOT NULL,
  target TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX aal_created_idx ON public.admin_activity_log(created_at DESC);
GRANT SELECT, INSERT ON public.admin_activity_log TO authenticated;
GRANT ALL ON public.admin_activity_log TO service_role;
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read log" ON public.admin_activity_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));
CREATE POLICY "staff insert own log" ON public.admin_activity_log FOR INSERT TO authenticated
  WITH CHECK (admin_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- ==================== STAFF INVITES ====================
CREATE TABLE public.staff_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  role public.app_role NOT NULL,
  invited_by UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invites TO authenticated;
GRANT ALL ON public.staff_invites TO service_role;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage invites" ON public.staff_invites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== BROADCASTS ====================
CREATE TABLE public.broadcasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subject TEXT NOT NULL,
  body_md TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'webhook',   -- webhook | email
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | queued | sent | failed
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sent_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage broadcasts" ON public.broadcasts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== JOB RUNS (for /admin/jobs) ====================
CREATE TABLE public.job_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job TEXT NOT NULL,                           -- cookies-autocheck | proxies-autocheck | auto-cleanup | pool-alert | broadcasts-scheduled | daily-stats
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok BOOLEAN,
  summary JSONB,
  error TEXT
);
CREATE INDEX job_runs_job_idx ON public.job_runs(job, started_at DESC);
GRANT SELECT ON public.job_runs TO authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read jobs" ON public.job_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'moderator'));

-- ==================== POOL PICKERS ====================
CREATE OR REPLACE FUNCTION public.pick_next_cookie()
RETURNS TABLE (id UUID, cookies_json JSONB, fingerprint TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID;
BEGIN
  UPDATE public.cookie_pool c
     SET is_locked = true, locked_at = now()
   WHERE c.id = (
     SELECT c2.id FROM public.cookie_pool c2
      WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
      ORDER BY c2.last_used_at NULLS FIRST, c2.total_uses ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING c.id INTO _id;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.cookies_json, c.fingerprint FROM public.cookie_pool c WHERE c.id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cookie(_id UUID, _success BOOLEAN, _outcome TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.cookie_pool
     SET is_locked = false,
         locked_at = NULL,
         last_used_at = now(),
         total_uses = total_uses + 1,
         success_count = success_count + CASE WHEN _success THEN 1 ELSE 0 END,
         fail_count = fail_count + CASE WHEN _success THEN 0 ELSE 1 END,
         last_error = COALESCE(_outcome, last_error)
   WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_cookie_invalid(_id UUID, _reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.cookie_pool
     SET status = 'invalid', is_valid = false, is_locked = false,
         last_used_at = now(), last_error = _reason
   WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pick_next_proxy()
RETURNS TABLE (id UUID, scheme TEXT, ip TEXT, port TEXT, username TEXT, password TEXT, raw TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _id UUID;
BEGIN
  UPDATE public.proxy_pool p
     SET is_locked = true, locked_at = now()
   WHERE p.id = (
     SELECT p2.id FROM public.proxy_pool p2
      WHERE p2.is_valid = true AND p2.is_locked = false
      ORDER BY p2.last_used_at NULLS FIRST, p2.total_uses ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING p.id INTO _id;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT p.id, p.scheme, p.ip, p.port, p.username, p.password, p.raw
                 FROM public.proxy_pool p WHERE p.id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_proxy(_id UUID, _success BOOLEAN, _latency_ms INT DEFAULT NULL, _err TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.proxy_pool
     SET is_locked = false,
         locked_at = NULL,
         last_used_at = now(),
         total_uses = total_uses + 1,
         last_latency_ms = COALESCE(_latency_ms, last_latency_ms),
         is_valid = CASE WHEN _success THEN true ELSE false END,
         last_error = COALESCE(_err, last_error)
   WHERE id = _id;
END;
$$;

-- ==================== AUTO-CLEANUP ====================
CREATE OR REPLACE FUNCTION public.run_auto_cleanup()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cleanup_days INT := COALESCE((SELECT value::INT FROM public.app_settings WHERE key='auto_cleanup_days'), 7);
  _dead INT; _fh INT; _prox INT; _att INT; _log INT;
BEGIN
  -- dead / invalid cookies untouched >24h
  DELETE FROM public.cookie_pool
   WHERE (status = 'invalid' OR is_valid = false)
     AND status <> 'unknown'
     AND (last_checked_at IS NULL OR last_checked_at < now() - INTERVAL '24 hours');
  GET DIAGNOSTICS _dead = ROW_COUNT;

  -- free / on_hold cookies untouched >24h
  DELETE FROM public.cookie_pool
   WHERE status IN ('free','on_hold')
     AND (last_checked_at IS NULL OR last_checked_at < now() - INTERVAL '24 hours');
  GET DIAGNOSTICS _fh = ROW_COUNT;

  -- dead proxies
  DELETE FROM public.proxy_pool WHERE is_valid = false
     AND (last_checked_at IS NULL OR last_checked_at < now() - INTERVAL '24 hours');
  GET DIAGNOSTICS _prox = ROW_COUNT;

  -- old attempts
  DELETE FROM public.activation_attempts WHERE created_at < now() - (_cleanup_days || ' days')::INTERVAL;
  GET DIAGNOSTICS _att = ROW_COUNT;

  -- old activity log
  DELETE FROM public.admin_activity_log WHERE created_at < now() - (_cleanup_days || ' days')::INTERVAL;
  GET DIAGNOSTICS _log = ROW_COUNT;

  INSERT INTO public.admin_activity_log(admin_id, actor_label, action, details)
  VALUES (NULL, 'system', 'scheduled_auto_cleanup',
    jsonb_build_object('dead_cookies', _dead, 'free_hold', _fh, 'dead_proxies', _prox,
                       'old_attempts', _att, 'old_log', _log, 'window_days', _cleanup_days));

  RETURN jsonb_build_object('dead_cookies', _dead, 'free_hold', _fh, 'dead_proxies', _prox,
                            'old_attempts', _att, 'old_log', _log);
END;
$$;

-- ==================== FIRST USER BOOTSTRAP: promote first sign-up to admin ====================
CREATE OR REPLACE FUNCTION public.handle_new_user_bootstrap()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- create admin profile row
  INSERT INTO public.admin_profiles(user_id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT (user_id) DO NOTHING;

  -- promote to admin if there is no admin yet, OR if an invite exists for this email
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles(user_id, role)
    SELECT NEW.id, si.role FROM public.staff_invites si
     WHERE lower(si.email) = lower(NEW.email) AND si.used_at IS NULL
    ON CONFLICT DO NOTHING;
    UPDATE public.staff_invites SET used_at = now()
     WHERE lower(email) = lower(NEW.email) AND used_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_bootstrap();

-- Revoke default PUBLIC execute on our SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_recent_attempts(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_next_cookie() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_next_proxy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_cookie(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_proxy(UUID, BOOLEAN, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_cookie_invalid(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_auto_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_bootstrap() FROM PUBLIC;

-- Grant only what's actually needed:
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_recent_attempts(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pick_next_cookie() TO service_role;
GRANT EXECUTE ON FUNCTION public.pick_next_proxy() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cookie(UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_proxy(UUID, BOOLEAN, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_cookie_invalid(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_auto_cleanup() TO service_role;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_admin_access_attempt(_allowed boolean, _path text DEFAULT '/admin')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text := auth.jwt() ->> 'email';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
  VALUES (
    auth.uid(),
    COALESCE(_email, auth.uid()::text),
    'admin_access_attempt',
    _path,
    jsonb_build_object(
      'email', _email,
      'allowed', _allowed,
      'path', _path,
      'user_id', auth.uid()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_access_attempt(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_email text;
  _actor_email text := auth.jwt() ->> 'email';
  _action text;
BEGIN
  SELECT email INTO _target_email
  FROM auth.users
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  IF TG_OP = 'INSERT' THEN
    _action := 'role_granted';
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
    VALUES (
      auth.uid(),
      COALESCE(_actor_email, auth.uid()::text, 'system'),
      _action,
      COALESCE(_target_email, NEW.user_id::text),
      jsonb_build_object(
        'target_email', _target_email,
        'target_user_id', NEW.user_id,
        'role', NEW.role,
        'actor_email', _actor_email
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    _action := 'role_changed';
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
    VALUES (
      auth.uid(),
      COALESCE(_actor_email, auth.uid()::text, 'system'),
      _action,
      COALESCE(_target_email, NEW.user_id::text),
      jsonb_build_object(
        'target_email', _target_email,
        'target_user_id', NEW.user_id,
        'old_role', OLD.role,
        'new_role', NEW.role,
        'actor_email', _actor_email
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    _action := 'role_removed';
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
    VALUES (
      auth.uid(),
      COALESCE(_actor_email, auth.uid()::text, 'system'),
      _action,
      COALESCE(_target_email, OLD.user_id::text),
      jsonb_build_object(
        'target_email', _target_email,
        'target_user_id', OLD.user_id,
        'role', OLD.role,
        'actor_email', _actor_email
      )
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_role_changes ON public.user_roles;
CREATE TRIGGER trg_audit_user_role_changes
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.audit_user_role_changes();
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_admin_access_attempt(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_access_attempt(boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.audit_user_role_changes() FROM PUBLIC;
DROP POLICY IF EXISTS "staff read attempts" ON public.activation_attempts;
CREATE POLICY "staff read attempts"
  ON public.activation_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'moderator'::public.app_role));

DROP POLICY IF EXISTS "staff insert own log" ON public.admin_activity_log;
CREATE POLICY "staff insert own log"
  ON public.admin_activity_log FOR INSERT TO authenticated
  WITH CHECK (admin_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "staff read log" ON public.admin_activity_log;
CREATE POLICY "staff read log"
  ON public.admin_activity_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'moderator'::public.app_role));

DROP POLICY IF EXISTS "staff can read all profiles" ON public.admin_profiles;
CREATE POLICY "staff can read all profiles"
  ON public.admin_profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'moderator'::public.app_role));

DROP POLICY IF EXISTS "admins write settings" ON public.app_settings;
CREATE POLICY "admins write settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage broadcasts" ON public.broadcasts;
CREATE POLICY "admins manage broadcasts"
  ON public.broadcasts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins write cookies" ON public.cookie_pool;
CREATE POLICY "admins write cookies"
  ON public.cookie_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "staff read cookies" ON public.cookie_pool;
CREATE POLICY "staff read cookies"
  ON public.cookie_pool FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'moderator'::public.app_role));

DROP POLICY IF EXISTS "staff read jobs" ON public.job_runs;
CREATE POLICY "staff read jobs"
  ON public.job_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'moderator'::public.app_role));

DROP POLICY IF EXISTS "admins write proxies" ON public.proxy_pool;
CREATE POLICY "admins write proxies"
  ON public.proxy_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "staff read proxies" ON public.proxy_pool;
CREATE POLICY "staff read proxies"
  ON public.proxy_pool FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'moderator'::public.app_role));

DROP POLICY IF EXISTS "admins manage invites" ON public.staff_invites;
CREATE POLICY "admins manage invites"
  ON public.staff_invites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP FUNCTION IF EXISTS public.has_role(uuid, text);

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_admin_access_attempt(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_admin_access_attempt(boolean, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.audit_user_role_changes() FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.job_runs ADD COLUMN IF NOT EXISTS progress JSONB;

-- Seed background song settings
INSERT INTO public.app_settings (key, value) VALUES
  ('background_song_enabled', 'true'),
  ('background_song_path', 'background.mp3'),
  ('background_song_name', 'background.mp3'),
  ('background_song_updated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;
insert into public.app_settings (key, value, updated_at) values ('background_song_reactive', 'true', now()) on conflict (key) do nothing;

-- Default rows for new settings keys.
insert into public.app_settings (key, value, updated_at) values
  ('background_song_schedule_enabled', 'false', now()),
  ('background_song_schedule_start', '00:00', now()),
  ('background_song_schedule_end', '23:59', now()),
  ('background_song_intensity', '1.0', now()),
  ('background_song_sensitivity', '1.0', now()),
  ('background_song_track_title', '', now())
on conflict (key) do nothing;

-- Uploaded-song history.
create table public.background_song_history (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  is_current boolean not null default false
);

grant select, insert, update, delete on public.background_song_history to authenticated;
grant all on public.background_song_history to service_role;

alter table public.background_song_history enable row level security;

create policy "Admins view song history"
  on public.background_song_history for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins manage song history"
  on public.background_song_history for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create index background_song_history_uploaded_at_idx
  on public.background_song_history (uploaded_at desc);

-- Lightweight analytics events.
create table public.background_song_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  session_hash text,
  created_at timestamptz not null default now()
);

grant select on public.background_song_events to authenticated;
grant all on public.background_song_events to service_role;

alter table public.background_song_events enable row level security;

create policy "Admins read song events"
  on public.background_song_events for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create index background_song_events_created_at_idx
  on public.background_song_events (created_at desc);

create index background_song_events_type_time_idx
  on public.background_song_events (event_type, created_at desc);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'activation_attempts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.activation_attempts';
  END IF;
END $$;

ALTER TABLE public.activation_attempts REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cookie_pool;

CREATE OR REPLACE FUNCTION public.pick_next_cookie_by_policy(_policy text DEFAULT 'round_robin')
RETURNS TABLE(id uuid, cookies_json jsonb, fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id UUID;
  _policy_norm text := lower(coalesce(_policy, 'round_robin'));
BEGIN
  IF _policy_norm = 'random' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
        ORDER BY random()
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSIF _policy_norm = 'quality' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
        ORDER BY
          -- Higher success rate first; unused cookies get a shot at rank 0.5 so proven winners still lead.
          (c2.success_count::float / NULLIF(c2.total_uses, 0)) DESC NULLS LAST,
          c2.success_count DESC,
          c2.last_used_at NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSE
    -- round_robin (default): least recently used, then fewest total uses.
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
        ORDER BY c2.last_used_at NULLS FIRST, c2.total_uses ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  END IF;

  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.cookies_json, c.fingerprint FROM public.cookie_pool c WHERE c.id = _id;
END;
$$;

-- Seed default policy so the settings screen has a value on first load.
INSERT INTO public.app_settings(key, value)
VALUES ('cookie_rotation_policy', 'round_robin')
ON CONFLICT (key) DO NOTHING;

-- Pick next cookie with policy + eligibility filters
CREATE OR REPLACE FUNCTION public.pick_next_cookie_filtered(
  _policy text DEFAULT 'round_robin',
  _include_statuses text[] DEFAULT ARRAY['active']::text[],
  _require_valid boolean DEFAULT true,
  _min_success_rate real DEFAULT 0,      -- 0..1
  _min_total_uses int DEFAULT 0          -- rate filter only applies when total_uses >= this
)
RETURNS TABLE(id uuid, cookies_json jsonb, fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id UUID;
  _p text := lower(coalesce(_policy, 'round_robin'));
BEGIN
  IF _p = 'random' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses < _min_total_uses
            OR (c2.success_count::real / NULLIF(c2.total_uses, 0)) >= _min_success_rate
          )
        ORDER BY random()
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSIF _p = 'quality' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses < _min_total_uses
            OR (c2.success_count::real / NULLIF(c2.total_uses, 0)) >= _min_success_rate
          )
        ORDER BY
          (c2.success_count::real / NULLIF(c2.total_uses, 0)) DESC NULLS LAST,
          c2.success_count DESC,
          c2.last_used_at NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSE
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses < _min_total_uses
            OR (c2.success_count::real / NULLIF(c2.total_uses, 0)) >= _min_success_rate
          )
        ORDER BY c2.last_used_at NULLS FIRST, c2.total_uses ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  END IF;

  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.cookies_json, c.fingerprint FROM public.cookie_pool c WHERE c.id = _id;
END;
$$;

-- Count how many cookies pass the eligibility filters right now.
CREATE OR REPLACE FUNCTION public.count_eligible_cookies(
  _include_statuses text[] DEFAULT ARRAY['active']::text[],
  _require_valid boolean DEFAULT true,
  _min_success_rate real DEFAULT 0,
  _min_total_uses int DEFAULT 0
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::int
    FROM public.cookie_pool c
   WHERE c.status = ANY(_include_statuses)
     AND (NOT _require_valid OR c.is_valid = true)
     AND (
       c.total_uses < _min_total_uses
       OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
     );
$$;

GRANT EXECUTE ON FUNCTION public.pick_next_cookie_filtered(text, text[], boolean, real, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_eligible_cookies(text[], boolean, real, int) TO authenticated, service_role;

ALTER TABLE public.activation_attempts
  ADD COLUMN IF NOT EXISTS selection_reason jsonb;

CREATE OR REPLACE FUNCTION public.simulate_cookie_selection(
  _policy text DEFAULT 'round_robin',
  _include_statuses text[] DEFAULT ARRAY['active']::text[],
  _require_valid boolean DEFAULT true,
  _min_success_rate real DEFAULT 0,
  _min_total_uses int DEFAULT 0,
  _limit int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p text := lower(coalesce(_policy, 'round_robin'));
  _total int;
  _skipped_status int;
  _skipped_invalid int;
  _skipped_locked int;
  _skipped_success int;
  _eligible int;
  _winner jsonb;
  _preview jsonb;
BEGIN
  SELECT COUNT(*) INTO _total FROM public.cookie_pool;

  SELECT COUNT(*) INTO _skipped_status
    FROM public.cookie_pool WHERE NOT (status = ANY(_include_statuses));

  SELECT COUNT(*) INTO _skipped_invalid
    FROM public.cookie_pool
   WHERE status = ANY(_include_statuses)
     AND _require_valid AND is_valid = false;

  SELECT COUNT(*) INTO _skipped_locked
    FROM public.cookie_pool
   WHERE status = ANY(_include_statuses)
     AND (NOT _require_valid OR is_valid = true)
     AND is_locked = true;

  SELECT COUNT(*) INTO _skipped_success
    FROM public.cookie_pool c
   WHERE c.status = ANY(_include_statuses)
     AND (NOT _require_valid OR c.is_valid = true)
     AND c.is_locked = false
     AND NOT (
       c.total_uses < _min_total_uses
       OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
     );

  SELECT COUNT(*) INTO _eligible
    FROM public.cookie_pool c
   WHERE c.status = ANY(_include_statuses)
     AND (NOT _require_valid OR c.is_valid = true)
     AND c.is_locked = false
     AND (
       c.total_uses < _min_total_uses
       OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
     );

  -- Build ordered preview list per policy.
  WITH candidates AS (
    SELECT
      c.id, c.email, c.country, c.status, c.is_valid,
      c.total_uses, c.success_count, c.fail_count,
      c.last_used_at, c.last_checked_at,
      CASE WHEN c.total_uses > 0
           THEN (c.success_count::real / c.total_uses)
           ELSE NULL END AS success_rate
      FROM public.cookie_pool c
     WHERE c.status = ANY(_include_statuses)
       AND (NOT _require_valid OR c.is_valid = true)
       AND c.is_locked = false
       AND (
         c.total_uses < _min_total_uses
         OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
       )
  ),
  ordered AS (
    SELECT *,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN _p = 'quality'
               THEN (success_count::real / NULLIF(total_uses, 0)) END DESC NULLS LAST,
          CASE WHEN _p = 'quality' THEN success_count END DESC,
          CASE WHEN _p = 'random' THEN random() END,
          last_used_at NULLS FIRST,
          total_uses ASC
      ) AS rn
      FROM candidates
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'email', email,
    'country', country,
    'status', status,
    'is_valid', is_valid,
    'total_uses', total_uses,
    'success_count', success_count,
    'fail_count', fail_count,
    'success_rate', success_rate,
    'last_used_at', last_used_at,
    'rank', rn
  ) ORDER BY rn)
    INTO _preview
    FROM ordered
   WHERE rn <= _limit;

  SELECT jsonb_build_object(
    'id', id, 'email', email, 'country', country,
    'total_uses', total_uses, 'success_count', success_count,
    'success_rate', success_rate, 'last_used_at', last_used_at
  ) INTO _winner
    FROM (
      SELECT * FROM public.cookie_pool c
       WHERE c.status = ANY(_include_statuses)
         AND (NOT _require_valid OR c.is_valid = true)
         AND c.is_locked = false
         AND (
           c.total_uses < _min_total_uses
           OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
         )
       ORDER BY
         CASE WHEN _p = 'quality'
              THEN (c.success_count::real / NULLIF(c.total_uses, 0)) END DESC NULLS LAST,
         CASE WHEN _p = 'quality' THEN c.success_count END DESC,
         CASE WHEN _p = 'random' THEN random() END,
         c.last_used_at NULLS FIRST,
         c.total_uses ASC
       LIMIT 1
    ) t
   CROSS JOIN LATERAL (
     SELECT CASE WHEN t.total_uses > 0
                 THEN (t.success_count::real / t.total_uses) END AS success_rate
   ) sr;

  RETURN jsonb_build_object(
    'policy', _p,
    'total', _total,
    'eligible', _eligible,
    'skipped', jsonb_build_object(
      'wrong_status', _skipped_status,
      'invalid_flag', _skipped_invalid,
      'currently_locked', _skipped_locked,
      'low_success_rate', _skipped_success
    ),
    'winner', _winner,
    'preview', COALESCE(_preview, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.simulate_cookie_selection(text, text[], boolean, real, int, int) TO authenticated, service_role;

-- Proxy health tracking
ALTER TABLE public.proxy_pool
  ADD COLUMN IF NOT EXISTS success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score real NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;

-- Update release_proxy to track health & auto-quarantine
CREATE OR REPLACE FUNCTION public.release_proxy(_id uuid, _success boolean, _latency_ms integer DEFAULT NULL::integer, _err text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_consec int;
  _new_success int;
  _new_fail int;
  _new_total int;
  _new_health real;
  _quarantine timestamptz;
BEGIN
  SELECT
    CASE WHEN _success THEN 0 ELSE consecutive_failures + 1 END,
    success_count + CASE WHEN _success THEN 1 ELSE 0 END,
    failure_count + CASE WHEN _success THEN 0 ELSE 1 END
    INTO _new_consec, _new_success, _new_fail
    FROM public.proxy_pool WHERE id = _id;

  _new_total := _new_success + _new_fail;
  IF _new_total > 0 THEN
    _new_health := _new_success::real / _new_total::real;
  ELSE
    _new_health := 0.5;
  END IF;

  _quarantine := CASE WHEN _new_consec >= 5 THEN now() ELSE NULL END;

  UPDATE public.proxy_pool
     SET is_locked = false,
         locked_at = NULL,
         last_used_at = now(),
         total_uses = total_uses + 1,
         last_latency_ms = COALESCE(_latency_ms, last_latency_ms),
         is_valid = CASE WHEN _success THEN true ELSE is_valid END,
         last_error = COALESCE(_err, last_error),
         success_count = _new_success,
         failure_count = _new_fail,
         consecutive_failures = _new_consec,
         health_score = _new_health,
         quarantined_at = COALESCE(quarantined_at, _quarantine)
   WHERE id = _id;
END;
$function$;

-- Update pick_next_proxy to skip quarantined and prefer healthier proxies
CREATE OR REPLACE FUNCTION public.pick_next_proxy()
 RETURNS TABLE(id uuid, scheme text, ip text, port text, username text, password text, raw text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id UUID;
BEGIN
  UPDATE public.proxy_pool p
     SET is_locked = true, locked_at = now()
   WHERE p.id = (
     SELECT p2.id FROM public.proxy_pool p2
      WHERE p2.is_valid = true
        AND p2.is_locked = false
        AND p2.quarantined_at IS NULL
      ORDER BY p2.health_score DESC, p2.last_used_at NULLS FIRST, p2.total_uses ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING p.id INTO _id;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT p.id, p.scheme, p.ip, p.port, p.username, p.password, p.raw
                 FROM public.proxy_pool p WHERE p.id = _id;
END;
$function$;

-- Proxy stats aggregate
CREATE OR REPLACE FUNCTION public.get_proxy_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.proxy_pool),
    'valid', (SELECT count(*) FROM public.proxy_pool WHERE is_valid = true AND quarantined_at IS NULL),
    'invalid', (SELECT count(*) FROM public.proxy_pool WHERE is_valid = false),
    'quarantined', (SELECT count(*) FROM public.proxy_pool WHERE quarantined_at IS NOT NULL),
    'never_checked', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at IS NULL),
    'checked_1h', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at > now() - interval '1 hour'),
    'avg_latency_ms', (SELECT COALESCE(round(avg(last_latency_ms))::int, 0) FROM public.proxy_pool WHERE is_valid = true AND last_latency_ms IS NOT NULL),
    'countries', (SELECT count(DISTINCT country) FROM public.proxy_pool WHERE country IS NOT NULL)
  );
$function$;

-- Un-quarantine a proxy (manual reset)
CREATE OR REPLACE FUNCTION public.unquarantine_proxy(_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.proxy_pool
     SET quarantined_at = NULL, consecutive_failures = 0
   WHERE id = _id;
$function$;

-- Enable Realtime for proxy_pool and job_runs
ALTER TABLE public.proxy_pool REPLICA IDENTITY FULL;
ALTER TABLE public.job_runs REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proxy_pool;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_runs;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

CREATE OR REPLACE FUNCTION public.get_proxy_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.proxy_pool),
    'valid', (SELECT count(*) FROM public.proxy_pool
               WHERE is_valid = true AND quarantined_at IS NULL AND last_checked_at IS NOT NULL),
    'invalid', (SELECT count(*) FROM public.proxy_pool
                 WHERE is_valid = false AND last_checked_at IS NOT NULL AND quarantined_at IS NULL),
    'quarantined', (SELECT count(*) FROM public.proxy_pool WHERE quarantined_at IS NOT NULL),
    'never_checked', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at IS NULL),
    'checked_1h', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at > now() - interval '1 hour'),
    'checked_24h', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at > now() - interval '24 hours'),
    'stuck_locked', (SELECT count(*) FROM public.proxy_pool
                      WHERE is_locked = true AND locked_at < now() - interval '5 minutes'),
    'avg_latency_ms', (SELECT COALESCE(round(avg(last_latency_ms))::int, 0)
                        FROM public.proxy_pool WHERE is_valid = true AND last_latency_ms IS NOT NULL),
    'avg_health', (SELECT COALESCE(round(avg(health_score)::numeric, 3), 0)
                    FROM public.proxy_pool WHERE last_checked_at IS NOT NULL),
    'countries', (SELECT count(DISTINCT country) FROM public.proxy_pool WHERE country IS NOT NULL),
    'schemes', (SELECT jsonb_object_agg(scheme, cnt) FROM (
                  SELECT scheme, count(*) AS cnt FROM public.proxy_pool GROUP BY scheme
                ) s)
  );
$function$;
ALTER TABLE public.job_runs ADD COLUMN IF NOT EXISTS control text;
COMMENT ON COLUMN public.job_runs.control IS 'null | stop | cancel — set by admin to signal a running job';
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
create table if not exists public.captcha_verify_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  purpose text not null default 'activate',
  success boolean not null,
  error_codes text[] not null default '{}',
  reason text,
  http_status int,
  latency_ms int,
  token_length int,
  token_prefix text,
  hostname text,
  challenge_ts timestamptz,
  ip_hash text,
  user_agent text
);
create index if not exists captcha_verify_log_created_idx on public.captcha_verify_log (created_at desc);
create index if not exists captcha_verify_log_success_idx on public.captcha_verify_log (success, created_at desc);
grant select, insert on public.captcha_verify_log to authenticated;
grant all on public.captcha_verify_log to service_role;
alter table public.captcha_verify_log enable row level security;
drop policy if exists "admins read captcha logs" on public.captcha_verify_log;
create policy "admins read captcha logs" on public.captcha_verify_log
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Purge captcha_verify_log rows older than N days.
CREATE OR REPLACE FUNCTION public.purge_captcha_verify_log(_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n integer;
BEGIN
  DELETE FROM public.captcha_verify_log
   WHERE created_at < now() - (_days || ' days')::interval;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

-- Count recent captcha verify failures for an IP hash within N minutes.
CREATE OR REPLACE FUNCTION public.count_recent_captcha_failures(_ip_hash text, _minutes integer)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.captcha_verify_log
   WHERE ip_hash = _ip_hash
     AND success = false
     AND created_at > now() - (_minutes || ' minutes')::interval;
$$;

-- Live captcha health snapshot: success rate over last N minutes.
CREATE OR REPLACE FUNCTION public.get_captcha_health(_minutes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT * FROM public.captcha_verify_log
     WHERE purpose = 'activate'
       AND created_at > now() - (_minutes || ' minutes')::interval
  )
  SELECT jsonb_build_object(
    'window_minutes', _minutes,
    'total', (SELECT COUNT(*) FROM win),
    'success', (SELECT COUNT(*) FROM win WHERE success),
    'failed', (SELECT COUNT(*) FROM win WHERE NOT success),
    'success_rate', COALESCE((SELECT COUNT(*) FILTER (WHERE success)::real
                                / NULLIF(COUNT(*), 0) FROM win), 1.0),
    'last_at', (SELECT MAX(created_at) FROM win),
    'last_success_at', (SELECT MAX(created_at) FROM win WHERE success),
    'last_failure_reason', (SELECT reason FROM win WHERE NOT success ORDER BY created_at DESC LIMIT 1)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_captcha_health(integer) TO anon, authenticated;

-- Schedule daily purge with configurable retention (default 7 days).
DO $$
DECLARE _jid int;
BEGIN
  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'purge-captcha-verify-log';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule(
    'purge-captcha-verify-log',
    '17 3 * * *',
    $cron$
      SELECT public.purge_captcha_verify_log(
        COALESCE((SELECT value::int FROM public.app_settings WHERE key='captcha_log_retention_days'), 7)
      );
    $cron$
  );
END $$;
-- Login gate: track which user made each activation and enforce per-user daily limit.
ALTER TABLE public.activation_attempts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS aa_user_created_idx
  ON public.activation_attempts(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Per-user rate limit RPC.
CREATE OR REPLACE FUNCTION public.count_user_recent_attempts(_user_id UUID, _minutes INT)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INT FROM public.activation_attempts
   WHERE user_id = _user_id
     AND created_at > now() - (_minutes || ' minutes')::INTERVAL
$$;

-- Seed default settings (idempotent).
INSERT INTO public.app_settings(key, value) VALUES
  ('user_daily_activation_limit', '10'),
  ('user_signup_require_verify', '1')
ON CONFLICT (key) DO NOTHING;

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

CREATE TABLE public.user_activation_overrides (
  user_id uuid PRIMARY KEY,
  daily_limit integer NOT NULL DEFAULT 0,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activation_overrides TO authenticated;
GRANT ALL ON public.user_activation_overrides TO service_role;

ALTER TABLE public.user_activation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage user activation overrides"
  ON public.user_activation_overrides
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE OR REPLACE FUNCTION public.pick_next_cookie_filtered(
  _policy text DEFAULT 'round_robin',
  _include_statuses text[] DEFAULT ARRAY['active'],
  _require_valid boolean DEFAULT true,
  _min_success_rate real DEFAULT 0,
  _min_total_uses integer DEFAULT 0
)
RETURNS TABLE(id uuid, cookies_json jsonb, fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id UUID;
  _p text := lower(coalesce(_policy, 'round_robin'));
BEGIN
  IF _p = 'random' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses <= _min_total_uses
            OR COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) >= _min_success_rate
          )
        ORDER BY random()
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSIF _p = 'quality' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses <= _min_total_uses
            OR COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) >= _min_success_rate
          )
        ORDER BY
          COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) DESC,
          c2.success_count DESC,
          c2.last_used_at NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSE
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses <= _min_total_uses
            OR COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) >= _min_success_rate
          )
        ORDER BY c2.last_used_at NULLS FIRST, c2.total_uses ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  END IF;

  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.cookies_json, c.fingerprint FROM public.cookie_pool c WHERE c.id = _id;
END;
$function$;
DO $$
DECLARE
  _jobid bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1 LIMIT 1'
      INTO _jobid
      USING 'purge-captcha-verify-log';
    IF _jobid IS NOT NULL THEN
      EXECUTE 'SELECT cron.unschedule($1)' USING _jobid;
    END IF;
  END IF;
END $$;

DELETE FROM public.app_settings
WHERE key IN (
  'captcha_required',
  'captcha_provider',
  'captcha_site_key',
  'captcha_log_retention_days'
);

DROP FUNCTION IF EXISTS public.get_captcha_health(integer);
DROP FUNCTION IF EXISTS public.count_recent_captcha_failures(text, integer);
DROP FUNCTION IF EXISTS public.purge_captcha_verify_log(integer);

DROP TABLE IF EXISTS public.captcha_verify_log;
-- Branding presets: named snapshots the admin can save and switch instantly.
CREATE TABLE public.branding_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branding_presets TO authenticated;
GRANT ALL ON public.branding_presets TO service_role;
ALTER TABLE public.branding_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage branding presets" ON public.branding_presets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Branding history: implicit snapshot before every write, powers one-click Undo.
CREATE TABLE public.branding_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data JSONB NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branding_history TO authenticated;
GRANT ALL ON public.branding_history TO service_role;
ALTER TABLE public.branding_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read+write branding history" ON public.branding_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX branding_history_created_at_idx ON public.branding_history (created_at DESC);

-- Enable Realtime for app_settings so the public site can react to
-- maintenance / gate changes instantly without polling.
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
  END IF;
END $$;

-- Seed default rows for the two scheduling keys so upserts stay idempotent
-- and the admin UI can render them without a race.
INSERT INTO public.app_settings(key, value)
VALUES
  ('maintenance_starts_at', ''),
  ('maintenance_ends_at', '')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_cron_schedules()
RETURNS TABLE(jobname text, schedule text, active boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT jobname::text, schedule::text, active
  FROM cron.job
  WHERE jobname LIKE 'emberlord-%';
$$;

REVOKE ALL ON FUNCTION public.list_cron_schedules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_cron_schedules() TO authenticated, service_role;
SELECT cron.unschedule('emberlord-pool-alert') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='emberlord-pool-alert');
DELETE FROM public.app_settings WHERE key IN ('pool_alert_threshold','pool_alert_webhook');

ALTER TABLE public.background_song_events
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS muted boolean,
  ADD COLUMN IF NOT EXISTS needs_gesture boolean,
  ADD COLUMN IF NOT EXISTS silent boolean,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS ip_hash text;

CREATE INDEX IF NOT EXISTS background_song_events_status_time_idx
  ON public.background_song_events (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_bg_song_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _now timestamptz := now();
  _24h timestamptz := _now - interval '24 hours';
  _48h timestamptz := _now - interval '48 hours';
  _7d  timestamptz := _now - interval '7 days';
  _kinds text[] := ARRAY['impression','autoplay','unmute','tap_play','out_of_schedule','silence_detected'];
  _t24 jsonb := '{}'::jsonb;
  _t7d jsonb := '{}'::jsonb;
  _prev24 jsonb := '{}'::jsonb;
  _k text;
  _c bigint;
  _u24 bigint;
  _u7d bigint;
  _last timestamptz;
BEGIN
  FOREACH _k IN ARRAY _kinds LOOP
    SELECT count(*) INTO _c FROM public.background_song_events
      WHERE event_type = _k AND created_at >= _24h;
    _t24 := _t24 || jsonb_build_object(_k, _c);

    SELECT count(*) INTO _c FROM public.background_song_events
      WHERE event_type = _k AND created_at >= _7d;
    _t7d := _t7d || jsonb_build_object(_k, _c);

    SELECT count(*) INTO _c FROM public.background_song_events
      WHERE event_type = _k AND created_at >= _48h AND created_at < _24h;
    _prev24 := _prev24 || jsonb_build_object(_k, _c);
  END LOOP;

  SELECT count(DISTINCT session_hash) INTO _u24 FROM public.background_song_events
    WHERE created_at >= _24h AND session_hash IS NOT NULL;
  SELECT count(DISTINCT session_hash) INTO _u7d FROM public.background_song_events
    WHERE created_at >= _7d AND session_hash IS NOT NULL;

  SELECT max(created_at) INTO _last FROM public.background_song_events;

  RETURN jsonb_build_object(
    'total24h', _t24,
    'total7d', _t7d,
    'prev24h', _prev24,
    'unique24h', _u24,
    'unique7d', _u7d,
    'lastEventAt', _last,
    'generatedAt', _now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bg_song_analytics() TO authenticated, service_role;
DELETE FROM public.app_settings WHERE key IN ('branding_section_features_title_1','branding_section_features_title_2','branding_section_cta_title_1','branding_section_cta_title_2') AND (value IS NULL OR value = '');

-- F002: hot-path partial indexes for pickers + activation feed / rate-limit
CREATE INDEX IF NOT EXISTS idx_cookie_pool_pickable
  ON public.cookie_pool(last_used_at NULLS FIRST, total_uses)
  WHERE status='active' AND is_valid=true AND is_locked=false;

CREATE INDEX IF NOT EXISTS idx_proxy_pool_pickable
  ON public.proxy_pool(health_score DESC, last_used_at NULLS FIRST)
  WHERE is_valid=true AND is_locked=false AND quarantined_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_activation_attempts_success_recent
  ON public.activation_attempts(created_at DESC)
  WHERE result='success';

-- F003: explicit deny-all policy on otp_attempts so intent is documented
--       (SECURITY DEFINER RPCs still write; RLS blocks any direct client read).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='otp_attempts' AND policyname='otp_attempts_no_direct_access'
  ) THEN
    EXECUTE 'CREATE POLICY otp_attempts_no_direct_access ON public.otp_attempts FOR ALL TO authenticated, anon USING (false) WITH CHECK (false)';
  END IF;
END$$;

-- F005: stuck-lock reaper. Runs every 5 minutes; releases locks older than 5m.
CREATE OR REPLACE FUNCTION public.reap_stuck_locks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c int;
  _p int;
BEGIN
  UPDATE public.cookie_pool
     SET is_locked=false, locked_at=NULL
   WHERE is_locked=true AND locked_at < now() - interval '5 minutes';
  GET DIAGNOSTICS _c = ROW_COUNT;

  UPDATE public.proxy_pool
     SET is_locked=false, locked_at=NULL
   WHERE is_locked=true AND locked_at < now() - interval '5 minutes';
  GET DIAGNOSTICS _p = ROW_COUNT;

  IF _c > 0 OR _p > 0 THEN
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, details)
    VALUES (NULL, 'system', 'stuck_lock_reaped',
            jsonb_build_object('cookies_released', _c, 'proxies_released', _p));
  END IF;

  RETURN jsonb_build_object('cookies_released', _c, 'proxies_released', _p);
END;
$$;

REVOKE ALL ON FUNCTION public.reap_stuck_locks() FROM PUBLIC;

-- Schedule stuck-lock reaper
SELECT cron.unschedule('emberlord-stuck-lock-reaper')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='emberlord-stuck-lock-reaper');

SELECT cron.schedule(
  'emberlord-stuck-lock-reaper',
  '*/5 * * * *',
  $cron$SELECT public.reap_stuck_locks();$cron$
);

-- F007 (P0-sec): Revoke PUBLIC EXECUTE on sensitive SECDEF RPCs.
-- These are called from server functions via service-role, so they don't need
-- public/anon execute at all. Keeping public execute broadened attack surface.

REVOKE EXECUTE ON FUNCTION public.simulate_cookie_selection(text, text[], boolean, real, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_proxy_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_bg_song_analytics() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_cookie_by_policy(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_cookie_filtered(text, text[], boolean, real, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_eligible_cookies(text[], boolean, real, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_user_recent_attempts(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unquarantine_proxy(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_auth_audit_log(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_access_sessions() FROM PUBLIC, anon;

-- record_otp_attempt & check_otp_rate_limit stay callable — anon signup path uses them.
-- Grant explicitly to authenticated so app calls keep working post-revoke.
GRANT EXECUTE ON FUNCTION public.check_otp_rate_limit(text, text, integer, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.record_otp_attempt(text, text, text) TO authenticated, anon;

-- F004 (P2): Rename scheduled jobs from emberlord- to okflix- prefix.
DO $$
DECLARE
  _r record;
BEGIN
  FOR _r IN SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'emberlord-%' LOOP
    PERFORM cron.unschedule(_r.jobid);
    PERFORM cron.schedule(replace(_r.jobname,'emberlord-','okflix-'), _r.schedule, _r.command);
  END LOOP;
END$$;

-- Update list_cron_schedules to look for the new prefix.
CREATE OR REPLACE FUNCTION public.list_cron_schedules()
 RETURNS TABLE(jobname text, schedule text, active boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
  SELECT jobname::text, schedule::text, active
  FROM cron.job
  WHERE jobname LIKE 'okflix-%' OR jobname LIKE 'emberlord-%';
$function$;

REVOKE EXECUTE ON FUNCTION public.list_cron_schedules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_cron_schedules() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.pick_next_cookie() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_cookie() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_next_cookie() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_next_cookie() TO service_role;

-- Access Gates & Keys audit hardening
-- 1. Revoke anon EXECUTE on sensitive RPCs. All callers use service_role (server functions),
--    so anon access is unnecessary and widens the bypass surface.
REVOKE EXECUTE ON FUNCTION public.consume_access_key(text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_recent_attempts(text, integer) FROM anon, PUBLIC;

-- 2. Add access_keys to the Realtime publication so /admin/access reflects
--    key create/disable/delete across tabs within ≤2s (in addition to 2s polling).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='access_keys'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.access_keys';
  END IF;
END $$;

-- 3. Hourly cron to purge expired public.access_sessions rows.
SELECT cron.schedule(
  'okflix-purge-access-sessions',
  '15 * * * *',
  $$SELECT public.purge_expired_access_sessions();$$
);
-- Unschedule any purge cron related to auth audit log if present
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job WHERE jobname IN ('okflix-purge-auth-audit-log','purge-auth-audit-log')
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Drop functions
DROP FUNCTION IF EXISTS public.purge_auth_audit_log(int);
DROP FUNCTION IF EXISTS public.check_otp_rate_limit(text, text, integer, integer, integer);
DROP FUNCTION IF EXISTS public.record_otp_attempt(text, text, text);

-- Drop tables
DROP TABLE IF EXISTS public.auth_audit_log CASCADE;
DROP TABLE IF EXISTS public.otp_attempts CASCADE;
-- Harden Staff & Roles: least-privilege for anon, prevent duplicate pending invites, enable realtime.
REVOKE ALL ON public.user_roles FROM anon;
REVOKE ALL ON public.staff_invites FROM anon;

CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_pending_email_uniq
  ON public.staff_invites (lower(email))
  WHERE used_at IS NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_invites;
-- Harden Two-factor: enable realtime + explicit grants for recovery codes
GRANT SELECT, DELETE ON public.admin_recovery_codes TO authenticated;
GRANT ALL ON public.admin_recovery_codes TO service_role;
REVOKE ALL ON public.admin_recovery_codes FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='admin_recovery_codes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_recovery_codes;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.consume_recovery_code(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_cookie_invalid(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_proxy() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_locks() FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_cookie(uuid, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_proxy(uuid, boolean, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_auto_cleanup() FROM anon;
-- Fresh publish: truncate operational tables, keep auth/roles/settings/branding/uploaded tracks
TRUNCATE TABLE
  public.activation_attempts,
  public.access_key_redemptions,
  public.access_keys,
  public.access_sessions,
  public.admin_activity_log,
  public.background_song_events,
  public.branding_history,
  public.broadcasts,
  public.cookie_pool,
  public.job_runs,
  public.proxy_pool,
  public.staff_invites,
  public.user_activation_overrides
RESTART IDENTITY CASCADE;

INSERT INTO public.admin_activity_log(admin_id, actor_label, action, details)
VALUES (NULL, 'system', 'fresh_launch_reset',
  jsonb_build_object('at', now(), 'note', 'Operational tables truncated for public launch.'));
-- Null out FK references to auth.users so we can delete them
UPDATE public.app_settings SET updated_by = NULL WHERE updated_by IS NOT NULL;
UPDATE public.branding_presets SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE public.background_song_history SET uploaded_by = NULL WHERE uploaded_by IS NOT NULL;
UPDATE public.admin_activity_log SET admin_id = NULL WHERE admin_id IS NOT NULL;

-- Wipe admin/staff app data
DELETE FROM public.admin_recovery_codes;
DELETE FROM public.staff_invites;
DELETE FROM public.user_roles;
DELETE FROM public.admin_profiles;

-- Wipe auth users
DELETE FROM auth.users;

INSERT INTO public.admin_activity_log(admin_id, actor_label, action, details)
VALUES (NULL, 'system', 'fresh_admin_reset',
  jsonb_build_object('at', now(), 'note', 'All admins/users purged; next Google sign-in becomes first admin.'));

-- Operational wipe
TRUNCATE TABLE
  public.activation_attempts,
  public.access_key_redemptions,
  public.access_keys,
  public.access_sessions,
  public.admin_activity_log,
  public.background_song_events,
  public.background_song_history,
  public.branding_history,
  public.broadcasts,
  public.cookie_pool,
  public.proxy_pool,
  public.job_runs,
  public.user_activation_overrides,
  public.staff_invites,
  public.admin_recovery_codes,
  public.user_roles,
  public.admin_profiles
RESTART IDENTITY CASCADE;

-- Delete all auth users (cascades via handle_new_user_bootstrap dependencies already truncated above)
DELETE FROM auth.users;

-- 1) Tighten app_settings public read to an allowlist of user-facing keys
DROP POLICY IF EXISTS "settings public read" ON public.app_settings;

CREATE POLICY "settings public read allowlist"
ON public.app_settings
FOR SELECT
TO public
USING (
  key LIKE 'branding_%'
  OR key LIKE 'contact_%'
  OR key LIKE 'background_song_%'
  OR key LIKE 'maintenance_%'
  OR key IN (
    'access_key_required',
    'login_required',
    'default_locale',
    'user_signup_require_verify'
  )
);

CREATE POLICY "settings authenticated read all"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

-- 2) storage.objects policies for private `site-audio` bucket (admins only)
DROP POLICY IF EXISTS "site-audio admin select" ON storage.objects;
DROP POLICY IF EXISTS "site-audio admin insert" ON storage.objects;
DROP POLICY IF EXISTS "site-audio admin update" ON storage.objects;
DROP POLICY IF EXISTS "site-audio admin delete" ON storage.objects;

CREATE POLICY "site-audio admin select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site-audio admin insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site-audio admin update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site-audio admin delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));
INSERT INTO public.app_settings(key, value)
VALUES ('cron_secret', encode(gen_random_bytes(36), 'hex'))
ON CONFLICT (key) DO UPDATE
  SET value = CASE
    WHEN public.app_settings.value IS NULL OR length(public.app_settings.value) < 32
    THEN encode(gen_random_bytes(36), 'hex')
    ELSE public.app_settings.value
  END;

DO $$
DECLARE
  _secret text;
  _base text := 'https://project--9c504117-6746-45b6-95c8-55e609b4b713-dev.lovable.app';
  _jid int;
BEGIN
  SELECT value INTO _secret FROM public.app_settings WHERE key = 'cron_secret';

  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'okflix-auto-cleanup';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule('okflix-auto-cleanup','7 4 * * *',
    format($cmd$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$cmd$,
      _base || '/api/public/hooks/auto-cleanup',
      json_build_object('Content-Type','application/json','x-cron-secret', _secret)::text));

  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'okflix-cookies-autocheck';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule('okflix-cookies-autocheck','5 * * * *',
    format($cmd$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$cmd$,
      _base || '/api/public/hooks/cookies-autocheck',
      json_build_object('Content-Type','application/json','x-cron-secret', _secret)::text));

  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'okflix-proxies-autocheck';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule('okflix-proxies-autocheck','25 * * * *',
    format($cmd$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$cmd$,
      _base || '/api/public/hooks/proxies-autocheck',
      json_build_object('Content-Type','application/json','x-cron-secret', _secret)::text));
END $$;
-- Lock down SECURITY DEFINER functions: only allow EXECUTE where actually needed.
-- Everything else is called via service_role (supabaseAdmin) or as triggers, so
-- anon/authenticated do not need EXECUTE.

-- Trigger functions — no EXECUTE needed for anyone but service_role.
REVOKE ALL ON FUNCTION public.handle_new_user_bootstrap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_user_role_changes() FROM PUBLIC, anon, authenticated;

-- Pool selection / release / maintenance — only called from server code with service_role.
REVOKE ALL ON FUNCTION public.pick_next_cookie() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_next_cookie_by_policy(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_next_cookie_filtered(text, text[], boolean, real, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_next_proxy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cookie(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_proxy(uuid, boolean, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_cookie_invalid(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unquarantine_proxy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_stuck_locks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_auto_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_access_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simulate_cookie_selection(text, text[], boolean, real, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_eligible_cookies(text[], boolean, real, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_bg_song_analytics() FROM PUBLIC, anon, authenticated;

-- Activation rate limiting — called with service_role from the activation server fn.
REVOKE ALL ON FUNCTION public.count_recent_attempts(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_user_recent_attempts(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Access key / recovery code redemption — called with service_role.
REVOKE ALL ON FUNCTION public.consume_access_key(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_recovery_code(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Kept callable by authenticated (verified call sites use the user's supabase client):
--   has_role(uuid, app_role)          — RLS predicate + admin gate checks
--   log_admin_access_attempt(bool, text) — admin route audit log
--   list_cron_schedules()             — admin settings page (RLS-inside function only lists cron rows)
--   get_proxy_stats()                 — admin pool page
REVOKE ALL ON FUNCTION public.list_cron_schedules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_proxy_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_admin_access_attempt(boolean, text) FROM PUBLIC, anon, authenticated;

UPDATE public.app_settings SET updated_by = NULL WHERE updated_by IS NOT NULL;

TRUNCATE TABLE
  public.activation_attempts,
  public.job_runs,
  public.cookie_pool,
  public.proxy_pool,
  public.access_key_redemptions,
  public.access_keys,
  public.access_sessions,
  public.user_activation_overrides,
  public.background_song_events,
  public.background_song_history,
  public.branding_history,
  public.broadcasts,
  public.admin_activity_log,
  public.admin_recovery_codes,
  public.staff_invites,
  public.user_roles,
  public.admin_profiles
RESTART IDENTITY CASCADE;

DELETE FROM auth.users;
