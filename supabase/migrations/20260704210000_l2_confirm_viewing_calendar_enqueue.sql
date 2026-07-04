-- L2 — align confirm_viewing_time to gate calendar enqueue on a connected credential.
-- DRAFT: NOT applied. Build-only.
--
-- confirm_viewing_time hardcoded calendar_sync_status='pending' regardless of whether
-- the agency has a connected Google Calendar → it would enqueue syncs even with no
-- calendar (and the worker would then permanently fail them). This mirrors the gate
-- create_manual_viewing/update_viewing already use, but on the L1 credential convention
-- (provider='google_calendar', status='connected'). Only the calendar_sync_status is
-- changed — the send_queue/reminder/task/event logic is untouched (Packet-1 territory).
--
-- ⚠ COMPANION CHANGE REQUIRED (see AIVENA_Packet2_L2_Calendar_Enqueue_Proposal): the
-- existing create_manual_viewing + update_viewing gate on provider='google' /
-- status='active' — the OLD W11-lite convention — which does NOT match the L1 store
-- (provider='google_calendar' / status='connected'). Until all three use ONE
-- convention, an agency that connects via L1 still won't enqueue. This migration uses
-- the L1 convention; the two W11-lite RPCs must be swapped to match (surgical 2-value
-- change in their EXISTS clause) in the same release.

