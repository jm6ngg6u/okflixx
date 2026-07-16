
-- Default rows for new settings keys.
insert into public.app_settings (key, value, updated_at) values
  ('background_song_schedule_enabled', 'false', now()),
  ('background_song_schedule_start', '00:00', now()),
  ('background_song_schedule_end', '23:59', now()),
  ('background_song_intensity', '1.0', now()),
  ('background_song_sensitivity', '1.0', now()),
  ('background_song_track_title', '', now())
on conflict (key) do nothing;

-- Uploaded-song history.
create table public.background_song_history (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  name text not null,
  size_bytes bigint not null default 0,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  is_current boolean not null default false
);

grant select, insert, update, delete on public.background_song_history to authenticated;
grant all on public.background_song_history to service_role;

alter table public.background_song_history enable row level security;

create policy "Admins view song history"
  on public.background_song_history for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins manage song history"
  on public.background_song_history for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create index background_song_history_uploaded_at_idx
  on public.background_song_history (uploaded_at desc);

-- Lightweight analytics events.
create table public.background_song_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  session_hash text,
  created_at timestamptz not null default now()
);

grant select on public.background_song_events to authenticated;
grant all on public.background_song_events to service_role;

alter table public.background_song_events enable row level security;

create policy "Admins read song events"
  on public.background_song_events for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create index background_song_events_created_at_idx
  on public.background_song_events (created_at desc);

create index background_song_events_type_time_idx
  on public.background_song_events (event_type, created_at desc);
