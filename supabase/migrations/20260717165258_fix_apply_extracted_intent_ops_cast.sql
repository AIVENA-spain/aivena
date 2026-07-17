-- APPLIED as ledger 20260717165258. FIX for 20260717144218.
-- In apply_extracted_intent, the operator-summary append for the open_to_adjacent case used a BARE
-- string literal:
--     v_ops_parts := v_ops_parts || 'open to nearby towns';
-- With v_ops_parts being text[], an untyped literal RHS makes Postgres prefer array || array and
-- try to parse the literal as an array → SQLSTATE 22P02 'malformed array literal'. Every OTHER append
-- is '...' || v_x (unambiguously text), so only this line broke — and only on the open_to_nearby=true
-- path, which the (safety-classifier-degraded) verifier's test cases never exercised. The end-to-end
-- test on the test agency hit it (message → EF → apply_extracted_intent returned apply_failed).
-- Fix: cast the literal to text so text[] || text (append) is chosen. Also swapped the summary glyphs
-- from U+2192 (→) to ASCII '->' to avoid any transport ambiguity. CREATE OR REPLACE re-creates the
-- whole function verbatim with only those changes.
--
-- Rollback: CREATE OR REPLACE apply_extracted_intent from the 20260717144218 definition (the buggy one)
--   — not advised; this is a strict bugfix with no behaviour change on any path that already worked.

