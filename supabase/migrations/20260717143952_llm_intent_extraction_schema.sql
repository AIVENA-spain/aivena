-- LLM buyer-message intent extraction — additive schema (El Raso Phase 2, Option 2).
-- APPLIED as ledger 20260717143952. Table/column/RLS/grant/index DDL ONLY. The RPC
-- (apply_extracted_intent), the dispatch helper (_intent_extraction_should_dispatch),
-- the apply_conversation_interest / trigger / matcher changes and the Edge Function land
-- as SEPARATE artifacts (assumed to be in this same migration on apply).
--
-- Ships behind an OFF-BY-DEFAULT flag: intent_extraction_config.enabled defaults false, so no
-- agency dispatches to the LLM until Christian flips it (the buyer-content legal gate is his call).
-- Everything here is additive and non-destructive: new nullable columns, new tables, new grants —
-- no existing object is altered, so the deterministic path and every current query are untouched.
--
-- Idioms mirrored from the live schema:
--   * per-agency isolation policy shape from property_import_batches / lead_events
--     (agency_id = current_setting('app.current_agency_id', true); agency_id is TEXT → no cast).
--   * ENABLE + FORCE ROW LEVEL SECURITY (as 20260601000100_capture_catalog_ingestion_tables).
--   * SELECT-only tenant grant + writes via SECURITY DEFINER only (as agency_agreements).
--   * policy creation guarded by pg_policies existence check for idempotency.
--
-- Rollback (documented, not run) is at the foot of this file.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) leads — three additive intent columns
--    excluded_areas   : towns the buyer explicitly does NOT want (additive/sticky).
--    open_to_adjacent : buyer is open to nearby towns (sticky-true; narrowed only via edit-profile).
--    must_haves       : buyer-stated features (STORED for operators; NOT used in matching).
--    Adding open_to_adjacent NOT NULL DEFAULT false is a constant default → metadata-only, no rewrite.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS excluded_areas   text[];
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS open_to_adjacent boolean NOT NULL DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS must_haves       text[];

COMMENT ON COLUMN public.leads.excluded_areas IS
  'Towns the buyer explicitly does NOT want (additive/sticky; deaccent+lower normalized on compare). '
  'Written by apply_extracted_intent from LLM/deterministic extraction. Used as a NOT-ANY exclude in '
  'match_properties_for_lead (strict no-op when NULL/empty → byte-identical results for existing leads).';
COMMENT ON COLUMN public.leads.open_to_adjacent IS
  'Buyer is open to nearby/adjacent towns (sticky-true — a later unrelated message never flips it back; '
  'an agent narrows it via the edit-profile UI). Expands the city set in match_properties_for_lead only '
  'when true AND a zone is resolvable (strict no-op when false).';
COMMENT ON COLUMN public.leads.must_haves IS
  'Buyer-stated must-have features (e.g. pool, garage). STORED for operators only — NOT used in matching '
  'and does NOT trigger a rematch. Additive/deduped by apply_extracted_intent.';

-- NO column grant is needed here. Verified live 2026-07-17:
--   pg_class.relacl for public.leads = '{...,aivena_app=arwd/postgres}'  → TABLE-LEVEL a/r/w/d, and
--   pg_attribute.attacl for location_interest_extracted / budget_extracted / bedrooms_min = NULL
--   → there are NO column-level grants on leads.
-- A table-level grant automatically covers columns added later, so the three new columns are already
-- readable/writable by aivena_app. (An earlier draft added an explicit column GRANT on the mistaken
-- belief that leads used column-level grants — that read information_schema.column_privileges, which
-- merely projects the table-level grant across every column. Dropped: it was a no-op subset.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) lead_extraction_log — INTERNAL audit + eval trail (append-only via SECURITY DEFINER writes).
--    Packet 2 no longer READS this; it exists for debugging + the eval harness.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_extraction_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  agency_id         text NOT NULL,                                   -- isolation column (TEXT, no cast)
  source_message_id uuid REFERENCES public.conversation_messages(id) ON DELETE SET NULL,  -- nullable → SET NULL viable
  source            text NOT NULL CHECK (source IN ('llm','deterministic')),
  model             text,
  input_text        text,
  intent            jsonb NOT NULL,
  applied           jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary           text,
  confidence        numeric,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_extraction_log_lead_created_idx
  ON public.lead_extraction_log (lead_id, created_at DESC);

COMMENT ON TABLE public.lead_extraction_log IS
  'Internal audit + eval trail of buyer-intent extraction (one row per applied extraction). source=llm|'
  'deterministic. Written ONLY by SECURITY DEFINER functions (apply_extracted_intent / '
  'apply_conversation_interest) — aivena_app has NO INSERT grant. Agency-scoped read for operators/eval.';

-- RLS: FORCE + per-agency isolation, SELECT only (writes come through SECURITY DEFINER functions,
-- which run as the function owner and bypass RLS — the same discipline as lead_events).
ALTER TABLE public.lead_extraction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_extraction_log FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'lead_extraction_log' AND policyname = 'lead_extraction_log_isolation') THEN
    CREATE POLICY lead_extraction_log_isolation ON public.lead_extraction_log
      FOR SELECT TO aivena_app
      USING (agency_id = current_setting('app.current_agency_id', true));
  END IF;
END $$;

REVOKE ALL ON public.lead_extraction_log FROM PUBLIC;
GRANT SELECT ON public.lead_extraction_log TO aivena_app, authenticated, service_role;  -- RLS-fenced; no INSERT/UPDATE/DELETE to aivena_app

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) intent_extraction_config — per-agency LLM enablement + monthly call cap.
--    OFF by default. Accessed ONLY by SECURITY DEFINER helpers → no tenant grants, no policy.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intent_extraction_config (
  agency_id        text PRIMARY KEY REFERENCES public.agencies(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,          -- OFF by default — the legal gate
  provider         text NOT NULL DEFAULT 'openai',
  model            text NOT NULL DEFAULT 'gpt-4o-mini',
  monthly_call_cap integer NOT NULL DEFAULT 2000,
  calls_this_month integer NOT NULL DEFAULT 0,
  month_key        text,                                    -- to_char(now(),'YYYY-MM'); rollover resets calls
  updated_at       timestamptz DEFAULT now()
);

COMMENT ON TABLE public.intent_extraction_config IS
  'Per-agency LLM buyer-intent extraction config (enabled flag + monthly call cap + usage counter). '
  'enabled defaults FALSE — no agency calls the LLM until explicitly switched on (buyer-content legal '
  'gate). Read/mutated ONLY by SECURITY DEFINER helpers (_intent_extraction_should_dispatch) — no tenant '
  'grants, no RLS policy (deny-all to non-owner roles); the owner-run definer functions reach it.';

-- RLS FORCE with NO policy = deny-all to any granted role; only owner-run SECURITY DEFINER functions
-- (which bypass RLS) touch it. No tenant grants at all (SECURITY DEFINER access only).
ALTER TABLE public.intent_extraction_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intent_extraction_config FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.intent_extraction_config FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (documented, not run):
--   DROP TABLE IF EXISTS public.intent_extraction_config;
--   DROP TABLE IF EXISTS public.lead_extraction_log;      -- (drops its policy + index too)
--   REVOKE SELECT, INSERT, UPDATE (excluded_areas, open_to_adjacent, must_haves) ON public.leads FROM aivena_app;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS must_haves;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS open_to_adjacent;
--   ALTER TABLE public.leads DROP COLUMN IF EXISTS excluded_areas;
-- ─────────────────────────────────────────────────────────────────────────────
