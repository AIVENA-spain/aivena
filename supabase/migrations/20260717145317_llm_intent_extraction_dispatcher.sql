-- AIVENA El Raso Phase 2 (Option 2) — LLM buyer-message extraction, DISPATCHER wiring.
-- Ships behind an OFF-BY-DEFAULT flag (intent_extraction_config.enabled=false) + a Christian-owned
-- legal gate. This migration only *wires* the dispatch; nothing fires until a per-agency config row
-- exists AND is enabled. Zero behaviour change for every agency until then.
--
-- WHAT THIS DOES
--   1. Replaces public.apply_conversation_interest(...) — ADDS a 4th param p_message_id uuid
--      DEFAULT NULL. ALL existing deterministic behaviour is preserved verbatim (extract_area_from_text
--      + extract_budget_from_text + write-on-change + the existing lead_events audit). It ADDS:
--        (a) a best-effort insert into lead_extraction_log (source='deterministic') ONLY when the
--            deterministic pass actually changed a column; and
--        (b) AFTER the write, a NON-FATAL pg_net dispatch to the extract-lead-intent Edge Function,
--            gated by _intent_extraction_should_dispatch(agency) AND a QUALIFIES cue-regex.
--      The whole dispatch is wrapped BEGIN..EXCEPTION WHEN OTHERS THEN NULL so it can NEVER break the
--      message insert / TwiML 200. If config is disabled, the cap is hit, the secret is missing, the
--      helper/table is absent, or pg_net errors — we silently fall back to the deterministic result.
--   2. Replaces trg_message_apply_interest() so the AFTER-INSERT trigger passes NEW.id as p_message_id.
--
-- DEPENDENCY ORDER: apply AFTER the additive migration that creates lead_extraction_log,
--   intent_extraction_config, apply_extracted_intent(), and _intent_extraction_should_dispatch().
--   (Runtime is defensive anyway: a missing helper/table raises inside the EXCEPTION-guarded blocks
--   and degrades to deterministic-only — it never surfaces.)
--
-- SIGNATURE NOTE: adding a parameter changes the signature, so CREATE OR REPLACE alone would leave the
--   old 3-arg function in place and make a 3-arg call ambiguous ("function is not unique"). We DROP the
--   old 3-arg signature first, then CREATE the 4-arg version (its p_message_id default keeps the two
--   existing 3-arg callers — trg_message_apply_interest before its own replace below, and any ad-hoc
--   callers — resolving cleanly). DROP resets the ACL, so grants are re-applied at the bottom to match
--   prior prod state (service_role + aivena_app; authenticated stays REVOKED per 20260704185056).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) apply_conversation_interest — deterministic (unchanged) + det-log + LLM dispatch
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.apply_conversation_interest(uuid, text, text);

