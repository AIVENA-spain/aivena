-- C6 (2026-07-02): harden set_agency_pilot_status so target='live' requires all four
-- manual attestations to be explicitly TRUE, not merely that the `attestations` key is
-- present. Surfaced by the C4 adversarial review: the prior gate `p_metadata ? 'attestations'`
-- passed trivially because the endpoint always injects the key for live. Full enforcement
-- also lives in the endpoint's evaluateGoLive; this makes the SECURITY DEFINER writer
-- (the sole writer of agencies.pilot_status) honestly enforce its own contract.
--
-- Only the go-live gate block changes; the is_aivena_staff() gate, target validation,
-- UPDATE, audit insert, and grants are unchanged. Non-destructive, reversible (re-apply
-- the presence-only gate). No schema or data change.
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

  -- HARDENED: require every manual attestation to be explicitly true (was: key-present only).
  IF p_target = 'live' AND NOT (
        COALESCE((p_metadata -> 'attestations' ->> 'autonomo_corrected')::boolean, false)
    AND COALESCE((p_metadata -> 'attestations' ->> 'legal_pages_published')::boolean, false)
    AND COALESCE((p_metadata -> 'attestations' ->> 'dpa_consent_live')::boolean, false)
    AND COALESCE((p_metadata -> 'attestations' ->> 'test_data_cleaned')::boolean, false)
  ) THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Go-live requires all four manual-gate attestations to be confirmed.');
  END IF;

  UPDATE agencies
     SET pilot_status = p_target,
         updated_at = now()
   WHERE id = p_agency_id;

  INSERT INTO staff_audit_log (event_type, actor_user_id, target_agency_id, metadata)
  VALUES ('staff_action', auth.uid(), p_agency_id,
          jsonb_build_object('action', 'set_pilot_status', 'from', v_from, 'to', p_target)
          || COALESCE(p_metadata, '{}'::jsonb));

  RETURN jsonb_build_object('ok', true, 'pilot_status', p_target, 'from', v_from);
END;
$function$;
