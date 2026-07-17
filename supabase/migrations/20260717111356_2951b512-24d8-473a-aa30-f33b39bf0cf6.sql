
CREATE OR REPLACE FUNCTION public.pick_next_cookie_by_policy(_policy text DEFAULT 'round_robin')
RETURNS TABLE(id uuid, cookies_json jsonb, fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id UUID;
  _policy_norm text := lower(coalesce(_policy, 'round_robin'));
BEGIN
  IF _policy_norm = 'random' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
        ORDER BY random()
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSIF _policy_norm = 'quality' THEN
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
        ORDER BY
          -- Higher success rate first; unused cookies get a shot at rank 0.5 so proven winners still lead.
          (c2.success_count::float / NULLIF(c2.total_uses, 0)) DESC NULLS LAST,
          c2.success_count DESC,
          c2.last_used_at NULLS FIRST
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  ELSE
    -- round_robin (default): least recently used, then fewest total uses.
    UPDATE public.cookie_pool c
       SET is_locked = true, locked_at = now()
     WHERE c.id = (
       SELECT c2.id FROM public.cookie_pool c2
        WHERE c2.status = 'active' AND c2.is_valid = true AND c2.is_locked = false
        ORDER BY c2.last_used_at NULLS FIRST, c2.total_uses ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING c.id INTO _id;
  END IF;

  IF _id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT c.id, c.cookies_json, c.fingerprint FROM public.cookie_pool c WHERE c.id = _id;
END;
$$;

-- Seed default policy so the settings screen has a value on first load.
INSERT INTO public.app_settings(key, value)
VALUES ('cookie_rotation_policy', 'round_robin')
ON CONFLICT (key) DO NOTHING;
