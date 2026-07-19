
REVOKE EXECUTE ON FUNCTION public.consume_recovery_code(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_cookie_invalid(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_next_proxy() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_locks() FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_cookie(uuid, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_proxy(uuid, boolean, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_auto_cleanup() FROM anon;
