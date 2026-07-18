
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
