-- C3 Step 1 — controlled, admin-only writer for agencies.pilot_status (C2).
--
-- This is the ONLY path that may change pilot_status. Defense-in-depth so an
-- agency can never self-promote to 'live':
--   1. is_aivena_staff() gate inside the RPC (staff ≠ agency owner);
--   2. SECURITY DEFINER (owner = postgres) so the function can write the column
--      even after the REVOKE below removes aivena_app's column-level UPDATE;
--   3. REVOKE UPDATE(pilot_status) FROM aivena_app — the API's role can no longer
--      write the column directly, even under an agency's RLS context;
--   4. 'live' additionally requires manual-gate attestations in p_metadata (the
--      Step-2 admin endpoint supplies them after a server-side readiness recompute).
-- Go-live is never auto-flipped on computed eligibility — it is always a
-- deliberate, audited, staff action.
--
-- SAFETY: additive (a new function + a column-privilege revoke). No table/column
-- DDL, no data rewrite. Rollback = DROP FUNCTION + re-GRANT UPDATE(pilot_status).

CREATE OR REPLACE FUNCTION public.set_agency_pilot_status(
  p_agency_id text,
  p_target text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from text;
BEGIN
  -- (1) Staff-only. Agency owners / aivena_app can never reach past here.
  IF NOT is_aivena_staff() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_target NOT IN ('setup', 'ready_for_pilot', 'live', 'paused', 'blocked') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid pilot status.');
  END IF;

  SELECT pilot_status INTO v_from FROM agencies WHERE id = p_agency_id;
  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Agency not found.');
  END IF;

  -- (4) Going live needs the manual-gate attestations the endpoint supplies
  -- (autónomo / legal pages / DPA / test-data-clean) after a readiness recompute.
  IF p_target = 'live' AND NOT (p_metadata ? 'attestations') THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Go-live requires manual-gate attestations.');
  END IF;

  -- (2) Writes the column (runs as the function owner, not aivena_app).
  UPDATE agencies
     SET pilot_status = p_target,
         updated_at = now()
   WHERE id = p_agency_id;

  -- Audit — atomic with the write; records the true staff actor + transition.
  INSERT INTO staff_audit_log (event_type, actor_user_id, target_agency_id, metadata)
  VALUES ('staff_action', auth.uid(), p_agency_id,
          jsonb_build_object('action', 'set_pilot_status', 'from', v_from, 'to', p_target)
          || COALESCE(p_metadata, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'pilot_status', p_target, 'from', v_from);
END;
$function$;

-- Only authenticated (PostgREST / the Step-2 endpoint) + service_role may invoke;
-- the is_aivena_staff() gate then filters to staff. anon cannot even call it.
REVOKE ALL ON FUNCTION public.set_agency_pilot_status(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_agency_pilot_status(text, text, jsonb) TO authenticated, service_role;

-- (3) Column-restriction attempt. NOTE: this column-level REVOKE is a NO-OP on its
-- own — aivena_app holds a TABLE-level UPDATE grant that covers every column and
-- supersedes a column-level revoke (Postgres semantics; has_column_privilege stays
-- true). The EFFECTIVE restriction lands in the companion migration
-- 20260630132639_agency_pilot_status_revoke_fix.sql (revoke the table grant, then
-- re-GRANT UPDATE on every column EXCEPT pilot_status). Kept here as the as-applied
-- record; harmless on its own.
REVOKE UPDATE (pilot_status) ON public.agencies FROM aivena_app;
