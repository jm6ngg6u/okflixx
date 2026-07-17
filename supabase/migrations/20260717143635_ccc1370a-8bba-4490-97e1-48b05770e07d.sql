create table if not exists public.captcha_verify_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  purpose text not null default 'activate',
  success boolean not null,
  error_codes text[] not null default '{}',
  reason text,
  http_status int,
  latency_ms int,
  token_length int,
  token_prefix text,
  hostname text,
  challenge_ts timestamptz,
  ip_hash text,
  user_agent text
);
create index if not exists captcha_verify_log_created_idx on public.captcha_verify_log (created_at desc);
create index if not exists captcha_verify_log_success_idx on public.captcha_verify_log (success, created_at desc);
grant select, insert on public.captcha_verify_log to authenticated;
grant all on public.captcha_verify_log to service_role;
alter table public.captcha_verify_log enable row level security;
drop policy if exists "admins read captcha logs" on public.captcha_verify_log;
create policy "admins read captcha logs" on public.captcha_verify_log
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));