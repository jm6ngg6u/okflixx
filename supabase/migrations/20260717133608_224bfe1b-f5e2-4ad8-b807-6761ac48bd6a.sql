ALTER TABLE public.job_runs ADD COLUMN IF NOT EXISTS control text;
COMMENT ON COLUMN public.job_runs.control IS 'null | stop | cancel — set by admin to signal a running job';