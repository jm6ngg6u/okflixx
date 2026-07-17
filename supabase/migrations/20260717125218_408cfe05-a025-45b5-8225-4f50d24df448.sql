
CREATE OR REPLACE FUNCTION public.get_proxy_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.proxy_pool),
    'valid', (SELECT count(*) FROM public.proxy_pool
               WHERE is_valid = true AND quarantined_at IS NULL AND last_checked_at IS NOT NULL),
    'invalid', (SELECT count(*) FROM public.proxy_pool
                 WHERE is_valid = false AND last_checked_at IS NOT NULL AND quarantined_at IS NULL),
    'quarantined', (SELECT count(*) FROM public.proxy_pool WHERE quarantined_at IS NOT NULL),
    'never_checked', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at IS NULL),
    'checked_1h', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at > now() - interval '1 hour'),
    'checked_24h', (SELECT count(*) FROM public.proxy_pool WHERE last_checked_at > now() - interval '24 hours'),
    'stuck_locked', (SELECT count(*) FROM public.proxy_pool
                      WHERE is_locked = true AND locked_at < now() - interval '5 minutes'),
    'avg_latency_ms', (SELECT COALESCE(round(avg(last_latency_ms))::int, 0)
                        FROM public.proxy_pool WHERE is_valid = true AND last_latency_ms IS NOT NULL),
    'avg_health', (SELECT COALESCE(round(avg(health_score)::numeric, 3), 0)
                    FROM public.proxy_pool WHERE last_checked_at IS NOT NULL),
    'countries', (SELECT count(DISTINCT country) FROM public.proxy_pool WHERE country IS NOT NULL),
    'schemes', (SELECT jsonb_object_agg(scheme, cnt) FROM (
                  SELECT scheme, count(*) AS cnt FROM public.proxy_pool GROUP BY scheme
                ) s)
  );
$function$;
