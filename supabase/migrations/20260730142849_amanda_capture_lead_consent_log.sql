-- Amanda Phase A — consent v1 (Packet-1 canonical): amanda_capture_lead now writes
-- a consent_log row for the data-capture consent, AFTER the lead exists.
--
-- Packet-1 rule (AIVENA_Amanda_Valuation_Legal_Compliance_Checklist_2026-07-30):
--   • consent is logged only AFTER the lead is created — never a fake lead just to
--     log the pre-response Art. 50 AI disclosure (that stays a UI-only event);
--   • store the EXACT localized notice + checkbox label the visitor saw, verbatim,
--     in consent_log.consent_text;
--   • event_type='chatbot_data_consent', channel='web_chat',
--     consent_method='explicit_checkbox|<lang>|v1'.
--
-- ADDITIVE + signature change: the function gains 4 trailing params
-- (p_consent_text, p_consent_method, p_user_agent, p_recorded_by). The prior 18-arg
-- signature is dropped and replaced; the ONLY caller is the /chat route (updated to
-- pass the 4 new args). Everything else is byte-identical to 20260703160000. Still
-- is_test-gated; still SECURITY DEFINER; still NO provider/send path.
--
-- Rollback: re-apply 20260703160000_amanda_session_token_scope.sql (the prior
-- 18-arg version) after dropping this 22-arg signature.

DROP FUNCTION IF EXISTS public.amanda_capture_lead(
  text,text,text,text,text,boolean,text,text,text,numeric,text,integer,text,jsonb,text,text,text,boolean);

