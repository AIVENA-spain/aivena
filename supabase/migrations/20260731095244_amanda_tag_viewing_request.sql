-- Amanda Phase B — tag a captured lead's pending Inbox task as a VIEWING REQUEST.
--
-- A website viewing request is NEVER a booking: no calendar write, no confirmation,
-- no send. After amanda_capture_lead has created the lead + its pending
-- suggested_reply task (Phase A, unchanged), the route calls this to tag that task
-- with raw_payload.kind='viewing_request' (+ the specific listing, if named) so the
-- agent sees it as a viewing request and books it themselves via the existing
-- agent-authenticated booking flow. Reuses the existing task structure — no new
-- task_type. SECURITY DEFINER, is_test-gated, slug-scoped, aivena_app + service_role.
CREATE OR REPLACE FUNCTION public.amanda_tag_viewing_request(
  p_agency_slug   text,
  p_session_token text,
  p_property_ref  text    DEFAULT NULL,
  p_require_test  boolean DEFAULT true,
  OUT ok       boolean,
  OUT task_id  uuid
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency text;
  v_is_test boolean;
  v_token  text := nullif(btrim(p_session_token), '');
  v_ref    text := nullif(btrim(p_property_ref), '');
  v_lead   uuid;
  v_prop   uuid;
  v_task   uuid;
BEGIN
  SELECT a.id, a.is_test INTO v_agency, v_is_test FROM public.agencies a WHERE a.slug = p_agency_slug;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'agency_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_require_test AND NOT coalesce(v_is_test, false) THEN
    RAISE EXCEPTION 'agency_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_token IS NULL THEN RAISE EXCEPTION 'session_required' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('app.current_agency_id', v_agency, true);

  -- The captured lead for this session (amanda_capture_lead marked the session).
  SELECT s.lead_id INTO v_lead FROM public.chat_sessions s
  WHERE s.agency_id = v_agency AND s.session_token = v_token;
  IF v_lead IS NULL THEN ok := false; RETURN; END IF;

  -- Resolve the specific listing (active only), if a reference was given.
  IF v_ref IS NOT NULL THEN
    SELECT p.id INTO v_prop FROM public.properties p
    WHERE p.agency_id = v_agency AND p.status = 'active' AND upper(p.external_id) = upper(v_ref)
    LIMIT 1;
  END IF;

  -- Tag the lead's pending Inbox task (the one amanda_capture_lead just created).
  UPDATE public.dashboard_tasks dt SET
    raw_payload = coalesce(dt.raw_payload, '{}'::jsonb)
                  || jsonb_build_object('kind', 'viewing_request', 'property_ref', v_ref, 'property_id', v_prop),
    updated_at = now()
  WHERE dt.lead_id = v_lead AND dt.agency_id = v_agency
    AND dt.task_type = 'suggested_reply' AND dt.status = 'pending'
  RETURNING dt.id INTO v_task;

  ok := v_task IS NOT NULL;
  task_id := v_task;
END;
$function$;

REVOKE ALL ON FUNCTION public.amanda_tag_viewing_request(text,text,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.amanda_tag_viewing_request(text,text,text,boolean) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.amanda_tag_viewing_request(text,text,text,boolean) TO aivena_app, service_role;
