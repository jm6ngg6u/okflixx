CREATE OR REPLACE FUNCTION public.pick_next_cookie_filtered(
  _policy text DEFAULT 'round_robin',
  _include_statuses text[] DEFAULT ARRAY['active'],
  _require_valid boolean DEFAULT true,
  _min_success_rate real DEFAULT 0,
  _min_total_uses integer DEFAULT 0
)
RETURNS TABLE(id uuid, cookies_json jsonb, fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _id UUID;
  _p text := lower(coalesce(_policy, 'round_robin'));
BEGIN
  IF _p = 'random' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses <= _min_total_uses
            OR COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) >= _min_success_rate
          )
        ORDER BY random()
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSIF _p = 'quality' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses <= _min_total_uses
            OR COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) >= _min_success_rate
          )
        ORDER BY
          COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) DESC,
          c2.success_count DESC,
          c2.last_used_at NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSE
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = ANY(_include_statuses)
          AND (NOT _require_valid OR c2.is_valid = true)
          AND c2.is_locked = false
          AND (
            c2.total_uses <= _min_total_uses
            OR COALESCE(c2.success_count::real / NULLIF(c2.total_uses, 0), 0) >= _min_success_rate
          )
        ORDER BY c2.last_used_at NULLS FIRST, c2.total_uses ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  END IF;

  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.cookies_json, c.fingerprint FROM public.cookie_pool c WHERE c.id = _id;
END;
$function$;