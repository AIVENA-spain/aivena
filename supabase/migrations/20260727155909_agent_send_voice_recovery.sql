-- Agent-authorized missed-call WhatsApp text-back (P2-A, approval-first path).
--
-- prepare_voice_recovery() is the AUTO path: it enforces the per-agency flag and
-- the K2 reply_rules posture, returning 'approval_required' when auto-send isn't
-- authorized. This RPC is the APPROVAL-FIRST counterpart: an agent explicitly
-- clicks "send text-back" on a missed call, so the agent's action IS the
-- authorization — the flag + K2 gate are intentionally NOT checked here. All the
-- SAFETY gates remain: the call must be genuinely missed, not already recovered,
-- have a contact + non-opted-out lead, an approved voice_recovery template, and a
-- connected WhatsApp provider. It NEVER sends directly — it enqueues to send_queue
-- exactly like send_reengagement_template; the Send-Pusher/EF drains the queue and
-- performs the Twilio send (so this is inert until a live provider exists).
--
-- Returns jsonb { sent, reason?, send_queue_id?, conversation_message_id? }. The
-- caller (API) maps `reason` to friendly copy; the raw token never leaves the API.
CREATE OR REPLACE FUNCTION public.agent_send_voice_recovery(
  p_voice_call_id uuid,
  p_operator_email text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_call         voice_calls%ROWTYPE;
  v_agency       text;
  v_lead_id      uuid;
  v_from         text;
  v_opt          text;
  v_first        text;
  v_lang         text;
  v_agency_name  text;
  v_tmpl_key     text;
  v_content_sid  text;
  v_wa_provider  text;
  v_wa_from      text;
  v_wa_connected boolean;
  v_conv_id      uuid;
  v_idem         text;
  v_queue_id     uuid;
  v_msg_id       uuid;
  v_event_id     uuid;
  v_claimed      int;
BEGIN
  PERFORM public.require_role('agent'::public.agency_role);

  SELECT * INTO v_call FROM public.voice_calls WHERE id = p_voice_call_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sent', false, 'reason', 'call_not_found'); END IF;

  v_agency  := v_call.agency_id;
  v_lead_id := v_call.lead_id;
  v_from    := v_call.from_number;

  IF v_call.status::text NOT IN ('no_answer','voicemail') THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'not_missed'); END IF;
  IF COALESCE(v_call.recovery_sent, false) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'already_sent'); END IF;
  IF v_lead_id IS NULL OR COALESCE(btrim(v_from), '') = '' THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_contact'); END IF;

  -- Serialise concurrent approvals of the same call (double-click / retry).
  PERFORM pg_advisory_xact_lock(hashtext('voice_recovery:'||p_voice_call_id::text));

  SELECT opt_in_status, NULLIF(split_part(COALESCE(full_name,''),' ',1),''), language
    INTO v_opt, v_first, v_lang
  FROM public.leads WHERE id = v_lead_id;
  IF v_opt IN ('opted_out','blocked') THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'opted_out'); END IF;

  SELECT COALESCE(voice_recovery_template_key,'voice_recovery'),
         whatsapp_provider, whatsapp_from_number, whatsapp_access_token_connected, agency_name
    INTO v_tmpl_key, v_wa_provider, v_wa_from, v_wa_connected, v_agency_name
  FROM public.agency_settings WHERE agency_id = v_agency;

  IF v_wa_provider IS DISTINCT FROM 'twilio' OR v_wa_from IS NULL OR v_wa_connected IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_whatsapp_provider'); END IF;

  SELECT provider_template_id INTO v_content_sid
  FROM public.whatsapp_templates
  WHERE agency_id = v_agency AND template_key = v_tmpl_key AND status = 'approved'
    AND COALESCE(btrim(provider_template_id),'') <> ''
  ORDER BY (language = COALESCE(v_lang,'')) DESC, approved_at DESC NULLS LAST
  LIMIT 1;
  IF v_content_sid IS NULL THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_template'); END IF;

  -- Claim the send atomically (idempotent against a concurrent auto-send).
  UPDATE public.voice_calls SET recovery_sent = true
   WHERE id = p_voice_call_id AND COALESCE(recovery_sent,false) = false;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN RETURN jsonb_build_object('sent', false, 'reason', 'already_sent'); END IF;

  INSERT INTO public.conversations (lead_id, agency_id, channel, status, message_count, last_message_at, created_at, updated_at)
  VALUES (v_lead_id, v_agency, 'whatsapp', 'active', 0, now(), now(), now())
  ON CONFLICT (lead_id, channel) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conv_id;

  v_idem := v_agency || ':' || v_lead_id::text || ':voice_recovery:' || p_voice_call_id::text;

  INSERT INTO public.send_queue (
    idempotency_key, agency_id, lead_id, channel, hub, template_key,
    template_variables, priority, status, requested_by, requested_at, expiry_at
  ) VALUES (
    v_idem, v_agency, v_lead_id, 'whatsapp', 'twilio', v_tmpl_key,
    jsonb_build_object('1', COALESCE(v_first,'there'), '2', COALESCE(v_agency_name,'')),
    'high', 'queued', 'operator_voice_recovery', now(), now() + interval '1 day'
  )
  RETURNING id INTO v_queue_id;

  INSERT INTO public.conversation_messages (
    conversation_id, agency_id, lead_id, direction, message_type,
    content, status, sent_by, send_queue_id, raw_payload
  ) VALUES (
    v_conv_id, v_agency, v_lead_id, 'outbound', 'text',
    '[missed-call text-back]', 'queued', 'agent', v_queue_id,
    jsonb_build_object('source','operator_voice_recovery','voice_call_id',p_voice_call_id,
                       'template_key',v_tmpl_key,'operator_email',p_operator_email)
  )
  RETURNING id INTO v_msg_id;

  INSERT INTO public.lead_events (lead_id, agency_id, type, source, channel, platform, summary, conversation_id, raw_payload)
  VALUES (v_lead_id, v_agency, 'voice_recovery_initiated', 'operator_voice_recovery', 'whatsapp', 'twilio',
          'Missed-call WhatsApp text-back approved by '||COALESCE(p_operator_email,'agent'),
          v_conv_id::text,
          jsonb_build_object('voice_call_id',p_voice_call_id,'send_queue_id',v_queue_id,'template_key',v_tmpl_key))
  RETURNING id INTO v_event_id;

  UPDATE public.send_queue SET lead_event_id = v_event_id WHERE id = v_queue_id;

  RETURN jsonb_build_object('sent', true, 'send_queue_id', v_queue_id, 'conversation_message_id', v_msg_id);
END;
$function$;

-- Same grants as the other operator-send RPCs: the app role executes it in the
-- agency-context tx; require_role('agent') + the tenant fence do the gating.
REVOKE ALL ON FUNCTION public.agent_send_voice_recovery(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_send_voice_recovery(uuid, text) TO aivena_app;
