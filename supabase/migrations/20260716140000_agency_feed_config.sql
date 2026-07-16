-- Feed-config store (Packet 3 — real-catalogue ingestion, Stage 1). Per-agency Kyero feed URL +
-- schedule, read by the pg_cron sync scheduler (Stage 4) which invokes property-sync per due agency.
--
-- NOT YET APPLIED — held for review + applied alongside the Stage-4 scheduler. On the live DB this
-- renames the EMPTY, unused, misleadingly-named `agency_scraper_config` (0 rows, no code reader —
-- AIVENA ingests Kyero FEEDS, it does not scrape). Zero behaviour change; nothing depends on it yet.
-- On a from-scratch rebuild this runs AFTER 20260601000100 (which captures agency_scraper_config),
-- renaming it forward — consistent.
--
-- Rollback: rename the objects back + re-add selector_overrides (jsonb default '{}') + drop feed_format.

ALTER TABLE IF EXISTS public.agency_scraper_config RENAME TO agency_feed_config;

-- Columns → feed semantics (scraper naming was a lie; AIVENA does not scrape portals).
ALTER TABLE public.agency_feed_config RENAME COLUMN listings_url             TO feed_url;
ALTER TABLE public.agency_feed_config RENAME COLUMN scrape_interval_hours    TO sync_interval_hours;
ALTER TABLE public.agency_feed_config RENAME COLUMN scrape_enabled           TO sync_enabled;
ALTER TABLE public.agency_feed_config RENAME COLUMN last_scraped_at          TO last_synced_at;
ALTER TABLE public.agency_feed_config RENAME COLUMN last_scrape_status       TO last_sync_status;

-- Drop the vestigial scraper-only column; add the feed format (Kyero today, room for others later).
ALTER TABLE public.agency_feed_config DROP COLUMN IF EXISTS selector_overrides;
ALTER TABLE public.agency_feed_config ADD COLUMN IF NOT EXISTS feed_format text NOT NULL DEFAULT 'kyero';

-- Rename the carried-over objects so a future reader isn't misled by "scraper" names.
ALTER INDEX  IF EXISTS public.agency_scraper_config_pkey          RENAME TO agency_feed_config_pkey;
ALTER INDEX  IF EXISTS public.agency_scraper_config_agency_id_key RENAME TO agency_feed_config_agency_id_key;
ALTER POLICY IF EXISTS agency_scraper_config_isolation ON public.agency_feed_config RENAME TO agency_feed_config_isolation;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'agency_scraper_config_updated_at'
             AND tgrelid = 'public.agency_feed_config'::regclass) THEN
    ALTER TRIGGER agency_scraper_config_updated_at ON public.agency_feed_config
      RENAME TO agency_feed_config_updated_at;
  END IF;
END $$;

COMMENT ON TABLE public.agency_feed_config IS
  'Per-agency property FEED config (Kyero XML v3). feed_url + sync_interval_hours + sync_enabled drive '
  'the pg_cron scheduler that invokes the property-sync EF. Renamed from agency_scraper_config 2026-07-16 '
  '(AIVENA ingests feeds, it does not scrape). Token-protected feeds: embed the token in feed_url for now; '
  'a proper credential store (Vault) is a follow-up.';
