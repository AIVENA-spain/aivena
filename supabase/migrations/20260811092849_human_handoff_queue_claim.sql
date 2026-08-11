-- Amanda Live L1 — dashboard queue + claim/release (2026-08-10).
--
-- SECURITY INVOKER, RLS-fenced by app.current_agency_id (set per-request by the
-- API's agencyContextMiddleware): the dashboard only ever sees its own agency's
-- handoffs. Claim = any available agent takes it (first click wins, race-safe).
-- Release = the agent explicitly hands the lead back to the bot (the ONLY way the
-- AI-mute clears — the bot never un-mutes itself). No sends anywhere.

-- Queue: open human requests, oldest wait first.
CREATE OR REPLACE FUNCTION public.get_human_handoff_queue()
RETURNS TABLE(
  lead_id uuid, full_name text, email text, phone text, language text,
  needs_human_since timestamptz, human_claimed_by text, human_claimed_at timestamptz,
  conversation_id uuid, last_message text
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT l.id, l.full_name, l.email, l.phone, l.language,
         l.needs_human_since, l.human_claimed_by, l.human_claimed_at,
         c.id AS conversation_id,
         (SELECT cm.content FROM public.conversation_messages cm
           WHERE cm.conversation_id = c.id AND cm.direction = 'inbound'
           ORDER BY cm.created_at DESC LIMIT 1) AS last_message
  FROM public.leads l
  LEFT JOIN LATERAL (
    SELECT c.id FROM public.conversations c
    WHERE c.lead_id = l.id AND c.agency_id = l.agency_id
    ORDER BY (c.channel = 'website') DESC, c.last_message_at DESC NULLS LAST
    LIMIT 1
  ) c ON true
  WHERE l.agency_id = current_setting('app.current_agency_id', true)
    AND l.needs_human_since IS NOT NULL
  ORDER BY l.needs_human_since ASC;
$$;
REVOKE ALL ON FUNCTION public.get_human_handoff_queue() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_human_handoff_queue() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_human_handoff_queue() TO aivena_app;

-- Claim: race-safe (first agent wins; a second click reports who has it).
CREATE OR REPLACE FUNCTION public.claim_human_handoff(
  p_lead_id uuid,
  p_operator text,
  OUT ok boolean,
  OUT claimed_by text
)
RETURNS record
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.leads SET human_claimed_by = p_operator, human_claimed_at = now(), updated_at = now()
  WHERE id = p_lead_id
    AND agency_id = current_setting('app.current_agency_id', true)
    AND needs_human_since IS NOT NULL
    AND human_claimed_by IS NULL
  RETURNING human_claimed_by INTO claimed_by;
  ok := claimed_by IS NOT NULL;
  IF NOT ok THEN
    SELECT l.human_claimed_by INTO claimed_by FROM public.leads l
    WHERE l.id = p_lead_id AND l.agency_id = current_setting('app.current_agency_id', true);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_human_handoff(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_human_handoff(uuid, text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.claim_human_handoff(uuid, text) TO aivena_app;

-- Release: agent hands the lead back to the bot — clears the AI-mute (audited).
CREATE OR REPLACE FUNCTION public.release_human_handoff(
  p_lead_id uuid,
  p_operator text,
  OUT ok boolean
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_agency text := current_setting('app.current_agency_id', true);
BEGIN
  UPDATE public.leads SET needs_human_since = NULL, human_claimed_by = NULL, human_claimed_at = NULL, updated_at = now()
  WHERE id = p_lead_id AND agency_id = v_agency AND needs_human_since IS NOT NULL;
  ok := FOUND;
  IF ok THEN
    INSERT INTO public.lead_events (lead_id, agency_id, type, source, channel, platform, summary, raw_payload)
    VALUES (p_lead_id, v_agency, 'human_handoff_released', 'dashboard', 'website', 'website',
            'Conversation handed back to the assistant by ' || coalesce(p_operator, 'an agent'),
            jsonb_build_object('operator', p_operator));
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.release_human_handoff(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_human_handoff(uuid, text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_human_handoff(uuid, text) TO aivena_app;
