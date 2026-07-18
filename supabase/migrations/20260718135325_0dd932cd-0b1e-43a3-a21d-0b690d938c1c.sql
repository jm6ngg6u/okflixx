
-- Enable Realtime for app_settings so the public site can react to
-- maintenance / gate changes instantly without polling.
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
  END IF;
END $$;

-- Seed default rows for the two scheduling keys so upserts stay idempotent
-- and the admin UI can render them without a race.
INSERT INTO public.app_settings(key, value)
VALUES
  ('maintenance_starts_at', ''),
  ('maintenance_ends_at', '')
ON CONFLICT (key) DO NOTHING;
