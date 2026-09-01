-- APPLIED to production 2026-09-01. See the migration of the same name in
-- Supabase; this file is the version-controlled copy.
--
-- ONE language vocabulary, enforced at the storage layer.
-- Christian: "language codes stay the same through the whole aivena system and
-- doesnt get names wrong ever."
--
-- The split, found while capturing translate-text into the repo:
--   whatsapp_templates  -> 'nb'  (24 rows, Meta-APPROVED — outward truth)
--   apps/api validators -> 'nb'  (canonical in code)
--   leads CHECK         -> 'no' ONLY; it REJECTED 'nb'
--   translate-text EF   -> writes 'no'
--
-- Not theoretical: on 2026-08-28 a DANISH template previewed to a Norwegian
-- lead, and routes/whatsapp.ts still carries the WHEN 'no' THEN 'nb' patch.
--
-- Switching the EF to write 'nb' alone would have FAILED the old CHECK on every
-- Norwegian detection. Fixed at the storage layer instead: a BEFORE trigger
-- normalises on write, so any writer — API, Edge Function, or n8n, which we
-- cannot audit from here — lands canonical. Verified by writing a literal 'no'
-- and reading back 'nb'.

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_language_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_language_check
  CHECK (language IS NULL OR language = ANY (ARRAY[
    'en','es','de','nl','fr','pl','sv','nb','da','fi','ru','it','pt',   -- canonical
    'no','nn','nob','dk','se'                                           -- legacy, normalised by trigger
  ]));

-- Mirrors LANG_ALIASES in apps/api/src/amanda-engine/validators.ts.
-- language-consistency.test.ts asserts the two agree.
CREATE OR REPLACE FUNCTION public.normalize_lead_language()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.language IS NULL THEN RETURN NEW; END IF;
  NEW.language := lower(split_part(btrim(NEW.language), '-', 1));
  NEW.language := CASE NEW.language
                    WHEN 'no'  THEN 'nb'
                    WHEN 'nn'  THEN 'nb'
                    WHEN 'nob' THEN 'nb'
                    WHEN 'dk'  THEN 'da'
                    WHEN 'se'  THEN 'sv'
                    ELSE NEW.language
                  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_lead_language ON public.leads;
CREATE TRIGGER trg_normalize_lead_language
  BEFORE INSERT OR UPDATE OF language ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.normalize_lead_language();

UPDATE public.leads SET language = 'nb' WHERE language IN ('no','nn','nob');
UPDATE public.leads SET language = 'da' WHERE language = 'dk';
UPDATE public.leads SET language = 'sv' WHERE language = 'se';

DO $$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover FROM public.leads
   WHERE language IN ('no','nn','nob','dk','se');
  IF leftover > 0 THEN
    RAISE EXCEPTION 'leads still holding legacy language codes: %', leftover;
  END IF;
END $$;
