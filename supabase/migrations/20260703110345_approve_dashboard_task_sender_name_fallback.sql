-- approve_dashboard_task — sender-name fallback (Chat 3 CC, 2026-07-03, Option 1).
--
-- WHY: the email path resolved the sender display name from agency_branding.sender_name ONLY,
-- with no fallback → any agency whose branding lacks sender_name (even with email_signature_name
-- / brand_name set) hit `agency_branding_missing` and could not send operator-approved email
-- (found on the demo 2026-07-02). This adds the fallback chain:
--   sender_name → email_signature_name → brand_name → agency_name
-- with NULLIF(...,'') so empty strings are treated as missing.
--
-- SCOPE: ONLY the sender-name SELECT changes. Signature, SECURITY (INVOKER), search_path,
-- the require_role gate, all guards (incl. the `agency_branding_missing` guard for a totally
-- missing branding row), and every other statement are byte-identical to the prior definition.
--
-- SAFE: agencies WITH a non-null sender_name are unaffected (COALESCE picks it first = identical
-- behaviour). The only change is that previously-erroring agencies now resolve a sensible real
-- name. No table/data change. Existing sends unaffected.
--
-- ROLLBACK: CREATE OR REPLACE with the prior SELECT
--   `SELECT b.sender_name, COALESCE(b.email_signature_role, v_agency_name) INTO v_sender_name, v_sender_role FROM agency_branding b WHERE b.agency_id = v_task.agency_id;`

CREATE OR REPLACE FUNCTION public.approve_dashboard_task(p_task_id uuid, p_edited_body text DEFAULT NULL::text, p_edited_subject text DEFAULT NULL::text, p_operator_email text DEFAULT NULL::text, OUT conversation_message_id uuid, OUT send_queue_id uuid, OUT idempotency_key text, OUT final_body text, OUT final_subject text, OUT was_edited boolean)
 RETURNS record
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_task              dashboard_tasks%ROWTYPE;
  v_lead              leads%ROWTYPE;
  v_channel           text;
  v_agency_name       text;
  v_sender_name       text;
  v_sender_role       text;
  v_first_name        text;
  v_is_portal_lead    boolean;
  v_template_vars     jsonb;
  v_task_approved_id  uuid;
  v_enqueued_id       uuid;
  v_existing_payload  jsonb;
  v_new_conversation_id uuid;
  v_from_email        text;
  v_from_name         text;
  v_reply_to          text;
  v_wa_provider       text;
  v_wa_from           text;
  v_wa_connected      boolean;
  v_platform          text;
