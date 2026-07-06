-- CAPTURE (version control) of THREE deploy-only, Packet-3-owned CATALOG-INGESTION tables:
--   * agency_scraper_config  — per-agency feed/scraper config (listings_url, cadence, enable,
--                              selector_overrides, run telemetry). Feeds the property import chain.
--   * property_import_batches — CSV import run header (source file, delimiter, matched/unmatched
--                              columns, row count, status/timing).
--   * property_imports        — per-row CSV staging buffer that PROMOTES rows into `properties`
--                              (raw_payload → resolved_payload → promoted_property_id).
--
-- Triaged read-only 2026-07-06 (workflow; each call adversarially verified). All three are
-- DEPLOY-ONLY (no committed CREATE TABLE in supabase/migrations/ — created out-of-band via the
-- Supabase DB migration ledger; the files were never committed) and clearly Packet-3 (catalog
-- data layer: O4 CSV import staging + O1/O6 scraper/feed config). The sibling tables
-- `property_valuations` and `lead_property_matches` were triaged Packet-4 (valuation / lead-property
-- matching) and are deliberately NOT captured here — routed to Packet 4.
--
-- DDL reproduced from live pg_catalog/information_schema (columns/types/defaults, PK, UNIQUE, CHECK,
-- FK, indexes, RLS+FORCE, isolation policies, the one updated_at trigger) — captured 2026-07-06.
-- Idempotent (IF NOT EXISTS + DO-block guards) → NO-OP on the live DB. Documentation/version-control
-- only: this migration is NOT applied by this change.
--
-- Ordering: sorts AFTER 20260601000000 (which captures `properties`) because
-- property_imports.promoted_property_id REFERENCES properties(id). Within this file,
-- property_import_batches is created before property_imports (FK import_batch_id → batches, CASCADE).
--
-- EXTERNAL DEPENDENCY (not owned here): the agency_scraper_config updated_at trigger calls the
-- SHARED-GENERIC function public.set_updated_at() (used by ~21 tables) — captured separately in a
-- future shared-core migration, referenced (not defined) here. auth.users(id) FK target is built-in.
--
-- GRANTS NOTE (captured as-is, NOT changed): on all three tables, `anon` holds only
-- REFERENCES/TRIGGER (no SELECT, no writes — Packet-1 F1 already covered anon), but `authenticated`
-- still holds full DML (INSERT/UPDATE/DELETE/TRUNCATE) — the same broad-grant pattern flagged on
-- `properties`. RLS+FORCE + the per-agency isolation policy fence it (no cross-tenant access), but
-- the raw grant is broader than needed → Packet-1 grant-hardening handoff. This migration emits NO
-- GRANT statements (Supabase default privileges reproduce them on a fresh rebuild); it records shape only.

-- ============ agency_scraper_config ============
CREATE TABLE IF NOT EXISTS public.agency_scraper_config (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid(),
  agency_id                 text        NOT NULL,
  listings_url              text        NOT NULL,
  scrape_interval_hours     integer     NOT NULL DEFAULT 6,
  scrape_enabled            boolean     NOT NULL DEFAULT true,
  last_scraped_at           timestamptz,
  last_scrape_status        text,
  selector_overrides        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  properties_found_last_run integer,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_scraper_config_pkey PRIMARY KEY (id),
  CONSTRAINT agency_scraper_config_agency_id_key UNIQUE (agency_id)
);

-- ============ property_import_batches ============
CREATE TABLE IF NOT EXISTS public.property_import_batches (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  agency_id          text        NOT NULL,
  source_filename    text,
  detected_delimiter text,
  matched_columns    jsonb,
  unmatched_columns  jsonb,
  total_rows         integer,
  status             text        NOT NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  created_by         uuid,
  CONSTRAINT property_import_batches_pkey PRIMARY KEY (id),
  CONSTRAINT property_import_batches_status_check
    CHECK (status = ANY (ARRAY['parsing'::text, 'validating'::text, 'importing'::text, 'completed'::text, 'failed'::text]))
);

-- ============ property_imports ============
CREATE TABLE IF NOT EXISTS public.property_imports (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  agency_id            text        NOT NULL,
  import_batch_id      uuid        NOT NULL,
  row_number           integer     NOT NULL,
  raw_payload          jsonb       NOT NULL,
  resolved_payload     jsonb,
  status               text        NOT NULL,
  validation_errors    jsonb,
  promoted_property_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_imports_pkey PRIMARY KEY (id),
  CONSTRAINT property_imports_status_check
    CHECK (status = ANY (ARRAY['staged'::text, 'validated'::text, 'promoted'::text, 'failed'::text, 'skipped'::text]))
);

-- ---- Foreign keys (guarded; added after table creation so targets can be created in any order on rebuild) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_import_batches_created_by_fkey'
                 AND conrelid = 'public.property_import_batches'::regclass) THEN
    ALTER TABLE public.property_import_batches
      ADD CONSTRAINT property_import_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_imports_import_batch_id_fkey'
                 AND conrelid = 'public.property_imports'::regclass) THEN
    ALTER TABLE public.property_imports
      ADD CONSTRAINT property_imports_import_batch_id_fkey FOREIGN KEY (import_batch_id)
      REFERENCES public.property_import_batches(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'property_imports_promoted_property_id_fkey'
                 AND conrelid = 'public.property_imports'::regclass) THEN
    ALTER TABLE public.property_imports
      ADD CONSTRAINT property_imports_promoted_property_id_fkey FOREIGN KEY (promoted_property_id)
      REFERENCES public.properties(id);
  END IF;
END $$;

-- ---- Indexes ----
CREATE INDEX IF NOT EXISTS property_imports_agency_status_idx ON public.property_imports USING btree (agency_id, status);
CREATE INDEX IF NOT EXISTS property_imports_batch_idx        ON public.property_imports USING btree (import_batch_id);

-- ---- updated_at trigger (agency_scraper_config only; references shared set_updated_at()) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agency_scraper_config_updated_at'
                 AND tgrelid = 'public.agency_scraper_config'::regclass AND NOT tgisinternal) THEN
    CREATE TRIGGER agency_scraper_config_updated_at BEFORE UPDATE ON public.agency_scraper_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---- RLS + FORCE + per-agency isolation policies (idempotent) ----
ALTER TABLE public.agency_scraper_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_scraper_config   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.property_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_import_batches FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.property_imports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_imports        FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'agency_scraper_config' AND policyname = 'agency_scraper_config_isolation') THEN
    CREATE POLICY agency_scraper_config_isolation ON public.agency_scraper_config
      FOR ALL TO aivena_app
      USING (agency_id = current_setting('app.current_agency_id', true))
      WITH CHECK (agency_id = current_setting('app.current_agency_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'property_import_batches' AND policyname = 'property_import_batches_isolation') THEN
    CREATE POLICY property_import_batches_isolation ON public.property_import_batches
      FOR ALL TO aivena_app
      USING (agency_id = current_setting('app.current_agency_id', true))
      WITH CHECK (agency_id = current_setting('app.current_agency_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'property_imports' AND policyname = 'property_imports_isolation') THEN
    CREATE POLICY property_imports_isolation ON public.property_imports
      FOR ALL TO aivena_app
      USING (agency_id = current_setting('app.current_agency_id', true))
      WITH CHECK (agency_id = current_setting('app.current_agency_id', true));
  END IF;
END $$;
