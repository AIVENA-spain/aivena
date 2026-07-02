-- Phase 1: server-truth test/demo flag for agencies (replaces the dashboard's hardcoded
-- allowlist). Additive, non-destructive. Adding a NOT NULL column with a constant default
-- is a metadata-only change (no table rewrite). aivena_app has NO column grant on is_test
-- (its grant is the explicit 13-column list from 20260630132639), so it cannot write it;
-- only the staff-gated SECURITY DEFINER admin_set_agency_test_flag RPC will.
ALTER TABLE public.agencies
  ADD COLUMN is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agencies.is_test IS
  'Internal test/demo agency — hidden from the admin list by default (server truth; replaces the hardcoded allowlist). Set only via admin_set_agency_test_flag (staff-gated, audited). NOT a delete/archive.';

-- Backfill the four KNOWN internal test agencies by explicit id (no pattern match, no delete).
-- The real pilot demo (demo-costa-homes-pilot01) is intentionally NOT included.
UPDATE public.agencies
   SET is_test = true, updated_at = now()
 WHERE id IN (
   'cc-verify-delete-me',
   'cc-verify-email-test',
   'testing-agency',
   'wf1v2-test-agency-aaaaaaaaaaaa'
 );
