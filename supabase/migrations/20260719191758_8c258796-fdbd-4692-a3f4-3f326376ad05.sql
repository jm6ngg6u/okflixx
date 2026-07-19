-- Harden Two-factor: enable realtime + explicit grants for recovery codes
GRANT SELECT, DELETE ON public.admin_recovery_codes TO authenticated;
GRANT ALL ON public.admin_recovery_codes TO service_role;
REVOKE ALL ON public.admin_recovery_codes FROM anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='admin_recovery_codes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_recovery_codes;
  END IF;
END $$;