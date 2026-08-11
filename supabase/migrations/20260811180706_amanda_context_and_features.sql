-- Amanda answer-first (2026-08-11) — conversation context + listing features.
--
-- (1) amanda_append_message: `lastRef` (the listing just shown) is a VOLATILE
--     context key — unlike qualification facts (existing-wins, never lost), the
--     newest lastRef always overwrites, so "the property / features / the link /
--     view it" follow-ups resolve to the listing the visitor is actually
--     discussing. Everything else unchanged.
-- (2) amanda_search_properties: returns the listing's `features` jsonb (agency-
--     entered, verbatim, safe/public) so Amanda can answer "what are its
--     features?" with real data — never invented. Same gates (active-only, safe
--     columns, is_test, cap 3) unchanged.
CREATE OR REPLACE FUNCTION public.amanda_append_message(
  p_agency_slug     text,
  p_session_token   text,
  p_direction       text,
  p_content         text,
  p_collected_patch jsonb    DEFAULT '{}'::jsonb,
  p_require_test    boolean  DEFAULT true,
  OUT session_id    uuid,
  OUT collected     jsonb,
  OUT message_count integer
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency    text;
  v_is_test   boolean;
  v_token     text  := nullif(btrim(p_session_token), '');
  v_dir       text  := CASE WHEN lower(coalesce(p_direction,'')) = 'outbound' THEN 'outbound' ELSE 'inbound' END;
  v_patch     jsonb := CASE WHEN jsonb_typeof(p_collected_patch) = 'object' THEN p_collected_patch ELSE '{}'::jsonb END;
  v_session   uuid;
  v_collected jsonb;
  v_count     integer;
BEGIN
  SELECT id, is_test INTO v_agency, v_is_test FROM public.agencies WHERE slug = p_agency_slug;
  IF v_agency IS NULL THEN RAISE EXCEPTION 'agency_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_require_test AND NOT coalesce(v_is_test, false) THEN
    RAISE EXCEPTION 'agency_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF v_token IS NULL THEN RAISE EXCEPTION 'session_required' USING ERRCODE = 'P0001'; END IF;

  PERFORM set_config('app.current_agency_id', v_agency, true);

  SELECT s.id, coalesce(s.collected, '{}'::jsonb) INTO v_session, v_collected
  FROM public.chat_sessions s
  WHERE s.agency_id = v_agency AND s.session_token = v_token;

  IF v_session IS NULL THEN
    INSERT INTO public.chat_sessions (agency_id, session_token, status, collected, last_activity_at)
    VALUES (v_agency, v_token, 'active', '{}'::jsonb, now())
    RETURNING id INTO v_session;
    v_collected := '{}'::jsonb;
  END IF;

  -- Qualification facts: EXISTING values win (never overwrite what we know).
  v_collected := v_patch || v_collected;
  -- Context keys: the NEWEST value wins (the conversation moved on).
  IF v_patch ? 'lastRef' THEN
    v_collected := jsonb_set(v_collected, '{lastRef}', v_patch->'lastRef');
  END IF;

  INSERT INTO public.chat_messages (session_id, agency_id, direction, content, message_type)
  VALUES (v_session, v_agency, v_dir, left(coalesce(p_content, ''), 4000), 'text');

  UPDATE public.chat_sessions
     SET collected         = v_collected,
         message_count     = coalesce(chat_sessions.message_count, 0) + 1,
         last_activity_at  = now(),
         updated_at        = now()
   WHERE id = v_session;

  SELECT cs.message_count INTO v_count FROM public.chat_sessions cs WHERE cs.id = v_session;

  session_id    := v_session;
  collected     := v_collected;
  message_count := v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.amanda_append_message(text,text,text,text,jsonb,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.amanda_append_message(text,text,text,text,jsonb,boolean) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.amanda_append_message(text,text,text,text,jsonb,boolean) TO aivena_app, service_role;


-- (2) search RPC v3: + features jsonb (verbatim agency data; grants unchanged).
-- Adding a column changes the return type, so the old signature is dropped first
-- (same transaction — atomically replaced; sole caller is the API route).
DROP FUNCTION public.amanda_search_properties(text,text,jsonb,integer,boolean);
CREATE FUNCTION public.amanda_search_properties(
  p_agency_slug   text,
  p_session_token text    DEFAULT NULL,
  p_filters       jsonb   DEFAULT '{}'::jsonb,
  p_limit         integer DEFAULT 3,
  p_require_test  boolean DEFAULT true
)
RETURNS TABLE(
  id uuid, external_id text, title text, property_type text, status text,
  price numeric, price_currency text, bedrooms integer, bathrooms integer,
  area_sqm numeric, area_built_sqm numeric, area_plot_sqm numeric,
  location_city text, location_region text, source_url text, images jsonb,
  features jsonb,
  match_tier integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
  v_type_grp text;
  v_beds     int;
  v_budget   numeric;
  v_open     boolean;
  v_limit    int := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 3);
  v_loc_norm text;
  v_zone     text;
  v_apt   text[] := ARRAY['apartment','penthouse','studio','flat','atico','ático','apartamento','piso'];
  v_villa text[] := ARRAY['villa','chalet','detached'];
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
           p.location_city, p.location_region, p.source_url, coalesce(p.images, '[]'::jsonb), coalesce(p.features, '[]'::jsonb), 0
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
  v_budget := nullif(p_filters->>'budgetMax', '')::numeric;
  v_open   := coalesce((p_filters->>'openToAdjacent')::boolean, false);
  v_type_grp := CASE WHEN v_type = ANY(v_apt) THEN 'apt' WHEN v_type = ANY(v_villa) THEN 'villa' ELSE v_type END;

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
    AND (v_type IS NULL OR v_type_grp = (
          CASE WHEN lower(btrim(coalesce(s.property_type,''))) = ANY(v_apt) THEN 'apt'
               WHEN lower(btrim(coalesce(s.property_type,''))) = ANY(v_villa) THEN 'villa'
               ELSE lower(btrim(coalesce(s.property_type,''))) END))
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

REVOKE ALL ON FUNCTION public.amanda_search_properties(text,text,jsonb,integer,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.amanda_search_properties(text,text,jsonb,integer,boolean) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.amanda_search_properties(text,text,jsonb,integer,boolean) TO aivena_app, service_role;
