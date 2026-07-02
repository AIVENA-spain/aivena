-- Reconciliation: admin_log_staff_action was created out-of-band (not captured in any
-- committed migration). Phase-1's admin_set_agency_status / admin_set_agency_test_flag call
-- it, so capture its exact live definition here (idempotent CREATE OR REPLACE — a no-op on
-- the live DB where it already exists) so a clean rebuild (db reset / fresh branch) has it.
--
-- Ordering note: this runs AFTER 20260702183323 (which defines the RPCs that reference it),
-- which is fine — plpgsql defers called-function resolution to runtime, and by the time any
-- archive/test-flag RPC is actually invoked (post-migration) this helper exists.
CREATE OR REPLACE FUNCTION public.admin_log_staff_action(p_target_agency_id text, p_action text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_log_id uuid;
  v_meta jsonb;
BEGIN
  IF NOT is_aivena_staff() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  v_meta := jsonb_build_object('action', p_action) || COALESCE(p_metadata, '{}'::jsonb);

  INSERT INTO staff_audit_log (event_type, actor_user_id, target_agency_id, metadata)
  VALUES ('staff_action', auth.uid(), p_target_agency_id, v_meta)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;