CREATE OR REPLACE FUNCTION public.amanda_capture_lead(
  p_agency_slug   text,
  p_session_token text  DEFAULT NULL,
  p_name          text  DEFAULT NULL,
  p_email         text  DEFAULT NULL,
  p_phone         text  DEFAULT NULL,
  p_consent       boolean DEFAULT false,
  p_language      text  DEFAULT NULL,
  p_intent        text  DEFAULT NULL,
  p_budget        text  DEFAULT NULL,
  p_budget_max    numeric DEFAULT NULL,
  p_location      text  DEFAULT NULL,
  p_bedrooms_min  integer DEFAULT NULL,
  p_property_type text  DEFAULT NULL,
  p_transcript    jsonb DEFAULT NULL,
  p_page_url      text  DEFAULT NULL,
  p_referrer      text  DEFAULT NULL,
  p_ip_hash       text  DEFAULT NULL,
  p_require_test  boolean DEFAULT true,
  p_consent_text   text DEFAULT NULL,   -- verbatim localized notice + checkbox label shown
  p_consent_method text DEFAULT NULL,   -- 'explicit_checkbox|<lang>|v1' (falls back below)
  p_user_agent     text DEFAULT NULL,   -- captured at the consent action
  p_recorded_by    text DEFAULT 'amanda_chat_capture',
  OUT lead_id         uuid,
  OUT conversation_id uuid,
  OUT task_type       text,
  OUT is_duplicate    boolean
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency   text;
  v_is_test  boolean;
  v_email    text := nullif(btrim(p_email), '');
  v_phone    text := nullif(btrim(p_phone), '');
  v_name     text := nullif(btrim(p_name), '');
  v_lang     text;
  v_type     text := lower(nullif(btrim(p_intent), ''));
  v_dedup    text;
  v_token    text := coalesce(nullif(btrim(p_session_token), ''), gen_random_uuid()::text);
  v_has_ct   boolean;
  v_lead     uuid;
  v_conv     uuid;
  v_task     text;
  v_msg      jsonb;
  v_dir      text;
  v_evt      uuid;
BEGIN
  -- Resolve agency (SECURITY DEFINER bypasses RLS for this lookup).
  SELECT id, is_test INTO v_agency, v_is_test FROM public.agencies WHERE slug = p_agency_slug;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'agency_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_require_test AND NOT v_is_test THEN
    RAISE EXCEPTION 'agency_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT coalesce(p_consent, false) THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'nothing_to_capture' USING ERRCODE = 'P0001';
  END IF;

  -- Scope every subsequent write to this agency for RLS.
  PERFORM set_config('app.current_agency_id', v_agency, true);

  v_lang   := CASE WHEN p_language IN ('en','es','de','nl','fr','pl','sv','no','da','fi','ru','it','pt')
                   THEN p_language ELSE NULL END;
  v_type   := CASE WHEN v_type IN ('buyer','seller') THEN v_type ELSE NULL END;
  v_has_ct := (v_email IS NOT NULL OR v_phone IS NOT NULL);
  v_dedup  := v_agency || ':website:' || lower(coalesce(v_email, v_phone, v_token));

  -- Dedup: reuse an existing website lead for the same contact.
  SELECT id INTO v_lead FROM public.leads WHERE agency_id = v_agency AND dedup_key = v_dedup LIMIT 1;
  is_duplicate := v_lead IS NOT NULL;

  IF v_lead IS NULL THEN
    INSERT INTO public.leads (
      agency_id, full_name, email, phone, source, source_type, channel, language,
      lead_type, intent, budget_raw, budget_extracted,
      location_interest_raw, location_interest_extracted, bedrooms_min, property_type_pref,
      status, opt_in_status, dedup_key, received_at, last_contact_at, raw_payload
    ) VALUES (
      v_agency, v_name, v_email, v_phone, 'aivena_website', 'website_chat', 'website', v_lang,
      v_type, v_type, nullif(btrim(p_budget),''), p_budget_max,
      nullif(btrim(p_location),''), nullif(btrim(p_location),''), p_bedrooms_min, nullif(btrim(p_property_type),''),
      'active', 'unknown', v_dedup, now(), now(),
      jsonb_build_object('captured_via','amanda_website_chat','consent',true,
                         'page_url',p_page_url,'referrer',p_referrer,'session_token',v_token)
    ) RETURNING id INTO v_lead;
  ELSE
    UPDATE public.leads SET
      full_name = coalesce(v_name, full_name),
      email     = coalesce(v_email, email),
      phone     = coalesce(v_phone, phone),
      last_contact_at = now(), updated_at = now()
    WHERE id = v_lead;
  END IF;

  -- One website conversation per lead+channel (DB unique). Reuse it for a repeat
  -- visitor; else create it.
  SELECT c.id INTO v_conv FROM public.conversations c
   WHERE c.agency_id = v_agency AND c.lead_id = v_lead AND c.channel = 'website' LIMIT 1;
  IF v_conv IS NULL THEN
    INSERT INTO public.conversations (agency_id, lead_id, channel, external_thread_id, status, last_message_at)
    VALUES (v_agency, v_lead, 'website', v_token, 'open', now())
    RETURNING id INTO v_conv;
  ELSE
    UPDATE public.conversations SET last_message_at = now(), updated_at = now() WHERE id = v_conv;
  END IF;

  -- Copy transcript (if provided) into the real thread.
  IF p_transcript IS NOT NULL AND jsonb_typeof(p_transcript) = 'array' THEN
    FOR v_msg IN SELECT * FROM jsonb_array_elements(p_transcript) LOOP
      v_dir := CASE WHEN lower(coalesce(v_msg->>'direction','inbound')) = 'outbound' THEN 'outbound' ELSE 'inbound' END;
      INSERT INTO public.conversation_messages (conversation_id, agency_id, lead_id, direction, message_type, content, sent_by, created_at)
      VALUES (v_conv, v_agency, v_lead, v_dir, 'text', nullif(v_msg->>'content',''),
              CASE WHEN v_dir='outbound' THEN 'amanda' ELSE NULL END, now());
    END LOOP;
    UPDATE public.conversations
       SET message_count = (SELECT count(*) FROM public.conversation_messages cm WHERE cm.conversation_id = v_conv),
           last_inbound_at = (SELECT max(cm.created_at) FROM public.conversation_messages cm WHERE cm.conversation_id = v_conv AND cm.direction='inbound'),
           updated_at = now()
     WHERE id = v_conv;
  END IF;

  -- Task: has-contact → suggested_reply (Inbox); no contact → missing_contact (/tasks).
  -- A repeat capture reuses the lead/conversation and does NOT stack a second
  -- pending task of the same type (avoids duplicate Inbox rows).
  v_task := CASE WHEN v_has_ct THEN 'suggested_reply' ELSE 'missing_contact' END;
  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_tasks dt
     WHERE dt.lead_id = v_lead AND dt.task_type = v_task AND dt.status = 'pending'
  ) THEN
    INSERT INTO public.dashboard_tasks (agency_id, lead_id, conversation_id, task_type, status, message_subject, message_body, priority)
    VALUES (
      v_agency, v_lead, v_conv::text, v_task, 'pending', NULL,
      CASE WHEN v_has_ct
        THEN 'Hi ' || coalesce(v_name, 'there') || ', thanks for reaching out through our website — how can we help with your property search?'
        ELSE NULL END,
      'normal'
    );
  END IF;

  -- Audited event (real, not fake): a website lead was captured by Amanda.
  INSERT INTO public.lead_events (lead_id, agency_id, type, source, channel, platform, summary, conversation_id, raw_payload)
  VALUES (v_lead, v_agency, 'website_lead_captured', 'amanda', 'website', 'website',
          'Website chat lead captured (' || coalesce(v_email, v_phone, 'no contact') || ')',
          v_conv, jsonb_build_object('session_token', v_token, 'task_type', v_task, 'is_duplicate', is_duplicate))
  RETURNING id INTO v_evt;

  -- ▶ Consent v1: log the data-capture consent AFTER the lead exists. The lead is
  --   only ever created here with p_consent = true (enforced above), so a captured
  --   website lead always has a consent record. consent_text = the verbatim notice
  --   + checkbox label the visitor saw; consent_method encodes language + version.
  INSERT INTO public.consent_log (agency_id, lead_id, event_type, channel, consent_method, consent_text, ip_address, user_agent, recorded_by)
  VALUES (
    v_agency, v_lead, 'chatbot_data_consent', 'web_chat',
    coalesce(nullif(btrim(p_consent_method), ''), 'explicit_checkbox|' || coalesce(v_lang, 'en') || '|v1'),
    nullif(btrim(p_consent_text), ''),
    p_ip_hash, nullif(btrim(p_user_agent), ''),
    coalesce(nullif(btrim(p_recorded_by), ''), 'amanda_chat_capture')
  );

  -- Upsert the session record (provenance + resume), mark it captured.
  -- ▶ SECURITY: conflict is scoped to (agency_id, session_token) so a reused/guessed
  --   token can only ever match THIS agency's own row; the WHERE guard is belt-and-
  --   suspenders on the update branch.
  INSERT INTO public.chat_sessions (agency_id, session_token, status, lead_id, conversation_id,
                                    visitor_language, page_url, referrer, ip_hash, captured_at, last_activity_at)
  VALUES (v_agency, v_token, 'captured', v_lead, v_conv, v_lang, p_page_url, p_referrer, p_ip_hash, now(), now())
  ON CONFLICT (agency_id, session_token) DO UPDATE SET
    status='captured', lead_id=EXCLUDED.lead_id, conversation_id=EXCLUDED.conversation_id,
    captured_at=now(), last_activity_at=now(), updated_at=now()
  WHERE public.chat_sessions.agency_id = v_agency;

  lead_id := v_lead;
  conversation_id := v_conv;
  task_type := v_task;
END;
$function$;

-- Least privilege: the ONLY caller is the public /chat route, which connects as
-- aivena_app (drizzle db client), never a Supabase JWT — so authenticated/anon get
-- no EXECUTE (tightened from the slice-1 grant, which had granted authenticated).
REVOKE ALL ON FUNCTION public.amanda_capture_lead(text,text,text,text,text,boolean,text,text,text,numeric,text,integer,text,jsonb,text,text,text,boolean,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.amanda_capture_lead(text,text,text,text,text,boolean,text,text,text,numeric,text,integer,text,jsonb,text,text,text,boolean,text,text,text,text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.amanda_capture_lead(text,text,text,text,text,boolean,text,text,text,numeric,text,integer,text,jsonb,text,text,text,boolean,text,text,text,text)
  TO aivena_app, service_role;

-- Tighten the sibling append RPC to the same posture (it was just applied with an
-- authenticated grant; no authenticated/anon caller exists).
REVOKE EXECUTE ON FUNCTION public.amanda_append_message(text,text,text,text,jsonb,boolean) FROM authenticated, anon;
