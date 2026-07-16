
-- Seed background song settings
INSERT INTO public.app_settings (key, value) VALUES
  ('background_song_enabled', 'true'),
  ('background_song_path', 'background.mp3'),
  ('background_song_name', 'background.mp3'),
  ('background_song_updated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;
