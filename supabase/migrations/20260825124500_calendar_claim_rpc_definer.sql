-- W11-lite calendar sync: make the claim RPC callable by the API worker (2026-08-25).
--
-- WHY: pick_and_claim_pending_calendar_syncs was built for the n8n watcher, which
-- called it as `postgres` (BYPASSRLS). The sync worker now runs inside the Hono API
-- as `aivena_app`, which does NOT bypass RLS — and bookings has FORCED RLS fenced by
-- app.current_agency_id. The claim is inherently CROSS-AGENCY (it drains every
-- agency's pending syncs), so as SECURITY INVOKER it returns zero rows for
-- aivena_app and the worker is a silent no-op.
--
-- FIX: recreate the function byte-identical except SECURITY DEFINER (owner postgres,
-- search_path already pinned), and lock EXECUTE down to aivena_app + service_role
-- (REVOKE from PUBLIC/anon/authenticated — the 2026-07-04 DEFINER-audit lesson).
-- The four mark_booking_calendar_* RPCs stay SECURITY INVOKER: the worker calls them
-- inside withAgency (per-agency GUC context), which forced RLS permits.
--
-- Rollback: recreate without SECURITY DEFINER (definition below, drop that clause)
-- and re-grant as before.

CREATE OR REPLACE FUNCTION public.pick_and_claim_pending_calendar_syncs(p_limit integer DEFAULT 50)
 RETURNS TABLE(booking_id uuid, agency_id text, lead_id uuid, property_id uuid, scheduled_at timestamp with time zone, duration_minutes integer, location text, notes text, attempts_after_claim integer, booking_raw_payload jsonb, lead_full_name text, lead_language text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH to_claim AS (
    SELECT b.id
    FROM public.bookings b
    WHERE b.calendar_sync_status = 'pending'
       OR (b.calendar_sync_status = 'failed_transient'
           AND (b.calendar_sync_next_retry_at IS NULL
                OR b.calendar_sync_next_retry_at <= now()))
    ORDER BY b.created_at ASC
    LIMIT p_limit
    FOR UPDATE OF b SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.bookings b
    SET calendar_sync_status = 'syncing',
        calendar_sync_attempts = b.calendar_sync_attempts + 1,
        calendar_sync_next_retry_at = NULL,  -- clear, will be re-set on transient fail
        updated_at = now()
    WHERE b.id IN (SELECT id FROM to_claim)
    RETURNING b.id, b.agency_id, b.lead_id, b.property_id, b.scheduled_at,
              b.duration_minutes, b.location, b.notes,
              b.calendar_sync_attempts, b.raw_payload
  )
  SELECT c.id, c.agency_id, c.lead_id, c.property_id, c.scheduled_at,
         c.duration_minutes, c.location, c.notes,
         c.calendar_sync_attempts, c.raw_payload,
         l.full_name, COALESCE(l.language, 'en')
  FROM claimed c
  LEFT JOIN public.leads l ON l.id = c.lead_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pick_and_claim_pending_calendar_syncs(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_pending_calendar_syncs(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_pending_calendar_syncs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_pending_calendar_syncs(integer) TO aivena_app;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_pending_calendar_syncs(integer) TO service_role;
