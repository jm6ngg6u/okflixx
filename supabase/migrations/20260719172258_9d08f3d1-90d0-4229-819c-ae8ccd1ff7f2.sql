
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
