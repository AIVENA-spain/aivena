-- Phase 1 admin agency management RPCs (staff-only, audited, NO hard delete).
-- All gated by is_aivena_staff(); all writes go through these SECURITY DEFINER fns only.

-- (1) admin_list_agencies: expose is_test so the dashboard can hide test rows by server truth.
CREATE OR REPLACE FUNCTION public.admin_list_agencies(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_agencies jsonb;
BEGIN
  IF NOT is_aivena_staff() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'created_at') DESC), '[]'::jsonb)
  INTO v_agencies
  FROM (
    SELECT jsonb_build_object(
      'id', a.id,
      'slug', a.slug,
      'trading_name', a.trading_name,
      'legal_name', a.legal_name,
      'status', a.status,
      'is_test', a.is_test,
      'plan_tier', s.plan_tier,
      'default_language', s.default_language,
      'primary_owner_email', a.primary_owner_email,
      'primary_region', a.primary_region,
      'user_count', (SELECT COUNT(*) FROM user_agencies WHERE agency_id = a.id),
      'pending_invitation_count', (
        SELECT COUNT(*) FROM invitations
        WHERE agency_id = a.id AND status = 'pending' AND revoked_at IS NULL AND expires_at > now()
      ),
      'created_at', a.created_at,
      'updated_at', a.updated_at
    ) AS row
    FROM agencies a
    LEFT JOIN agency_settings s ON s.agency_id = a.id
    WHERE (p_status IS NULL OR a.status = p_status)
      AND (p_search IS NULL OR p_search = ''
           OR a.slug ILIKE '%' || p_search || '%'
           OR a.trading_name ILIKE '%' || p_search || '%'
           OR a.legal_name ILIKE '%' || p_search || '%'
           OR COALESCE(a.primary_owner_email, '') ILIKE '%' || p_search || '%')
  ) sub;

  RETURN jsonb_build_object('ok', true, 'agencies', v_agencies);
END;
$function$;

-- (2) admin_set_agency_status: soft archive/restore via status (NO delete). Blocks archiving a
-- live agency; a non-test agency requires the slug typed back (strong confirm). Reason required.
CREATE OR REPLACE FUNCTION public.admin_set_agency_status(
  p_agency_id text, p_status text, p_reason text, p_confirm_slug text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_from text; v_pilot text; v_slug text; v_is_test boolean;
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('active','paused','archived') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid status.');
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A reason is required.');
  END IF;
  SELECT status, pilot_status, slug, is_test INTO v_from, v_pilot, v_slug, v_is_test
    FROM agencies WHERE id = p_agency_id;
  IF v_from IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Agency not found.'); END IF;

  IF p_status = 'archived' THEN
    IF v_pilot = 'live' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Cannot archive a live agency — set it to paused or blocked first.');
    END IF;
    IF NOT v_is_test AND (p_confirm_slug IS DISTINCT FROM v_slug) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'To archive a non-test agency, confirm by typing its identifier exactly.');
    END IF;
  END IF;

  UPDATE agencies SET status = p_status, updated_at = now() WHERE id = p_agency_id;
  PERFORM admin_log_staff_action(p_agency_id, 'set_agency_status',
    jsonb_build_object('from', v_from, 'to', p_status, 'reason', btrim(p_reason), 'is_test', v_is_test));
  RETURN jsonb_build_object('ok', true, 'status', p_status, 'from', v_from);
END;
$function$;

-- (3) admin_set_agency_test_flag: mark/unmark test (server truth), audited.
CREATE OR REPLACE FUNCTION public.admin_set_agency_test_flag(
  p_agency_id text, p_is_test boolean, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_from boolean;
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT is_test INTO v_from FROM agencies WHERE id = p_agency_id;
  IF v_from IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Agency not found.'); END IF;
  UPDATE agencies SET is_test = p_is_test, updated_at = now() WHERE id = p_agency_id;
  PERFORM admin_log_staff_action(p_agency_id, 'set_test_flag',
    jsonb_build_object('from', v_from, 'to', p_is_test, 'reason', NULLIF(btrim(COALESCE(p_reason,'')), '')));
  RETURN jsonb_build_object('ok', true, 'is_test', p_is_test);
END;
$function$;

-- (4) admin_list_agency_audit: read the staff_audit_log history for one agency (staff-only).
CREATE OR REPLACE FUNCTION public.admin_list_agency_audit(p_agency_id text, p_limit int DEFAULT 100)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_entries jsonb;
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'created_at') DESC), '[]'::jsonb) INTO v_entries
  FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'created_at', l.created_at,
      'actor_email', u.email,
      'event_type', l.event_type,
      'action', l.metadata->>'action',
      'metadata', l.metadata
    ) AS e
    FROM staff_audit_log l
    LEFT JOIN auth.users u ON u.id = l.actor_user_id
    WHERE l.target_agency_id = p_agency_id
    ORDER BY l.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500))
  ) sub;
  RETURN jsonb_build_object('ok', true, 'entries', v_entries);
END;
$function$;

-- Grants — mirror the staff-gated admin RPC posture (called via the caller's JWT = authenticated).
REVOKE ALL ON FUNCTION public.admin_set_agency_status(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_agency_test_flag(text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_agency_audit(text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_agency_status(text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_agency_test_flag(text,boolean,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_agency_audit(text,int) TO authenticated, service_role;
