-- Null out FK references to auth.users so we can delete them
UPDATE public.app_settings SET updated_by = NULL WHERE updated_by IS NOT NULL;
UPDATE public.branding_presets SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE public.background_song_history SET uploaded_by = NULL WHERE uploaded_by IS NOT NULL;
UPDATE public.admin_activity_log SET admin_id = NULL WHERE admin_id IS NOT NULL;

-- Wipe admin/staff app data
DELETE FROM public.admin_recovery_codes;
DELETE FROM public.staff_invites;
DELETE FROM public.user_roles;
DELETE FROM public.admin_profiles;

-- Wipe auth users
DELETE FROM auth.users;

INSERT INTO public.admin_activity_log(admin_id, actor_label, action, details)
VALUES (NULL, 'system', 'fresh_admin_reset',
  jsonb_build_object('at', now(), 'note', 'All admins/users purged; next Google sign-in becomes first admin.'));