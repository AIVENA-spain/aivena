-- Lead scoring Stage 3b (approved by Christian 2026-09-13): provenance for every score written to a lead, and the one
-- place the scorer learns which agencies are active.
--
-- ADDITIVE ONLY: eight new nullable columns on leads and one new read-only function. No existing column, row,
-- function, trigger or policy is changed, and no data is written. The lead triggers (lead_autoembed, lead_automatch)
-- react only to summary, message, preferences and embedding columns, never to these.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS score_source         text,
  ADD COLUMN IF NOT EXISTS score_rubric_version text,
  ADD COLUMN IF NOT EXISTS score_model          text,
  ADD COLUMN IF NOT EXISTS score_run_id         uuid,
  ADD COLUMN IF NOT EXISTS score_band           text,
  ADD COLUMN IF NOT EXISTS score_message_count  integer,
  ADD COLUMN IF NOT EXISTS score_cost_usd       numeric(10, 6),
  ADD COLUMN IF NOT EXISTS score_viewing_date   date;

COMMENT ON COLUMN public.leads.score_source IS
  'Which scorer wrote score/temperature/reasoning_summary. Only aivena_scoring_v1 is ever shown as a live score; anything else (e.g. the legacy n8n 2A pipeline) is never displayed.';
COMMENT ON COLUMN public.leads.score_rubric_version IS 'Scoring rubric version that produced the score, e.g. v1.6.';
COMMENT ON COLUMN public.leads.score_model IS 'AI model that extracted the facts behind the score.';
COMMENT ON COLUMN public.leads.score_run_id IS 'ai_classifications.id of the scoring run: full facts, quotes, discarded quotes, guards and cost.';
COMMENT ON COLUMN public.leads.score_band IS 'Band of the latest run, including lost, deal and do_not_contact, where score and temperature are null.';
COMMENT ON COLUMN public.leads.score_message_count IS 'How many messages the scorer read for this score.';
COMMENT ON COLUMN public.leads.score_cost_usd IS 'Cost of the scoring run in USD.';
COMMENT ON COLUMN public.leads.score_viewing_date IS 'Viewing date the scorer resolved, if any. The urgency layer compares it with today; it never changes the score.';

-- The scorer runs for every ACTIVE agency (Christian 2026-09-13). The API role (aivena_app) cannot list other agencies
-- under row-level security, so this returns agency ids only, nothing else, and only aivena_app may call it.
CREATE OR REPLACE FUNCTION public.lead_scoring_active_agencies()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.agencies WHERE status = 'active' ORDER BY id;
$$;

REVOKE ALL ON FUNCTION public.lead_scoring_active_agencies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lead_scoring_active_agencies() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lead_scoring_active_agencies() TO aivena_app;
