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