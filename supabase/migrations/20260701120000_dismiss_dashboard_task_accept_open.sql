-- F7 fix: allow dismissing dashboard tasks whose status is 'open' (not only
-- 'pending'). Real active tasks like super_hot_alert are created with status
-- 'open', and /operations treats pending + open as the active set
-- (OPEN_TASK_STATUSES) — so the Tasks list surfaces them as resolvable, but the
-- RPC previously rejected them with task_already_handled.
--
-- ONLY the status guard changes ('status <> pending' → 'status NOT IN
-- (pending, open)'). Same signature, same body otherwise; CREATE OR REPLACE
-- preserves existing grants (no DROP). No task rows are touched. The reason
-- whitelist, audit lead_event, and all other behaviour are unchanged.

CREATE OR REPLACE FUNCTION public.dismiss_dashboard_task(
  p_task_id uuid,
  p_reason text,
  p_operator_email text DEFAULT NULL::text,
  OUT dismissed_task_id uuid,
  OUT lead_event_id uuid
)
 RETURNS record
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_task             dashboard_tasks%ROWTYPE;
  v_dismiss_event_id uuid;
  v_existing_payload jsonb;
BEGIN
  PERFORM public.require_role('agent'::public.agency_role);
  PERFORM assert_staff_audit_present();

  -- Original 5-reason whitelist (intentionally NOT including 'superseded_by_new_inbound';
  -- that reason is W4a-internal and bypasses this RPC).
  IF p_reason IS NULL OR p_reason NOT IN (
    'dropped_lead', 'handled_externally', 'not_relevant', 'wrong_number', 'duplicate'
  ) THEN
    RAISE EXCEPTION 'invalid_dismissal_reason' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_task FROM dashboard_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0001'; END IF;
  -- F7: accept both active statuses ('pending' and 'open'), not 'pending' alone.
  IF v_task.status NOT IN ('pending', 'open') THEN RAISE EXCEPTION 'task_already_handled' USING ERRCODE = 'P0001'; END IF;

  IF v_task.lead_id IS NOT NULL THEN
    INSERT INTO lead_events (
      lead_id, agency_id, type, source, channel, platform, summary, conversation_id, raw_payload
    ) VALUES (
      v_task.lead_id, v_task.agency_id, 'task_dismissed', 'operator', 'system', 'dashboard',
      'Dashboard task ' || v_task.id::text || ' dismissed (' || p_reason || ') by ' || COALESCE(p_operator_email, 'unknown'),
      v_task.conversation_id,
      jsonb_build_object(
        'task_id', v_task.id, 'operator_email', p_operator_email,
        'dismissal_reason', p_reason, 'task_type', v_task.task_type
      )
    ) RETURNING id INTO v_dismiss_event_id;
  END IF;

  v_existing_payload := CASE
    WHEN v_task.raw_payload IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(v_task.raw_payload) = 'string' THEN
      COALESCE((v_task.raw_payload #>> '{}')::jsonb, '{}'::jsonb)
    WHEN jsonb_typeof(v_task.raw_payload) = 'object' THEN v_task.raw_payload
    ELSE jsonb_build_object('legacy_raw', v_task.raw_payload)
  END;

  UPDATE dashboard_tasks SET
    status           = 'dismissed',
    dismissal_reason = p_reason,
    handled_at       = now(),
    handled_by       = p_operator_email,
    handled_event_id = v_dismiss_event_id,
    updated_at       = now(),
    raw_payload      = v_existing_payload || jsonb_build_object(
      'dismissal', jsonb_build_object(
        'dismissed_at', now(), 'dismissed_by', p_operator_email,
        'reason', p_reason, 'dismiss_event_id', v_dismiss_event_id
      )
    )
  WHERE id = v_task.id;

  dismissed_task_id := v_task.id;
  lead_event_id     := v_dismiss_event_id;
END;
$function$;
