-- Fresh publish: truncate operational tables, keep auth/roles/settings/branding/uploaded tracks
TRUNCATE TABLE
  public.activation_attempts,
  public.access_key_redemptions,
  public.access_keys,
  public.access_sessions,
  public.admin_activity_log,
  public.background_song_events,
  public.branding_history,
  public.broadcasts,
  public.cookie_pool,
  public.job_runs,
  public.proxy_pool,
  public.staff_invites,
  public.user_activation_overrides
RESTART IDENTITY CASCADE;

INSERT INTO public.admin_activity_log(admin_id, actor_label, action, details)
VALUES (NULL, 'system', 'fresh_launch_reset',
  jsonb_build_object('at', now(), 'note', 'Operational tables truncated for public launch.'));