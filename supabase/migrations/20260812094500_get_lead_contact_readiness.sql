-- get_lead_contact_readiness(p_lead_id) — deterministic per-lead contact readiness (v1).
--
-- WHY (2026-08-12): Christian's WhatsApp check-in to a Norwegian lead failed with a generic
-- "Didn't send. Please try again." The real cause (send_queue d6723ab8) was
-- template_language_not_approved: the reply window was closed and NO approved Norwegian (nb)
-- check-in template exists — a PERMANENT config gap, not a transient error. The UI had
-- recommended an action that provably could not work. This function is the single source of
-- truth the UI must consult BEFORE offering any send action: "can this lead be contacted right
-- now, and if not, exactly why."
--
-- READ-ONLY: no writes, no sends, no side effects. STABLE. SECURITY INVOKER — all reads run
-- under the caller's RLS (aivena_app policies fence by app.current_agency_id), so the function
-- is agency-fenced by construction; a lead outside the caller's agency returns lead_not_found.
--
-- MIRRORS THE LIVE GATES EXACTLY (verified against prod source 2026-08-12):
--   * Opt-out guard         = whatsapp-send-execute v6.6 sendBlockedByOptIn
--                             (refuses BOTH 'blocked' AND 'opted_out').
--   * Provider gate         = agency_settings.whatsapp_provider='twilio' AND
--                             whatsapp_from_number IS NOT NULL AND
--                             whatsapp_access_token_connected IS TRUE
--                             (same fields as send_reengagement_template + the EF; NOT provider_accounts).
--   * Phone gate            = EF E.164 regex verbatim: ^\+[1-9][0-9]{6,14}$ (no normalization live).
--   * Language alias        = EF v6.5 LANG_ALIAS: no/nn/nob/nb_no -> nb; empty/null -> en.
--   * Template approval     = EF v6.4 verified-approved: provider_status='approved' AND
--                             provider_synced_at IS NOT NULL AND provider_template_id IS NOT NULL,
--                             over agency-specific + '__platform__' rows. STRICT language,
--                             ENGLISH FLOOR OFF (Christian decision 2026-07-04) — never recommend
--                             a language substitution the pipeline will refuse.
--   * RPC registration gate = send_reengagement_template requires an AGENCY-scoped row with
--                             status='approved' (platform-only registration is not enough).
--   * Cooldown              = RPC rolling 7-day re-engage cooldown (non-failed operator_reengage
--                             row in the last 7 days blocks).
--
-- RLS SUBTLETY (found in review, 2026-08-12): whatsapp_templates_isolation fences aivena_app
-- to agency_id = GUC, so a plain SECURITY INVOKER read CANNOT see '__platform__' rows — while
-- the live EF (service_role) CAN. Fix: the platform-catalog read goes through a minimal
-- SECURITY DEFINER helper that exposes ONLY platform template languages for a key (no agency
-- data crosses the definer boundary). Everything else stays under the caller's RLS.
--
-- Rollback / off switch:
--   DROP FUNCTION public.get_lead_contact_readiness(uuid);
--   DROP FUNCTION public._platform_approved_template_languages(text);
-- (Nothing depends on them yet; dropping restores the exact pre-migration state.)

