-- migration: get_whatsapp_provider_readiness  (Phase 1c / H1) — B3 semantics
-- One honest per-agency readiness object, sourced from PROVIDER-VERIFIED truth (not the hand
-- seed), gating the dashboard WhatsApp surface and telling Vega what is real.
--
-- Agency comes from app.current_agency_id (the tenant fence agencyContextMiddleware sets),
-- never a parameter. SECURITY DEFINER + locked search_path; fails closed if the fence is unset.
-- Resolution mirrors the worker: per (template_key, language) prefer the agency-specific row,
-- else the __platform__ catalog row, then read that row's synced status.
--
-- B3 contract (Chat 3 main, 2026-06-27):
--   * "verified approved" = provider_status='approved' AND provider_synced_at IS NOT NULL.
--   * a seed status='approved' WITHOUT a provider sync is UNKNOWN, never verified.
--   * templates_provider_approved.count is INFORMATIONAL — never by itself makes an agency usable.
--   * closed_window_template_ready (the usability gate) = sender_ready AND a VERIFIED-approved
--     agency_followup_v1 — so a no-sender agency shows not-usable even if approved templates exist.
--   * provider_truth_verified = the resolved set is fully provider-backed (>0 resolved, 0 unknown).
--   * template_send_path_proven = a real template-keyed send reached sent/delivered (false until I1).
--   * languages_ready = languages with a verified-approved template (English only after sync);
--     languages_pending = supported_languages not yet ready.
--
-- GRANT (deviation from the original brief): EXECUTE to aivena_app (the pooled API role that calls
-- this through agencyContextMiddleware) + service_role (internal cross-agency route). Safe — it only
-- ever returns the GUC-fenced agency's data, and the GUC is set server-side, never by the client.

create or replace function public.get_whatsapp_provider_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_agency text := nullif(current_setting('app.current_agency_id', true), '');
  v_provider text;
  v_from text;
  v_connected boolean;
  v_channels jsonb;
  v_supported jsonb;
  v_sender_ready boolean;
  v_channel_enabled boolean;
  v_send_path_proven boolean;
begin
  if v_agency is null then
    return jsonb_build_object('ok', false, 'error', 'agency_context_unset');
  end if;

  select whatsapp_provider, whatsapp_from_number, whatsapp_access_token_connected,
         to_jsonb(channels_enabled), to_jsonb(supported_languages)
    into v_provider, v_from, v_connected, v_channels, v_supported
  from agency_settings
  where agency_id = v_agency;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'agency_not_found');
  end if;

  v_sender_ready := (v_provider = 'twilio' and v_from is not null and v_connected is true);

  v_channel_enabled := exists (
    select 1 from jsonb_array_elements_text(coalesce(v_channels, '[]'::jsonb)) e where e = 'whatsapp'
  );

  -- A template-keyed WhatsApp send must have reached sent/delivered for this agency.
  v_send_path_proven := exists (
    select 1 from send_queue
    where agency_id = v_agency and channel = 'whatsapp'
      and template_key is not null and template_key <> 'freeform'
      and status in ('sent','delivered')
  );

  return (
    with resolved as (
      select distinct on (template_key, language)
        template_key, language, provider_synced_at,
        (provider_status = 'approved' and provider_synced_at is not null) as verified_approved,
        (provider_synced_at is null)                                      as is_unknown
      from whatsapp_templates
      where agency_id in (v_agency, '__platform__')
      order by template_key, language, (agency_id = v_agency) desc  -- agency row preferred
    ),
    agg as (
      select
        count(*) filter (where verified_approved) as approved_count,
        count(*) filter (where is_unknown)        as unknown_count,
        count(*)                                  as total_count,
        coalesce(jsonb_agg(jsonb_build_object('template_key', template_key, 'language', language)
                 order by template_key, language) filter (where verified_approved), '[]'::jsonb) as approved_items,
        coalesce(jsonb_agg(jsonb_build_object('template_key', template_key, 'language', language)
                 order by template_key, language) filter (where is_unknown), '[]'::jsonb)        as unknown_items,
        coalesce((select jsonb_agg(distinct language order by language) from resolved where verified_approved),
                 '[]'::jsonb)                     as langs_ready,
        bool_or(verified_approved and template_key = 'agency_followup_v1') as followup_verified,
        max(provider_synced_at)                   as last_sync
      from resolved
    )
    select jsonb_build_object(
      'ok', true,
      'agency_id', v_agency,
      'whatsapp_sender_ready', v_sender_ready,
      'whatsapp_channel_enabled', v_channel_enabled,
      'templates_provider_approved', jsonb_build_object('count', approved_count, 'items', approved_items),
      'templates_provider_unknown',  jsonb_build_object('count', unknown_count, 'items', unknown_items),
      'languages_ready', langs_ready,
      'languages_pending', coalesce((
        select jsonb_agg(l order by l)
        from jsonb_array_elements_text(coalesce(v_supported, '[]'::jsonb)) l
        where not (langs_ready ? l)
      ), '[]'::jsonb),
      'closed_window_template_ready', (v_sender_ready and coalesce(followup_verified, false)),
      'provider_truth_verified', (total_count > 0 and unknown_count = 0),
      'last_provider_sync_at', last_sync,
      'template_send_path_proven', v_send_path_proven
    )
    from agg
  );
end;
$$;

revoke all on function public.get_whatsapp_provider_readiness() from public, anon, authenticated;
grant execute on function public.get_whatsapp_provider_readiness() to aivena_app, service_role;
