REVOKE EXECUTE ON FUNCTION public.pick_next_cookie() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_cookie() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pick_next_cookie() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_next_cookie() TO service_role;