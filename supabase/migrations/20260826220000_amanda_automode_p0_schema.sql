-- Amanda auto-mode P0 foundations schema (design doc §4/§8/§11, build go 2026-08-26).
-- PREPARED IN-REPO; applying to prod is approval-gated (dry-run against live data
-- first — the bookings EXCLUDE constraint must be checked against existing rows).
--
-- Contents:
--   1. btree_gist extension (slot EXCLUDE arbiter)
--   2. amanda_inbound_queue        — inbound outbox the engine consumes
--   3. amanda_pending_actions      — proposal→confirmation state (never parse "yes")
--   4. viewing_slot_holds + bookings EXCLUDE constraint — DB-level slot exclusivity
--   5. amanda_turn_usage           — per-turn metering from day one
--   6. amanda_lead_state           — structured, supersession-aware lead memory
--   7. agency_amanda_knowledge     — screened agency knowledge w/ version history
--   8. amanda_questions (+ events) — ask-the-agency tickets (§3b)
--   9. amanda_funnel_events        — day-one funnel data pack (§11)
--  10. bookings: viewing_type + outcome columns (§11 viewing lifecycle spine)
--  11. conversations: AI disclosure / mute / human-claim columns
--  12. agency_settings: amanda_mode dial (default off) + amanda_settings
--
-- House rules honored: agency-fenced FORCE RLS via app.current_agency_id on every
-- new agency-scoped table (mirrors bookings_isolation); no grants to anon/authenticated.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2 ── inbound outbox ─────────────────────────────────────────────────────────
CREATE TABLE public.amanda_inbound_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           text NOT NULL,
  conversation_id     uuid NOT NULL,
  lead_id             uuid NOT NULL,
  provider_message_id text NOT NULL,
  kind                text NOT NULL DEFAULT 'message' CHECK (kind IN ('message','media','agency_edit','ticket_answered','system')),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','skipped')),
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz,
  lease_expires_at    timestamptz,
  leased_by           text,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  UNIQUE (provider_message_id, kind)
);
CREATE INDEX amanda_inbound_queue_due_idx ON public.amanda_inbound_queue (status, next_attempt_at, lease_expires_at) WHERE status IN ('pending','processing');
CREATE INDEX amanda_inbound_queue_conv_idx ON public.amanda_inbound_queue (conversation_id, created_at);
ALTER TABLE public.amanda_inbound_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_inbound_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_inbound_queue_isolation ON public.amanda_inbound_queue AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 3 ── pending actions (proposal → button/explicit confirmation → execute) ────
CREATE TABLE public.amanda_pending_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       text NOT NULL,
  conversation_id uuid NOT NULL,
  lead_id         uuid NOT NULL,
  property_id     uuid,
  action_type     text NOT NULL CHECK (action_type IN ('book_viewing','reschedule_viewing','cancel_viewing')),
  slot            tstzrange,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','executed','expired','cancelled','superseded')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  executed_booking_id uuid
);
CREATE INDEX amanda_pending_actions_conv_idx ON public.amanda_pending_actions (conversation_id, status, expires_at);
ALTER TABLE public.amanda_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_pending_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_pending_actions_isolation ON public.amanda_pending_actions AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 4 ── slot exclusivity: TTL holds + the DB-level arbiter on bookings ─────────
CREATE TABLE public.viewing_slot_holds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         text NOT NULL,
  agent_key         text NOT NULL,              -- coalesce(agent_id, agent_name, 'agency')
  slot              tstzrange NOT NULL,
  pending_action_id uuid REFERENCES public.amanda_pending_actions(id) ON DELETE CASCADE,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- two live holds for the same agent may not overlap; expired holds are swept
  CONSTRAINT viewing_slot_holds_no_overlap EXCLUDE USING gist (
    agency_id WITH =, agent_key WITH =, slot WITH &&
  )
);
CREATE INDEX viewing_slot_holds_expiry_idx ON public.viewing_slot_holds (expires_at);
ALTER TABLE public.viewing_slot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viewing_slot_holds FORCE ROW LEVEL SECURITY;
CREATE POLICY viewing_slot_holds_isolation ON public.viewing_slot_holds AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- The arbiter: two ACTIVE viewings for the same agent may not overlap. App-level
-- checks stay advisory; this constraint is the truth (design §4). DRY-RUN NOTE:
-- verify no existing active rows overlap before applying (query in apply proposal).
-- timestamptz + interval is only STABLE in pg_proc, which EXCLUDE expressions
-- reject — for pure minute intervals the result is instant-deterministic, so the
-- IMMUTABLE wrapper is sound (the standard workaround; reviewer-confirmed).
CREATE OR REPLACE FUNCTION public.booking_slot_range(ts timestamptz, mins integer)
 RETURNS tstzrange
 LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT tstzrange(ts, ts + make_interval(mins => COALESCE(mins, 60)), '[)') $$;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_active_slot_exclusive EXCLUDE USING gist (
  agency_id WITH =,
  COALESCE(agent_id, agent_name, 'agency') WITH =,
  public.booking_slot_range(scheduled_at, duration_minutes) WITH &&
) WHERE (status IN ('requested'::public.booking_status, 'confirmed'::public.booking_status, 'rescheduled'::public.booking_status));

