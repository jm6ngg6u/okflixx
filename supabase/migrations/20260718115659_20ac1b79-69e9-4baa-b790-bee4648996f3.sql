-- Branding presets: named snapshots the admin can save and switch instantly.
CREATE TABLE public.branding_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branding_presets TO authenticated;
GRANT ALL ON public.branding_presets TO service_role;
ALTER TABLE public.branding_presets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage branding presets" ON public.branding_presets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Branding history: implicit snapshot before every write, powers one-click Undo.
CREATE TABLE public.branding_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data JSONB NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branding_history TO authenticated;
GRANT ALL ON public.branding_history TO service_role;
ALTER TABLE public.branding_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read+write branding history" ON public.branding_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX branding_history_created_at_idx ON public.branding_history (created_at DESC);