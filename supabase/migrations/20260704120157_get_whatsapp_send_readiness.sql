-- Packet 1 / Slice 1b — get_whatsapp_send_readiness (Proposal A, approved 2026-07-04).
--
-- Read-only per-agency WhatsApp send-readiness truth with plain-English blockers.
-- Answers: does this agency have an active provider account / WABA / sender number,
-- and (optionally) is there a verified-approved template for this key (+language)?
-- Consumers (wired later in their own packets): admin Go-Live recompute, D3 provider
-- cards, F3 fallback text, pilot readiness.
--
-- Deliberate design point: automation_enabled is REPORTED but is NOT a blocker and
-- NOT part of `ready` — approval-first/manual is the pilot design, so "automation OFF"
-- must never read as a red flag.
--
-- Verified-approved predicate (B3): provider_status='approved' AND provider_synced_at
-- IS NOT NULL AND provider_template_id IS NOT NULL.
--
-- ROLLBACK: DROP FUNCTION public.get_whatsapp_send_readiness(text,text,text);

CREATE OR REPLACE FUNCTION public.get_whatsapp_send_readiness(
  p_agency_id text, p_template_key text DEFAULT NULL, p_language text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_s  agency_settings%ROWTYPE;
  v_pa provider_accounts%ROWTYPE;
  v_pa_active boolean := false;
  v_waba boolean; v_phone_id boolean; v_from boolean;
  v_tpl_ready boolean := NULL; v_tpl_lang_ready boolean := NULL;
  v_blockers text[] := '{}'; v_ready boolean;
BEGIN
  SELECT * INTO v_s FROM agency_settings WHERE agency_id = p_agency_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'error', 'agency_not_found');
  END IF;

  SELECT * INTO v_pa FROM provider_accounts
   WHERE agency_id = p_agency_id AND provider_type = 'twilio_whatsapp' AND status = 'active'
   LIMIT 1;
  v_pa_active := FOUND;

  v_waba     := COALESCE(v_pa.waba_id,         v_s.whatsapp_business_account_id) IS NOT NULL;
  v_phone_id := COALESCE(v_pa.phone_number_id, v_s.whatsapp_phone_number_id)     IS NOT NULL;
  v_from     := COALESCE(v_pa.from_number,     v_s.whatsapp_from_number)         IS NOT NULL;

  IF NOT v_pa_active THEN v_blockers := array_append(v_blockers, 'No active WhatsApp provider account (provider_accounts) for this agency.'); END IF;
  IF NOT v_waba     THEN v_blockers := array_append(v_blockers, 'No WhatsApp Business Account (WABA) id on file.'); END IF;
  IF NOT v_from     THEN v_blockers := array_append(v_blockers, 'No WhatsApp sender number on file.'); END IF;

  IF p_template_key IS NOT NULL THEN
    v_tpl_ready := EXISTS (SELECT 1 FROM whatsapp_templates
      WHERE template_key = p_template_key AND agency_id IN (p_agency_id, '__platform__')
        AND provider_status = 'approved' AND provider_synced_at IS NOT NULL
        AND provider_template_id IS NOT NULL);
    IF NOT v_tpl_ready THEN
      v_blockers := array_append(v_blockers, format('No verified-approved template for key ''%s''.', p_template_key));
    ELSIF p_language IS NOT NULL THEN
      v_tpl_lang_ready := EXISTS (SELECT 1 FROM whatsapp_templates
        WHERE template_key = p_template_key AND agency_id IN (p_agency_id, '__platform__')
          AND provider_status = 'approved' AND provider_synced_at IS NOT NULL
          AND provider_template_id IS NOT NULL AND language = p_language);
      IF NOT v_tpl_lang_ready THEN
        v_blockers := array_append(v_blockers, format('No approved template in language ''%s'' for ''%s''.', p_language, p_template_key));
      END IF;
    END IF;
  END IF;

  v_ready := v_pa_active AND v_waba AND v_from
             AND COALESCE(v_tpl_ready, true) AND COALESCE(v_tpl_lang_ready, true);

  RETURN jsonb_build_object(
    'ready', v_ready,
    'provider_account_active', v_pa_active,
    'waba_id_present', v_waba,
    'phone_number_id_present', v_phone_id,
    'from_number_present', v_from,
    'automation_enabled', COALESCE(v_s.whatsapp_automation_enabled, false),
    'templates_enabled',  COALESCE(v_s.whatsapp_templates_enabled,  false),
    'template_ready', v_tpl_ready,
    'template_language_ready', v_tpl_lang_ready,
    'blockers', to_jsonb(v_blockers));
END $fn$;

REVOKE ALL ON FUNCTION public.get_whatsapp_send_readiness(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_whatsapp_send_readiness(text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.get_whatsapp_send_readiness(text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_send_readiness(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_send_readiness(text,text,text) TO aivena_app;
