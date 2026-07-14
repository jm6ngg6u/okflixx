
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
