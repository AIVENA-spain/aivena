-- El Raso / extractor hardening — Packet 3 (data layer). A + B + C in one migration.
--
-- ⚠️ THIS IS NOT INERT. Unlike the recent preservation migrations, this changes LIVE behaviour the
-- moment it is applied: trigger `message_apply_interest` on public.conversation_messages is ENABLED
-- and already calls apply_conversation_interest() -> extract_area_from_text() on every inbound
-- message with content. The chain has been live all along; it produced nothing only because the
-- extractor returned NULL. NOTHING NEW NEEDS WIRING — and a second call from the Edge Function
-- would double-write. (Relayed to Packet 2.)
--
-- THREE DEFECTS FIXED (all proven against prod read-only before this file was written):
--
--   A. DISTRICT COVERAGE — a DATA fix, not a code fix.
--      extract_area_from_text reads area_zone_alias (11 rows). The district knowledge already lives
--      in area_zone_city (64 rows) — including 'el raso' -> 'guardamar'. Neither table was wrong;
--      the extractor simply reads the wrong one. match_properties_for_lead ALSO resolves through
--      area_zone_alias (exact alias -> zone, then longest contained), so promoting the city names
--      into the alias table fixes EXTRACTION and MATCHING at once, inventing no data.
--      44 of the 54 candidates are promoted. 10 are deliberately excluded as generic — each has a
--      plausible non-place meaning in a property conversation, and every one stays reachable via its
--      parent town or full name, so no coverage is lost:
--        centro          "the centre/downtown"        -> reachable via 'torrevieja'
--        los balcones    "the balconies" (a FEATURE)  -> reachable via 'torrevieja'
--        la siesta       "the nap"                    -> reachable via 'torrevieja'
--        los altos       "the heights/upstairs"       -> reachable via 'torrevieja'
--        la marina       "the marina/harbour"         -> reachable via 'guardamar'
--        los locos       "the crazy ones"             -> reachable via 'playa (de) los locos'
--        los naufragos   "the shipwrecked"            -> reachable via 'playa los naufragos'
--        agua marina     "seawater"                   -> reachable via 'aguamarina'
--        las ramblas     Barcelona's street           -> reachable via 'orihuela costa'
--        las filipinas   the Philippines              -> reachable via 'orihuela costa'
--
--   B. NEGATION GUARD. "we do NOT want Torrevieja" and "anywhere except Torrevieja" both returned
--      'Torrevieja' — i.e. the REJECTED town, which (being live) would be written to the lead,
--      re-embedded, re-matched and audited as the buyer's wish. Now: an alias whose preceding 4
--      words contain a negation is discarded, and if EVERY mention is negated the answer is NULL.
--      Never store a town the buyer just ruled out.
--
--   C. LAST AFFIRMATIVE MENTION WINS (longest only as a tie-break at the SAME position).
--      The old rule was "longest alias wins", which is not a preference rule at all:
--        "we liked Torrevieja but now we prefer Guardamar" -> 'Torrevieja'  (10 chars beats 9)
--      It returned the town the buyer moved AWAY from. Now the last affirmative mention wins;
--      longest still wins at the same start position, so 'guardamar del segura' beats 'guardamar'.
--
-- KNOWN CEILING — STATED, NOT PAPERED OVER. A whitelist cannot resolve an expansion that names no
-- town: "other places", "nearby towns", "by the beach" still return NULL, and this migration does
-- NOT close Marte's actual message. Writing "nearby towns" into location_interest_extracted would
-- be inventing a place, so we don't. Two honest follow-ups, both DECISIONS not tasks: represent
-- expansion as its own fact (area_zone_adjacent already exists: guardamar -> ciudad_quesada,
-- torrevieja), or semantic extraction via an LLM (product + DPA gate).
--
-- DELIBERATE BIAS: the negation window is 4 words, so a distant "not" ("we're not sure yet, maybe
-- Torrevieja") can suppress a real mention. That direction is safe — NULL means "no change", while a
-- wrong town means a wrong write. Prefer a missed update over a false one.
--
-- BLAST RADIUS (measured on prod, read-only): 13 inbound messages, 5 buyer leads. Exactly 2 leads
-- change matching — 'Cabo Roig' and 'Villamartín', both currently UNRESOLVABLE, both becoming the
-- correct zone orihuela_costa. 'Jávea' stays NULL (genuinely outside the 6 zones).
--
-- ROLLBACK:
--   DELETE FROM public.area_zone_alias a
--    USING public.area_zone_city c WHERE a.alias = c.city AND a.zone = c.zone
--      AND a.alias NOT IN ('ciudad quesada','guardamar','guardamar del segura','orihuela',
--                          'orihuela costa','pilar de la horadada','quesada','rojales',
--                          'san miguel','san miguel de salinas','torrevieja');
--   -- then CREATE OR REPLACE extract_area_from_text with the previous body (whitelist over
--   -- area_zone_alias, longest-alias-wins, no negation guard) — preserved in this file's git history.

-- ── A. promote the 44 safe district names into the alias table ────────────────────────────────
INSERT INTO public.area_zone_alias (alias, zone)
SELECT c.city, c.zone
FROM public.area_zone_city c
WHERE NOT EXISTS (SELECT 1 FROM public.area_zone_alias a WHERE a.alias = c.city)
  AND c.city NOT IN (
    'centro','los balcones','la siesta','los altos','la marina',
    'los locos','los naufragos','agua marina','las ramblas','las filipinas'
  );

-- ── B + C. negation guard + last-affirmative-mention ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extract_area_from_text(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_from CONSTANT text := 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
  c_to   CONSTANT text := 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC';
  -- Single-word negations, matched as WHOLE WORDS within the 4 words preceding an alias.
  c_neg_word CONSTANT text :=
    '(^| )(not|no|dont|never|except|excluding|exclude|without|avoid|excepto|salvo|menos|sin|nada|tampoco|ni|evitar|evitamos)( |$)';
  -- Multi-word negations MUST be matched as phrases. A bare "but" must NEVER be a negation token:
  -- it is a CONTRAST word that normally precedes the town the buyer DOES want ("liked X but now
  -- prefer Y"). Treating it as a negation inverts the exact bug this guard exists to fix — caught
  -- by test case 6 while building this.
  c_neg_phrase CONSTANT text :=
    '(anywhere but|other than|apart from|instead of|rather than|en vez de|fuera de|aparte de)';
  v_norm  text;
  v_alias text;
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN NULL; END IF;

  -- Strip apostrophes FIRST so "don't" -> "dont". Without this the generic normaliser turns it into
  -- "don t" and the negation guard never sees a token it recognises.
  v_norm := lower(translate(replace(p_text, '''', ''), c_from, c_to));
  v_norm := regexp_replace(v_norm, '[^a-z0-9]+', ' ', 'g');
  v_norm := ' ' || btrim(v_norm) || ' ';

  SELECT a.alias INTO v_alias
  FROM public.area_zone_alias a
  CROSS JOIN LATERAL (SELECT position(' ' || a.alias || ' ' IN v_norm) AS pos) p
  CROSS JOIN LATERAL (
    -- the 4 words immediately preceding this alias occurrence
    SELECT ' ' || COALESCE(string_agg(z.word, ' ' ORDER BY z.ord), '') || ' ' AS win
    FROM (
      SELECT word, ord FROM (
        SELECT word, row_number() OVER () AS ord
        FROM regexp_split_to_table(btrim(left(v_norm, p.pos)), '\s+') AS word
      ) q
      WHERE word <> ''
      ORDER BY ord DESC
      LIMIT 4
    ) z
  ) g
  WHERE p.pos > 0
    AND NOT (g.win ~ c_neg_word OR g.win ~ c_neg_phrase)
  ORDER BY p.pos DESC, length(a.alias) DESC   -- C: last affirmative wins; longest only ties at same pos
  LIMIT 1;

  IF v_alias IS NULL THEN RETURN NULL; END IF;
  RETURN initcap(v_alias);
END;
$function$;

-- ── Self-verifying regression gate: the migration ABORTS if any case regresses ────────────────
DO $verify$
DECLARE
  r record;
  v_got  text;
  v_fail text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- required by the control tower
      ('we are looking in El Raso',                       'El Raso'),
      ('somewhere between Guardamar and El Raso',         'El Raso'),
      ('we do NOT want Torrevieja',                       NULL),
      ('anywhere except Torrevieja',                      NULL),
      ('no queremos Torrevieja',                          NULL),
      ('we liked Torrevieja but now we prefer Guardamar', 'Guardamar'),
      ('we would consider nearby towns too',              NULL),   -- known ceiling
      ('something by the beach',                          NULL),   -- known ceiling
      -- added while building, each pinning a specific hazard
      ('we dont want Torrevieja',                         NULL),          -- apostrophe stripping
      ('anywhere but Torrevieja',                         NULL),          -- phrase, not bare "but"
      ('other than Torrevieja we are open',               NULL),          -- phrase negation
      ('we want La Zenia not Torrevieja',                 'La Zenia'),    -- affirmative survives a later negation
      ('nos gusta Cabo Roig',                             'Cabo Roig'),   -- promoted district, Spanish
      ('looking at Guardamar del Segura',                 'Guardamar Del Segura'), -- longest at same position
      ('in the centro of town',                           NULL)           -- excluded generic alias
    ) AS t(input, expected)
  LOOP
    v_got := public.extract_area_from_text(r.input);
    IF v_got IS DISTINCT FROM r.expected THEN
      v_fail := v_fail || format(E'\n  %L -> got %L, expected %L', r.input, v_got, r.expected);
    END IF;
  END LOOP;

  IF v_fail <> '' THEN
    RAISE EXCEPTION 'extract_area_from_text regression — migration aborted:%', v_fail;
  END IF;

  -- A must have landed, and the 10 generic names must NOT be aliases.
  IF (SELECT count(*) FROM public.area_zone_alias) < 50 THEN
    RAISE EXCEPTION 'alias promotion did not land: only % aliases', (SELECT count(*) FROM public.area_zone_alias);
  END IF;
  IF EXISTS (SELECT 1 FROM public.area_zone_alias
              WHERE alias IN ('centro','los balcones','la siesta','los altos','la marina',
                              'los locos','los naufragos','agua marina','las ramblas','las filipinas')) THEN
    RAISE EXCEPTION 'a generic name was promoted to an alias — that would mis-extract everyday words';
  END IF;

  RAISE NOTICE 'extract_area_from_text: 15/15 cases pass; % aliases active',
               (SELECT count(*) FROM public.area_zone_alias);
END
$verify$;
