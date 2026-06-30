-- C3 Step 1 (FIX) — make the pilot_status write-restriction ACTUALLY effective.
--
-- 20260627000002's `REVOKE UPDATE (pilot_status) ON agencies FROM aivena_app` was a
-- NO-OP: aivena_app holds a TABLE-level UPDATE grant on agencies, which covers every
-- column and supersedes a column-level revoke (Postgres privilege semantics —
-- has_column_privilege returns true via the table grant).
--
-- Correct column restriction: drop the blanket table-UPDATE and re-GRANT UPDATE on
-- every agencies column EXCEPT pilot_status. NON-DESTRUCTIVE — this preserves
-- aivena_app's UPDATE on all other columns (verified: no API path updates `agencies`
-- as aivena_app today, so this is precautionary; column-exclusion is strictly safer
-- than a full revoke). Only pilot_status becomes unwritable by aivena_app.
--
-- The set_agency_pilot_status RPC (SECURITY DEFINER, owner = postgres) is unaffected
-- and remains the ONLY writer; admin_* RPCs (also SECURITY DEFINER) are unaffected.
-- Rollback: GRANT UPDATE ON public.agencies TO aivena_app (restore the table grant).

REVOKE UPDATE ON public.agencies FROM aivena_app;

GRANT UPDATE (
  id, slug, legal_name, trading_name, cif_nif, status,
  primary_owner_email, primary_owner_phone, primary_region,
  supported_languages, notes, created_at, updated_at
) ON public.agencies TO aivena_app;
