-- Phase 2 admin agency management: staff-only, audited core-field editing + invitation listing.
-- NO hard delete; the whitelist here CANNOT change slug/id/status/is_test/pilot_status (each has its
-- own gated path). Mirrors the admin_update_agency_settings patch pattern; audits via admin_log_staff_action.

CREATE OR REPLACE FUNCTION public.admin_update_agency(p_agency_id text, p_patch jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM agencies WHERE id = p_agency_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Agency not found.');
  END IF;

  -- trading_name is required — never allow it to be blanked.
  IF p_patch ? 'trading_name' AND btrim(COALESCE(p_patch->>'trading_name','')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Trading name is required.');
  END IF;
  -- validate owner email format if a non-empty value is provided.
  IF p_patch ? 'primary_owner_email'
     AND btrim(COALESCE(p_patch->>'primary_owner_email','')) <> ''
     AND (p_patch->>'primary_owner_email') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
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

CREATE OR REPLACE FUNCTION public.admin_list_agency_invitations(p_agency_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_invites jsonb;
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'email', email, 'role', role, 'status', status,
      'created_at', created_at, 'expires_at', expires_at, 'accepted_at', accepted_at,
      'revoked_at', revoked_at, 'send_attempts', send_attempts, 'last_sent_at', last_sent_at
    ) ORDER BY created_at DESC), '[]'::jsonb) INTO v_invites
  FROM invitations WHERE agency_id = p_agency_id;
  RETURN jsonb_build_object('ok', true, 'invitations', v_invites);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_agency(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_agency_invitations(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_agency(text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_agency_invitations(text) TO authenticated, service_role;
