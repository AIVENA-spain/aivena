-- Packet 2 — the AGENT ROSTER (Christian's direction, 2026-08-28).
--
-- "the agency needs to have a place for managing their real estate agents, the
--  different ones, name, what language speaks, office and work hours,
--  unavailable hours, whats email and whatsapp nr, so that amanda can ping the
--  agent that is correct for the client"
--
-- Nothing like this exists today: user_agencies holds only (user_id, agency_id,
-- role), so AIVENA knows logins but not who speaks Norwegian or who finishes at
-- two on Fridays. Everything about agent routing depends on this table.
--
-- THE CLEAR LINE (his safety requirement: "we need to make sure there is a
-- clear line and the bot knows it between the agents and clients"). An agent
-- writes to the SAME AIVENA WhatsApp number as buyers do, so the number itself
-- is the only discriminator. `whatsapp_e164` is therefore the staff registry
-- the inbound router checks BEFORE find-or-create-lead: a match is staff and
-- must never become a lead or reach the buyer engine. It is UNIQUE per agency
-- (an agent cannot be registered twice) and normalised to E.164 by a CHECK, so
-- a mistyped local format can never silently fail to match.

CREATE TABLE public.agency_agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         text NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  -- E.164 only ('+34600111222'): the inbound router matches on exact equality,
  -- so any other shape would be an invisible routing failure.
  whatsapp_e164     text NOT NULL CHECK (whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email             text,
  -- ISO codes the agent can actually hold a conversation in ('nb','en','es').
  languages         text[] NOT NULL DEFAULT '{}',
  office            text,
  -- Same shape as Amanda's viewing hours: { "1": [9,10,...], ... } 0=Sun..6=Sat.
  work_hours        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Whole days off, 'YYYY-MM-DD'.
  unavailable_dates text[] NOT NULL DEFAULT '{}',
  -- Some staff must never be pinged (owner, office manager). Honest switch.
  receives_pings    boolean NOT NULL DEFAULT true,
  -- Shift check-in (his idea): the daily template lands ~15 min before the
  -- shift; the agent's reply opens WhatsApp's 24h window AND proves presence,
  -- so routing can prefer whoever actually checked in today.
  last_checkin_at   timestamptz,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'removed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, whatsapp_e164)
);

CREATE INDEX agency_agents_agency_active_idx
  ON public.agency_agents (agency_id) WHERE status = 'active';
-- The staff-lookup index: the inbound router hits this on EVERY message.
CREATE INDEX agency_agents_whatsapp_idx ON public.agency_agents (whatsapp_e164);

ALTER TABLE public.agency_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_agents FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_agents_isolation ON public.agency_agents AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

REVOKE ALL ON public.agency_agents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_agents TO aivena_app;
GRANT ALL ON public.agency_agents TO service_role;

-- ── The clear line, as a function ────────────────────────────────────────────
-- SECURITY DEFINER because the inbound edge function has no agency GUC yet at
-- the moment it must decide "staff or buyer?" — it knows only the number it
-- received and which agency the AIVENA number belongs to. Returns the agent
-- when that number is registered STAFF for that agency, else nothing.
CREATE FUNCTION public.lookup_agency_agent(p_agency_id text, p_whatsapp text)
 RETURNS TABLE (id uuid, full_name text, languages text[], receives_pings boolean, status text)
 LANGUAGE sql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT a.id, a.full_name, a.languages, a.receives_pings, a.status
    FROM public.agency_agents a
   WHERE a.agency_id = p_agency_id
     AND a.whatsapp_e164 = p_whatsapp
     AND a.status <> 'removed'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_agency_agent(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_agency_agent(text, text) TO aivena_app, service_role;