CREATE OR REPLACE FUNCTION public.apply_extracted_intent(
  p_lead_id           uuid,
  p_intent            jsonb,
  p_source            text,
  p_source_message_id uuid,
  p_summary           text,
  p_model             text,
  p_input_text        text    DEFAULT NULL,
  p_confidence        numeric DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_from CONSTANT text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_to   CONSTANT text := 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';

  v_lead   public.leads%ROWTYPE;
  v_agency text;

  v_areas_add      text[];
  v_areas_exclude  text[];
  v_must_haves     text[];
  v_open_nearby    boolean := false;
  v_budget         numeric;
  v_ptype          text;
  v_num            numeric;
  v_bmin           integer;
  v_bmax           integer;
  v_bathmin        integer;

  v_new_area       text;
  v_new_excluded   text[]  := '{}';
  v_new_excl_norm  text[]  := '{}';
  v_prior_excl_norm text[] := '{}';
  v_new_mh         text[]  := '{}';
  v_new_mh_norm    text[]  := '{}';
  v_prior_mh_norm  text[]  := '{}';
  v_new_open       boolean;

  v_loc_changed    boolean := false;
  v_excl_changed   boolean := false;
  v_open_changed   boolean := false;
  v_budget_changed boolean := false;
  v_ptype_changed  boolean := false;
  v_bmin_changed   boolean := false;
  v_bmax_changed   boolean := false;
  v_bathmin_changed boolean := false;
  v_mh_changed     boolean := false;

  v_applied  jsonb := '{}'::jsonb;
  v_changed  boolean := false;
  v_ops_parts text[] := '{}';
  v_summary_ops text;
  v_log_id   uuid;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'applied', '{}'::jsonb, 'log_id', NULL);
  END IF;
  IF p_intent IS NULL OR jsonb_typeof(p_intent) <> 'object' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'applied', '{}'::jsonb, 'log_id', NULL);
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'applied', '{}'::jsonb, 'log_id', NULL);
  END IF;
  IF COALESCE(v_lead.lead_type, 'buyer') <> 'buyer' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'applied', '{}'::jsonb, 'log_id', NULL);
  END IF;
  v_agency := v_lead.agency_id;

  v_areas_add     := public._intent_text_array(p_intent->'areas_add');
  v_areas_exclude := public._intent_text_array(p_intent->'areas_exclude');
  v_must_haves    := public._intent_text_array(p_intent->'must_haves');

  IF jsonb_typeof(p_intent->'open_to_nearby') = 'boolean' THEN
    v_open_nearby := (p_intent->>'open_to_nearby')::boolean;
  END IF;

  IF jsonb_typeof(p_intent->'budget_max') = 'number' THEN
    v_budget := (p_intent->>'budget_max')::numeric;
    IF v_budget IS NOT NULL AND (v_budget < 0 OR v_budget > 1e12) THEN v_budget := NULL; END IF;
  END IF;

  IF jsonb_typeof(p_intent->'property_type') = 'string' THEN
    v_ptype := NULLIF(btrim(p_intent->>'property_type'), '');
  END IF;

  IF jsonb_typeof(p_intent->'bedrooms_min') = 'number' THEN
    v_num := (p_intent->>'bedrooms_min')::numeric;
    IF v_num >= 0 AND v_num <= 50 THEN v_bmin := floor(v_num)::integer; END IF;
  END IF;
  IF jsonb_typeof(p_intent->'bedrooms_max') = 'number' THEN
    v_num := (p_intent->>'bedrooms_max')::numeric;
    IF v_num >= 0 AND v_num <= 50 THEN v_bmax := floor(v_num)::integer; END IF;
  END IF;
  IF jsonb_typeof(p_intent->'bathrooms_min') = 'number' THEN
    v_num := (p_intent->>'bathrooms_min')::numeric;
    IF v_num >= 0 AND v_num <= 50 THEN v_bathmin := floor(v_num)::integer; END IF;
  END IF;

  IF array_length(v_areas_add, 1) IS NOT NULL THEN
    v_new_area := v_areas_add[array_length(v_areas_add, 1)];
  END IF;
  IF v_new_area IS NOT NULL
     AND lower(btrim(v_new_area)) IS DISTINCT FROM lower(btrim(COALESCE(v_lead.location_interest_extracted, ''))) THEN
    v_loc_changed := true;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(translate(x, c_from, c_to))) ORDER BY lower(btrim(translate(x, c_from, c_to)))), '{}'::text[])
    INTO v_prior_excl_norm
    FROM unnest(COALESCE(v_lead.excluded_areas, '{}'::text[])) AS x
   WHERE btrim(COALESCE(x, '')) <> '';

  WITH prior AS (
    SELECT btrim(x) AS orig FROM unnest(COALESCE(v_lead.excluded_areas, '{}'::text[])) x
    UNION ALL
    SELECT btrim(x) AS orig FROM unnest(v_areas_exclude) x
  ),
  add_norm AS (
    SELECT DISTINCT lower(btrim(translate(x, c_from, c_to))) AS norm
      FROM unnest(v_areas_add) x
     WHERE btrim(COALESCE(x, '')) <> ''
  ),
  cand AS (
    SELECT orig, lower(btrim(translate(orig, c_from, c_to))) AS norm
      FROM prior
     WHERE COALESCE(orig, '') <> ''
  ),
  keep AS (
    SELECT DISTINCT ON (norm) orig, norm
      FROM cand
     WHERE norm NOT IN (SELECT norm FROM add_norm)
     ORDER BY norm, orig
  )
  SELECT COALESCE(array_agg(orig ORDER BY norm), '{}'::text[]),
         COALESCE(array_agg(norm ORDER BY norm), '{}'::text[])
    INTO v_new_excluded, v_new_excl_norm
    FROM keep;

  IF v_new_excl_norm IS DISTINCT FROM v_prior_excl_norm THEN
    v_excl_changed := true;
  END IF;

  v_new_open := COALESCE(v_lead.open_to_adjacent, false) OR v_open_nearby;
  IF v_new_open IS DISTINCT FROM COALESCE(v_lead.open_to_adjacent, false) THEN
    v_open_changed := true;
  END IF;

  IF v_budget IS NOT NULL AND v_budget IS DISTINCT FROM v_lead.budget_extracted THEN
    v_budget_changed := true;
  END IF;
  IF v_ptype IS NOT NULL AND v_ptype IS DISTINCT FROM v_lead.property_type_pref THEN
    v_ptype_changed := true;
  END IF;
  IF v_bmin IS NOT NULL AND v_bmin IS DISTINCT FROM v_lead.bedrooms_min THEN
    v_bmin_changed := true;
  END IF;
  IF v_bmax IS NOT NULL AND v_bmax IS DISTINCT FROM v_lead.bedrooms_max THEN
    v_bmax_changed := true;
  END IF;
  IF v_bathmin IS NOT NULL AND v_bathmin IS DISTINCT FROM v_lead.bathrooms_min THEN
    v_bathmin_changed := true;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(x)) ORDER BY lower(btrim(x))), '{}'::text[])
    INTO v_prior_mh_norm
    FROM unnest(COALESCE(v_lead.must_haves, '{}'::text[])) AS x
   WHERE btrim(COALESCE(x, '')) <> '';

  WITH allmh AS (
    SELECT btrim(x) AS orig FROM unnest(COALESCE(v_lead.must_haves, '{}'::text[])) x
    UNION ALL
    SELECT btrim(x) AS orig FROM unnest(v_must_haves) x
  ),
  c AS (
    SELECT orig, lower(btrim(orig)) AS norm FROM allmh WHERE COALESCE(orig, '') <> ''
  ),
  k AS (
    SELECT DISTINCT ON (norm) orig, norm FROM c ORDER BY norm, orig
  )
  SELECT COALESCE(array_agg(orig ORDER BY norm), '{}'::text[]),
         COALESCE(array_agg(norm ORDER BY norm), '{}'::text[])
    INTO v_new_mh, v_new_mh_norm
    FROM k;

  IF v_new_mh_norm IS DISTINCT FROM v_prior_mh_norm THEN
    v_mh_changed := true;
  END IF;

  IF v_loc_changed THEN
    v_applied := v_applied || jsonb_build_object('location_interest_extracted', v_new_area);
    v_ops_parts := v_ops_parts || ('area -> ' || v_new_area);
  END IF;
  IF v_excl_changed THEN
    v_applied := v_applied || jsonb_build_object('excluded_areas', to_jsonb(NULLIF(v_new_excluded, '{}'::text[])));
    v_ops_parts := v_ops_parts || (
      CASE WHEN array_length(v_areas_exclude, 1) IS NOT NULL
           THEN 'excluded ' || array_to_string(v_areas_exclude, ', ')
           ELSE 'excluded areas updated' END);
  END IF;
  IF v_open_changed THEN
    v_applied := v_applied || jsonb_build_object('open_to_adjacent', v_new_open);
    v_ops_parts := v_ops_parts || 'open to nearby towns'::text;   -- FIX: ::text so text[] || text (append) is chosen
  END IF;
  IF v_budget_changed THEN
    v_applied := v_applied || jsonb_build_object('budget_extracted', v_budget);
    v_ops_parts := v_ops_parts || ('budget -> ' || v_budget::text);
  END IF;
  IF v_ptype_changed THEN
    v_applied := v_applied || jsonb_build_object('property_type_pref', v_ptype);
    v_ops_parts := v_ops_parts || ('type -> ' || v_ptype);
  END IF;
  IF v_bmin_changed THEN
    v_applied := v_applied || jsonb_build_object('bedrooms_min', v_bmin);
    v_ops_parts := v_ops_parts || ('min beds -> ' || v_bmin::text);
  END IF;
  IF v_bmax_changed THEN
    v_applied := v_applied || jsonb_build_object('bedrooms_max', v_bmax);
    v_ops_parts := v_ops_parts || ('max beds -> ' || v_bmax::text);
  END IF;
  IF v_bathmin_changed THEN
    v_applied := v_applied || jsonb_build_object('bathrooms_min', v_bathmin);
    v_ops_parts := v_ops_parts || ('min baths -> ' || v_bathmin::text);
  END IF;
  IF v_mh_changed THEN
    v_applied := v_applied || jsonb_build_object('must_haves', to_jsonb(NULLIF(v_new_mh, '{}'::text[])));
    v_ops_parts := v_ops_parts || ('must-haves +' || array_to_string(v_must_haves, ', '));
  END IF;

  v_changed := (v_applied <> '{}'::jsonb);

  IF v_changed THEN
    UPDATE public.leads SET
      location_interest_extracted = CASE WHEN v_loc_changed     THEN v_new_area     ELSE location_interest_extracted END,
      excluded_areas              = CASE WHEN v_excl_changed    THEN NULLIF(v_new_excluded, '{}'::text[]) ELSE excluded_areas END,
      open_to_adjacent            = CASE WHEN v_open_changed    THEN v_new_open     ELSE open_to_adjacent END,
      budget_extracted            = CASE WHEN v_budget_changed  THEN v_budget       ELSE budget_extracted END,
      property_type_pref          = CASE WHEN v_ptype_changed   THEN v_ptype        ELSE property_type_pref END,
      bedrooms_min                = CASE WHEN v_bmin_changed    THEN v_bmin         ELSE bedrooms_min END,
      bedrooms_max                = CASE WHEN v_bmax_changed    THEN v_bmax         ELSE bedrooms_max END,
      bathrooms_min               = CASE WHEN v_bathmin_changed THEN v_bathmin      ELSE bathrooms_min END,
      must_haves                  = CASE WHEN v_mh_changed      THEN NULLIF(v_new_mh, '{}'::text[]) ELSE must_haves END,
      updated_at                  = now()
    WHERE id = p_lead_id AND agency_id = v_agency;

    v_summary_ops := 'Read from buyer message: ' || array_to_string(v_ops_parts, '; ');
    BEGIN
      INSERT INTO public.lead_events (lead_id, agency_id, type, source, summary, raw_payload)
      VALUES (
        p_lead_id, v_agency, 'interest_updated_from_conversation', 'conversation_interest',
        left(v_summary_ops, 500),
        jsonb_build_object('source', p_source, 'intent', p_intent, 'applied', v_applied, 'summary_buyer', p_summary)
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  BEGIN
    INSERT INTO public.lead_extraction_log
      (lead_id, agency_id, source_message_id, source, model, input_text, intent, applied, summary, confidence)
    VALUES
      (p_lead_id, v_agency, p_source_message_id, p_source, p_model, p_input_text,
       p_intent, v_applied, p_summary, p_confidence)
    RETURNING id INTO v_log_id;
  EXCEPTION WHEN OTHERS THEN
    v_log_id := NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed, 'applied', v_applied, 'log_id', v_log_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_extracted_intent(uuid,jsonb,text,uuid,text,text,text,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_extracted_intent(uuid,jsonb,text,uuid,text,text,text,numeric)
  TO service_role;
