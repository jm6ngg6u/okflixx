
REVOKE EXECUTE ON FUNCTION public.count_recent_attempts(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_recent_attempts(text, int) TO service_role;
