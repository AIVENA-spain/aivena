-- Amanda Phase A · Slice 1 — SECURITY FIX: scope session_token per agency.
--
-- Review finding (before the /chat endpoint deploys): the public endpoint accepts
-- a caller-provided `sessionToken`, but 20260703140000 made `chat_sessions.session_token`
-- GLOBALLY unique and the capture RPC upserted with `ON CONFLICT (session_token)`.
-- Because amanda_capture_lead is SECURITY DEFINER owned by a BYPASSRLS role, that
-- ON CONFLICT could match a row belonging to ANOTHER agency and overwrite its
-- lead_id / conversation_id / status — a cross-agency session hijack from a reused
-- or guessed token.
--
-- FIX (additive, safe — chat_sessions is empty; endpoint not yet deployed):
--   1. Uniqueness becomes composite (agency_id, session_token). Two agencies may
--      now share a token; each upsert can only ever hit its OWN agency's row, so a
--      guessed/reused token from agency A can never touch agency B's session — it
--      just creates a fresh row under A.
--   2. The RPC upsert targets (agency_id, session_token) and adds a hard same-agency
--      WHERE guard on the UPDATE branch (defense-in-depth: redundant under the
--      composite key, but makes isolation self-evident and would still block a
--      cross-agency update if the key ever regressed).
-- Nothing else in the RPC changes. Still is_test-gated; still no provider/send path.

-- 1. Swap the global unique for a per-agency composite unique.
ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_session_token_key;
ALTER TABLE public.chat_sessions
  ADD CONSTRAINT chat_sessions_agency_token_key UNIQUE (agency_id, session_token);

-- 2. Replace the RPC — identical to 20260703140000 except the session upsert's
--    ON CONFLICT target + same-agency guard (marked ▶ below).
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

REVOKE ALL ON FUNCTION public.amanda_capture_lead(text,text,text,text,text,boolean,text,text,text,numeric,text,integer,text,jsonb,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amanda_capture_lead(text,text,text,text,text,boolean,text,text,text,numeric,text,integer,text,jsonb,text,text,text,boolean)
  TO aivena_app, authenticated, service_role;
