-- PRESERVED FOR SOURCE OF TRUTH — THIS MIGRATION IS ALREADY APPLIED TO PRODUCTION.
-- Applied 2026-07-04 as ledger version 20260704184645 ('d4_tone_canonical' in supabase_migrations.schema_migrations).
-- It was applied out-of-band via apply_migration and the file was never committed, so this branch
-- (packet3-d4-tone, b1200fc) held the ONLY git copy of schema that is live right now. Deleting that branch
-- would have destroyed it, and a rebuild-from-migrations would then silently omit live objects.
-- Committing this changes NOTHING in the database: a migration runner finds the version already in
-- the ledger and SKIPS it. The SQL below is byte-exact from the source branch — do not 'tidy' it.
-- STALE CLAIM BELOW: the 'DRAFT — NOT YET APPLIED' wording is FALSE and has been since 2026-07-04.
-- It is left in place so the artifact stays exact; THIS header is the authoritative statement.

-- D4 — tone reconciliation (Packet 3 task 13, D4 half). DRAFT — NOT YET APPLIED.
--
-- CANONICAL = agency_settings.tone (recorded decision). agency_branding.tone is kept as a
-- trigger-synced MIRROR so every existing reader (dashboard AI section + readiness, both via the
-- dashboard_settings RPC's branding.tone) stays unchanged and always sees canonical — exactly the
-- D7 (supported_languages) pattern. No reader/auth repoint.
--
-- Demo tone decision (Christian, 2026-07-04): canonical value = 'professional' (the product truth in
-- agency_settings.tone). The demo's drifted branding.tone='formal' is corrected to 'professional' by
-- the backfill below — do NOT preserve the stale mirror value.
--
-- Apply ONLY with control-tower approval. Rollback documented at the end.

-- 1) One-time reconcile — canonical agency_settings.tone wins into the agency_branding.tone mirror
--    (fixes the live demo divergence: branding 'formal' -> 'professional').
UPDATE agency_branding b
   SET tone = s.tone,
       updated_at = now()
  FROM agency_settings s
 WHERE s.agency_id = b.agency_id
   AND s.tone IS NOT NULL
   AND b.tone IS DISTINCT FROM s.tone;

-- 2) Forward-sync trigger — any change to canonical agency_settings.tone mirrors into agency_branding.
--    Tenant-scoped, one-directional (no loop), SECURITY DEFINER for reliable sync. Mirrors the D7 fn.
CREATE OR REPLACE FUNCTION public.sync_tone_to_branding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.tone IS DISTINCT FROM OLD.tone THEN
    UPDATE agency_branding
       SET tone = NEW.tone,
           updated_at = now()
     WHERE agency_id = NEW.agency_id
       AND tone IS DISTINCT FROM NEW.tone;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS agency_settings_sync_tone ON public.agency_settings;
CREATE TRIGGER agency_settings_sync_tone
  AFTER INSERT OR UPDATE OF tone ON public.agency_settings
  FOR EACH ROW EXECUTE FUNCTION public.sync_tone_to_branding();

-- ROLLBACK (documented, not run):
--   DROP TRIGGER IF EXISTS agency_settings_sync_tone ON public.agency_settings;
--   DROP FUNCTION IF EXISTS public.sync_tone_to_branding();
--   -- The backfill only aligned the mirror to canonical; prior branding.tone recoverable from backup.
