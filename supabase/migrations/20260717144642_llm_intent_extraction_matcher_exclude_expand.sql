-- ============================================================================
-- AIVENA — El Raso Phase 2 (Option 2): matcher EXCLUDE + EXPAND
-- APPLIED as ledger 20260717144642. Additive, behind the OFF-BY-DEFAULT extraction flag.
--
-- Depends on the additive-migration artifact having already added:
--   leads.excluded_areas   text[]  NULL
--   leads.open_to_adjacent  boolean NOT NULL DEFAULT false
--   (leads.must_haves is NOT used in matching — deliberately ignored here)
--
-- HARD NON-BREAKING INVARIANT (live demo agencies depend on it):
--   For any lead with excluded_areas NULL/empty AND open_to_adjacent = false,
--   match_properties_for_lead MUST return byte-identical rows AND identical
--   ORDER to today. This is guaranteed structurally:
--     * the EXCLUDE predicate is `(v_excluded_norm IS NULL OR NOT (...))`,
--       a strict no-op whenever v_excluded_norm IS NULL (all-empty / absent);
--     * the EXPAND block only runs inside `IF v_open ... THEN`, so it cannot
--       touch v_cities when open_to_adjacent = false.
--   No other part of the query is altered.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) match_properties_for_lead — verbatim, PLUS EXCLUDE + EXPAND only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_properties_for_lead(p_lead_id uuid, p_limit integer DEFAULT 5)
 RETURNS TABLE(property_id uuid, external_id text, title text, property_type text, price numeric, price_currency text, bedrooms integer, bathrooms integer, area_sqm numeric, location_city text, location_region text, source_url text, similarity double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency    text;
  v_emb       vector;
  v_limit     integer := LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
  v_beds_min  integer;
  v_beds_max  integer;
  v_baths_min integer;
  v_budget    numeric;
  v_type_pref text;
  v_area_raw  text;
  v_area_n    text;
  v_has_area  boolean;
  v_zone      text;
  v_cities    text[] := NULL;
  v_pattern   text   := NULL;
  v_apt       text[] := ARRAY['apartment','penthouse','studio','flat','atico','ático','apartamento'];
  -- NEW: buyer-expressed exclusions + open-to-adjacent, loaded from the lead row.
  v_excluded      text[];
  v_excluded_norm text[] := NULL;   -- NULL => exclude predicate is a strict no-op
  v_open          boolean;
  c_from CONSTANT text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_to   CONSTANT text := 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
BEGIN
  SELECT l.agency_id, l.embedding, l.bedrooms_min, l.bedrooms_max, l.bathrooms_min,
         NULLIF(regexp_replace(COALESCE(l.budget_extracted::text, ''), '[^0-9]', '', 'g'), '')::numeric,
         NULLIF(lower(btrim(COALESCE(l.property_type_pref, ''))), ''),
         COALESCE(NULLIF(btrim(l.location_interest_extracted), ''), NULLIF(btrim(l.location_interest_raw), '')),
         l.excluded_areas,
         COALESCE(l.open_to_adjacent, false)
    INTO v_agency, v_emb, v_beds_min, v_beds_max, v_baths_min, v_budget, v_type_pref, v_area_raw,
         v_excluded, v_open
  FROM public.leads l WHERE l.id = p_lead_id;

  IF v_agency IS NULL OR v_emb IS NULL THEN
    RETURN;
  END IF;

  v_area_n := lower(btrim(translate(COALESCE(v_area_raw, ''), c_from, c_to)));
  v_area_n := btrim(regexp_replace(v_area_n, '\s+(area|zona|zone|region)$', ''));
  v_has_area := (v_area_n IS NOT NULL AND v_area_n <> '');

  IF v_has_area THEN
    -- 1) exact alias
    SELECT a.zone INTO v_zone FROM public.area_zone_alias a WHERE a.alias = v_area_n;
    -- 2) longest alias contained within the stated area string
    IF v_zone IS NULL THEN
      SELECT a.zone INTO v_zone
      FROM public.area_zone_alias a
      WHERE v_area_n LIKE '%' || a.alias || '%'
      ORDER BY length(a.alias) DESC
      LIMIT 1;
    END IF;

    IF v_zone IS NOT NULL THEN
      SELECT array_agg(c.city) INTO v_cities FROM public.area_zone_city c WHERE c.zone = v_zone;
    ELSE
      v_pattern := '%' || v_area_n || '%';   -- unmapped area: match the town name directly
    END IF;
  END IF;

  -- EXPAND (open_to_adjacent): only when the buyer is open AND we resolved a zone.
  -- Strict no-op when v_open = false (block does not run) or when v_zone IS NULL
  -- (unmapped area / no area — cannot expand, leave v_cities as-is). Cities in
  -- area_zone_city are stored already-normalized (lower + deaccented), matching how
  -- the WHERE clause below compares them, so unioning the raw column is correct.
  IF v_open AND v_zone IS NOT NULL THEN
    SELECT array_agg(DISTINCT u.city) INTO v_cities
    FROM (
      SELECT unnest(COALESCE(v_cities, ARRAY[]::text[])) AS city
      UNION
      SELECT c.city
        FROM public.area_zone_city c
       WHERE c.zone IN (
               SELECT a.adjacent_zone
                 FROM public.area_zone_adjacent a
                WHERE a.zone = v_zone
             )
    ) u
    WHERE u.city IS NOT NULL;
  END IF;

  -- EXCLUDE: normalize each non-empty excluded entry (deaccent + lower + btrim).
  -- array_agg over an empty set yields NULL, so an absent/all-empty excluded_areas
  -- leaves v_excluded_norm = NULL and the predicate below is a strict no-op.
  IF v_excluded IS NOT NULL THEN
    SELECT array_agg(s.x) INTO v_excluded_norm
    FROM (
      SELECT DISTINCT lower(btrim(translate(COALESCE(e, ''), c_from, c_to))) AS x
        FROM unnest(v_excluded) AS e
       WHERE btrim(COALESCE(e, '')) <> ''
    ) s;
  END IF;

  RETURN QUERY
  SELECT p.id, p.external_id, p.title, p.property_type,
         p.price, p.price_currency, p.bedrooms, p.bathrooms,
         p.area_sqm, p.location_city, p.location_region, p.source_url,
         (1 - (p.embedding <=> v_emb))::double precision AS similarity
  FROM public.properties p
  WHERE p.agency_id = v_agency
    AND p.status = 'active'
    AND p.embedding IS NOT NULL
    AND (v_beds_min  IS NULL OR p.bedrooms  IS NULL OR p.bedrooms  >= v_beds_min)
    AND (v_beds_max  IS NULL OR p.bedrooms  IS NULL OR p.bedrooms  <= v_beds_max)
    AND (v_baths_min IS NULL OR p.bathrooms IS NULL OR p.bathrooms >= v_baths_min)
    AND (v_budget    IS NULL OR p.price     IS NULL OR p.price     <= v_budget)
    AND (
      v_type_pref IS NULL OR p.property_type IS NULL
      OR ( (v_type_pref = ANY(v_apt)) = (lower(p.property_type) = ANY(v_apt)) )
    )
    AND (
      v_has_area = false
      OR (v_cities IS NOT NULL
          AND lower(btrim(translate(COALESCE(p.location_city,''), c_from, c_to))) = ANY(v_cities))
      OR (v_cities IS NULL AND v_pattern IS NOT NULL
          AND lower(btrim(translate(COALESCE(p.location_city,''), c_from, c_to))) LIKE v_pattern)
    )
    -- EXCLUDE predicate — strict no-op when v_excluded_norm IS NULL.
    AND (
      v_excluded_norm IS NULL
      OR NOT (lower(btrim(translate(COALESCE(p.location_city,''), c_from, c_to))) = ANY(v_excluded_norm))
    )
  ORDER BY p.embedding <=> v_emb
  LIMIT v_limit;
  -- No wrong-town fallback: empty result is honest when the area has no stock.
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2) trg_lead_automatch — verbatim, PLUS two columns in the change-detection
--    short-circuit so an UPDATE that changes ONLY excluded_areas OR
--    open_to_adjacent still re-runs match_properties_for_lead.
--    must_haves is intentionally NOT added (it is not used in matching).
--    Embedding-non-null precondition + buyer gate + all existing conditions
--    preserved exactly.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_lead_automatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.embedding IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.lead_type, 'buyer') <> 'buyer' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.embedding                   IS NOT DISTINCT FROM OLD.embedding
     AND NEW.bedrooms_min                IS NOT DISTINCT FROM OLD.bedrooms_min
     AND NEW.bedrooms_max                IS NOT DISTINCT FROM OLD.bedrooms_max
     AND NEW.bathrooms_min               IS NOT DISTINCT FROM OLD.bathrooms_min
     AND NEW.budget_extracted            IS NOT DISTINCT FROM OLD.budget_extracted
     AND NEW.property_type_pref          IS NOT DISTINCT FROM OLD.property_type_pref
     AND NEW.location_interest_extracted IS NOT DISTINCT FROM OLD.location_interest_extracted
     AND NEW.location_interest_raw       IS NOT DISTINCT FROM OLD.location_interest_raw
     AND NEW.excluded_areas              IS NOT DISTINCT FROM OLD.excluded_areas
     AND NEW.open_to_adjacent            IS NOT DISTINCT FROM OLD.open_to_adjacent
  THEN RETURN NEW; END IF;

  DELETE FROM public.lead_property_matches WHERE lead_id = NEW.id;
  INSERT INTO public.lead_property_matches (agency_id, lead_id, property_id, similarity, rank)
  SELECT NEW.agency_id, NEW.id, m.property_id, m.similarity,
         row_number() OVER (ORDER BY m.similarity DESC)
  FROM public.match_properties_for_lead(NEW.id, 5) m;
  RETURN NEW;
END;
$function$;
