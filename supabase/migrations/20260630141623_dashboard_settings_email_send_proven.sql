-- J3 — replace the FAKE email "domain_verified" signal with a REAL "send_proven" signal (Chat 3 CC, 2026-06-30).
--
-- WHY: dashboard_settings.profile.domain_verified was computed as
--   (ec.from_email IS NOT NULL AND split_part(ec.from_email,'@',2) <> '')
-- i.e. merely "from_email has an @domain" — NOT a real verification. It made readiness
-- render "Email domain verified" for any agency with a from_email (a Law-1 fake-state).
--
-- FIX (profile email block ONLY): drop the faked domain_verified from the profile and add a
-- REAL proof signal sourced from provider_audit_log — a genuinely successful Resend send
-- (provider_type='resend', HTTP 2xx, provider_message_id present):
--   * send_proven      = EXISTS(such a row for this agency)
--   * send_proven_at   = max(created_at) of such rows
-- Every other field of dashboard_settings is preserved byte-for-byte.
--
-- NOT a DNS/domain-verification claim — readiness will say "Email sending proven" (real send)
-- vs "configured — sending not proven" vs "not configured", and NEVER "domain verified" until a
-- real Resend domains-API/DNS signal exists (tracked separately as J3b).
--
-- NB (flagged, NOT changed here — Chat-4 lane): the setup_checklist `domain_verified` step still
-- uses the same fake formula; neutralising that onboarding-checklist step is handed to Chat 4.
--
-- ROLLBACK: restore the prior definition (profile email line back to the domain_verified formula).

