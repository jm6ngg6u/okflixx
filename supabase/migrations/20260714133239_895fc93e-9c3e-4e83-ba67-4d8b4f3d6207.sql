REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_admin_access_attempt(boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_admin_access_attempt(boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.audit_user_role_changes() FROM PUBLIC;