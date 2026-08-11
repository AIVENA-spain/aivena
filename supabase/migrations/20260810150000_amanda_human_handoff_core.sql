-- Amanda Live L1 — human-handoff core (2026-08-10).
--
-- When a website visitor asks for a person, the lead is flagged needs-human and the
-- AI is MUTED for that lead: ai_autoreply_blocked(lead) is the single canonical
-- predicate every AI auto-reply path MUST consult (Amanda web replies now; WhatsApp
-- continuation / any automation later — automatic mode can never override it). The
-- flag clears only by explicit agent action (release), never by the bot.
--
-- amanda_tag_human_request mirrors amanda_tag_viewing_request: public /chat route
-- calls it (as aivena_app) after amanda_capture_lead, for the session's captured
-- lead. It also broadcasts on the agency's private Realtime topic so every open
-- dashboard lights up instantly. NO send, NO provider, NO booking. is_test-gated.

-- 1) Lead-level handoff state (additive).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS needs_human_since timestamptz,
  ADD COLUMN IF NOT EXISTS human_claimed_by  text,
  ADD COLUMN IF NOT EXISTS human_claimed_at  timestamptz;

-- 2) THE canonical AI-mute predicate. Any path that would let the AI reply to /
--    message a lead must check this first and stand down when true.
CREATE OR REPLACE FUNCTION public.ai_autoreply_blocked(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce((SELECT l.needs_human_since IS NOT NULL FROM public.leads l WHERE l.id = p_lead_id), false);
$$;
REVOKE ALL ON FUNCTION public.ai_autoreply_blocked(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_autoreply_blocked(uuid) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.ai_autoreply_blocked(uuid) TO aivena_app, service_role;

-- 3) Tag the captured lead as needing a human + notify all agency dashboards.
CREATE OR REPLACE FUNCTION public.amanda_tag_human_request(
  p_agency_slug   text,
  p_session_token text,
  p_require_test  boolean DEFAULT true,
  OUT ok       boolean,
  OUT lead_id  uuid,
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
  v_lead   uuid;
  v_task   uuid;
BEGIN
  SELECT a.id, a.is_test INTO v_agency, v_is_test FROM public.agencies a WHERE a.slug = p_agency_slug;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'agency_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_require_test AND NOT coalesce(v_is_test, false) THEN
    RAISE EXCEPTION 'agency_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_token IS NULL THEN RAISE EXCEPTION 'session_required' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('app.current_agency_id', v_agency, true);

  SELECT s.lead_id INTO v_lead FROM public.chat_sessions s
  WHERE s.agency_id = v_agency AND s.session_token = v_token;
  IF v_lead IS NULL THEN ok := false; RETURN; END IF;

  -- Set the mute flag. Idempotent: a repeat request keeps the ORIGINAL wait clock.
  UPDATE public.leads SET needs_human_since = coalesce(needs_human_since, now()), updated_at = now()
  WHERE id = v_lead AND agency_id = v_agency;

  -- Tag the pending Inbox task so agents see WHY it's urgent (merge keeps other keys).
  UPDATE public.dashboard_tasks dt SET
    raw_payload = coalesce(dt.raw_payload, '{}'::jsonb) || jsonb_build_object('kind', 'human_request'),
    priority = 'high',
    updated_at = now()
  WHERE dt.lead_id = v_lead AND dt.agency_id = v_agency
    AND dt.task_type = 'suggested_reply' AND dt.status = 'pending'
  RETURNING dt.id INTO v_task;

  INSERT INTO public.lead_events (lead_id, agency_id, type, source, channel, platform, summary, raw_payload)
  VALUES (v_lead, v_agency, 'human_requested', 'amanda', 'website', 'website',
          'Visitor asked to speak with a person (website chat)',
          jsonb_build_object('session_token', v_token, 'task_id', v_task));

  -- Instant dashboard alert on the agency's PRIVATE Realtime topic. Best-effort:
  -- a realtime hiccup must never fail the capture.
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('lead_id', v_lead, 'at', now()),
      'handoff_requested',
      'agency:' || v_agency || ':handoffs',
      true
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ok := true;
  lead_id := v_lead;
  task_id := v_task;
END;
$function$;
REVOKE ALL ON FUNCTION public.amanda_tag_human_request(text,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.amanda_tag_human_request(text,text,boolean) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.amanda_tag_human_request(text,text,boolean) TO aivena_app, service_role;

-- 4) Realtime channel authorization: a logged-in dashboard user may subscribe ONLY
--    to their own agency's handoff topic (private channel; realtime.messages RLS).
DROP POLICY IF EXISTS agency_handoff_topic_read ON realtime.messages;
CREATE POLICY agency_handoff_topic_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_agencies ua
      WHERE ua.user_id = (SELECT auth.uid())
        AND realtime.topic() = 'agency:' || ua.agency_id || ':handoffs'
    )
  );
