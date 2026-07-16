-- update_lead_preferences — agent-editable buyer preferences (Packet 3 data/API layer for Packet 2).
--
-- WHY: Packet 2's buyer-profile Edit UI (El Raso Step 3) needs a safe write path to change a lead's
-- structured preferences. The whole downstream chain already exists and is live: writing these
-- columns fires trg_lead_autoembed (re-embed on location/budget change) and trg_lead_automatch
-- (re-match on any of bedrooms_min/max, bathrooms_min, budget_extracted, property_type_pref,
-- location_interest_extracted/raw — verified against the deployed trigger). So this RPC only writes
-- the row + audits; the triggers refresh embedding + lead_property_matches. NO matcher/extractor
-- change, NO new trigger.
--
-- SAFETY (mirrors the proven add_lead_note pattern — this is the SAFE DEFINER shape, not the
-- agency-as-parameter kind revoked from `authenticated` on 2026-07-04):
--   * SECURITY DEFINER, but agency comes from current_setting('app.current_agency_id'), NEVER a
--     parameter → no cross-tenant surface.
--   * require_role('agent') — owner/agent/aivena_staff pass; viewer is blocked.
--   * explicit cross-agency guard (the lead must belong to the caller's agency).
--   * buyer-only (lead_type must be 'buyer').
--   * EXECUTE granted ONLY to aivena_app + service_role; REVOKEd from anon/authenticated/public, so
--     no browser/JWT role can call it directly (the API calls it via the pooled aivena_app conn).
--   * writes a lead_events audit row (before/after + changed keys + editor) — never silent.
--
-- PATCH SEMANTICS: p_patch is a partial jsonb object. A key PRESENT sets that field (json null clears
-- it); a key ABSENT leaves it unchanged. Only these 6 keys are editable — any other key is rejected.
--
-- Rollback: DROP FUNCTION public.update_lead_preferences(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.update_lead_preferences(p_lead_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency   text := current_setting('app.current_agency_id', true);
  v_caller   uuid;
  v_lead     public.leads%ROWTYPE;
  v_key      text;
  v_before   jsonb;
  v_after    jsonb;
  v_changed  text[] := '{}';
  -- new values, initialised to current so an absent key = keep
  n_location text;
  n_budget   numeric;
  n_ptype    text;
  n_bmin     integer;
  n_bmax     integer;
  n_bathmin  integer;
BEGIN
  -- 1. context
  IF v_agency IS NULL OR v_agency = '' THEN
    RAISE EXCEPTION 'no_agency_context' USING ERRCODE = 'P0001';
  END IF;
  v_caller := COALESCE(NULLIF(current_setting('app.current_user_id', true), '')::uuid, auth.uid());
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'no_auth_context' USING ERRCODE = 'P0001';
  END IF;

  -- 2. role gate (owner/agent/aivena_staff pass; viewer blocked)
  PERFORM public.require_role('agent'::public.agency_role);

  -- 3. patch shape + editable-key whitelist (reject anything else outright)
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_patch' USING ERRCODE = 'P0001';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('location_interest_extracted','budget_extracted','property_type_pref',
                     'bedrooms_min','bedrooms_max','bathrooms_min') THEN
      RAISE EXCEPTION 'unknown_field' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT (p_patch ?| ARRAY['location_interest_extracted','budget_extracted','property_type_pref',
                           'bedrooms_min','bedrooms_max','bathrooms_min']) THEN
    RAISE EXCEPTION 'no_fields' USING ERRCODE = 'P0001';
  END IF;

  -- 4. load + cross-agency guard + buyer-only
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_lead.agency_id <> v_agency THEN
    RAISE EXCEPTION 'lead_wrong_agency' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_lead.lead_type, 'buyer') <> 'buyer' THEN
    RAISE EXCEPTION 'not_a_buyer_lead' USING ERRCODE = 'P0001';
  END IF;

  -- 5. resolve new values (present key applies; absent key keeps current). json null clears.
  n_location := v_lead.location_interest_extracted;
  n_budget   := v_lead.budget_extracted;
  n_ptype    := v_lead.property_type_pref;
  n_bmin     := v_lead.bedrooms_min;
  n_bmax     := v_lead.bedrooms_max;
  n_bathmin  := v_lead.bathrooms_min;

  IF p_patch ? 'location_interest_extracted' THEN
    n_location := NULLIF(btrim(p_patch->>'location_interest_extracted'), '');
  END IF;
  IF p_patch ? 'property_type_pref' THEN
    n_ptype := NULLIF(btrim(p_patch->>'property_type_pref'), '');
  END IF;
  IF p_patch ? 'budget_extracted' THEN
    IF jsonb_typeof(p_patch->'budget_extracted') = 'null' THEN
      n_budget := NULL;
    ELSIF jsonb_typeof(p_patch->'budget_extracted') = 'number' THEN
      n_budget := (p_patch->>'budget_extracted')::numeric;
      IF n_budget < 0 OR n_budget > 1e12 THEN RAISE EXCEPTION 'invalid_budget' USING ERRCODE='P0001'; END IF;
    ELSE
      RAISE EXCEPTION 'invalid_budget' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  n_bmin    := public._lead_pref_int(p_patch, 'bedrooms_min',  n_bmin);
  n_bmax    := public._lead_pref_int(p_patch, 'bedrooms_max',  n_bmax);
  n_bathmin := public._lead_pref_int(p_patch, 'bathrooms_min', n_bathmin);

  IF n_bmin IS NOT NULL AND n_bmax IS NOT NULL AND n_bmin > n_bmax THEN
    RAISE EXCEPTION 'invalid_bedrooms_range' USING ERRCODE = 'P0001';
  END IF;

  -- 6. before/after snapshots + changed-key list (honest audit)
  v_before := jsonb_build_object(
    'location_interest_extracted', v_lead.location_interest_extracted,
    'budget_extracted', v_lead.budget_extracted,
    'property_type_pref', v_lead.property_type_pref,
    'bedrooms_min', v_lead.bedrooms_min,
    'bedrooms_max', v_lead.bedrooms_max,
    'bathrooms_min', v_lead.bathrooms_min);
  v_after := jsonb_build_object(
    'location_interest_extracted', n_location,
    'budget_extracted', n_budget,
    'property_type_pref', n_ptype,
    'bedrooms_min', n_bmin,
    'bedrooms_max', n_bmax,
    'bathrooms_min', n_bathmin);
  SELECT array_agg(k) INTO v_changed
  FROM jsonb_object_keys(v_before) k
  WHERE (v_before->k) IS DISTINCT FROM (v_after->k);

  -- 7. write (extra agency fence on the UPDATE) — fires autoembed + automatch
  UPDATE public.leads SET
    location_interest_extracted = n_location,
    budget_extracted            = n_budget,
    property_type_pref          = n_ptype,
    bedrooms_min                = n_bmin,
    bedrooms_max                = n_bmax,
    bathrooms_min               = n_bathmin,
    updated_at                  = now()
  WHERE id = p_lead_id AND agency_id = v_agency;

  -- 8. audit
  INSERT INTO public.lead_events (lead_id, agency_id, type, source, channel, platform, summary, raw_payload)
  VALUES (
    p_lead_id, v_agency, 'lead_preferences_updated', 'operator', 'system', 'dashboard',
    'Buyer preferences edited by ' || COALESCE((SELECT email FROM auth.users WHERE id = v_caller), 'unknown'),
    jsonb_build_object('before', v_before, 'after', v_after,
                       'changed_keys', COALESCE(to_jsonb(v_changed), '[]'::jsonb),
                       'editor', v_caller)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'lead_id', p_lead_id,
    'preferences', v_after,
    'changed_keys', COALESCE(to_jsonb(v_changed), '[]'::jsonb),
    'note', 'Matches and embedding refresh automatically.'
  );
END;
$function$;

-- Small typed-int helper for the three integer prefs (present → apply, json null → clear,
-- non-int or out-of-range → reject). Kept as its own function so the main body stays readable.
CREATE OR REPLACE FUNCTION public._lead_pref_int(p_patch jsonb, p_key text, p_current integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v integer;
BEGIN
  IF NOT (p_patch ? p_key) THEN RETURN p_current; END IF;
  IF jsonb_typeof(p_patch->p_key) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_patch->p_key) <> 'number' THEN
    RAISE EXCEPTION 'invalid_number' USING ERRCODE = 'P0001';
  END IF;
  v := (p_patch->>p_key)::numeric::integer;
  IF v < 0 OR v > 50 THEN
    RAISE EXCEPTION 'invalid_number' USING ERRCODE = 'P0001';
  END IF;
  RETURN v;
END;
$function$;

-- Lock down: only the API's pooled role + service_role may call these. No browser/JWT role.
REVOKE ALL ON FUNCTION public.update_lead_preferences(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lead_pref_int(jsonb, text, integer)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_lead_preferences(uuid, jsonb) TO aivena_app, service_role;
GRANT EXECUTE ON FUNCTION public._lead_pref_int(jsonb, text, integer)  TO aivena_app, service_role;
