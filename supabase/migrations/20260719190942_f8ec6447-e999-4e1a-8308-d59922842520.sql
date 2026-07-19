-- Harden Staff & Roles: least-privilege for anon, prevent duplicate pending invites, enable realtime.
REVOKE ALL ON public.user_roles FROM anon;
REVOKE ALL ON public.staff_invites FROM anon;

CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_pending_email_uniq
  ON public.staff_invites (lower(email))
  WHERE used_at IS NULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_invites;