CREATE OR REPLACE FUNCTION public.confirm_viewing_time(p_task_id uuid, p_chosen_time timestamp with time zone, p_duration_minutes integer DEFAULT 60, p_location text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(booking_id uuid, send_queue_immediate_id uuid, send_queue_reminder_id uuid, send_queue_followup_id uuid, calendar_sync_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency_id           text := current_setting('app.current_agency_id', true);
  v_user_id             text := COALESCE(NULLIF(current_setting('app.current_user_id', true), ''), 'system_confirm_viewing_time');
  v_task                public.dashboard_tasks;
  v_lead                public.leads;
  v_booking_id          uuid;
  v_immediate_id        uuid;
  v_reminder_id         uuid;
  v_followup_id         uuid;
  v_reminder_send_after timestamptz;
  v_property_id         uuid;
  v_template_vars       jsonb;
  v_cal_status          text;      -- L2: computed, gated on a connected credential
  v_has_gcal            boolean;
BEGIN
  IF v_agency_id IS NULL OR v_agency_id = '' THEN
    RAISE EXCEPTION 'no_agency_context' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.require_role('agent'::public.agency_role);

  IF p_chosen_time IS NULL OR p_chosen_time < now() + INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'viewing_time_too_soon' USING ERRCODE = 'P0001',
      DETAIL = format('chosen time must be at least 1 hour in the future; received: %s, now: %s', p_chosen_time, now());
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 480 THEN
    RAISE EXCEPTION 'viewing_duration_out_of_range' USING ERRCODE = 'P0001',
      DETAIL = format('duration_minutes must be between 15 and 480; received: %s', p_duration_minutes);
  END IF;

  SELECT * INTO v_task FROM public.dashboard_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0001', DETAIL = format('task_id: %s', p_task_id);
  END IF;
  IF v_task.agency_id <> v_agency_id THEN
    RAISE EXCEPTION 'task_wrong_agency' USING ERRCODE = 'P0001';
  END IF;
  IF v_task.task_type <> 'viewing_intent_detected' THEN
    RAISE EXCEPTION 'task_type_mismatch' USING ERRCODE = 'P0001',
      DETAIL = format('expected: viewing_intent_detected, actual: %s', v_task.task_type);
  END IF;
  IF v_task.status <> 'pending' THEN
    RAISE EXCEPTION 'task_already_handled' USING ERRCODE = 'P0001',
      DETAIL = format('task status: %s, handled_at: %s', v_task.status, v_task.handled_at);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = v_task.lead_id;
  v_property_id := NULLIF(v_task.raw_payload->>'property_id', '')::uuid;

  -- L2: calendar sync only when the agency has a connected Google Calendar credential
  -- (L1 convention). Otherwise not_required → manual-task fallback (L3).
  SELECT EXISTS (
    SELECT 1 FROM public.agency_oauth_credentials
     WHERE agency_id = v_agency_id AND provider = 'google_calendar'
       AND status = 'connected' AND revoked_at IS NULL
  ) INTO v_has_gcal;
  v_cal_status := CASE WHEN v_has_gcal THEN 'pending' ELSE 'not_required' END;

  INSERT INTO public.bookings (
    agency_id, lead_id, property_id, booking_type, status,
    scheduled_at, duration_minutes, location, notes,
    source, raw_payload, calendar_sync_status
  ) VALUES (
    v_agency_id, v_task.lead_id, v_property_id,
    'viewing', 'confirmed'::public.booking_status,
    p_chosen_time, p_duration_minutes, p_location, p_notes,
    'dashboard_confirm',
    jsonb_build_object(
      'source_task_id', p_task_id,
      'producer', v_task.raw_payload->>'producer',
      'original_message_excerpt', v_task.raw_payload->>'original_message_excerpt',
      'detected_language', v_task.raw_payload->>'detected_language',
      'confirmed_by', v_user_id
    ),
    v_cal_status                       -- L2: was hardcoded 'pending'
  ) RETURNING id INTO v_booking_id;

  v_template_vars := jsonb_build_object(
    'buyer_name', COALESCE(v_lead.full_name, 'there'),
    'scheduled_at_iso', to_char(p_chosen_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'scheduled_at_local', to_char(p_chosen_time AT TIME ZONE 'Europe/Madrid', 'FMDay DD FMMonth "at" HH24:MI'),
    'duration_minutes', p_duration_minutes,
    'location', COALESCE(p_location, ''),
    'property_reference', COALESCE(v_task.raw_payload->>'property_reference_raw', ''),
    'lead_language', COALESCE(v_lead.language, 'en'),
    'booking_id', v_booking_id::text
  );

  v_reminder_send_after := GREATEST(p_chosen_time - INTERVAL '24 hours', now());

  INSERT INTO public.send_queue (
    idempotency_key, agency_id, lead_id, channel, hub,
    template_key, template_variables, priority, status, requested_by, send_after, expiry_at
  ) VALUES (
    'viewing_confirm_' || v_booking_id::text, v_agency_id, v_task.lead_id, 'whatsapp', 'w11_viewing',
    'viewing_confirmation_v1', v_template_vars, 'high', 'queued'::public.send_status,
    v_user_id, NULL, p_chosen_time
  ) RETURNING id INTO v_immediate_id;

  INSERT INTO public.send_queue (
    idempotency_key, agency_id, lead_id, channel, hub,
    template_key, template_variables, priority, status, requested_by, send_after, expiry_at
  ) VALUES (
    'viewing_reminder_' || v_booking_id::text, v_agency_id, v_task.lead_id, 'whatsapp', 'w11_viewing',
    'viewing_reminder_v1', v_template_vars, 'normal', 'queued'::public.send_status,
    v_user_id, v_reminder_send_after, p_chosen_time
  ) RETURNING id INTO v_reminder_id;

  INSERT INTO public.send_queue (
    idempotency_key, agency_id, lead_id, channel, hub,
    template_key, template_variables, priority, status, requested_by, send_after, expiry_at
  ) VALUES (
    'viewing_followup_' || v_booking_id::text, v_agency_id, v_task.lead_id, 'whatsapp', 'w11_viewing',
    'viewing_followup_v1', v_template_vars, 'normal', 'queued'::public.send_status,
    v_user_id, p_chosen_time + INTERVAL '24 hours', p_chosen_time + INTERVAL '72 hours'
  ) RETURNING id INTO v_followup_id;

  UPDATE public.dashboard_tasks
     SET status = 'approved', handled_at = now(), handled_by = v_user_id, updated_at = now()
   WHERE id = p_task_id;

  INSERT INTO public.lead_events (
    agency_id, lead_id, type, source, summary, raw_payload, conversation_id
  ) VALUES (
    v_agency_id, v_task.lead_id, 'viewing_confirmed', 'confirm_viewing_time_rpc',
    'Viewing confirmed for ' || to_char(p_chosen_time, 'YYYY-MM-DD HH24:MI TZ'),
    jsonb_build_object(
      'booking_id', v_booking_id, 'scheduled_at', p_chosen_time, 'duration_minutes', p_duration_minutes,
      'source_task_id', p_task_id,
      'send_queue_ids', jsonb_build_array(v_immediate_id, v_reminder_id, v_followup_id),
      'confirmed_by', v_user_id
    ),
    v_task.conversation_id
  );

  RETURN QUERY SELECT v_booking_id, v_immediate_id, v_reminder_id, v_followup_id, v_cal_status;  -- L2: was 'pending'
END;
$function$;
