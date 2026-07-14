
CREATE TABLE public.activation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  user_agent text,
  code text NOT NULL,
  result text NOT NULL,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activation_attempts_ip_time_idx ON public.activation_attempts (ip_hash, created_at DESC);
CREATE INDEX activation_attempts_created_at_idx ON public.activation_attempts (created_at DESC);

GRANT ALL ON public.activation_attempts TO service_role;

ALTER TABLE public.activation_attempts ENABLE ROW LEVEL SECURITY;

-- No public policies — only service role (server code) can read/write.

-- Rate-limit helper: returns number of attempts for an IP hash in the last N minutes.
CREATE OR REPLACE FUNCTION public.count_recent_attempts(_ip_hash text, _minutes int)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.activation_attempts
  WHERE ip_hash = _ip_hash
    AND created_at > now() - (_minutes || ' minutes')::interval;
$$;
