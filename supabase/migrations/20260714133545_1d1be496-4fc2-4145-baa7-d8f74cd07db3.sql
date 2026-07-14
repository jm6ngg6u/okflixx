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