-- Helper: which languages does the PLATFORM ('__platform__') have verified-approved for a
-- template key? SECURITY DEFINER strictly so platform rows are visible past the agency-GUC
-- RLS fence; it reads nothing agency-scoped and returns only a language list.
CREATE OR REPLACE FUNCTION public._platform_approved_template_languages(p_template_key text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $helper$
  SELECT coalesce(array_agg(DISTINCT w.language ORDER BY w.language), '{}')
    FROM whatsapp_templates w
   WHERE w.agency_id = '__platform__'
     AND w.template_key = p_template_key
     AND w.language IS NOT NULL
     AND w.provider_status = 'approved'
     AND w.provider_synced_at IS NOT NULL
     AND w.provider_template_id IS NOT NULL;
$helper$;

REVOKE ALL ON FUNCTION public._platform_approved_template_languages(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._platform_approved_template_languages(text) FROM anon;
REVOKE ALL ON FUNCTION public._platform_approved_template_languages(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._platform_approved_template_languages(text) TO aivena_app;
GRANT EXECUTE ON FUNCTION public._platform_approved_template_languages(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_lead_contact_readiness(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead               leads%ROWTYPE;
  v_lang_norm          text;
  v_window_open        boolean;
  v_window_state       text;
  v_window_expires_at  timestamptz;
  v_contact_allowed    boolean;
  v_phone_valid        boolean;
  v_has_settings       boolean := false;
  v_provider_ready     boolean := false;
  v_provider_state     text;
  v_approved_langs     text[];
  v_lang_ok            boolean;
  v_rpc_registered     boolean;
  v_last_ok_out        timestamptz;
  v_last_failed_at     timestamptz;
  v_last_failed_reason text;
  v_cooldown_until     timestamptz;
  v_action             text;
  v_blocked            text;
  v_explanation        text;
  v_lang_disp          text;
  v_gap_still_present  boolean;
  c_template_key       constant text := 'agency_followup_v1';
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    -- Also the answer for a lead outside the caller's RLS fence: indistinguishable
    -- from nonexistence, so nothing cross-agency is leaked.
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  -- Language normalization — EF v6.5 LANG_ALIAS. Whitespace strip uses \s (not plain
  -- trim()) to match the EF's JS String.trim(), which removes tabs/newlines too.
  v_lang_norm := CASE lower(regexp_replace(coalesce(v_lead.language, ''), '^\s+|\s+$', '', 'g'))
    WHEN 'no' THEN 'nb' WHEN 'nn' THEN 'nb' WHEN 'nob' THEN 'nb' WHEN 'nb_no' THEN 'nb'
    WHEN '' THEN 'en'
    ELSE lower(regexp_replace(v_lead.language, '^\s+|\s+$', '', 'g'))
  END;
  -- Display form for prose: only interpolate a language code that looks like one;
  -- anything else (lead-influenced free text) is named generically, never embedded.
  v_lang_disp := CASE WHEN v_lang_norm ~ '^[a-z][a-z0-9_-]{1,9}$'
                      THEN v_lang_norm ELSE 'the lead''s language' END;

  -- 24h session window from the lead's canonical last-inbound stamp.
  v_window_open := v_lead.last_inbound_whatsapp_at IS NOT NULL
               AND now() - v_lead.last_inbound_whatsapp_at < interval '24 hours';
  v_window_state := CASE WHEN v_lead.last_inbound_whatsapp_at IS NULL THEN 'never_opened'
                         WHEN v_window_open THEN 'open'
                         ELSE 'closed' END;
  v_window_expires_at := CASE WHEN v_window_open
                              THEN v_lead.last_inbound_whatsapp_at + interval '24 hours' END;

  -- Opt-out guard — refuses BOTH states, same as the send path.
  v_contact_allowed := v_lead.opt_in_status IS DISTINCT FROM 'opted_out'
                   AND v_lead.opt_in_status IS DISTINCT FROM 'blocked';

  -- E.164 — EF regex verbatim; the live path does NOT normalize, so neither do we.
  v_phone_valid := v_lead.phone IS NOT NULL AND v_lead.phone ~ '^\+[1-9][0-9]{6,14}$';

  -- Provider gate — agency_settings, the same source both the RPC and the EF check.
  SELECT true,
         coalesce(s.whatsapp_provider = 'twilio'
                  AND s.whatsapp_from_number IS NOT NULL
                  AND s.whatsapp_access_token_connected IS TRUE, false)
    INTO v_has_settings, v_provider_ready
    FROM agency_settings s
   WHERE s.agency_id = v_lead.agency_id;
  -- SELECT INTO with no row sets NULL (it does not keep the initializers): coalesce back.
  v_has_settings   := coalesce(v_has_settings, false);
  v_provider_ready := coalesce(v_provider_ready, false);
  v_provider_state := CASE WHEN NOT v_has_settings THEN 'no_settings'
                           WHEN v_provider_ready THEN 'ready'
                           ELSE 'not_configured' END;

  -- EF-verified-approved check-in template languages: agency rows under the caller's
  -- own RLS, UNION platform rows via the definer helper (aivena_app's RLS fence hides
  -- '__platform__' rows, but the live EF reads them as service_role — mirror that).
  SELECT coalesce(array_agg(DISTINCT u.lang ORDER BY u.lang), '{}')
    INTO v_approved_langs
    FROM (
      SELECT w.language AS lang
        FROM whatsapp_templates w
       WHERE w.template_key = c_template_key
         AND w.agency_id = v_lead.agency_id
         AND w.language IS NOT NULL
         AND w.provider_status = 'approved'
         AND w.provider_synced_at IS NOT NULL
         AND w.provider_template_id IS NOT NULL
      UNION
      SELECT unnest(public._platform_approved_template_languages(c_template_key))
    ) u
   WHERE u.lang IS NOT NULL;
  -- coalesce: '= ANY' over a NULL-containing array is three-valued; keep a real boolean.
  v_lang_ok := coalesce(v_lang_norm = ANY (v_approved_langs), false);

  -- RPC registration gate (agency-scoped row, status='approved').
  SELECT EXISTS (
    SELECT 1 FROM whatsapp_templates w2
     WHERE w2.agency_id = v_lead.agency_id
       AND w2.template_key = c_template_key
       AND w2.status = 'approved')
    INTO v_rpc_registered;

  -- Last successful outbound (thread truth; 'sent' at EF write time, then callback
  -- upgrades to delivered/read — 'failed'/'undelivered'/'queued' never count).
  SELECT max(coalesce(m.sent_at, m.created_at))
    INTO v_last_ok_out
    FROM conversation_messages m
   WHERE m.lead_id = p_lead_id
     AND m.direction = 'outbound'
     AND m.status IN ('sent', 'delivered', 'read');

  -- Last failed send + the REAL reason (send_queue is the send truth). 'rejected' and
  -- 'dead' are terminal failure states too (same set the RPC cooldown excludes);
  -- 'cancelled' is operator intent, not a failure. Delivery-level 'undelivered'
  -- (post-acceptance, conversation_messages) is deliberately out of scope here:
  -- fields 9/10 are send-acceptance truth — documented decision, v1.
  SELECT coalesce(q.failed_at, q.updated_at, q.requested_at), q.failure_reason
    INTO v_last_failed_at, v_last_failed_reason
    FROM send_queue q
   WHERE q.lead_id = p_lead_id AND q.status IN ('failed', 'rejected', 'dead')
   ORDER BY coalesce(q.failed_at, q.updated_at, q.requested_at) DESC
   LIMIT 1;

  -- RPC rolling 7-day re-engage cooldown (failed attempts do not count).
  SELECT max(q.requested_at) + interval '7 days'
    INTO v_cooldown_until
    FROM send_queue q
   WHERE q.lead_id = p_lead_id
     AND q.requested_by = 'operator_reengage'
     AND q.requested_at > now() - interval '7 days'
     AND q.status NOT IN ('failed', 'cancelled', 'rejected', 'dead');

  -- ---- Deterministic recommendation ladder (first blocker wins) ----
  -- Permanent gaps dominate transient ones: the cooldown arm fires ONLY when the
  -- post-cooldown send can actually work (template + registration both in place) —
  -- otherwise "possible after <date>" would be a try-again promise for a send that
  -- will still fail, the exact incident class this function exists to prevent.
  v_action := CASE
    WHEN NOT v_contact_allowed                    THEN 'do_not_contact'
    WHEN NOT v_has_settings OR NOT v_provider_ready THEN 'fix_whatsapp_provider_setup'
    WHEN NOT v_phone_valid                        THEN 'add_valid_phone_number'
    WHEN v_window_open                            THEN 'send_normal_reply'
    WHEN v_lang_ok AND v_rpc_registered
         AND v_cooldown_until IS NOT NULL         THEN 'wait_reengagement_cooldown'
    WHEN v_lang_ok AND v_rpc_registered           THEN 'send_template_checkin'
    WHEN v_lang_ok                                THEN 'register_agency_template'
    ELSE 'do_not_send_get_template_approved'
  END;

  v_blocked := CASE
    WHEN NOT v_contact_allowed                    THEN 'lead_opted_out_or_blocked'
    WHEN NOT v_has_settings OR NOT v_provider_ready THEN 'whatsapp_not_configured'
    WHEN NOT v_phone_valid                        THEN 'lead_missing_valid_phone'
    WHEN v_window_open                            THEN NULL
    WHEN v_lang_ok AND v_rpc_registered
         AND v_cooldown_until IS NOT NULL         THEN 'reengagement_cooldown'
    WHEN v_lang_ok AND v_rpc_registered           THEN NULL
    WHEN v_lang_ok                                THEN 'template_not_registered_for_agency'
    ELSE 'no_approved_template_in_lead_language'
  END;

  v_explanation := CASE v_action
    WHEN 'do_not_contact' THEN
      'This lead has opted out or blocked WhatsApp contact. Do not contact them on this channel.'
    WHEN 'fix_whatsapp_provider_setup' THEN
      'This agency has no active Twilio WhatsApp sender configured. No WhatsApp message can be sent to any lead until the provider is set up.'
    WHEN 'add_valid_phone_number' THEN
      'The lead has no valid international (E.164, e.g. +34600000000) phone number on file, so no WhatsApp can be sent. Fix the phone number first.'
    WHEN 'send_normal_reply' THEN
      'The WhatsApp reply window is open until '
      || to_char(v_window_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
      || ' UTC. A normal reply can be sent now.'
    WHEN 'wait_reengagement_cooldown' THEN
      -- Only reachable when template + registration are in place, so the promise is true.
      'A re-engagement check-in was already requested in the last 7 days. The next check-in is possible after '
      || to_char(v_cooldown_until AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
      || ' UTC, or wait for the lead to reply.'
    WHEN 'send_template_checkin' THEN
      'The reply window is closed, but an approved ' || v_lang_disp
      || ' check-in template exists. A template check-in can be sent now.'
    WHEN 'register_agency_template' THEN
      'A provider-approved ' || v_lang_disp
      || ' template exists in scope, but this agency has no agency-registered row with status ''approved'' for the check-in key, so the check-in path will refuse. Register or re-activate the agency template first.'
    ELSE
      'The reply window is closed and there is no approved ' || v_lang_disp
      || ' check-in template (approved languages: '
      || coalesce(nullif(array_to_string(v_approved_langs, ', '), ''), 'none')
      || '). Sending will always fail — do not retry. Options: get the ' || v_lang_disp
      || ' template approved, or wait for the lead to reply. The pipeline is strict-language by design and will not substitute another language.'
  END;

  IF v_last_failed_reason IS NOT NULL THEN
    -- The bare fact is always surfaced; the "retrying will not help" verdict is
    -- appended ONLY while the gap behind that reason is still present — a stale
    -- verdict would contradict a healthy recommendation in the same sentence.
    v_gap_still_present :=
         (v_last_failed_reason IN ('template_language_not_approved', 'template_not_approved',
                                   'template_no_content_sid')
            AND NOT (v_lang_ok AND v_rpc_registered))
      OR (v_last_failed_reason = 'whatsapp_not_configured' AND NOT v_provider_ready);
    v_explanation := v_explanation
      || ' Last send attempt failed at '
      || to_char(v_last_failed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
      || ' UTC with reason: ' || v_last_failed_reason || '.'
      || CASE WHEN v_gap_still_present
              THEN ' That failure is a configuration gap that is still present — retrying will not help until it is fixed.'
              ELSE '' END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'version', 'v1',
    'checked_at', now(),
    'template_key', c_template_key,
    -- 1..5
    'lead_id', v_lead.id,
    'agency_id', v_lead.agency_id,
    'lead_language', v_lead.language,
    'lead_language_normalized', v_lang_norm,
    'opt_in_status', v_lead.opt_in_status,
    'channel', v_lead.channel,
    -- 6..10
    'whatsapp_window', jsonb_build_object(
      'state', v_window_state, 'open', v_window_open, 'expires_at', v_window_expires_at),
    'last_inbound_at', v_lead.last_inbound_whatsapp_at,
    'last_successful_outbound_at', v_last_ok_out,
    'last_failed_outbound_at', v_last_failed_at,
    'last_failed_reason', v_last_failed_reason,
    -- 11
    'provider', jsonb_build_object('ready', v_provider_ready, 'state', v_provider_state),
    -- 12..15
    'normal_reply_allowed', (v_contact_allowed AND v_window_open AND v_provider_ready AND v_phone_valid),
    'template_checkin_required', (v_contact_allowed AND NOT v_window_open),
    'approved_template_in_lead_language', v_lang_ok,
    'approved_template_languages', to_jsonb(v_approved_langs),
    -- 16..18
    'recommended_action', v_action,
    'blocked_reason', v_blocked,
    'explanation', v_explanation,
    -- extras (each exists so the UI can never recommend an action that cannot work)
    'phone_valid', v_phone_valid,
    'template_registered_for_agency', v_rpc_registered,
    'reengagement_cooldown_until', v_cooldown_until
  );
END;
$function$;

COMMENT ON FUNCTION public.get_lead_contact_readiness(uuid) IS
  'Read-only, deterministic per-lead WhatsApp contact readiness. Mirrors the live send gates (opt-out, agency_settings provider, E.164, 24h window, EF strict-language verified-approved templates, RPC registration, 7-day re-engage cooldown) and returns recommended_action + blocked_reason + explanation. The UI must consult this before offering any send action. v1, 2026-08-12.';

-- Grant posture: mirror the post-P0 hardening (apply_conversation_interest).
-- SECURITY INVOKER + RLS does the agency fencing; no anon/authenticated EXECUTE
-- (authenticated has zero SELECT policies on the underlying tables anyway).
REVOKE ALL ON FUNCTION public.get_lead_contact_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_lead_contact_readiness(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_lead_contact_readiness(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_contact_readiness(uuid) TO aivena_app;
GRANT EXECUTE ON FUNCTION public.get_lead_contact_readiness(uuid) TO service_role;
