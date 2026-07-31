-- Reverse prospecting (P2-G): given a LISTING, find the agency's existing buyer
-- leads it matches — the mirror image of match_properties_for_lead. Same honesty
-- gates, inverted: the property must fit each buyer's budget, area/zone (respecting
-- their exclusions + open-to-adjacent), bedrooms, bathrooms and property type; only
-- then are survivors ranked by embedding similarity. No wrong-fit fallback — an empty
-- result is honest. STABLE + read-only: surfaces buyers, never messages anyone.
CREATE OR REPLACE FUNCTION public.match_leads_for_property(
  p_property_id uuid,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  lead_id uuid,
  full_name text,
  language text,
  budget_extracted numeric,
  location_interest_extracted text,
  bedrooms_min integer,
  bedrooms_max integer,
  bathrooms_min integer,
  property_type_pref text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency     text;
  v_emb        vector;
  v_price      numeric;
  v_beds       integer;
  v_baths      integer;
  v_ptype      text;
  v_city_norm  text;
  v_zone       text;
  v_limit      integer := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_apt        text[] := ARRAY['apartment','penthouse','studio','flat','atico','ático','apartamento'];
  c_from CONSTANT text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_to   CONSTANT text := 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
BEGIN
  SELECT p.agency_id, p.embedding, p.price, p.bedrooms, p.bathrooms,
         lower(btrim(COALESCE(p.property_type,''))),
         lower(btrim(translate(COALESCE(p.location_city,''), c_from, c_to)))
    INTO v_agency, v_emb, v_price, v_beds, v_baths, v_ptype, v_city_norm
  FROM public.properties p WHERE p.id = p_property_id;

  IF v_agency IS NULL OR v_emb IS NULL THEN RETURN; END IF;

  -- The property's zone (the zone whose city list contains this listing's city).
  -- Cities in area_zone_city are stored already-normalized, matching v_city_norm.
  IF v_city_norm <> '' THEN
    SELECT c.zone INTO v_zone FROM public.area_zone_city c WHERE c.city = v_city_norm LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT l.id, l.full_name, l.language, l.budget_extracted, l.location_interest_extracted,
         l.bedrooms_min, l.bedrooms_max, l.bathrooms_min, l.property_type_pref,
         (1 - (l.embedding <=> v_emb))::double precision AS similarity
  FROM public.leads l
  -- Per-buyer: normalise their stated area + resolve it to a zone (exact alias, else
  -- the longest alias contained in the string) — exactly how the forward matcher does.
  CROSS JOIN LATERAL (
    SELECT NULLIF(btrim(regexp_replace(
             lower(btrim(translate(
               COALESCE(NULLIF(btrim(l.location_interest_extracted),''),
                        NULLIF(btrim(l.location_interest_raw),'')), c_from, c_to))),
             '\s+(area|zona|zone|region)$','')), '') AS area_n
  ) la
  CROSS JOIN LATERAL (
    SELECT CASE WHEN la.area_n IS NULL THEN NULL ELSE COALESCE(
      (SELECT a.zone FROM public.area_zone_alias a WHERE a.alias = la.area_n),
      (SELECT a.zone FROM public.area_zone_alias a WHERE la.area_n LIKE '%'||a.alias||'%'
         ORDER BY length(a.alias) DESC LIMIT 1)
    ) END AS lead_zone
  ) lz
  WHERE l.agency_id = v_agency
    AND l.embedding IS NOT NULL
    AND COALESCE(l.lead_type, 'buyer') = 'buyer'
    -- HARD GATES (property must fit the buyer) — mirror the forward matcher, inverted.
    AND (l.budget_extracted IS NULL OR v_price IS NULL OR v_price <= l.budget_extracted)
    AND (l.bedrooms_min IS NULL OR v_beds IS NULL OR v_beds >= l.bedrooms_min)
    AND (l.bedrooms_max IS NULL OR v_beds IS NULL OR v_beds <= l.bedrooms_max)
    AND (l.bathrooms_min IS NULL OR v_baths IS NULL OR v_baths >= l.bathrooms_min)
    AND (
      l.property_type_pref IS NULL OR v_ptype = ''
      OR ( (lower(btrim(l.property_type_pref)) = ANY(v_apt)) = (v_ptype = ANY(v_apt)) )
    )
    -- AREA: buyer has no stated area (open) OR the listing is in their area/zone,
    -- OR they're open-to-adjacent and the listing's zone is adjacent to theirs.
    AND (
      la.area_n IS NULL
      OR la.area_n = v_city_norm
      OR (lz.lead_zone IS NOT NULL AND lz.lead_zone = v_zone)
      OR (COALESCE(l.open_to_adjacent, false) AND lz.lead_zone IS NOT NULL AND v_zone IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.area_zone_adjacent adj
                       WHERE adj.zone = lz.lead_zone AND adj.adjacent_zone = v_zone))
    )
    -- EXCLUSIONS: the buyer explicitly ruled out this listing's town.
    AND NOT (
      l.excluded_areas IS NOT NULL
      AND v_city_norm = ANY (
        SELECT lower(btrim(translate(COALESCE(e,''), c_from, c_to)))
          FROM unnest(l.excluded_areas) AS e WHERE btrim(COALESCE(e,'')) <> ''
      )
    )
  ORDER BY l.embedding <=> v_emb
  LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.match_leads_for_property(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_leads_for_property(uuid, integer) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.match_leads_for_property(uuid, integer) TO aivena_app;
