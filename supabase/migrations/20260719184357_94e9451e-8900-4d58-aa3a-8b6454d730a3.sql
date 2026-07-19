
-- Access Gates & Keys audit hardening
-- 1. Revoke anon EXECUTE on sensitive RPCs. All callers use service_role (server functions),
--    so anon access is unnecessary and widens the bypass surface.
REVOKE EXECUTE ON FUNCTION public.consume_access_key(text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_recent_attempts(text, integer) FROM anon, PUBLIC;

-- 2. Add access_keys to the Realtime publication so /admin/access reflects
--    key create/disable/delete across tabs within ≤2s (in addition to 2s polling).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='access_keys'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.access_keys';
  END IF;
END $$;

-- 3. Hourly cron to purge expired public.access_sessions rows.
SELECT cron.schedule(
  'okflix-purge-access-sessions',
  '15 * * * *',
  $$SELECT public.purge_expired_access_sessions();$$
);
