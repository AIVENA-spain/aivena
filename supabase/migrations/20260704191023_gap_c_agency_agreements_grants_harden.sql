-- PRESERVED FOR SOURCE OF TRUTH — THIS MIGRATION IS ALREADY APPLIED TO PRODUCTION.
-- Applied 2026-07-04 as ledger version 20260704191023 ('gap_c_agency_agreements_grants_harden' in supabase_migrations.schema_migrations).
-- It was applied out-of-band via apply_migration and the file was never committed, so this branch
-- (packet3-gapc-agreements, 4a556b0) held the ONLY git copy of schema that is live right now. Deleting that branch
-- would have destroyed it, and a rebuild-from-migrations would then silently omit live objects.
-- Committing this changes NOTHING in the database: a migration runner finds the version already in
-- the ledger and SKIPS it. The SQL below is byte-exact from the source branch — do not 'tidy' it.

-- Gap C grants hardening: Supabase default privileges over-granted anon/authenticated/aivena_app
-- with full DML on the new table. Restrict to SELECT-only for app roles (all writes go through the
-- SECURITY DEFINER record_agency_agreement RPC); anon gets nothing. Defense-in-depth with RLS + the
-- append-only trigger. service_role/postgres keep their admin grants.
REVOKE ALL ON public.agency_agreements FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.agency_agreements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.agency_agreements FROM aivena_app;
