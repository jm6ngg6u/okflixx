
CREATE TABLE public.user_activation_overrides (
  user_id uuid PRIMARY KEY,
  daily_limit integer NOT NULL DEFAULT 0,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activation_overrides TO authenticated;
GRANT ALL ON public.user_activation_overrides TO service_role;

ALTER TABLE public.user_activation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage user activation overrides"
  ON public.user_activation_overrides
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
