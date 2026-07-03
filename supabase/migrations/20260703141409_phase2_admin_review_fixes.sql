-- Phase-2 review fixes (append-only): (1) admin_update_agency — validate the TRIMMED owner email
-- so validation and storage agree; (2) capture admin_revoke_invitation's live definition (it was
-- created out-of-band and the Phase-2 revoke route now depends on it) for rebuild self-sufficiency.

CREATE OR REPLACE FUNCTION public.admin_update_agency(p_agency_id text, p_patch jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM agencies WHERE id = p_agency_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Agency not found.');
  END IF;

  IF p_patch ? 'trading_name' AND btrim(COALESCE(p_patch->>'trading_name','')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Trading name is required.');
  END IF;
  -- validate the TRIMMED email so the check agrees with what the UPDATE stores.
  IF p_patch ? 'primary_owner_email'
     AND btrim(COALESCE(p_patch->>'primary_owner_email','')) <> ''
     AND btrim(p_patch->>'primary_owner_email') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please enter a valid owner email.');
  END IF;

  UPDATE agencies SET
    legal_name          = CASE WHEN p_patch ? 'legal_name'          THEN NULLIF(btrim(p_patch->>'legal_name'),'')          ELSE legal_name END,
    trading_name        = CASE WHEN p_patch ? 'trading_name'        THEN btrim(p_patch->>'trading_name')                    ELSE trading_name END,
    cif_nif             = CASE WHEN p_patch ? 'cif_nif'             THEN NULLIF(btrim(p_patch->>'cif_nif'),'')             ELSE cif_nif END,
    primary_region      = CASE WHEN p_patch ? 'primary_region'      THEN NULLIF(btrim(p_patch->>'primary_region'),'')      ELSE primary_region END,
    primary_owner_email = CASE WHEN p_patch ? 'primary_owner_email' THEN NULLIF(btrim(p_patch->>'primary_owner_email'),'') ELSE primary_owner_email END,
    primary_owner_phone = CASE WHEN p_patch ? 'primary_owner_phone' THEN NULLIF(btrim(p_patch->>'primary_owner_phone'),'') ELSE primary_owner_phone END,
    notes               = CASE WHEN p_patch ? 'notes'               THEN NULLIF(btrim(p_patch->>'notes'),'')               ELSE notes END,
    updated_at = now()
  WHERE id = p_agency_id;

  PERFORM admin_log_staff_action(p_agency_id, 'update_agency',
    jsonb_build_object('patch_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_patch) k)));

  RETURN jsonb_build_object('ok', true, 'agency', (SELECT to_jsonb(a.*) FROM agencies a WHERE a.id = p_agency_id));
END;
$function$;

-- Capture admin_revoke_invitation (out-of-band origin) so a clean rebuild has it before the
-- Phase-2 revoke route calls it. Idempotent CREATE OR REPLACE (no-op on the live DB).
CREATE OR REPLACE FUNCTION public.admin_revoke_invitation(p_invitation_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_agency_id text;
  v_email text;
  v_already_revoked boolean;
BEGIN
  IF NOT is_aivena_staff() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT agency_id, email, (revoked_at IS NOT NULL)
  INTO v_agency_id, v_email, v_already_revoked
  FROM invitations
  WHERE id = p_invitation_id;

  IF v_agency_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invitation not found.');
  END IF;

  IF v_already_revoked THEN
    RETURN jsonb_build_object('ok', true, 'note', 'already_revoked');
  END IF;

  UPDATE invitations
  SET revoked_at = now(), status = 'revoked'
  WHERE id = p_invitation_id;

  INSERT INTO staff_audit_log (event_type, actor_user_id, target_agency_id, metadata)
  VALUES ('staff_action', auth.uid(), v_agency_id, jsonb_build_object(
    'action', 'revoke_invitation',
    'invitation_id', p_invitation_id,
    'email', v_email
  ));

  RETURN jsonb_build_object('ok', true);
END;
$function$;
