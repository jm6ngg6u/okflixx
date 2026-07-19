-- Lock down SECURITY DEFINER functions: only allow EXECUTE where actually needed.
-- Everything else is called via service_role (supabaseAdmin) or as triggers, so
-- anon/authenticated do not need EXECUTE.

-- Trigger functions — no EXECUTE needed for anyone but service_role.
REVOKE ALL ON FUNCTION public.handle_new_user_bootstrap() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_user_role_changes() FROM PUBLIC, anon, authenticated;

-- Pool selection / release / maintenance — only called from server code with service_role.
REVOKE ALL ON FUNCTION public.pick_next_cookie() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_next_cookie_by_policy(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_next_cookie_filtered(text, text[], boolean, real, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_next_proxy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cookie(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_proxy(uuid, boolean, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_cookie_invalid(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unquarantine_proxy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_stuck_locks() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_auto_cleanup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_access_sessions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.simulate_cookie_selection(text, text[], boolean, real, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_eligible_cookies(text[], boolean, real, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_bg_song_analytics() FROM PUBLIC, anon, authenticated;

-- Activation rate limiting — called with service_role from the activation server fn.
REVOKE ALL ON FUNCTION public.count_recent_attempts(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_user_recent_attempts(uuid, integer) FROM PUBLIC, anon, authenticated;

-- Access key / recovery code redemption — called with service_role.
REVOKE ALL ON FUNCTION public.consume_access_key(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_recovery_code(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Kept callable by authenticated (verified call sites use the user's supabase client):
--   has_role(uuid, app_role)          — RLS predicate + admin gate checks
--   log_admin_access_attempt(bool, text) — admin route audit log
--   list_cron_schedules()             — admin settings page (RLS-inside function only lists cron rows)
--   get_proxy_stats()                 — admin pool page
