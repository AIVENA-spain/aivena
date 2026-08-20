-- Amanda catalogue search — make property-type matching ASYMMETRIC (Christian, 2026-08-20).
--
-- BEFORE: 'apartment' and 'penthouse'/'ático' were one bucket ('apt') in BOTH directions,
-- so asking specifically for a penthouse returned ordinary apartments too.
--
-- AFTER (the correct product model):
--   • "apartment" (also flat / studio / piso / apartamento) = the UMBRELLA for anything
--     in a building → still surfaces penthouses/áticos among the results.
--   • "penthouse" / "ático" = a SPECIFIC ask → returns ONLY penthouse-type listings,
--     never plain apartments.
-- Villa grouping (villa/chalet/detached) and every other behaviour are unchanged.
--
-- Read-only search fn (STABLE SECURITY DEFINER, is_test-gated). Signature unchanged.

CREATE OR REPLACE FUNCTION public.amanda_search_properties(
  p_agency_slug text,
  p_session_token text DEFAULT NULL::text,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 3,
  p_require_test boolean DEFAULT true)
 RETURNS TABLE(id uuid, external_id text, title text, property_type text, status text, price numeric, price_currency text, bedrooms integer, bathrooms integer, area_sqm numeric, area_built_sqm numeric, area_plot_sqm numeric, location_city text, location_region text, source_url text, images jsonb, features jsonb, description text, match_tier integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency   text;
  v_is_test  boolean;
  v_ref      text := nullif(btrim(p_filters->>'ref'), '');
  v_q        text := nullif(btrim(p_filters->>'q'), '');
  v_q_norm   text;
  v_loc      text;
  v_type     text;
  v_beds     int;
  v_baths    int;
  v_budget   numeric;
  v_open     boolean;
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 3);
  v_loc_norm text;
  v_zone     text;
  v_apt       text[] := ARRAY['apartment','penthouse','studio','flat','atico','ático','apartamento','piso'];
  v_villa     text[] := ARRAY['villa','chalet','detached'];
  v_penthouse text[] := ARRAY['penthouse','atico','ático'];
  v_req_penthouse boolean := false;
  v_req_apt       boolean := false;
  v_req_villa     boolean := false;
  c_from CONSTANT text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_to   CONSTANT text := 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
