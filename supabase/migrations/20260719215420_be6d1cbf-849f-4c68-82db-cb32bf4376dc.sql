
-- 1) Tighten app_settings public read to an allowlist of user-facing keys
DROP POLICY IF EXISTS "settings public read" ON public.app_settings;

CREATE POLICY "settings public read allowlist"
ON public.app_settings
FOR SELECT
TO public
USING (
  key LIKE 'branding_%'
  OR key LIKE 'contact_%'
  OR key LIKE 'background_song_%'
  OR key LIKE 'maintenance_%'
  OR key IN (
    'access_key_required',
    'login_required',
    'default_locale',
    'user_signup_require_verify'
  )
);

CREATE POLICY "settings authenticated read all"
ON public.app_settings
FOR SELECT
TO authenticated
USING (true);

-- 2) storage.objects policies for private `site-audio` bucket (admins only)
DROP POLICY IF EXISTS "site-audio admin select" ON storage.objects;
DROP POLICY IF EXISTS "site-audio admin insert" ON storage.objects;
DROP POLICY IF EXISTS "site-audio admin update" ON storage.objects;
DROP POLICY IF EXISTS "site-audio admin delete" ON storage.objects;

CREATE POLICY "site-audio admin select"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site-audio admin insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site-audio admin update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "site-audio admin delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'site-audio' AND public.has_role(auth.uid(), 'admin'::app_role));