BEGIN
  PERFORM public.require_role('agent'::public.agency_role);

  SELECT * INTO v_task FROM dashboard_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_task.task_type <> 'suggested_reply' THEN RAISE EXCEPTION 'task_wrong_type' USING ERRCODE = 'P0001'; END IF;
  IF v_task.status <> 'pending' THEN RAISE EXCEPTION 'task_already_handled' USING ERRCODE = 'P0001'; END IF;
  IF v_task.lead_id IS NULL THEN RAISE EXCEPTION 'task_missing_lead' USING ERRCODE = 'P0001'; END IF;

  v_channel  := COALESCE(NULLIF(v_task.channel, ''), 'email');
  IF v_channel NOT IN ('email', 'whatsapp') THEN
    RAISE EXCEPTION 'task_channel_unsupported' USING ERRCODE = 'P0001';
  END IF;
  v_platform := CASE v_channel WHEN 'whatsapp' THEN 'twilio' ELSE 'resend' END;

  SELECT * INTO v_lead FROM leads WHERE id = v_task.lead_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0001'; END IF;

  IF v_channel = 'email' THEN
    IF v_lead.opt_in_status = 'opted_out' THEN RAISE EXCEPTION 'lead_opted_out' USING ERRCODE = 'P0001'; END IF;
    IF v_lead.email IS NULL OR v_lead.email = '' THEN RAISE EXCEPTION 'lead_missing_email' USING ERRCODE = 'P0001'; END IF;
  ELSE
    IF v_lead.opt_in_status IN ('opted_out', 'blocked') THEN RAISE EXCEPTION 'lead_opted_out' USING ERRCODE = 'P0001'; END IF;
    IF v_lead.phone IS NULL OR v_lead.phone = '' THEN RAISE EXCEPTION 'lead_missing_phone' USING ERRCODE = 'P0001'; END IF;
    IF v_lead.last_inbound_whatsapp_at IS NULL
       OR (now() - v_lead.last_inbound_whatsapp_at) >= interval '24 hours' THEN
      RAISE EXCEPTION 'whatsapp_window_closed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_task.conversation_id IS NULL THEN
    INSERT INTO conversations (lead_id, agency_id, channel, status, message_count, last_message_at, created_at, updated_at)
    VALUES (v_task.lead_id, v_task.agency_id, v_channel, 'active', 0, now(), now(), now())
    ON CONFLICT (lead_id, channel) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_new_conversation_id;
    IF v_new_conversation_id IS NULL THEN RAISE EXCEPTION 'task_missing_conversation' USING ERRCODE = 'P0001'; END IF;
    v_task.conversation_id := v_new_conversation_id::text;
    UPDATE dashboard_tasks SET conversation_id = v_new_conversation_id::text WHERE id = v_task.id;
  END IF;

  SELECT agency_name INTO v_agency_name FROM agency_settings WHERE agency_id = v_task.agency_id;
  IF v_agency_name IS NULL THEN RAISE EXCEPTION 'agency_settings_missing' USING ERRCODE = 'P0001'; END IF;
  SELECT COALESCE(NULLIF(b.sender_name, ''), NULLIF(b.email_signature_name, ''), NULLIF(b.brand_name, ''), v_agency_name),
         COALESCE(NULLIF(b.email_signature_role, ''), v_agency_name)
    INTO v_sender_name, v_sender_role
    FROM agency_branding b WHERE b.agency_id = v_task.agency_id;

  IF v_channel = 'email' THEN
    IF v_sender_name IS NULL THEN RAISE EXCEPTION 'agency_branding_missing' USING ERRCODE = 'P0001'; END IF;
    SELECT from_email, COALESCE(from_name, v_sender_name, v_agency_name), reply_to
      INTO v_from_email, v_from_name, v_reply_to
      FROM agency_email_config WHERE agency_id = v_task.agency_id;
    IF v_from_email IS NULL OR v_from_email = '' THEN
      RAISE EXCEPTION 'agency_from_address_missing' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT whatsapp_provider, whatsapp_from_number, whatsapp_access_token_connected
      INTO v_wa_provider, v_wa_from, v_wa_connected
      FROM agency_settings WHERE agency_id = v_task.agency_id;
    IF v_wa_provider IS DISTINCT FROM 'twilio' OR v_wa_from IS NULL OR v_wa_connected IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'agency_whatsapp_not_configured' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  final_body    := COALESCE(p_edited_body,    v_task.message_body);
  final_subject := CASE WHEN v_channel = 'whatsapp' THEN NULL
                        ELSE COALESCE(p_edited_subject, v_task.message_subject) END;
  was_edited    := (p_edited_body    IS NOT NULL AND p_edited_body    <> COALESCE(v_task.message_body, ''))
                OR (v_channel = 'email' AND p_edited_subject IS NOT NULL AND p_edited_subject <> COALESCE(v_task.message_subject, ''));
  IF final_body IS NULL OR final_body = '' THEN RAISE EXCEPTION 'final_body_empty' USING ERRCODE = 'P0001'; END IF;
  IF v_channel = 'whatsapp' AND length(final_body) > 1600 THEN
    RAISE EXCEPTION 'whatsapp_body_too_long' USING ERRCODE = 'P0001';
  END IF;

  v_first_name     := split_part(COALESCE(v_lead.full_name, ''), ' ', 1);
  v_is_portal_lead := (v_lead.source_type = 'portal');

  IF v_channel = 'email' THEN
    v_template_vars := jsonb_build_object(
      'body', final_body, 'subject', final_subject,
      'full_name', v_lead.full_name, 'first_name', v_first_name,
      'agency_name', v_agency_name, 'sender_name', v_sender_name, 'sender_role', v_sender_role,
      'portal_source', v_lead.source, 'is_portal_lead', v_is_portal_lead,
      'property_reference', v_lead.listing_id,
      'from_email', v_from_email, 'from_name', v_from_name, 'reply_to_email', v_reply_to
    );
  ELSE
    v_template_vars := jsonb_build_object(
      'body', final_body,
      'lead_phone', v_lead.phone,
      'full_name', v_lead.full_name, 'first_name', v_first_name,
      'agency_name', v_agency_name
    );
  END IF;

  idempotency_key := v_task.agency_id || ':' || v_task.lead_id::text
                     || ':reply:' || v_task.id::text || ':' || v_channel || ':operator';

  INSERT INTO send_queue (
    idempotency_key, agency_id, lead_id, channel, hub, template_key,
    template_variables, priority, status, requested_by, requested_at, expiry_at
  ) VALUES (
    idempotency_key, v_task.agency_id, v_task.lead_id, v_channel,
    CASE v_channel WHEN 'whatsapp' THEN 'twilio' ELSE 'w3_followup' END,
    CASE v_channel WHEN 'whatsapp' THEN 'freeform' ELSE 'followup_personalized' END,
    v_template_vars, 'high', 'queued', 'operator_approved', now(), now() + interval '7 days'
  ) RETURNING id INTO send_queue_id;

  INSERT INTO conversation_messages (
    conversation_id, agency_id, lead_id, direction, message_type,
    content, status, sent_by, send_queue_id, raw_payload
  ) VALUES (
    v_task.conversation_id::uuid, v_task.agency_id, v_task.lead_id, 'outbound',
    CASE v_channel WHEN 'whatsapp' THEN 'text' ELSE 'email' END,
    final_body, 'queued', 'agent', send_queue_id,
    jsonb_build_object('source', 'operator_approved', 'task_id', v_task.id, 'edited', was_edited)
  ) RETURNING id INTO conversation_message_id;

  INSERT INTO lead_events (lead_id, agency_id, type, source, channel, platform, summary, conversation_id, raw_payload)
  VALUES (v_task.lead_id, v_task.agency_id, 'task_approved', 'operator', v_channel, v_platform,
    'Dashboard task ' || v_task.id::text || ' approved by ' || COALESCE(p_operator_email, 'unknown'),
    v_task.conversation_id,
    jsonb_build_object('task_id', v_task.id, 'operator_email', p_operator_email,
      'final_body', final_body, 'final_subject', final_subject, 'was_edited', was_edited,
      'ai_body', v_task.message_body, 'ai_subject', v_task.message_subject))
  RETURNING id INTO v_task_approved_id;

  INSERT INTO lead_events (lead_id, agency_id, type, source, channel, platform, summary, conversation_id, raw_payload)
  VALUES (v_task.lead_id, v_task.agency_id, 'followup_enqueued', 'operator_approved', v_channel, v_platform,
    'Reply enqueued via operator approval', v_task.conversation_id,
    jsonb_build_object('send_queue_id', send_queue_id, 'idempotency_key', idempotency_key,
      'conversation_message_id', conversation_message_id, 'task_id', v_task.id))
  RETURNING id INTO v_enqueued_id;

  UPDATE send_queue SET lead_event_id = v_enqueued_id WHERE id = send_queue_id;

  v_existing_payload := CASE
    WHEN v_task.raw_payload IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(v_task.raw_payload) = 'string' THEN COALESCE((v_task.raw_payload #>> '{}')::jsonb, '{}'::jsonb)
    WHEN jsonb_typeof(v_task.raw_payload) = 'object' THEN v_task.raw_payload
    ELSE jsonb_build_object('legacy_raw', v_task.raw_payload)
  END;

  UPDATE dashboard_tasks SET
    status='approved', handled_at=now(), handled_by=p_operator_email, handled_event_id=v_task_approved_id, updated_at=now(),
    raw_payload = v_existing_payload || jsonb_build_object('approval', jsonb_build_object(
      'approved_at', now(), 'approved_by', p_operator_email, 'final_body', final_body, 'final_subject', final_subject,
      'was_edited', was_edited, 'send_queue_id', send_queue_id, 'conversation_message_id', conversation_message_id,
      'task_approved_event_id', v_task_approved_id, 'enqueued_event_id', v_enqueued_id))
  WHERE id = v_task.id;

  UPDATE leads SET followup_count = COALESCE(followup_count,0)+1, last_followup_at=now(), last_contact_at=now(), updated_at=now()
  WHERE id = v_task.lead_id;
END;
$function$;