CREATE OR REPLACE FUNCTION public.dashboard_settings(void_unused integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_agency text := current_setting('app.current_agency_id', true);
  v_profile  jsonb;
  v_config   jsonb;
  v_channels jsonb;
  v_branding jsonb;
  v_team     jsonb;
  v_checklist jsonb;
  v_non_staff_count int;
BEGIN
  IF v_agency IS NULL OR v_agency = '' THEN
    RAISE EXCEPTION 'no_agency_context' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.require_role('viewer'::public.agency_role);  -- Phase 4 role gate

  SELECT jsonb_build_object(
    'agency_id',            a.id,
    'name',                 COALESCE(b.brand_name, a.trading_name, a.legal_name, s.agency_name),
    'legal_name',           a.legal_name,
    'region',               a.primary_region,
    'status',               a.status,
    'supported_languages',  a.supported_languages,
    'sending_domain',       split_part(ec.from_email, '@', 2),
    'from_email',           ec.from_email,
    'from_name',            ec.from_name,
    'reply_to',             ec.reply_to,
    'send_proven',          EXISTS (
                              SELECT 1 FROM provider_audit_log pal
                              WHERE pal.agency_id = a.id
                                AND pal.provider_type = 'resend'
                                AND pal.response_status BETWEEN 200 AND 299
                                AND pal.provider_message_id IS NOT NULL
                            ),
    'send_proven_at',       (
                              SELECT max(pal.created_at) FROM provider_audit_log pal
                              WHERE pal.agency_id = a.id
                                AND pal.provider_type = 'resend'
                                AND pal.response_status BETWEEN 200 AND 299
                                AND pal.provider_message_id IS NOT NULL
                            )
  )
  INTO v_profile
  FROM agencies a
  LEFT JOIN agency_settings    s  ON s.agency_id  = a.id
  LEFT JOIN agency_email_config ec ON ec.agency_id = a.id
  LEFT JOIN agency_branding    b  ON b.agency_id  = a.id
  WHERE a.id = v_agency;

  SELECT jsonb_build_object(
    'approve_before_sending', s.human_approval_required,
    'auto_first_response',    s.auto_first_response_enabled,
    'reply_handling_mode',    s.reply_handling_mode,
    'fallback_mode',          s.fallback_mode,
    'timezone',               s.timezone,
    'working_hours',          s.working_hours,
    'followup_style',         s.followup_style,
    'daily_send_cap',         s.daily_send_cap,
    'monthly_send_cap',       s.monthly_send_cap,
    'data_retention_days',    s.data_retention_days,
    'agency_paused',          (SELECT status = 'paused' FROM agencies WHERE id = v_agency)
  )
  INTO v_config
  FROM agency_settings s
  WHERE s.agency_id = v_agency;

  SELECT jsonb_build_object(
    'email',    jsonb_build_object(
                  'enabled', COALESCE(s.email_enabled, false),
                  'live',    true),
    'whatsapp', jsonb_build_object(
                  'enabled',   COALESCE(s.whatsapp_automation_enabled, false),
                  'connected', COALESCE(s.whatsapp_access_token_connected, false),
                  'live',      false,
                  'no_source', NOT COALESCE(s.whatsapp_access_token_connected, false))
  )
  INTO v_channels
  FROM agency_settings s
  WHERE s.agency_id = v_agency;

  SELECT jsonb_build_object(
    'brand_name',           b.brand_name,
    'logo_url',             b.logo_url,
    'primary_color',        b.primary_color,
    'accent_color',         b.accent_color,
    'text_color',           b.text_color,
    'background_color',     b.background_color,
    'font_family',          b.font_family,
    'phone',                b.phone,
    'whatsapp_number',      b.whatsapp_number,
    'website_url',          b.website_url,
    'booking_url',          b.booking_url,
    'office_address',       b.office_address,
    'city',                 b.city,
    'region',               b.region,
    'country',              b.country,
    'instagram_url',        b.instagram_url,
    'facebook_url',         b.facebook_url,
    'linkedin_url',         b.linkedin_url,
    'email_signature_name', b.email_signature_name,
    'email_signature_role', b.email_signature_role,
    'email_footer_text',    b.email_footer_text,
    'tone',                 b.tone,
    'brand_voice',          b.brand_voice,
    'content_style',        b.content_style,
    'reviewed_at',          b.branding_reviewed_at
  )
  INTO v_branding
  FROM agency_branding b
  WHERE b.agency_id = v_agency;

  SELECT jsonb_build_object(
    'members', COALESCE(
      (SELECT jsonb_agg(member ORDER BY sort_role, sort_created)
       FROM (
         SELECT
           jsonb_build_object(
             'user_id',    ua.user_id,
             'email',      public._get_user_email(ua.user_id),
             'role',       ua.role::text,
             'is_default', ua.is_default
           ) AS member,
           CASE ua.role::text
             WHEN 'owner'  THEN 0
             WHEN 'agent'  THEN 1
             WHEN 'viewer' THEN 2
             ELSE 9
           END AS sort_role,
           ua.created_at AS sort_created
         FROM user_agencies ua

         WHERE ua.agency_id = v_agency
           AND ua.role::text <> 'aivena_staff'
       ) ranked),
      '[]'::jsonb),
    'member_count', (
      SELECT count(*)::int
      FROM user_agencies ua
      WHERE ua.agency_id = v_agency
        AND ua.role::text <> 'aivena_staff'
    ),
    'invitations', COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object(
           'id',            i.id,
           'email',         i.email,
           'role',          i.role::text,
           'status',        i.status,
           'created_at',    i.created_at,
           'expires_at',    i.expires_at,
           'send_attempts', i.send_attempts,
           'last_sent_at',  i.last_sent_at,
           'invited_by',    i.invited_by
         ) ORDER BY i.created_at DESC)
       FROM invitations i
       WHERE i.agency_id = v_agency
         AND i.status = 'pending'),
      '[]'::jsonb),
    'pending_invitation_count', (
      SELECT count(*)::int FROM invitations
      WHERE agency_id = v_agency AND status = 'pending'
    )
  )
  INTO v_team;

  SELECT count(*)::int INTO v_non_staff_count
  FROM user_agencies
  WHERE agency_id = v_agency
    AND role::text <> 'aivena_staff';

  SELECT jsonb_build_object(
    'domain_verified', jsonb_build_object(
      'completed', (SELECT (ec.from_email IS NOT NULL AND split_part(ec.from_email, '@', 2) <> '')
                    FROM agency_email_config ec WHERE ec.agency_id = v_agency),
      'completed_at', (SELECT ec.updated_at FROM agency_email_config ec
                       WHERE ec.agency_id = v_agency
                         AND ec.from_email IS NOT NULL
                         AND split_part(ec.from_email, '@', 2) <> '')
    ),
    'branding_added', jsonb_build_object(
      'completed',    (SELECT b.branding_reviewed_at IS NOT NULL FROM agency_branding b WHERE b.agency_id = v_agency),
      'completed_at', (SELECT b.branding_reviewed_at              FROM agency_branding b WHERE b.agency_id = v_agency)
    ),
    'ai_rules_set', jsonb_build_object(
      'completed',    (SELECT s.reply_rules_reviewed_at IS NOT NULL FROM agency_settings s WHERE s.agency_id = v_agency),
      'completed_at', (SELECT s.reply_rules_reviewed_at              FROM agency_settings s WHERE s.agency_id = v_agency)
    ),
    'team_invited', jsonb_build_object(
      'completed',    (v_non_staff_count > 1),
      'completed_at', null
    ),
    'whatsapp_connected', jsonb_build_object(
      'completed',    (SELECT COALESCE(s.whatsapp_access_token_connected, false) FROM agency_settings s WHERE s.agency_id = v_agency),
      'completed_at', null
    )
  )
  INTO v_checklist;

  RETURN jsonb_build_object(
    'profile',         v_profile,
    'config',          v_config,
    'channels',        v_channels,
    'branding',        v_branding,
    'team',            v_team,
    'setup_checklist', v_checklist,
    'network',         jsonb_build_object('value', null, 'no_source', true, 'label', 'Coming soon')
  );
END;
$function$;
