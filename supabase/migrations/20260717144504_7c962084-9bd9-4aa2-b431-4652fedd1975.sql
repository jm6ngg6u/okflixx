
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
