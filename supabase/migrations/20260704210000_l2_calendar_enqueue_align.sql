-- L2 — align ALL THREE booking RPCs to gate calendar enqueue on a connected
-- Google Calendar credential. Canonical convention (from the agency_oauth_credentials
-- CHECK constraints): provider='google_calendar', status='active', revoked_at IS NULL.
-- Applied to prod 2026-07-04 (migrations l2_calendar_enqueue_align_google_calendar_connected
-- + l2_calendar_enqueue_fix_status_active). Only calendar_sync_status logic changes;
-- signatures + all other side-effects (send_queue/reminders/tasks/events) unchanged.
--
-- Notes:
--   * confirm_viewing_time previously HARDCODED 'pending' (no cred check) — now gated.
--   * create_manual_viewing/update_viewing previously checked provider='google' (NOT a
--     CHECK-valid provider → dead gate, always not_required) — now provider='google_calendar'.
--   * ⚠ COMPANION L1 FIX REQUIRED before Calendar go-live: the L1 store/get/route code uses
--     status='connected', which the status CHECK REJECTS (allowed: active/expired/revoked/
--     pending_reconnect) — so L1's store would fail on the first real connect. L1 must write
--     status='active'. Tracked separately.

CREATE OR REPLACE FUNCTION public.confirm_viewing_time(p_task_id uuid, p_chosen_time timestamp with time zone, p_duration_minutes integer DEFAULT 60, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(booking_id uuid, send_queue_immediate_id uuid, send_queue_reminder_id uuid, send_queue_followup_id uuid, calendar_sync_status text)
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency_id text := current_setting('app.current_agency_id', true);
  v_user_id   text := COALESCE(NULLIF(current_setting('app.current_user_id', true), ''), 'system_confirm_viewing_time');
  v_task public.dashboard_tasks; v_lead public.leads; v_booking_id uuid;
  v_immediate_id uuid; v_reminder_id uuid; v_followup_id uuid;
  v_reminder_send_after timestamptz; v_property_id uuid; v_template_vars jsonb;
  v_cal_status text; v_has_gcal boolean;
BEGIN
  IF v_agency_id IS NULL OR v_agency_id = '' THEN RAISE EXCEPTION 'no_agency_context' USING ERRCODE='P0001'; END IF;
  PERFORM public.require_role('agent'::public.agency_role);
  IF p_chosen_time IS NULL OR p_chosen_time < now() + INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'viewing_time_too_soon' USING ERRCODE='P0001', DETAIL=format('chosen time must be at least 1 hour in the future; received: %s, now: %s', p_chosen_time, now());
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 480 THEN
    RAISE EXCEPTION 'viewing_duration_out_of_range' USING ERRCODE='P0001', DETAIL=format('duration_minutes must be between 15 and 480; received: %s', p_duration_minutes);
  END IF;
  SELECT * INTO v_task FROM public.dashboard_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found' USING ERRCODE='P0001', DETAIL=format('task_id: %s', p_task_id); END IF;
  IF v_task.agency_id <> v_agency_id THEN RAISE EXCEPTION 'task_wrong_agency' USING ERRCODE='P0001'; END IF;
  IF v_task.task_type <> 'viewing_intent_detected' THEN RAISE EXCEPTION 'task_type_mismatch' USING ERRCODE='P0001', DETAIL=format('expected: viewing_intent_detected, actual: %s', v_task.task_type); END IF;
  IF v_task.status <> 'pending' THEN RAISE EXCEPTION 'task_already_handled' USING ERRCODE='P0001', DETAIL=format('task status: %s, handled_at: %s', v_task.status, v_task.handled_at); END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id = v_task.lead_id;
  v_property_id := NULLIF(v_task.raw_payload->>'property_id', '')::uuid;

  SELECT EXISTS (SELECT 1 FROM public.agency_oauth_credentials
    WHERE agency_id = v_agency_id AND provider = 'google_calendar' AND status = 'active' AND revoked_at IS NULL) INTO v_has_gcal;
  v_cal_status := CASE WHEN v_has_gcal THEN 'pending' ELSE 'not_required' END;

  INSERT INTO public.bookings (agency_id, lead_id, property_id, booking_type, status, scheduled_at, duration_minutes, location, notes, source, raw_payload, calendar_sync_status)
  VALUES (v_agency_id, v_task.lead_id, v_property_id, 'viewing', 'confirmed'::public.booking_status, p_chosen_time, p_duration_minutes, p_location, p_notes, 'dashboard_confirm',
    jsonb_build_object('source_task_id', p_task_id, 'producer', v_task.raw_payload->>'producer', 'original_message_excerpt', v_task.raw_payload->>'original_message_excerpt', 'detected_language', v_task.raw_payload->>'detected_language', 'confirmed_by', v_user_id),
    v_cal_status) RETURNING id INTO v_booking_id;

  v_template_vars := jsonb_build_object('buyer_name', COALESCE(v_lead.full_name, 'there'),
    'scheduled_at_iso', to_char(p_chosen_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'scheduled_at_local', to_char(p_chosen_time AT TIME ZONE 'Europe/Madrid', 'FMDay DD FMMonth "at" HH24:MI'),
    'duration_minutes', p_duration_minutes, 'location', COALESCE(p_location, ''),
    'property_reference', COALESCE(v_task.raw_payload->>'property_reference_raw', ''),
    'lead_language', COALESCE(v_lead.language, 'en'), 'booking_id', v_booking_id::text);
  v_reminder_send_after := GREATEST(p_chosen_time - INTERVAL '24 hours', now());

  INSERT INTO public.send_queue (idempotency_key, agency_id, lead_id, channel, hub, template_key, template_variables, priority, status, requested_by, send_after, expiry_at)
  VALUES ('viewing_confirm_' || v_booking_id::text, v_agency_id, v_task.lead_id, 'whatsapp', 'w11_viewing', 'viewing_confirmation_v1', v_template_vars, 'high', 'queued'::public.send_status, v_user_id, NULL, p_chosen_time) RETURNING id INTO v_immediate_id;
  INSERT INTO public.send_queue (idempotency_key, agency_id, lead_id, channel, hub, template_key, template_variables, priority, status, requested_by, send_after, expiry_at)
  VALUES ('viewing_reminder_' || v_booking_id::text, v_agency_id, v_task.lead_id, 'whatsapp', 'w11_viewing', 'viewing_reminder_v1', v_template_vars, 'normal', 'queued'::public.send_status, v_user_id, v_reminder_send_after, p_chosen_time) RETURNING id INTO v_reminder_id;
  INSERT INTO public.send_queue (idempotency_key, agency_id, lead_id, channel, hub, template_key, template_variables, priority, status, requested_by, send_after, expiry_at)
  VALUES ('viewing_followup_' || v_booking_id::text, v_agency_id, v_task.lead_id, 'whatsapp', 'w11_viewing', 'viewing_followup_v1', v_template_vars, 'normal', 'queued'::public.send_status, v_user_id, p_chosen_time + INTERVAL '24 hours', p_chosen_time + INTERVAL '72 hours') RETURNING id INTO v_followup_id;

  UPDATE public.dashboard_tasks SET status='approved', handled_at=now(), handled_by=v_user_id, updated_at=now() WHERE id = p_task_id;
  INSERT INTO public.lead_events (agency_id, lead_id, type, source, summary, raw_payload, conversation_id)
  VALUES (v_agency_id, v_task.lead_id, 'viewing_confirmed', 'confirm_viewing_time_rpc', 'Viewing confirmed for ' || to_char(p_chosen_time, 'YYYY-MM-DD HH24:MI TZ'),
    jsonb_build_object('booking_id', v_booking_id, 'scheduled_at', p_chosen_time, 'duration_minutes', p_duration_minutes, 'source_task_id', p_task_id, 'send_queue_ids', jsonb_build_array(v_immediate_id, v_reminder_id, v_followup_id), 'confirmed_by', v_user_id), v_task.conversation_id);

  RETURN QUERY SELECT v_booking_id, v_immediate_id, v_reminder_id, v_followup_id, v_cal_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_viewing(p_lead_id uuid, p_scheduled_at timestamp with time zone, p_duration_minutes integer DEFAULT 60, p_property_id uuid DEFAULT NULL::uuid, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_agent_name text DEFAULT NULL::text, p_send_confirmation boolean DEFAULT false)
 RETURNS TABLE(booking_id uuid, calendar_sync_status text)
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency_id text := current_setting('app.current_agency_id', true);
  v_user_id   text := COALESCE(NULLIF(current_setting('app.current_user_id', true), ''), 'system_create_manual_viewing');
  v_lead public.leads; v_booking_id uuid; v_cal_status text; v_has_gcal boolean;
BEGIN
  IF v_agency_id IS NULL OR v_agency_id = '' THEN RAISE EXCEPTION 'no_agency_context' USING ERRCODE='P0001'; END IF;
  PERFORM public.require_role('agent'::public.agency_role);
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'viewing_time_in_past' USING ERRCODE='P0001', DETAIL=format('scheduled_at must not be in the past; received: %s', p_scheduled_at); END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 480 THEN
    RAISE EXCEPTION 'viewing_duration_out_of_range' USING ERRCODE='P0001', DETAIL=format('duration_minutes must be between 15 and 480; received: %s', p_duration_minutes); END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND OR v_lead.agency_id <> v_agency_id THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0001', DETAIL=format('lead_id: %s', p_lead_id); END IF;
  IF p_property_id IS NOT NULL THEN
    PERFORM 1 FROM public.properties WHERE id = p_property_id AND agency_id = v_agency_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'property_not_found' USING ERRCODE='P0001', DETAIL=format('property_id: %s', p_property_id); END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.agency_oauth_credentials
    WHERE agency_id = v_agency_id AND provider = 'google_calendar' AND status = 'active' AND revoked_at IS NULL) INTO v_has_gcal;
  v_cal_status := CASE WHEN v_has_gcal THEN 'pending' ELSE 'not_required' END;

  INSERT INTO public.bookings (agency_id, lead_id, property_id, booking_type, status, scheduled_at, duration_minutes, location, agent_name, notes, source, raw_payload, calendar_sync_status)
  VALUES (v_agency_id, p_lead_id, p_property_id, 'viewing', 'confirmed'::public.booking_status, p_scheduled_at, p_duration_minutes, p_location, p_agent_name, p_notes, 'dashboard_manual',
    jsonb_build_object('created_by', v_user_id, 'send_confirmation_requested', p_send_confirmation), v_cal_status) RETURNING id INTO v_booking_id;

  INSERT INTO public.lead_events (agency_id, lead_id, type, source, summary, raw_payload)
  VALUES (v_agency_id, p_lead_id, 'viewing_confirmed', 'create_manual_viewing_rpc', 'Viewing manually scheduled for ' || to_char(p_scheduled_at, 'YYYY-MM-DD HH24:MI TZ'),
    jsonb_build_object('booking_id', v_booking_id, 'scheduled_at', p_scheduled_at, 'duration_minutes', p_duration_minutes, 'created_by', v_user_id, 'manual', true));
  RETURN QUERY SELECT v_booking_id, v_cal_status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_viewing(p_booking_id uuid, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_minutes integer DEFAULT NULL::integer, p_property_id uuid DEFAULT NULL::uuid, p_location text DEFAULT NULL::text, p_agent_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(booking_id uuid, calendar_sync_status text)
 LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency_id text := current_setting('app.current_agency_id', true);
  v_user_id   text := COALESCE(NULLIF(current_setting('app.current_user_id', true), ''), 'system_update_viewing');
  v_booking public.bookings; v_new_time timestamptz; v_new_dur integer; v_has_gcal boolean; v_cal_status text; v_time_changed boolean := false;
BEGIN
  IF v_agency_id IS NULL OR v_agency_id = '' THEN RAISE EXCEPTION 'no_agency_context' USING ERRCODE='P0001'; END IF;
  PERFORM public.require_role('agent'::public.agency_role);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.agency_id <> v_agency_id THEN RAISE EXCEPTION 'booking_not_found' USING ERRCODE='P0001', DETAIL=format('booking_id: %s', p_booking_id); END IF;
  IF v_booking.booking_type <> 'viewing' THEN RAISE EXCEPTION 'booking_type_mismatch' USING ERRCODE='P0001', DETAIL=format('expected: viewing, actual: %s', v_booking.booking_type); END IF;
  IF v_booking.status NOT IN ('requested'::public.booking_status, 'confirmed'::public.booking_status, 'rescheduled'::public.booking_status) THEN
    RAISE EXCEPTION 'booking_not_editable' USING ERRCODE='P0001', DETAIL=format('status: %s', v_booking.status); END IF;
  v_new_time := COALESCE(p_scheduled_at, v_booking.scheduled_at);
  v_new_dur  := COALESCE(p_duration_minutes, v_booking.duration_minutes, 60);
  IF p_scheduled_at IS NOT NULL THEN
    IF p_scheduled_at < now() - INTERVAL '5 minutes' THEN RAISE EXCEPTION 'viewing_time_in_past' USING ERRCODE='P0001', DETAIL=format('scheduled_at must not be in the past; received: %s', p_scheduled_at); END IF;
    v_time_changed := (v_booking.scheduled_at IS DISTINCT FROM p_scheduled_at);
  END IF;
  IF v_new_dur < 15 OR v_new_dur > 480 THEN RAISE EXCEPTION 'viewing_duration_out_of_range' USING ERRCODE='P0001', DETAIL=format('duration_minutes must be between 15 and 480; received: %s', v_new_dur); END IF;
  IF p_property_id IS NOT NULL THEN
    PERFORM 1 FROM public.properties WHERE id = p_property_id AND agency_id = v_agency_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'property_not_found' USING ERRCODE='P0001', DETAIL=format('property_id: %s', p_property_id); END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.agency_oauth_credentials
    WHERE agency_id = v_agency_id AND provider = 'google_calendar' AND status = 'active' AND revoked_at IS NULL) INTO v_has_gcal;
  v_cal_status := CASE WHEN v_has_gcal AND v_time_changed THEN 'pending' ELSE v_booking.calendar_sync_status END;

  UPDATE public.bookings SET scheduled_at=v_new_time, duration_minutes=v_new_dur, property_id=COALESCE(p_property_id, property_id),
    location=COALESCE(p_location, location), agent_name=COALESCE(p_agent_name, agent_name), notes=COALESCE(p_notes, notes),
    calendar_sync_status=v_cal_status, updated_at=now() WHERE id = p_booking_id;

  IF v_time_changed THEN
    UPDATE public.send_queue SET send_after=NULL, expiry_at=v_new_time,
      template_variables = template_variables || jsonb_build_object('scheduled_at_iso', to_char(v_new_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'scheduled_at_local', to_char(v_new_time AT TIME ZONE 'Europe/Madrid', 'FMDay DD FMMonth "at" HH24:MI'), 'duration_minutes', v_new_dur), updated_at=now()
     WHERE idempotency_key = 'viewing_confirm_' || p_booking_id::text AND status='queued'::public.send_status;
    UPDATE public.send_queue SET send_after=GREATEST(v_new_time - INTERVAL '24 hours', now()), expiry_at=v_new_time,
      template_variables = template_variables || jsonb_build_object('scheduled_at_iso', to_char(v_new_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'scheduled_at_local', to_char(v_new_time AT TIME ZONE 'Europe/Madrid', 'FMDay DD FMMonth "at" HH24:MI'), 'duration_minutes', v_new_dur), updated_at=now()
     WHERE idempotency_key = 'viewing_reminder_' || p_booking_id::text AND status='queued'::public.send_status;
    UPDATE public.send_queue SET send_after=v_new_time + INTERVAL '24 hours', expiry_at=v_new_time + INTERVAL '72 hours',
      template_variables = template_variables || jsonb_build_object('scheduled_at_iso', to_char(v_new_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'scheduled_at_local', to_char(v_new_time AT TIME ZONE 'Europe/Madrid', 'FMDay DD FMMonth "at" HH24:MI'), 'duration_minutes', v_new_dur), updated_at=now()
     WHERE idempotency_key = 'viewing_followup_' || p_booking_id::text AND status='queued'::public.send_status;
    INSERT INTO public.lead_events (agency_id, lead_id, type, source, summary, raw_payload)
    VALUES (v_agency_id, v_booking.lead_id, 'viewing_rescheduled', 'update_viewing_rpc', 'Viewing rescheduled to ' || to_char(v_new_time, 'YYYY-MM-DD HH24:MI TZ'),
      jsonb_build_object('booking_id', p_booking_id, 'old_scheduled_at', v_booking.scheduled_at, 'new_scheduled_at', v_new_time, 'updated_by', v_user_id));
  END IF;
  RETURN QUERY SELECT p_booking_id, v_cal_status;
END;
$function$;
