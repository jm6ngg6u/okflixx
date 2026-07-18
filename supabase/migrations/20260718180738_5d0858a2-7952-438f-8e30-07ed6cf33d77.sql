
CREATE OR REPLACE FUNCTION public.get_bg_song_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _now timestamptz := now();
  _24h timestamptz := _now - interval '24 hours';
  _48h timestamptz := _now - interval '48 hours';
  _7d  timestamptz := _now - interval '7 days';
  _kinds text[] := ARRAY['impression','autoplay','unmute','tap_play','out_of_schedule','silence_detected'];
  _t24 jsonb := '{}'::jsonb;
  _t7d jsonb := '{}'::jsonb;
  _prev24 jsonb := '{}'::jsonb;
  _k text;
  _c bigint;
  _u24 bigint;
  _u7d bigint;
  _last timestamptz;
BEGIN
  FOREACH _k IN ARRAY _kinds LOOP
    SELECT count(*) INTO _c FROM public.background_song_events
      WHERE event_type = _k AND created_at >= _24h;
    _t24 := _t24 || jsonb_build_object(_k, _c);

    SELECT count(*) INTO _c FROM public.background_song_events
      WHERE event_type = _k AND created_at >= _7d;
    _t7d := _t7d || jsonb_build_object(_k, _c);

    SELECT count(*) INTO _c FROM public.background_song_events
      WHERE event_type = _k AND created_at >= _48h AND created_at < _24h;
    _prev24 := _prev24 || jsonb_build_object(_k, _c);
  END LOOP;

  SELECT count(DISTINCT session_hash) INTO _u24 FROM public.background_song_events
    WHERE created_at >= _24h AND session_hash IS NOT NULL;
  SELECT count(DISTINCT session_hash) INTO _u7d FROM public.background_song_events
    WHERE created_at >= _7d AND session_hash IS NOT NULL;

  SELECT max(created_at) INTO _last FROM public.background_song_events;

  RETURN jsonb_build_object(
    'total24h', _t24,
    'total7d', _t7d,
    'prev24h', _prev24,
    'unique24h', _u24,
    'unique7d', _u7d,
    'lastEventAt', _last,
    'generatedAt', _now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bg_song_analytics() TO authenticated, service_role;
