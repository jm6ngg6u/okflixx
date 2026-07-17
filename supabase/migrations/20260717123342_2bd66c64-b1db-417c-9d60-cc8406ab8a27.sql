
-- Proxy health tracking
ALTER TABLE public.proxy_pool
  ADD COLUMN IF NOT EXISTS success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score real NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz;

-- Update release_proxy to track health & auto-quarantine
CREATE OR REPLACE FUNCTION public.release_proxy(_id uuid, _success boolean, _latency_ms integer DEFAULT NULL::integer, _err text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_consec int;
  _new_success int;
  _new_fail int;
  _new_total int;
  _new_health real;
  _quarantine timestamptz;
BEGIN
  SELECT
    CASE WHEN _success THEN 0 ELSE consecutive_failures + 1 END,
    success_count + CASE WHEN _success THEN 1 ELSE 0 END,
    failure_count + CASE WHEN _success THEN 0 ELSE 1 END
    INTO _new_consec, _new_success, _new_fail
    FROM public.proxy_pool WHERE id = _id;

  _new_total := _new_success + _new_fail;
  IF _new_total > 0 THEN
    _new_health := _new_success::real / _new_total::real;
  ELSE
    _new_health := 0.5;
  END IF;

  _quarantine := CASE WHEN _new_consec >= 5 THEN now() ELSE NULL END;

  UPDATE public.proxy_pool
     SET is_locked = false,
         locked_at = NULL,
         last_used_at = now(),
         total_uses = total_uses + 1,
         last_latency_ms = COALESCE(_latency_ms, last_latency_ms),
         is_valid = CASE WHEN _success THEN true ELSE is_valid END,
         last_error = COALESCE(_err, last_error),
         success_count = _new_success,
         failure_count = _new_fail,
         consecutive_failures = _new_consec,
         health_score = _new_health,
         quarantined_at = COALESCE(quarantined_at, _quarantine)
   WHERE id = _id;
END;
$function$;

-- Update pick_next_proxy to skip quarantined and prefer healthier proxies
CREATE OR REPLACE FUNCTION public.pick_next_proxy()
 RETURNS TABLE(id uuid, scheme text, ip text, port text, username text, password text, raw text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id UUID;
BEGIN
  UPDATE public.proxy_pool p
     SET is_locked = true, locked_at = now()
   WHERE p.id = (
     SELECT p2.id FROM public.proxy_pool p2
      WHERE p2.is_valid = true
        AND p2.is_locked = false
        AND p2.quarantined_at IS NULL
      ORDER BY p2.health_score DESC, p2.last_used_at NULLS FIRST, p2.total_uses ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING p.id INTO _id;
  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT p.id, p.scheme, p.ip, p.port, p.username, p.password, p.raw
                 FROM public.proxy_pool p WHERE p.id = _id;
END;
$function$;

-- Proxy stats aggregate
CREATE OR REPLACE FUNCTION public.get_proxy_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.proxy_pool),
    'valid', (SELECT count(*) FROM public.proxy_pool WHERE is_valid = true AND quarantined_at IS NULL),
    'invalid', (SELECT count(*) FROM public.proxy_pool WHERE is_valid = false),
    'quarantined', (SELECT count(*) FROM public.proxy_pool WHERE quarantined_at IS NOT NULL),
    'never_checked', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at IS NULL),
    'checked_1h', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at > now() - interval '1 hour'),
    'avg_latency_ms', (SELECT COALESCE(round(avg(last_latency_ms))::int, 0) FROM public.proxy_pool WHERE is_valid = true AND last_latency_ms IS NOT NULL),
    'countries', (SELECT count(DISTINCT country) FROM public.proxy_pool WHERE country IS NOT NULL)
  );
$function$;

-- Un-quarantine a proxy (manual reset)
CREATE OR REPLACE FUNCTION public.unquarantine_proxy(_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.proxy_pool
     SET quarantined_at = NULL, consecutive_failures = 0
   WHERE id = _id;
$function$;

-- Enable Realtime for proxy_pool and job_runs
ALTER TABLE public.proxy_pool REPLICA IDENTITY FULL;
ALTER TABLE public.job_runs REPLICA IDENTITY FULL;

DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proxy_pool;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_runs;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
