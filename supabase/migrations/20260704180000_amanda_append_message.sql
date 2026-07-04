-- Amanda slice 2 — append a conversational message + merge qualification.
-- ADDITIVE, DRAFT: NOT applied to prod until slice-2 is approved for deploy.
--
-- The PUBLIC /chat/:agencySlug/message route calls this with NO user/agency
-- context, so (like amanda_capture_lead) it is SECURITY DEFINER: it resolves the
-- agency from the slug, is_test-gates, and sets the RLS GUC itself. NO lead is
-- created here — the route calls the existing amanda_capture_lead once contact is
-- present AND consent is given. NO LLM, NO provider/send. Reuses the slice-1
-- tables (chat_sessions/chat_messages) and the composite (agency_id, session_token)
-- key from the slice-1 security fix.

CREATE OR REPLACE FUNCTION public.amanda_append_message(
  p_agency_slug     text,
  p_session_token   text,
  p_direction       text,                        -- 'inbound' (visitor) | 'outbound' (amanda)
  p_content         text,
  p_collected_patch jsonb    DEFAULT '{}'::jsonb, -- new qualification facts this turn
  p_require_test    boolean  DEFAULT true,
  OUT session_id    uuid,
  OUT collected     jsonb,
  OUT message_count integer
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency    text;
  v_is_test   boolean;
  v_token     text  := nullif(btrim(p_session_token), '');
  v_dir       text  := CASE WHEN lower(coalesce(p_direction,'')) = 'outbound' THEN 'outbound' ELSE 'inbound' END;
  v_patch     jsonb := CASE WHEN jsonb_typeof(p_collected_patch) = 'object' THEN p_collected_patch ELSE '{}'::jsonb END;
  v_session   uuid;
  v_collected jsonb;
  v_count     integer;
BEGIN
  SELECT id, is_test INTO v_agency, v_is_test FROM public.agencies WHERE slug = p_agency_slug;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'agency_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_require_test AND NOT coalesce(v_is_test, false) THEN
    RAISE EXCEPTION 'agency_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_token IS NULL THEN RAISE EXCEPTION 'session_required' USING ERRCODE = 'P0001'; END IF;

  PERFORM set_config('app.current_agency_id', v_agency, true);

  -- Find-or-create the anonymous session (no lead yet).
  SELECT s.id, coalesce(s.collected, '{}'::jsonb) INTO v_session, v_collected
  FROM public.chat_sessions s
  WHERE s.agency_id = v_agency AND s.session_token = v_token;

  IF v_session IS NULL THEN
    INSERT INTO public.chat_sessions (agency_id, session_token, status, collected, last_activity_at)
    VALUES (v_agency, v_token, 'active', '{}'::jsonb, now())
    RETURNING id INTO v_session;
    v_collected := '{}'::jsonb;
  END IF;

  -- EXISTING values win (never overwrite a set field) — matches TS mergeCollected.
  v_collected := v_patch || v_collected;

  INSERT INTO public.chat_messages (session_id, agency_id, direction, content, message_type)
  VALUES (v_session, v_agency, v_dir, left(coalesce(p_content, ''), 4000), 'text');

  UPDATE public.chat_sessions
     SET collected         = v_collected,
         message_count     = coalesce(chat_sessions.message_count, 0) + 1,  -- table-qualified to avoid OUT-param ambiguity
         last_activity_at  = now(),
         updated_at        = now()
   WHERE id = v_session;

  SELECT cs.message_count INTO v_count FROM public.chat_sessions cs WHERE cs.id = v_session;

  session_id    := v_session;
  collected     := v_collected;
  message_count := v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.amanda_append_message(text,text,text,text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amanda_append_message(text,text,text,text,jsonb,boolean)
  TO aivena_app, authenticated, service_role;
