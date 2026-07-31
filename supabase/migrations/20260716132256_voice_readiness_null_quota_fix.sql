-- Fix: voice_minutes_remaining should be NULL (not a negative number) when quota is unset.
-- CREATE OR REPLACE preserves grants. Read-only function; no behavior/enable change.
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
  -- NULL quota = unset/unlimited → remaining is NULL, not a negative number.
  v_quota_remaining := CASE WHEN v_s.voice_minutes_monthly_quota IS NULL THEN NULL
                           ELSE v_s.voice_minutes_monthly_quota - COALESCE(v_s.voice_minutes_used_this_month,0) END;

  IF NOT v_channel             THEN v_blockers := array_append(v_blockers, 'Voice channel not enabled (channels_enabled has no ''voice'').'); END IF;
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