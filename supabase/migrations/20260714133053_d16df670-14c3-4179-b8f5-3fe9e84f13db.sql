CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_admin_access_attempt(_allowed boolean, _path text DEFAULT '/admin')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _email text := auth.jwt() ->> 'email';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
  VALUES (
    auth.uid(),
    COALESCE(_email, auth.uid()::text),
    'admin_access_attempt',
    _path,
    jsonb_build_object(
      'email', _email,
      'allowed', _allowed,
      'path', _path,
      'user_id', auth.uid()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_admin_access_attempt(boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_email text;
  _actor_email text := auth.jwt() ->> 'email';
  _action text;
BEGIN
  SELECT email INTO _target_email
  FROM auth.users
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  IF TG_OP = 'INSERT' THEN
    _action := 'role_granted';
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
    VALUES (
      auth.uid(),
      COALESCE(_actor_email, auth.uid()::text, 'system'),
      _action,
      COALESCE(_target_email, NEW.user_id::text),
      jsonb_build_object(
        'target_email', _target_email,
        'target_user_id', NEW.user_id,
        'role', NEW.role,
        'actor_email', _actor_email
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    _action := 'role_changed';
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
    VALUES (
      auth.uid(),
      COALESCE(_actor_email, auth.uid()::text, 'system'),
      _action,
      COALESCE(_target_email, NEW.user_id::text),
      jsonb_build_object(
        'target_email', _target_email,
        'target_user_id', NEW.user_id,
        'old_role', OLD.role,
        'new_role', NEW.role,
        'actor_email', _actor_email
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    _action := 'role_removed';
    INSERT INTO public.admin_activity_log(admin_id, actor_label, action, target, details)
    VALUES (
      auth.uid(),
      COALESCE(_actor_email, auth.uid()::text, 'system'),
      _action,
      COALESCE(_target_email, OLD.user_id::text),
      jsonb_build_object(
        'target_email', _target_email,
        'target_user_id', OLD.user_id,
        'role', OLD.role,
        'actor_email', _actor_email
      )
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_role_changes ON public.user_roles;
CREATE TRIGGER trg_audit_user_role_changes
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.audit_user_role_changes();