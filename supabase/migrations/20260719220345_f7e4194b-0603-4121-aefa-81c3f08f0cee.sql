REVOKE ALL ON FUNCTION public.list_cron_schedules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_proxy_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_admin_access_attempt(boolean, text) FROM PUBLIC, anon, authenticated;