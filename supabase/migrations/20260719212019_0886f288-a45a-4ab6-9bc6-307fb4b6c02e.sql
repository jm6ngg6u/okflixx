
-- Operational wipe
TRUNCATE TABLE
  public.activation_attempts,
  public.access_key_redemptions,
  public.access_keys,
  public.access_sessions,
  public.admin_activity_log,
  public.background_song_events,
  public.background_song_history,
  public.branding_history,
  public.broadcasts,
  public.cookie_pool,
  public.proxy_pool,
  public.job_runs,
  public.user_activation_overrides,
  public.staff_invites,
  public.admin_recovery_codes,
  public.user_roles,
  public.admin_profiles
RESTART IDENTITY CASCADE;

-- Delete all auth users (cascades via handle_new_user_bootstrap dependencies already truncated above)
DELETE FROM auth.users;
