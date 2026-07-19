INSERT INTO public.app_settings(key, value)
VALUES ('cron_secret', encode(gen_random_bytes(36), 'hex'))
ON CONFLICT (key) DO UPDATE
  SET value = CASE
    WHEN public.app_settings.value IS NULL OR length(public.app_settings.value) < 32
    THEN encode(gen_random_bytes(36), 'hex')
    ELSE public.app_settings.value
  END;

DO $$
DECLARE
  _secret text;
  _base text := 'https://project--9c504117-6746-45b6-95c8-55e609b4b713-dev.lovable.app';
  _jid int;
BEGIN
  SELECT value INTO _secret FROM public.app_settings WHERE key = 'cron_secret';

  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'okflix-auto-cleanup';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule('okflix-auto-cleanup','7 4 * * *',
    format($cmd$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$cmd$,
      _base || '/api/public/hooks/auto-cleanup',
      json_build_object('Content-Type','application/json','x-cron-secret', _secret)::text));

  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'okflix-cookies-autocheck';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule('okflix-cookies-autocheck','5 * * * *',
    format($cmd$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$cmd$,
      _base || '/api/public/hooks/cookies-autocheck',
      json_build_object('Content-Type','application/json','x-cron-secret', _secret)::text));

  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'okflix-proxies-autocheck';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
  PERFORM cron.schedule('okflix-proxies-autocheck','25 * * * *',
    format($cmd$SELECT net.http_post(url:=%L, headers:=%L::jsonb, body:='{}'::jsonb);$cmd$,
      _base || '/api/public/hooks/proxies-autocheck',
      json_build_object('Content-Type','application/json','x-cron-secret', _secret)::text));
END $$;