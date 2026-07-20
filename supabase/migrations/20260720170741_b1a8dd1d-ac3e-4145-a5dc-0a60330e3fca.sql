
UPDATE public.app_settings SET updated_by = NULL WHERE updated_by IS NOT NULL;

TRUNCATE TABLE
  public.activation_attempts,
  public.job_runs,
  public.cookie_pool,
  public.proxy_pool,
  public.access_key_redemptions,
  public.access_keys,
  public.access_sessions,
  public.user_activation_overrides,
  public.background_song_events,
  public.background_song_history,
  public.branding_history,
  public.broadcasts,
  public.admin_activity_log,
  public.admin_recovery_codes,
  public.staff_invites,
  public.user_roles,
  public.admin_profiles
RESTART IDENTITY CASCADE;

DELETE FROM auth.users;