CREATE OR REPLACE FUNCTION public.apply_conversation_interest(
  p_lead_id    uuid,
  p_agency_id  text,
  p_text       text,
  p_message_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- NOTE: the deaccent map + cue regexes an earlier draft declared here are gone. They existed only to
  -- decide "does this message need the LLM?", which a keyword list cannot answer across languages
  -- (see the QUALIFIES comment below). Dispatch is now a plain length floor.
  v_area           text;
  v_budget         numeric;
  v_old_area       text;
  v_old_budget     numeric;
  v_area_changed   boolean := false;
  v_budget_changed boolean := false;

  v_qualifies   boolean := false;
  v_det_intent  jsonb   := '{}'::jsonb;
  v_det_applied jsonb   := '{}'::jsonb;
  v_secret      text;
BEGIN
  IF p_lead_id IS NULL OR p_agency_id IS NULL OR p_text IS NULL OR btrim(p_text) = '' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;

  SELECT location_interest_extracted, budget_extracted
    INTO v_old_area, v_old_budget
  FROM public.leads
  WHERE id = p_lead_id
    AND agency_id = p_agency_id
    AND COALESCE(lead_type, 'buyer') = 'buyer';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'changed', false);
  END IF;

  -- ── Deterministic extraction (UNCHANGED) ──
  v_area   := public.extract_area_from_text(p_text);
  v_budget := public.extract_budget_from_text(p_text);

  IF v_area IS NOT NULL
     AND lower(btrim(v_area)) IS DISTINCT FROM lower(btrim(COALESCE(v_old_area, ''))) THEN
    v_area_changed := true;
  END IF;
  IF v_budget IS NOT NULL AND v_budget IS DISTINCT FROM v_old_budget THEN
    v_budget_changed := true;
  END IF;

  IF v_area_changed OR v_budget_changed THEN
    UPDATE public.leads
       SET location_interest_extracted = CASE WHEN v_area_changed   THEN v_area   ELSE location_interest_extracted END,
           budget_extracted            = CASE WHEN v_budget_changed THEN v_budget ELSE budget_extracted END,
           updated_at = now()
     WHERE id = p_lead_id AND agency_id = p_agency_id;

    -- best-effort audit trail; must never roll back the lead update (UNCHANGED)
    BEGIN
      INSERT INTO public.lead_events (lead_id, agency_id, type, source, summary)
      VALUES (
        p_lead_id, p_agency_id, 'interest_updated_from_conversation', 'conversation_interest',
        'Buyer message updated interest'
          || CASE WHEN v_area_changed   THEN ' · area -> ' || v_area ELSE '' END
          || CASE WHEN v_budget_changed THEN ' · budget -> ' || v_budget::text ELSE '' END
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- (a) best-effort deterministic extraction-log row — ONLY when something changed. Internal audit
    --     + eval only (Packet 2 no longer reads it). Never rolls back the lead update.
    BEGIN
      IF v_area IS NOT NULL THEN
        v_det_intent := v_det_intent || jsonb_build_object('areas_add', jsonb_build_array(v_area));
      END IF;
      IF v_budget IS NOT NULL THEN
        v_det_intent := v_det_intent || jsonb_build_object('budget_max', v_budget);
      END IF;
      IF v_area_changed THEN
        v_det_applied := v_det_applied || jsonb_build_object('location_interest_extracted', v_area);
      END IF;
      IF v_budget_changed THEN
        v_det_applied := v_det_applied || jsonb_build_object('budget_extracted', v_budget);
      END IF;

      INSERT INTO public.lead_extraction_log
        (lead_id, agency_id, source, model, source_message_id, input_text, intent, applied, summary, confidence)
      VALUES
        (p_lead_id, p_agency_id, 'deterministic', NULL, p_message_id, p_text, v_det_intent, v_det_applied, NULL, NULL);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- ── (b) NON-FATAL LLM dispatch — after the deterministic write, independent of whether it changed.
  --    Fully guarded: any failure (disabled config, cap reached, missing secret/helper/table, pg_net
  --    error) degrades to deterministic-only and can NEVER break the inbound-message insert.
  BEGIN
    -- QUALIFIES = any substantive message. Deliberately NOT a cue/keyword gate.
    --
    -- An earlier draft gated on an English+Spanish negation/expansion regex, OR-ed with
    -- "deterministic found no area". Both fail on the exact case this engine exists to fix:
    -- Marte's "Kan du sende meg noen fra andre steder, ikke El Raso? Det trenger ikke aa vaere
    -- Guardamar." -> extract_area_from_text returns 'Guardamar' (so the v_area IS NULL arm is false)
    -- and 'ikke'/'andre steder' are Norwegian (so no EN/ES cue matches) -> it never dispatched, and
    -- El Raso kept showing. Generalising: a deterministic pre-filter CANNOT detect negation across
    -- every buyer language -- that is precisely the job being handed to the LLM. So we do not try.
    --
    -- Cost stays bounded by three things, not by this gate: the agency flag (off by default), the
    -- monthly cap in _intent_extraction_should_dispatch, and the EF's own greeting/trivial prefilter.
    -- The length floor only skips "ok"/"gracias"-class noise before we spend a quota slot.
    v_qualifies := char_length(btrim(p_text)) >= 12;

    -- Nested IFs (not a single AND) so the counter-incrementing helper is only called when the
    -- message actually qualifies — we never burn monthly quota on a non-qualifying message.
    IF v_qualifies THEN
      IF public._intent_extraction_should_dispatch(p_agency_id) THEN
        v_secret := public._get_platform_secret('EXTRACT_LEAD_INTENT_INTERNAL_SECRET');
        IF v_secret IS NOT NULL THEN
          PERFORM net.http_post(
            url := 'https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/extract-lead-intent',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-internal-secret', v_secret
            ),
            body := jsonb_build_object(
              'lead_id',    p_lead_id::text,
              'agency_id',  p_agency_id,
              'message_id', p_message_id,
              'text',       p_text
            ),
            timeout_milliseconds := 30000
          );
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;  -- dispatch is best-effort; deterministic result already persisted
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'changed', (v_area_changed OR v_budget_changed),
    'area_changed', v_area_changed, 'new_area', v_area,
    'budget_changed', v_budget_changed, 'new_budget', v_budget
  );
END;
$function$;

-- Re-apply grants to match prior prod state (DROP reset the ACL). authenticated stays REVOKED
-- (per 20260704185056 revoke_authenticated_execute_w4c_and_apply_interest).
REVOKE ALL ON FUNCTION public.apply_conversation_interest(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_conversation_interest(uuid, text, text, uuid) TO service_role, aivena_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) trg_message_apply_interest — pass NEW.id as p_message_id (only line that changed)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_message_apply_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text;
BEGIN
  BEGIN
    IF NEW.message_type = 'email' THEN
      -- email body carries quoted thread + signature → prefer the cleaned body
      v_text := COALESCE(NULLIF(btrim(NEW.body_clean), ''), NEW.content);
    ELSE
      -- whatsapp 'text', voice, etc. → raw content (unchanged behaviour)
      v_text := NEW.content;
    END IF;
    PERFORM public.apply_conversation_interest(NEW.lead_id, NEW.agency_id, v_text, NEW.id);
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- interest extraction must never block storing the inbound message
  END;
  RETURN NEW;
END;
$function$;
