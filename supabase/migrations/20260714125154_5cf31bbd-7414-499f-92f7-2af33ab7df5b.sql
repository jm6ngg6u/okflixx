
-- Revoke default PUBLIC execute on our SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_recent_attempts(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_next_cookie() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_next_proxy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_cookie(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_proxy(UUID, BOOLEAN, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_cookie_invalid(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_auto_cleanup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_bootstrap() FROM PUBLIC;

-- Grant only what's actually needed:
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_recent_attempts(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pick_next_cookie() TO service_role;
GRANT EXECUTE ON FUNCTION public.pick_next_proxy() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cookie(UUID, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_proxy(UUID, BOOLEAN, INT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_cookie_invalid(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_auto_cleanup() TO service_role;
