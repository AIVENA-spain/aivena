-- Packet 1 — voice + automation READINESS/GATE layer (build-freeze lifted 2026-07-16).
-- Additive + read-only + flag-gated. NOTHING here enables, sends, or places a call.
-- Runtime/enforcement (prepare_voice_recovery, reply_rules, the send pipeline, Vapi/Amanda disclosure
-- rendering) stays Packet 2's lane — these are the readiness gates + a kill-switch anchor Packet 1 owns.
-- ROLLBACK:
--   DROP FUNCTION public.get_voice_call_readiness(text);
--   DROP FUNCTION public.get_automation_readiness(text);
--   ALTER TABLE public.agency_settings DROP COLUMN automation_kill_switch;

-- Emergency automation kill-switch anchor (default off = no behavior change; enforcement must ALSO
-- honor it — Packet 2 seam). Surfaced through both readiness RPCs below.
ALTER TABLE public.agency_settings
  ADD COLUMN automation_kill_switch boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.agency_settings.automation_kill_switch IS
  'Emergency off: when true, all automation must be forced off regardless of reply_rules. Readiness RPCs report not-ready; enforcement (Packet 2) must also honor it.';

-- ---- Voice-call readiness (read-only). Never places a call. Art.50 disclosure is a HARD gate. ----
CREATE OR REPLACE FUNCTION public.get_voice_call_readiness(p_agency_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_s agency_settings%ROWTYPE;
  v_channel boolean; v_kill boolean; v_recovery_tpl_ok boolean;
  v_quota_remaining int; v_blockers text[] := '{}'; v_ready boolean;
  v_ai_disclosure_ready boolean := false;  -- K3 Art.50 copy not yet configured → hard gate for voice go-live
BEGIN
  SELECT * INTO v_s FROM agency_settings WHERE agency_id = p_agency_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ready', false, 'error', 'agency_not_found'); END IF;

  v_channel := EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(v_s.channels_enabled,'[]'::jsonb)) e WHERE e = 'voice');
  v_kill := COALESCE(v_s.automation_kill_switch, false);
  v_recovery_tpl_ok := EXISTS (SELECT 1 FROM whatsapp_templates
     WHERE template_key = COALESCE(v_s.voice_recovery_template_key,'voice_recovery')
       AND agency_id IN (p_agency_id,'__platform__')
       AND provider_status='approved' AND provider_synced_at IS NOT NULL AND provider_template_id IS NOT NULL);
  v_quota_remaining := COALESCE(v_s.voice_minutes_monthly_quota,0) - COALESCE(v_s.voice_minutes_used_this_month,0);

  IF NOT v_channel            THEN v_blockers := array_append(v_blockers, 'Voice channel not enabled (channels_enabled has no ''voice'').'); END IF;
  IF NOT v_ai_disclosure_ready THEN v_blockers := array_append(v_blockers, 'Art.50 AI-identity disclosure not configured (K3 — copy pending). Voice must not go live without it.'); END IF;
  IF v_kill                    THEN v_blockers := array_append(v_blockers, 'Automation kill-switch is ON — automation forced off.'); END IF;

  v_ready := v_channel AND v_ai_disclosure_ready AND NOT v_kill;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'voice_channel_enabled', v_channel,
    'ai_disclosure_ready', v_ai_disclosure_ready,
    'voice_recovery_whatsapp_enabled', COALESCE(v_s.voice_recovery_whatsapp_enabled,false),
    'voice_recovery_template_approved', v_recovery_tpl_ok,
    'automation_kill_switch', v_kill,
    'whatsapp_reply_mode', v_s.whatsapp_reply_mode,
    'voice_minutes_quota', v_s.voice_minutes_monthly_quota,
    'voice_minutes_used', v_s.voice_minutes_used_this_month,
    'voice_minutes_remaining', v_quota_remaining,
    'no_live_calls_note', 'Readiness only — this function never enables or places a call.',
    'blockers', to_jsonb(v_blockers));
END $fn$;

-- ---- Automation go-live readiness (read-only). Never enables automation or sends. ----
CREATE OR REPLACE FUNCTION public.get_automation_readiness(p_agency_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_s agency_settings%ROWTYPE;
  v_kill boolean; v_provider_ok boolean; v_approved_tpl int; v_reviewed boolean;
  v_blockers text[] := '{}'; v_ready boolean;
  v_ai_disclosure_ready boolean := false;  -- K3 pending
BEGIN
  SELECT * INTO v_s FROM agency_settings WHERE agency_id = p_agency_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ready', false, 'error', 'agency_not_found'); END IF;

  v_kill := COALESCE(v_s.automation_kill_switch, false);
  v_provider_ok := (v_s.whatsapp_provider='twilio' AND v_s.whatsapp_from_number IS NOT NULL AND v_s.whatsapp_access_token_connected IS TRUE);
  SELECT count(*) INTO v_approved_tpl FROM whatsapp_templates
    WHERE agency_id IN (p_agency_id,'__platform__')
      AND provider_status='approved' AND provider_synced_at IS NOT NULL AND provider_template_id IS NOT NULL;
  v_reviewed := v_s.reply_rules_reviewed_at IS NOT NULL;

  IF v_kill                    THEN v_blockers := array_append(v_blockers, 'Automation kill-switch is ON.'); END IF;
  IF NOT v_provider_ok         THEN v_blockers := array_append(v_blockers, 'No active WhatsApp sender (provider not configured).'); END IF;
  IF v_approved_tpl = 0        THEN v_blockers := array_append(v_blockers, 'No verified-approved templates for this agency.'); END IF;
  IF NOT v_ai_disclosure_ready THEN v_blockers := array_append(v_blockers, 'Art.50 AI-identity disclosure not configured (K3 — copy pending).'); END IF;
  IF NOT v_reviewed            THEN v_blockers := array_append(v_blockers, 'reply_rules not reviewed (reply_rules_reviewed_at is null).'); END IF;

  v_ready := (NOT v_kill) AND v_provider_ok AND v_approved_tpl > 0 AND v_ai_disclosure_ready AND v_reviewed;

  RETURN jsonb_build_object(
    'ready', v_ready,
    'automation_currently_enabled', COALESCE(v_s.whatsapp_automation_enabled, false),
    'whatsapp_reply_mode', v_s.whatsapp_reply_mode,
    'automation_kill_switch', v_kill,
    'provider_ready', v_provider_ok,
    'approved_template_count', v_approved_tpl,
    'ai_disclosure_ready', v_ai_disclosure_ready,
    'reply_rules_reviewed', v_reviewed,
    'note', 'Readiness gate only — never enables automation or sends. Enablement stays an explicit approval-first action; enforcement (reply_rules / prepare_voice_recovery) must also honor automation_kill_switch (Packet 2 seam).',
    'blockers', to_jsonb(v_blockers));
END $fn$;

-- Grants: same posture as get_whatsapp_send_readiness — no anon/authenticated; aivena_app + service_role only.
REVOKE ALL ON FUNCTION public.get_voice_call_readiness(text)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_automation_readiness(text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voice_call_readiness(text)  TO aivena_app, service_role;
GRANT EXECUTE ON FUNCTION public.get_automation_readiness(text)  TO aivena_app, service_role;