BEGIN
  SELECT a.id, a.is_test INTO v_agency, v_is_test FROM public.agencies a WHERE a.slug = p_agency_slug;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'agency_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_require_test AND NOT coalesce(v_is_test, false) THEN
    RAISE EXCEPTION 'agency_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.current_agency_id', v_agency, true);

  -- SPECIFIC-LISTING lookup: exact external_id (or id), ACTIVE only, one row.
  IF v_ref IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.external_id, p.title, p.property_type, p.status, p.price, p.price_currency,
           p.bedrooms, p.bathrooms, p.area_sqm, p.area_built_sqm, p.area_plot_sqm,
           p.location_city, p.location_region, p.source_url, coalesce(p.images, '[]'::jsonb), coalesce(p.features, '[]'::jsonb), p.description, 0
    FROM public.properties p
    WHERE p.agency_id = v_agency AND p.status = 'active'
      AND (upper(p.external_id) = upper(v_ref) OR p.id::text = lower(v_ref))
    LIMIT 1;
    RETURN;
  END IF;

  -- CRITERIA / PHRASE search.
  v_q_norm := CASE WHEN v_q IS NOT NULL THEN lower(btrim(translate(v_q, c_from, c_to))) END;
  v_loc    := nullif(btrim(p_filters->>'location'), '');
  v_type   := lower(nullif(btrim(p_filters->>'propertyType'), ''));
  v_beds   := nullif(p_filters->>'bedroomsMin', '')::int;
  v_baths  := nullif(p_filters->>'bathroomsMin', '')::int;
  v_budget := nullif(p_filters->>'budgetMax', '')::numeric;
  v_open   := coalesce((p_filters->>'openToAdjacent')::boolean, false);

  -- Asymmetric type intent: "apartment" is the umbrella for anything in a building
  -- (still surfaces penthouses); "penthouse"/"ático" is a specific ask (only those).
  v_req_penthouse := v_type = ANY(v_penthouse);
  v_req_apt       := v_type = ANY(v_apt) AND NOT v_req_penthouse;
  v_req_villa     := v_type = ANY(v_villa);

  IF v_loc IS NOT NULL THEN
    v_loc_norm := nullif(btrim(regexp_replace(lower(translate(v_loc, c_from, c_to)), '\s+(area|zona|zone|region)$', '')), '');
    SELECT COALESCE(
      (SELECT z.zone FROM public.area_zone_alias z WHERE z.alias = v_loc_norm),
      (SELECT z.zone FROM public.area_zone_alias z WHERE v_loc_norm LIKE '%'||z.alias||'%' ORDER BY length(z.alias) DESC LIMIT 1),
      (SELECT zc.zone FROM public.area_zone_city zc WHERE zc.city = v_loc_norm LIMIT 1)
    ) INTO v_zone;
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT p.*,
      lower(btrim(translate(coalesce(p.location_city,''), c_from, c_to))) AS city_norm,
      lower(translate(coalesce(p.title,''), c_from, c_to)) AS title_norm,
      COALESCE(
        (SELECT zc.zone FROM public.area_zone_city zc WHERE zc.city = lower(btrim(translate(coalesce(p.location_city,''), c_from, c_to))) LIMIT 1),
        (SELECT za.zone FROM public.area_zone_alias za WHERE za.alias = lower(btrim(translate(coalesce(p.location_city,''), c_from, c_to))) LIMIT 1)
      ) AS p_zone
    FROM public.properties p
    WHERE p.agency_id = v_agency AND p.status = 'active'
  )
  SELECT s.id, s.external_id, s.title, s.property_type, s.status, s.price, s.price_currency,
         s.bedrooms, s.bathrooms, s.area_sqm, s.area_built_sqm, s.area_plot_sqm,
         s.location_city, s.location_region, s.source_url, coalesce(s.images, '[]'::jsonb),
         coalesce(s.features, '[]'::jsonb),
         s.description,
         (CASE
            WHEN v_q_norm IS NOT NULL AND s.title_norm LIKE '%'||v_q_norm||'%' THEN 0
            WHEN v_q_norm IS NOT NULL THEN 1
            WHEN v_loc_norm IS NULL THEN 3
            WHEN s.city_norm = v_loc_norm THEN 0
            WHEN v_zone IS NOT NULL AND s.p_zone = v_zone THEN 1
            WHEN v_open AND v_zone IS NOT NULL AND s.p_zone IS NOT NULL
                 AND EXISTS (SELECT 1 FROM public.area_zone_adjacent adj WHERE adj.zone = v_zone AND adj.adjacent_zone = s.p_zone) THEN 2
            ELSE 9
          END)::integer AS match_tier
  FROM scored s
  WHERE (v_budget IS NULL OR s.price IS NULL OR s.price <= v_budget)
    AND (v_beds IS NULL OR s.bedrooms IS NULL OR s.bedrooms >= v_beds)
    AND (v_baths IS NULL OR s.bathrooms IS NULL OR s.bathrooms >= v_baths)
    AND (v_type IS NULL
         OR (v_req_penthouse AND lower(btrim(coalesce(s.property_type,''))) = ANY(v_penthouse))
         OR (v_req_apt       AND lower(btrim(coalesce(s.property_type,''))) = ANY(v_apt))
         OR (v_req_villa     AND lower(btrim(coalesce(s.property_type,''))) = ANY(v_villa))
         OR (NOT v_req_penthouse AND NOT v_req_apt AND NOT v_req_villa
             AND lower(btrim(coalesce(s.property_type,''))) = v_type))
    AND (
      -- PHRASE mode: the phrase must match title or city (replaces the town gate).
      CASE WHEN v_q_norm IS NOT NULL THEN
        (s.title_norm LIKE '%'||v_q_norm||'%' OR s.city_norm LIKE '%'||v_q_norm||'%')
      ELSE (
        v_loc_norm IS NULL
        OR s.city_norm = v_loc_norm
        OR (v_zone IS NOT NULL AND s.p_zone = v_zone)
        OR (v_open AND v_zone IS NOT NULL AND s.p_zone IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.area_zone_adjacent adj WHERE adj.zone = v_zone AND adj.adjacent_zone = s.p_zone))
      ) END
    )
  ORDER BY match_tier ASC, s.price ASC NULLS LAST, s.updated_at DESC NULLS LAST
  LIMIT v_limit;
END;
$function$;
