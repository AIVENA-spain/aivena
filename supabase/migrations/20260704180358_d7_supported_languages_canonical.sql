-- PRESERVED FOR SOURCE OF TRUTH — THIS MIGRATION IS ALREADY APPLIED TO PRODUCTION.
-- Applied 2026-07-04 as ledger version 20260704180358 ('d7_supported_languages_canonical' in supabase_migrations.schema_migrations).
-- It was applied out-of-band via apply_migration and the file was never committed, so this branch
-- (packet3-d7-supported-languages, 1f674c6) held the ONLY git copy of schema that is live right now. Deleting that branch
-- would have destroyed it, and a rebuild-from-migrations would then silently omit live objects.
-- Committing this changes NOTHING in the database: a migration runner finds the version already in
-- the ledger and SKIPS it. The SQL below is byte-exact from the source branch — do not 'tidy' it.
-- STALE CLAIM BELOW: the 'DRAFT — NOT YET APPLIED' wording is FALSE and has been since 2026-07-04.
-- It is left in place so the artifact stays exact; THIS header is the authoritative statement.

-- D7 — supported_languages reconciliation (Packet 3 task 13). DRAFT — NOT YET APPLIED.
--
-- CANONICAL SOURCE = agency_settings.supported_languages (the column the Settings edit UI
-- writes, that readiness treats as canonical, and that Packet-1 I8/I9 read for template
-- replication). agencies.supported_languages is kept as a MIRROR that must never drift —
-- so every existing reader (auth context, admin, dashboard profile via dashboard_settings)
-- keeps working unchanged (NO auth-context / reader code change). A forward-sync trigger
-- guarantees agencies == agency_settings from now on, and a one-time backfill reconciles
-- the drift that already exists (verified live: wf1v2-test-agency has agencies=[es,en] but
-- agency_settings=[es,en,no,sv,de,pl]).
--
-- Also normalizes agency_settings.default_language from legacy full words → ISO codes
-- (verified live: demo has 'english'; others already ISO). Norwegian stays 'no' at the
-- agency level (the per-user 'nb' UI-catalog alias + the template no→nb mapping are a
-- SEPARATE layer and are NOT touched here).
--
-- Apply ONLY with control-tower approval. Safe/idempotent; rollback documented at the end.

-- 1) One-time reconcile — canonical agency_settings wins into the agencies mirror.
UPDATE agencies a
   SET supported_languages = s.supported_languages,
       updated_at = now()
  FROM agency_settings s
 WHERE s.agency_id = a.id
   AND s.supported_languages IS NOT NULL
   AND cardinality(s.supported_languages) > 0
   AND a.supported_languages IS DISTINCT FROM s.supported_languages;

-- ...and if agency_settings is somehow empty but agencies has a value, seed settings from it
-- (keeps the canonical column populated for every agency before the trigger takes over).
UPDATE agency_settings s
   SET supported_languages = a.supported_languages,
       updated_at = now()
  FROM agencies a
 WHERE a.id = s.agency_id
   AND (s.supported_languages IS NULL OR cardinality(s.supported_languages) = 0)
   AND a.supported_languages IS NOT NULL
   AND cardinality(a.supported_languages) > 0;

-- 2) Forward-sync trigger — any change to the canonical column mirrors into agencies.
--    Tenant-scoped (id = NEW.agency_id); one-directional, so no trigger loop. SECURITY DEFINER
--    so the sync is reliable regardless of the writer's row-level grants.
CREATE OR REPLACE FUNCTION public.sync_supported_languages_to_agency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.supported_languages IS DISTINCT FROM OLD.supported_languages THEN
    UPDATE agencies
       SET supported_languages = NEW.supported_languages,
           updated_at = now()
     WHERE id = NEW.agency_id
       AND supported_languages IS DISTINCT FROM NEW.supported_languages;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agency_settings_sync_langs ON public.agency_settings;
CREATE TRIGGER agency_settings_sync_langs
  AFTER INSERT OR UPDATE OF supported_languages ON public.agency_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_supported_languages_to_agency();

-- 3) default_language — normalize legacy full words to ISO codes (Norwegian → 'no', the
--    agency-level convention, NOT 'nb').
UPDATE agency_settings
   SET default_language = CASE lower(btrim(default_language))
         WHEN 'english'    THEN 'en'
         WHEN 'spanish'    THEN 'es'
         WHEN 'german'     THEN 'de'
         WHEN 'french'     THEN 'fr'
         WHEN 'dutch'      THEN 'nl'
         WHEN 'italian'    THEN 'it'
         WHEN 'portuguese' THEN 'pt'
         WHEN 'polish'     THEN 'pl'
         WHEN 'russian'    THEN 'ru'
         WHEN 'danish'     THEN 'da'
         WHEN 'finnish'    THEN 'fi'
         WHEN 'swedish'    THEN 'sv'
         WHEN 'norwegian'  THEN 'no'
         ELSE default_language
       END,
       updated_at = now()
 WHERE lower(btrim(default_language)) IN
   ('english','spanish','german','french','dutch','italian','portuguese',
    'polish','russian','danish','finnish','swedish','norwegian');

-- ROLLBACK (documented, not run):
--   DROP TRIGGER IF EXISTS agency_settings_sync_langs ON public.agency_settings;
--   DROP FUNCTION IF EXISTS public.sync_supported_languages_to_agency();
--   -- The backfill + default_language normalization only made the two columns consistent /
--   -- corrected legacy values; there is no meaningful data to "un-reconcile". If required,
--   -- prior per-agency values are recoverable from this migration's pre-image in backups.
