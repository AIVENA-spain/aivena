-- CAPTURE (documentation / version control) of the deploy-only CATALOG schema (Packet 3 schema-drift).
--
-- `properties` + `property_sync_runs` were created OUT OF BAND (Vega/n8n) and are NOT in migration
-- history. This file documents the LIVE DDL (captured 2026-07-06) so a rebuild/review has a source of
-- truth. It is IDEMPOTENT (IF NOT EXISTS / guarded) and a NO-OP on the live DB — DO NOT rely on it to
-- CHANGE prod; it only records what already exists. Early timestamp so a fresh rebuild creates these
-- base tables before the 2026-06-24+ migrations that reference them.
--
-- DEPENDENCIES captured elsewhere / still uncaptured (see report): the trigger functions
-- `set_updated_at()` + `trg_property_autoembed()` (platform-level, not recreated here); the sibling
-- catalog tables `agency_scraper_config`, `property_import_batches`, `property_imports`,
-- `property_valuations`, `lead_property_matches`; and the `_get_platform_secret` RPC the EFs gate on.

CREATE EXTENSION IF NOT EXISTS vector;  -- properties.embedding is vector(1536)

CREATE TABLE IF NOT EXISTS public.properties (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id                text NOT NULL,
  external_id              text NOT NULL,
  source_url               text,
  title                    text NOT NULL,
  description              text,
  property_type            text,
  status                   text NOT NULL DEFAULT 'active',
  price                    numeric,
  price_currency           text NOT NULL DEFAULT 'EUR',
  bedrooms                 integer,
  bathrooms                integer,
  area_sqm                 numeric,
  location_city            text,
  location_region          text,
  location_country         text,
  lat                      numeric,
  lng                      numeric,
  images                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  features                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  vector_synced_at         timestamptz,
  scraped_at               timestamptz,
  raw_payload              jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  embedding                vector(1536),
  embedding_model_version  text,
  area_built_sqm           numeric,
  area_plot_sqm            numeric,
  CONSTRAINT properties_agency_id_external_id_key UNIQUE (agency_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_properties_comps ON public.properties
  USING btree (agency_id, lower(btrim(location_city)), lower(btrim(property_type)))
  WHERE (price IS NOT NULL AND area_sqm IS NOT NULL AND area_sqm > 0::numeric);
CREATE INDEX IF NOT EXISTS properties_embedding_hnsw_idx ON public.properties
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='properties' AND policyname='properties_isolation') THEN
    CREATE POLICY properties_isolation ON public.properties FOR ALL TO aivena_app
      USING (agency_id = current_setting('app.current_agency_id', true))
      WITH CHECK (agency_id = current_setting('app.current_agency_id', true));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.properties'::regclass AND tgname='properties_updated_at') THEN
    CREATE TRIGGER properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.properties'::regclass AND tgname='property_autoembed') THEN
    CREATE TRIGGER property_autoembed AFTER INSERT OR UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION trg_property_autoembed();
  END IF;
END $$;

-- property_sync_runs — the sync/enrichment audit table (written by property-sync + property-enrich-montinmo).
CREATE TABLE IF NOT EXISTS public.property_sync_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id             text NOT NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  properties_found      integer,
  properties_updated    integer,
  properties_withdrawn  integer,
  error_message         text,
  status                text NOT NULL DEFAULT 'running',
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.property_sync_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_sync_runs' AND policyname='property_sync_runs_isolation') THEN
    CREATE POLICY property_sync_runs_isolation ON public.property_sync_runs FOR ALL TO aivena_app
      USING (agency_id = current_setting('app.current_agency_id', true));
  END IF;
END $$;

-- ⚠ GRANTS DRIFT (flagged, deliberately NOT changed here — this file is capture-only): live default
-- privileges over-grant `anon` + `authenticated` FULL DML on public.properties (the same Supabase
-- default-privilege pattern that was hardened for agency_agreements). Effective protection today is RLS
-- (FORCE) + a policy scoped to aivena_app only, so anon/authenticated cannot actually read/write across
-- tenants — but the raw grants should be tightened to SELECT-only for app roles in a SEPARATE, gated
-- hardening migration. Not applied here.
