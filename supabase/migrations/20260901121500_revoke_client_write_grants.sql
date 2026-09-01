-- APPLIED to production 2026-09-01 on Christian's explicit approval.
--
-- public._imp was dropped separately (drop_imp_studio_import_scratch), so six
-- tables remained, carrying 24 client write grants between them.
--
-- VERIFIED AFTER APPLYING, by privilege check rather than assumption:
--   authenticated -> agencies : SELECT true, UPDATE/DELETE/TRUNCATE all false
--   aivena_app and service_role writes intact (164 and 180 grants)
--   0 client write grants left anywhere in schema public
--
-- Finding F8 of the 2026-08-31 audit. Seven public tables carry real write
-- privileges (INSERT/UPDATE/DELETE/TRUNCATE) for the browser roles anon and
-- authenticated. They came from the DEFAULT ACL of the supabase_admin role,
-- which grants arwdDxtm to anon and authenticated on every table THAT ROLE
-- creates - i.e. anything made in the Supabase dashboard SQL editor. Our own
-- migrations run as postgres, whose default ACL grants no write, which is why
-- most tables are clean. We cannot fix the supabase_admin default itself: this
-- connection is postgres and is not a member of supabase_admin.
--
-- Today RLS still denies these writes, but the margin is thinner than it looks:
-- agencies has a PERMISSIVE ALL policy for role `public` whose test is
-- `id = current_setting('app.current_agency_id', true)`. A browser session can
-- never set that GUC, so it evaluates NULL and denies. The grant means the
-- moment anyone adds a policy, or any path sets that GUC for a client session,
-- a browser JWT could INSERT, UPDATE, DELETE or TRUNCATE the tenant table.
--
-- Verified safe before writing this: the dashboard performs ZERO direct
-- supabase-js writes. Every write in the codebase goes through a service-role
-- client in the API or an Edge Function, or through aivena_app. waa_query_log
-- has an authenticated-INSERT policy but ZERO write sites anywhere in the
-- repo - it is vestigial. So no application path loses anything here.

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.agencies,
  public.area_zone_adjacent,
  public.area_zone_alias,
  public.area_zone_city,
  public.email_templates,
  public.waa_query_log
FROM anon, authenticated;

-- The vestigial policy that made waa_query_log look client-writable. Nothing
-- in the codebase inserts into this table.
DROP POLICY IF EXISTS waa_query_log_insert_jwt ON public.waa_query_log;

-- Proof, inside the same transaction: if any write grant survives for a browser
-- role, this aborts and nothing is committed.
DO $$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon','authenticated')
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
  IF leftover > 0 THEN
    RAISE EXCEPTION 'client write grants still present on % table/privilege pairs', leftover;
  END IF;
END $$;

COMMIT;
