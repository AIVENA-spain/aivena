-- dashboard_match_explanation: make the LOCATION verdict zone-aware so it agrees
-- with match_properties_for_lead. Before: a naive substring compare flagged any
-- property whose town name didn't literally contain the stated area as
-- 'different_area' (amber "Area mismatch") — even when the matcher had
-- deliberately included it because the town is IN that area's zone (e.g. Lomas de
-- Cabo Roig / Villamartín ∈ Orihuela Costa). After: if the property's city is a
-- member of the same zone the lead's area resolves to, the location reads 'match'
-- (green "Area fits"), identical to how the matcher decides membership.
-- Signature / SECURITY INVOKER / search_path unchanged; logic-only.
CREATE OR REPLACE FUNCTION public.dashboard_match_explanation(p_lead_id uuid, p_property_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agency text := current_setting('app.current_agency_id', true);
  v_lead   leads%ROWTYPE;
  v_wants  text;
  v_result jsonb;
  v_key_amenities text[] := ARRAY['pool','sea view','garden','parking','terrace','air conditioning'];
  -- Zone resolution for the location verdict (mirrors match_properties_for_lead).
  v_area_n      text;
  v_zone        text;
  v_zone_cities text[] := NULL;
  c_from CONSTANT text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_to   CONSTANT text := 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
BEGIN
  -- Fail-closed tenant fence: unset GUC -> v_agency NULL -> no row matches.
  SELECT * INTO v_lead
    FROM leads
   WHERE id = p_lead_id
     AND agency_id = v_agency;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  -- Buyer's free-text wants, including AI-context notes, for requested-feature detection.
  v_wants := lower(concat_ws(' ',
      v_lead.message,
      v_lead.summary,
      v_lead.location_interest_raw,
      (SELECT string_agg(body, ' ')
         FROM lead_notes
        WHERE lead_id = p_lead_id
          AND context_for_ai = true)
  ));

  -- Resolve the lead's stated area to a zone + its member cities, exactly like the
  -- matcher: exact alias first, then the longest alias contained in the string.
  v_area_n := lower(btrim(translate(COALESCE(v_lead.location_interest_extracted, ''), c_from, c_to)));
  v_area_n := btrim(regexp_replace(v_area_n, '\s+(area|zona|zone|region)$', ''));
  IF v_area_n <> '' THEN
    SELECT a.zone INTO v_zone FROM public.area_zone_alias a WHERE a.alias = v_area_n;
    IF v_zone IS NULL THEN
      SELECT a.zone INTO v_zone
        FROM public.area_zone_alias a
       WHERE v_area_n LIKE '%' || a.alias || '%'
       ORDER BY length(a.alias) DESC
       LIMIT 1;
    END IF;
    IF v_zone IS NOT NULL THEN
      SELECT array_agg(c.city) INTO v_zone_cities FROM public.area_zone_city c WHERE c.zone = v_zone;
    END IF;
  END IF;

  SELECT jsonb_agg(expl ORDER BY rnk NULLS LAST, sim DESC)
    INTO v_result
  FROM (
    SELECT
      m.rank AS rnk,
      m.similarity AS sim,
      jsonb_build_object(
        'property_id', p.id,
        'reference', p.external_id,
        'title', p.title,
        'similarity', m.similarity,
        'rank', m.rank,
        'match_status', m.status,
        'dimensions', jsonb_build_array(
          jsonb_build_object('key','budget',
            'lead_value', v_lead.budget_extracted,
            'property_value', p.price,
            'verdict', CASE
              WHEN v_lead.budget_extracted IS NULL OR p.price IS NULL THEN 'unknown'
              WHEN p.price <= v_lead.budget_extracted THEN 'match'
              WHEN p.price <= v_lead.budget_extracted * 1.10 THEN 'slightly_over'
              ELSE 'over_budget' END),
          jsonb_build_object('key','location',
            'lead_value', v_lead.location_interest_extracted,
            'property_value', concat_ws(', ', p.location_city, p.location_region),
            'verdict', CASE
              WHEN v_lead.location_interest_extracted IS NULL THEN 'unknown'
              WHEN p.location_city ILIKE '%'||v_lead.location_interest_extracted||'%'
                OR p.location_region ILIKE '%'||v_lead.location_interest_extracted||'%'
                OR v_lead.location_interest_extracted ILIKE '%'||coalesce(p.location_city,'~~none~~')||'%'
                THEN 'match'
              WHEN v_zone_cities IS NOT NULL
                AND lower(btrim(translate(COALESCE(p.location_city,''), c_from, c_to))) = ANY(v_zone_cities)
                THEN 'match'
              ELSE 'different_area' END),
          jsonb_build_object('key','bedrooms',
            'lead_value', nullif(concat_ws('-', v_lead.bedrooms_min, v_lead.bedrooms_max),''),
            'property_value', p.bedrooms,
            'verdict', CASE
              WHEN v_lead.bedrooms_min IS NULL AND v_lead.bedrooms_max IS NULL THEN 'unknown'
              WHEN p.bedrooms IS NULL THEN 'unknown'
              WHEN p.bedrooms >= coalesce(v_lead.bedrooms_min,0)
               AND p.bedrooms <= coalesce(v_lead.bedrooms_max, 2147483647) THEN 'match'
              ELSE 'mismatch' END),
          jsonb_build_object('key','bathrooms',
            'lead_value', v_lead.bathrooms_min,
            'property_value', p.bathrooms,
            'verdict', CASE
              WHEN v_lead.bathrooms_min IS NULL THEN 'unknown'
              WHEN p.bathrooms IS NULL THEN 'unknown'
              WHEN p.bathrooms >= v_lead.bathrooms_min THEN 'match'
              ELSE 'mismatch' END),
          jsonb_build_object('key','property_type',
            'lead_value', v_lead.property_type_pref,
            'property_value', p.property_type,
            'verdict', CASE
              WHEN v_lead.property_type_pref IS NULL THEN 'unknown'
              WHEN p.property_type IS NULL THEN 'unknown'
              WHEN p.property_type ILIKE v_lead.property_type_pref THEN 'match'
              ELSE 'mismatch' END)
        ),
        'features', (
          SELECT jsonb_agg(jsonb_build_object(
            'name', a,
            'requested', (v_wants LIKE '%'||a||'%'),
            'verdict', CASE WHEN EXISTS (
                SELECT 1
                  FROM jsonb_array_elements_text(coalesce(p.features,'[]'::jsonb)) f
                 WHERE lower(f) LIKE '%'||a||'%'
              ) THEN 'confirmed' ELSE 'not_confirmed' END
          ))
          FROM unnest(v_key_amenities) a
        )
      ) AS expl
    FROM lead_property_matches m
    JOIN properties p ON p.id = m.property_id
    WHERE m.lead_id = p_lead_id
      AND m.agency_id = v_agency
      AND (p_property_id IS NULL OR m.property_id = p_property_id)
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'lead_id', p_lead_id,
    'matches', coalesce(v_result, '[]'::jsonb)
  );
END;
$function$;