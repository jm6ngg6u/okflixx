
ALTER TABLE public.activation_attempts
  ADD COLUMN IF NOT EXISTS selection_reason jsonb;

CREATE OR REPLACE FUNCTION public.simulate_cookie_selection(
  _policy text DEFAULT 'round_robin',
  _include_statuses text[] DEFAULT ARRAY['active']::text[],
  _require_valid boolean DEFAULT true,
  _min_success_rate real DEFAULT 0,
  _min_total_uses int DEFAULT 0,
  _limit int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p text := lower(coalesce(_policy, 'round_robin'));
  _total int;
  _skipped_status int;
  _skipped_invalid int;
  _skipped_locked int;
  _skipped_success int;
  _eligible int;
  _winner jsonb;
  _preview jsonb;
BEGIN
  SELECT COUNT(*) INTO _total FROM public.cookie_pool;

  SELECT COUNT(*) INTO _skipped_status
    FROM public.cookie_pool WHERE NOT (status = ANY(_include_statuses));

  SELECT COUNT(*) INTO _skipped_invalid
    FROM public.cookie_pool
   WHERE status = ANY(_include_statuses)
     AND _require_valid AND is_valid = false;

  SELECT COUNT(*) INTO _skipped_locked
    FROM public.cookie_pool
   WHERE status = ANY(_include_statuses)
     AND (NOT _require_valid OR is_valid = true)
     AND is_locked = true;

  SELECT COUNT(*) INTO _skipped_success
    FROM public.cookie_pool c
   WHERE c.status = ANY(_include_statuses)
     AND (NOT _require_valid OR c.is_valid = true)
     AND c.is_locked = false
     AND NOT (
       c.total_uses < _min_total_uses
       OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
     );

  SELECT COUNT(*) INTO _eligible
    FROM public.cookie_pool c
   WHERE c.status = ANY(_include_statuses)
     AND (NOT _require_valid OR c.is_valid = true)
     AND c.is_locked = false
     AND (
       c.total_uses < _min_total_uses
       OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
     );

  -- Build ordered preview list per policy.
  WITH candidates AS (
    SELECT
      c.id, c.email, c.country, c.status, c.is_valid,
      c.total_uses, c.success_count, c.fail_count,
      c.last_used_at, c.last_checked_at,
      CASE WHEN c.total_uses > 0
           THEN (c.success_count::real / c.total_uses)
           ELSE NULL END AS success_rate
      FROM public.cookie_pool c
     WHERE c.status = ANY(_include_statuses)
       AND (NOT _require_valid OR c.is_valid = true)
       AND c.is_locked = false
       AND (
         c.total_uses < _min_total_uses
         OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
       )
  ),
  ordered AS (
    SELECT *,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN _p = 'quality'
               THEN (success_count::real / NULLIF(total_uses, 0)) END DESC NULLS LAST,
          CASE WHEN _p = 'quality' THEN success_count END DESC,
          CASE WHEN _p = 'random' THEN random() END,
          last_used_at NULLS FIRST,
          total_uses ASC
      ) AS rn
      FROM candidates
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'email', email,
    'country', country,
    'status', status,
    'is_valid', is_valid,
    'total_uses', total_uses,
    'success_count', success_count,
    'fail_count', fail_count,
    'success_rate', success_rate,
    'last_used_at', last_used_at,
    'rank', rn
  ) ORDER BY rn)
    INTO _preview
    FROM ordered
   WHERE rn <= _limit;

  SELECT jsonb_build_object(
    'id', id, 'email', email, 'country', country,
    'total_uses', total_uses, 'success_count', success_count,
    'success_rate', success_rate, 'last_used_at', last_used_at
  ) INTO _winner
    FROM (
      SELECT * FROM public.cookie_pool c
       WHERE c.status = ANY(_include_statuses)
         AND (NOT _require_valid OR c.is_valid = true)
         AND c.is_locked = false
         AND (
           c.total_uses < _min_total_uses
           OR (c.success_count::real / NULLIF(c.total_uses, 0)) >= _min_success_rate
         )
       ORDER BY
         CASE WHEN _p = 'quality'
              THEN (c.success_count::real / NULLIF(c.total_uses, 0)) END DESC NULLS LAST,
         CASE WHEN _p = 'quality' THEN c.success_count END DESC,
         CASE WHEN _p = 'random' THEN random() END,
         c.last_used_at NULLS FIRST,
         c.total_uses ASC
       LIMIT 1
    ) t
   CROSS JOIN LATERAL (
     SELECT CASE WHEN t.total_uses > 0
                 THEN (t.success_count::real / t.total_uses) END AS success_rate
   ) sr;

  RETURN jsonb_build_object(
    'policy', _p,
    'total', _total,
    'eligible', _eligible,
    'skipped', jsonb_build_object(
      'wrong_status', _skipped_status,
      'invalid_flag', _skipped_invalid,
      'currently_locked', _skipped_locked,
      'low_success_rate', _skipped_success
    ),
    'winner', _winner,
    'preview', COALESCE(_preview, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.simulate_cookie_selection(text, text[], boolean, real, int, int) TO authenticated, service_role;
