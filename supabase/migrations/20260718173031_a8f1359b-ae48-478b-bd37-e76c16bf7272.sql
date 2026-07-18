
ALTER TABLE public.background_song_events
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS muted boolean,
  ADD COLUMN IF NOT EXISTS needs_gesture boolean,
  ADD COLUMN IF NOT EXISTS silent boolean,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS ip_hash text;

CREATE INDEX IF NOT EXISTS background_song_events_status_time_idx
  ON public.background_song_events (status, created_at DESC);
