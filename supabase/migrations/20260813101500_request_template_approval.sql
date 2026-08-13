-- request_template_approval(p_lead_id) — record an INTERNAL request that the
-- AIVENA team approve the lead-language check-in template for this lead.
--
-- WHY (2026-08-13): the AIVENA Brief's "Recommended next step" card offers a
-- "Request template" action for a lead whose WhatsApp window is closed and whose
-- language has no approved check-in template (the Marte case). Clicking it must
-- do something REAL and SAFE: it records an internal task + audit event that the
-- AIVENA team (who manage template approval during pilot) can action. It NEVER
-- submits anything to Meta/Twilio and never mutates template/provider state —
-- that lives in the separate, aivena_app-revoked apply_template_provider_status
-- RPC, which this does not call.
--
-- Safety: writes ONLY public.dashboard_tasks + public.lead_events (both agency-
-- RLS-fenced). SECURITY DEFINER, agency-fenced by the app.current_agency_id GUC
-- (verifies the lead belongs to the caller's agency), viewer-blocked via
-- require_role('agent'). Deduplicated: a second click while a request is already
-- pending is a safe no-op (returns ok:true, deduped:true).
--
-- Rollback: DROP FUNCTION public.request_template_approval(uuid);
-- (Nothing depends on it; dropping restores the exact pre-migration state. The
--  rows it may create are ordinary dashboard_tasks/lead_events, harmless if left.)

CREATE OR REPLACE FUNCTION public.request_template_approval(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency   text := nullif(btrim(current_setting('app.current_agency_id', true)), '');
  v_lead     leads%ROWTYPE;
  v_lang     text;
  v_lang_disp text;
  v_task_id  uuid;
  c_key      constant text := 'agency_followup_v1';
BEGIN
  IF v_agency IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  -- Viewer-blocked: only an agent+ may raise an internal request. Uses the
  -- app.current_user_role GUC set per-request by agencyContextMiddleware.
  PERFORM public.require_role('agent'::public.agency_role);

  -- Agency-fenced lead lookup (defense-in-depth on top of RLS).
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id AND agency_id = v_agency;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  -- Normalize the lead's language the same way the send path does (no→nb, etc.),
  -- recorded so the AIVENA team knows which template language to approve.
  v_lang := CASE lower(regexp_replace(coalesce(v_lead.language, ''), '^\s+|\s+$', '', 'g'))
    WHEN 'no' THEN 'nb' WHEN 'nn' THEN 'nb' WHEN 'nob' THEN 'nb' WHEN 'nb_no' THEN 'nb'
    WHEN '' THEN 'en'
    ELSE lower(regexp_replace(v_lead.language, '^\s+|\s+$', '', 'g'))
  END;
  -- Display form for human-readable prose: only embed a value that looks like a
  -- real language code; otherwise a generic label (never lead-influenced free
  -- text into the task description). The raw code still goes in raw_payload.
  v_lang_disp := CASE WHEN v_lang ~ '^[a-z][a-z0-9_-]{1,9}$' THEN v_lang ELSE 'the lead''s' END;

  -- Serialize check-then-insert for this (agency, lead, language) so two
  -- concurrent clicks (double-click / retry / two tabs) can't both pass the
  -- EXISTS check and stack duplicate tasks. Transaction-scoped; released at commit.
  PERFORM pg_advisory_xact_lock(hashtext('template_approval:' || v_agency || ':' || p_lead_id::text || ':' || v_lang));

  -- Dedup: a pending request for the same lead + template + language already
  -- covers this. Repeated clicks must not stack tasks.
  IF EXISTS (
    SELECT 1 FROM dashboard_tasks dt
     WHERE dt.agency_id = v_agency
       AND dt.lead_id = p_lead_id
       AND dt.task_type = 'template_approval_request'
       AND dt.status = 'pending'
       AND coalesce(dt.raw_payload->>'template', '') = c_key
       AND coalesce(dt.raw_payload->>'language', '') = v_lang
  ) THEN
    RETURN jsonb_build_object('ok', true, 'deduped', true);
  END IF;

  INSERT INTO dashboard_tasks (
    agency_id, lead_id, task_type, status, title, description, priority, raw_payload
  ) VALUES (
    v_agency, p_lead_id, 'template_approval_request', 'pending',
    'Template approval requested',
    'An agent requested approval of the ' || v_lang_disp || ' check-in template ('
      || c_key || ') so this lead can be re-engaged when the window reopens.',
    'normal',
    jsonb_build_object(
      'kind', 'template_approval_request',
      'template', c_key,
      'language', v_lang,
      'generated_by', 'request_template_approval'
    )
  )
  RETURNING id INTO v_task_id;

  INSERT INTO lead_events (lead_id, agency_id, type, source, summary, raw_payload)
  VALUES (
    p_lead_id, v_agency, 'template_approval_requested', 'operator',
    'Requested approval of the ' || v_lang_disp || ' check-in template (' || c_key || ').',
    jsonb_build_object('task_id', v_task_id, 'template', c_key, 'language', v_lang)
  );

  RETURN jsonb_build_object('ok', true, 'deduped', false, 'task_id', v_task_id);
END;
$function$;

COMMENT ON FUNCTION public.request_template_approval(uuid) IS
  'Records an internal template-approval request (dashboard_tasks + lead_events only) for the AIVENA team. Never touches Meta/Twilio/template state. Agency-fenced, agent-gated, deduplicated. v1, 2026-08-13.';

REVOKE ALL ON FUNCTION public.request_template_approval(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_template_approval(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_template_approval(uuid) TO aivena_app;
