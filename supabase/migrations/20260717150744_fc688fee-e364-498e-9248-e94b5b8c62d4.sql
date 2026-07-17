-- Login gate: track which user made each activation and enforce per-user daily limit.
ALTER TABLE public.activation_attempts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS aa_user_created_idx
  ON public.activation_attempts(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Per-user rate limit RPC.
CREATE OR REPLACE FUNCTION public.count_user_recent_attempts(_user_id UUID, _minutes INT)
RETURNS INT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::INT FROM public.activation_attempts
   WHERE user_id = _user_id
     AND created_at > now() - (_minutes || ' minutes')::INTERVAL
$$;

-- Seed default settings (idempotent).
INSERT INTO public.app_settings(key, value) VALUES
  ('user_daily_activation_limit', '10'),
  ('user_signup_require_verify', '1')
ON CONFLICT (key) DO NOTHING;