-- 10 ── viewing lifecycle spine on bookings (§11.1) ───────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN viewing_type        text NOT NULL DEFAULT 'in_person' CHECK (viewing_type IN ('in_person','video')),
  ADD COLUMN outcome             text CHECK (outcome IN ('attended','no_show','cancelled_late','unknown')),
  ADD COLUMN outcome_recorded_at timestamptz,
  ADD COLUMN outcome_recorded_by text,
  ADD COLUMN outcome_notes       text;

-- 5 ── per-turn metering (design §7 — from day one) ───────────────────────────
CREATE TABLE public.amanda_turn_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id          text NOT NULL,
  conversation_id    uuid NOT NULL,
  turn_id            text NOT NULL UNIQUE,      -- f(conversation, MessageSid)
  mode               text NOT NULL,             -- shadow | approval | assisted | full
  model              text NOT NULL,
  prompt_version     text,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  tool_calls         integer NOT NULL DEFAULT 0,
  latency_ms         integer,
  outcome            text,                      -- sent | drafted | blocked_gate | handoff | error ...
  turn_class         text,                      -- social | fact_bearing (§2 false-block budget needs this from day one)
  gate_failures      text,                      -- comma list when gates blocked (calibration data, unrecoverable later)
  cannot_answer      text,                      -- reason when the model declared abstention (§2 calibration)
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX amanda_turn_usage_agency_day_idx ON public.amanda_turn_usage (agency_id, created_at);
ALTER TABLE public.amanda_turn_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_turn_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_turn_usage_isolation ON public.amanda_turn_usage AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 6 ── structured lead memory (design §1 layer 2; §10 counters live here) ─────
CREATE TABLE public.amanda_lead_state (
  lead_id           uuid PRIMARY KEY,
  agency_id         text NOT NULL,
  state             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- budget/areas/must_haves/rejected_property_ids/promised_followups/trip_dates/intel slots (timestamped, supersession-aware)
  engagement_state  text NOT NULL DEFAULT 'active' CHECK (engagement_state IN ('active','cooling','dormant')),
  value_nudges_sent integer NOT NULL DEFAULT 0,          -- lifetime cap 2, enforced by scheduler
  last_nudge_at     timestamptz,
  version           integer NOT NULL DEFAULT 1,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX amanda_lead_state_agency_idx ON public.amanda_lead_state (agency_id, engagement_state);
ALTER TABLE public.amanda_lead_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_lead_state FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_lead_state_isolation ON public.amanda_lead_state AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 7 ── agency knowledge, screened at save time, versioned (design §5/§6) ──────
CREATE TABLE public.agency_amanda_knowledge (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id     text NOT NULL,
  content       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','active','rejected','superseded')),
  source        text NOT NULL DEFAULT 'settings' CHECK (source IN ('settings','ticket_answer','import')),
  source_ref    uuid,                            -- e.g. amanda_questions.id for the flywheel
  screen_result jsonb,                           -- save-time screening verdict + reason
  screened_at   timestamptz,
  created_by    text,
  superseded_by uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agency_amanda_knowledge_active_idx ON public.agency_amanda_knowledge (agency_id, status);
ALTER TABLE public.agency_amanda_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_amanda_knowledge FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_amanda_knowledge_isolation ON public.agency_amanda_knowledge AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 8 ── ask-the-agency tickets (design §3b + §3b-spine data model) ─────────────
CREATE TABLE public.amanda_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         text NOT NULL,
  short_code        integer NOT NULL,            -- smallest unused per assignee; never recycled within 7 days
  conversation_id   uuid NOT NULL,
  lead_id           uuid NOT NULL,
  property_id       uuid,
  question_text     text NOT NULL,
  question_lang     text NOT NULL DEFAULT 'en',
  question_category text,                        -- §11 data pack: negotiability/commission/furniture/availability/...
  priority          text NOT NULL DEFAULT 'p2' CHECK (priority IN ('p1','p2','p3')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','clarifying','escalated','answered','handoff','reassigned','expired','cancelled_moot')),
  assigned_staff    text,
  answer_raw        text,                        -- agent's words, verbatim (audit)
  answer_relay      text,                        -- what Amanda actually sent (translated, attributed)
  answered_by       text,
  answered_at       timestamptz,
  relay_message_sid text,
  relay_sent_at     timestamptz,
  rung              integer NOT NULL DEFAULT 0,
  pings_sent        integer NOT NULL DEFAULT 0,
  snooze_count      integer NOT NULL DEFAULT 0,
  wait_update_sent  boolean NOT NULL DEFAULT false,
  next_ping_at      timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX amanda_questions_open_idx ON public.amanda_questions (agency_id, status) WHERE status IN ('open','clarifying','escalated');
-- One LIVE ticket per code per agency — closes the concurrent-mint race (the
-- allocator retries on 23505). Live statuses ONLY: answered tickets release
-- their code; the 7-day non-recycle window stays enforced by the allocator CTE
-- (now() is not allowed in index predicates).
CREATE UNIQUE INDEX amanda_questions_live_code_uq ON public.amanda_questions (agency_id, short_code) WHERE status IN ('open','clarifying','escalated');
CREATE INDEX amanda_questions_due_idx ON public.amanda_questions (next_ping_at) WHERE status IN ('open','escalated');
CREATE INDEX amanda_questions_conv_idx ON public.amanda_questions (conversation_id, created_at);
ALTER TABLE public.amanda_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_questions_isolation ON public.amanda_questions AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

CREATE TABLE public.amanda_question_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id   text NOT NULL,
  question_id uuid NOT NULL REFERENCES public.amanda_questions(id) ON DELETE CASCADE,
  event_type  text NOT NULL,                     -- filed/ping/snooze/escalated/answer_received/relayed/corrected/expired/...
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX amanda_question_events_q_idx ON public.amanda_question_events (question_id, created_at);
ALTER TABLE public.amanda_question_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_question_events FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_question_events_isolation ON public.amanda_question_events AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 9 ── day-one funnel events (§11.4 — unrecoverable if not logged) ────────────
CREATE TABLE public.amanda_funnel_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         text NOT NULL,
  lead_id           uuid NOT NULL,
  conversation_id   uuid,
  property_id       uuid,
  event_type        text NOT NULL CHECK (event_type IN (
    'lead_created','engaged','intel_captured','viewing_proposed','viewing_booked',
    'viewing_attended','viewing_no_show','post_viewing_feedback','offer_signalled',
    'handoff','question_ticket','dormant','reactivated','alert_opt_in')),
  amanda_attributed boolean NOT NULL DEFAULT false,
  source            text,                        -- entry-source / trigger tag (§11.8 attribution)
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX amanda_funnel_events_agency_idx ON public.amanda_funnel_events (agency_id, event_type, created_at);
CREATE INDEX amanda_funnel_events_lead_idx ON public.amanda_funnel_events (lead_id, created_at);
ALTER TABLE public.amanda_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amanda_funnel_events FORCE ROW LEVEL SECURITY;
CREATE POLICY amanda_funnel_events_isolation ON public.amanda_funnel_events AS PERMISSIVE FOR ALL
  USING (agency_id = current_setting('app.current_agency_id', true));

-- 11 ── conversation AI columns (disclosure / mute / human claim — design §5/§6)
ALTER TABLE public.conversations
  ADD COLUMN ai_disclosure_sent_at timestamptz,
  ADD COLUMN ai_muted_at           timestamptz,
  ADD COLUMN ai_muted_by           text,
  ADD COLUMN human_claimed_at      timestamptz,
  ADD COLUMN human_claimed_by      text;

-- 12 ── the agency dial (default OFF; is_test agencies may run any mode — §8 P0.5)
ALTER TABLE public.agency_settings
  ADD COLUMN amanda_mode     text NOT NULL DEFAULT 'off' CHECK (amanda_mode IN ('off','shadow','approval','assisted','full')),
  ADD COLUMN amanda_settings jsonb NOT NULL DEFAULT '{}'::jsonb;  -- working hours/duration/escalation phone/tone/quiet-hours etc.

-- 12b ── privilege hygiene ────────────────────────────────────────────────────
-- Supabase default privileges grant anon/authenticated on every new table
-- (pg_default_acl) — RLS already fences rows, but these tables are engine
-- internals with no client-facing surface: revoke outright (defense in depth,
-- and it makes the header's "no grants to anon/authenticated" literally true).
REVOKE ALL ON public.amanda_inbound_queue, public.amanda_pending_actions,
  public.viewing_slot_holds, public.amanda_turn_usage, public.amanda_lead_state,
  public.agency_amanda_knowledge, public.amanda_questions,
  public.amanda_question_events, public.amanda_funnel_events
FROM anon, authenticated;

-- 13 ── cross-agency queue claim RPC ──────────────────────────────────────────
-- The engine worker runs as aivena_app (no BYPASSRLS) and drains EVERY agency's
-- queue — as SECURITY INVOKER under FORCE RLS it would see zero rows (the exact
-- 2026-08-25 calendar-claim lesson, migration 20260825124500). SECURITY DEFINER
-- with tight grants; per-row processing then happens inside withAgency.
CREATE OR REPLACE FUNCTION public.pick_and_claim_amanda_inbound(p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 120)
 RETURNS SETOF public.amanda_inbound_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  -- §4 ordering machinery (v2):
  --   · per-conversation SERIALIZATION — a conversation with a live 'processing'
  --     row is untouchable (no concurrent turns on one conversation, ever);
  --   · 12s BURST DEBOUNCE for buyer messages — a message row becomes claimable
  --     only once 12s old, and only if it is the NEWEST pending message/media of
  --     its conversation (a typing burst settles into ONE turn on the last
  --     message, with the earlier ones folded as superseded — their text is in
  --     conversation context regardless);
  --   · internal kinds (ticket_answered / system / agency_edit) skip the
  --     debounce but still respect the serialization.
  WITH claimable AS (
    SELECT q.*
    FROM public.amanda_inbound_queue q
    WHERE ((q.status = 'pending' AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= now()))
        OR (q.status = 'processing' AND q.lease_expires_at < now()))   -- stale lease steal
      AND NOT EXISTS (
        SELECT 1 FROM public.amanda_inbound_queue live
        WHERE live.conversation_id = q.conversation_id
          AND live.status = 'processing' AND live.lease_expires_at >= now()
      )
    FOR UPDATE OF q SKIP LOCKED   -- two workers can never claim/fold the same rows
  ),
  eligible AS (
    SELECT c.id, c.conversation_id, c.created_at,
           (c.kind IN ('message', 'media')) AS is_buyer_msg
    FROM claimable c
    WHERE c.kind NOT IN ('message', 'media')
       OR (c.created_at <= now() - interval '12 seconds'
           AND NOT EXISTS (
             SELECT 1 FROM public.amanda_inbound_queue newer
             WHERE newer.conversation_id = c.conversation_id
               AND newer.kind IN ('message', 'media')
               AND newer.status = 'pending'
               AND newer.created_at > c.created_at
           ))
  ),
  one_per_conversation AS (
    SELECT e.id, e.conversation_id, e.is_buyer_msg
    FROM (
      SELECT e2.*, row_number() OVER (PARTITION BY e2.conversation_id ORDER BY e2.created_at ASC) AS rn
      FROM eligible e2
    ) e
    WHERE e.rn = 1
    ORDER BY e.conversation_id
    LIMIT p_limit
  ),
  folded AS (
    -- Older pending buyer messages of a claimed conversation collapse into the
    -- claimed (newest) one: mark them skipped so they never fire their own turn.
    UPDATE public.amanda_inbound_queue q
    SET status = 'skipped', processed_at = now(),
        error_message = 'superseded_by_newer_inbound (burst fold)'
    FROM one_per_conversation oc
    WHERE oc.is_buyer_msg
      AND q.conversation_id = oc.conversation_id
      AND q.id <> oc.id
      AND q.kind IN ('message', 'media')
      AND q.status = 'pending'
    RETURNING q.id
  )
  UPDATE public.amanda_inbound_queue q
  SET status = 'processing',
      attempts = q.attempts + 1,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      leased_by = 'api-worker'
  WHERE q.id IN (SELECT id FROM one_per_conversation)
  RETURNING q.*;
END;
$function$;

-- 14 ── viewing day-before reminder claim (§11.1 lifecycle, reminder rung) ────
-- Cross-agency sweep (DEFINER, same FORCE-RLS lesson): finds tomorrow's
-- confirmed viewings for engine-enabled agencies (amanda_mode <> 'off'),
-- inside the agency's local daytime (09-20h), marks reminder_sent atomically
-- and returns everything the worker needs to enqueue the approved
-- viewing_reminder_v1 template. Google Calendar's own 24h/2h popups remain the
-- belt if a WhatsApp enqueue ever fails after the mark.
CREATE OR REPLACE FUNCTION public.pick_and_mark_viewing_reminders(p_limit integer DEFAULT 25)
 RETURNS TABLE(booking_id uuid, agency_id text, lead_id uuid, lead_phone text, lead_first_name text,
               lead_language text, agency_name text, scheduled_at timestamptz,
               property_title text, tz text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT b.id
    FROM public.bookings b
    JOIN public.agency_settings s ON s.agency_id = b.agency_id
    JOIN public.leads l ON l.id = b.lead_id
    WHERE b.status = 'confirmed'::public.booking_status
      AND b.reminder_sent = false
      AND b.scheduled_at BETWEEN now() + interval '20 hours' AND now() + interval '28 hours'
      AND s.amanda_mode <> 'off'
      AND l.phone IS NOT NULL
      AND COALESCE(l.opt_in_status, '') <> 'opted_out'
      AND extract(hour FROM now() AT TIME ZONE COALESCE(s.amanda_settings->>'timezone', 'Europe/Madrid')) BETWEEN 9 AND 19
    ORDER BY b.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF b SKIP LOCKED
  ),
  marked AS (
    UPDATE public.bookings b SET reminder_sent = true, updated_at = now()
    WHERE b.id IN (SELECT id FROM candidates)
    RETURNING b.id, b.agency_id, b.lead_id, b.property_id, b.scheduled_at
  )
  SELECT m.id, m.agency_id, m.lead_id, l.phone, split_part(COALESCE(l.full_name, ''), ' ', 1),
         COALESCE(l.language, 'en'), COALESCE(a.trading_name, a.legal_name, a.slug),
         m.scheduled_at, p.title,
         COALESCE(s.amanda_settings->>'timezone', 'Europe/Madrid')
  FROM marked m
  JOIN public.leads l ON l.id = m.lead_id
  JOIN public.agencies a ON a.id = m.agency_id
  JOIN public.agency_settings s ON s.agency_id = m.agency_id
  LEFT JOIN public.properties p ON p.id = m.property_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pick_and_mark_viewing_reminders(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_and_mark_viewing_reminders(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_and_mark_viewing_reminders(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pick_and_mark_viewing_reminders(integer) TO aivena_app;
GRANT EXECUTE ON FUNCTION public.pick_and_mark_viewing_reminders(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) TO aivena_app;
GRANT EXECUTE ON FUNCTION public.pick_and_claim_amanda_inbound(integer, integer) TO service_role;
