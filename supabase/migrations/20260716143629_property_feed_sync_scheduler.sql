-- Feed-sync scheduler tick (Packet 3 — real-catalogue ingestion, Stage 4). APPLIED to prod as ledger
-- 20260716143629; committed to match so replay is inert. Dispatches a REAL property-sync (dry_run:false)
-- for each DUE, sync_enabled agency in agency_feed_config. Inert today (0 configured agencies).
-- SECURITY DEFINER (needs the Vault secret + net.http_post); EXECUTE locked to service_role.
--
-- ACTIVATION IS GATED and NOT performed here. When a real agency feed is approved (Stage 5), turn the
-- cron on with the one line at the bottom. Until then this function exists but nothing calls it.

CREATE OR REPLACE FUNCTION public._property_feed_sync_tick()
 RETURNS integer   -- number of agencies dispatched this tick
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_secret     text := public._get_platform_secret('PROPERTY_SYNC_INTERNAL_SECRET');
  v_rec        record;
  v_dispatched int := 0;
BEGIN
  IF v_secret IS NULL THEN RETURN 0; END IF;

  FOR v_rec IN
    SELECT agency_id, feed_url, feed_format, sync_interval_hours
    FROM public.agency_feed_config
    WHERE sync_enabled = true
      AND feed_url IS NOT NULL
      AND (last_synced_at IS NULL
           OR last_synced_at < now() - make_interval(hours => GREATEST(COALESCE(sync_interval_hours, 6), 1)))
  LOOP
    PERFORM net.http_post(
      url := 'https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/property-sync',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
      body := jsonb_build_object(
        'agency_id', v_rec.agency_id,
        'feed_url', v_rec.feed_url,
        'format', COALESCE(v_rec.feed_format, 'kyero'),
        'dry_run', false
      ),
      timeout_milliseconds := 60000
    );
    UPDATE public.agency_feed_config
       SET last_synced_at = now(), last_sync_status = 'dispatched'
     WHERE agency_id = v_rec.agency_id;
    v_dispatched := v_dispatched + 1;
  END LOOP;

  RETURN v_dispatched;
END;
$function$;

REVOKE ALL ON FUNCTION public._property_feed_sync_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._property_feed_sync_tick() TO service_role;

-- ── ACTIVATION (GATED — run only when a real agency feed is approved; NOT executed here) ──
--   SELECT cron.schedule('property-feed-sync', '*/15 * * * *', $sched$ SELECT public._property_feed_sync_tick(); $sched$);
-- To pause:  SELECT cron.unschedule('property-feed-sync');
