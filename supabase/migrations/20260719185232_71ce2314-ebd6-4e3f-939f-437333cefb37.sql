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
