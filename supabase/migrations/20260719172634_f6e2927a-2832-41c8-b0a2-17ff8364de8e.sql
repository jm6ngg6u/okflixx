
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
