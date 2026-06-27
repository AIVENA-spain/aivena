-- migration: apply_template_provider_status  (Phase 1b)
-- Reconcile function: takes the array the twilio-template-sync Edge Function builds from
-- Twilio ContentAndApprovals and applies it in one transaction. Updates EVERY row whose
-- provider_template_id matches a SID in the array, so both the agency row and the
-- __platform__ catalog row for a shared SID receive the truth in the same call.
--
-- service_role only (the sync EF calls it with the service-role key).
-- CREATE OR REPLACE with the SAME signature if you ever change it (a DROP+CREATE re-adds
-- the default PUBLIC/anon EXECUTE grants — re-run the revoke/grant only on a signature change).

create or replace function public.apply_template_provider_status(p_items jsonb)
returns table(matched_sid text, rows_updated bigint)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  return query
  with src as (
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(sid text, provider_status text, mapped_status text, category text, rejection_reason text)
  ),
  upd as (
    update public.whatsapp_templates t set
      provider_status    = s.provider_status,
      status             = s.mapped_status,
      -- category is NOT NULL. Never blank it on an empty provider value: keep the existing
      -- category if Twilio returns nothing, else normalize to UPPERCASE. (Deviation from the
      -- brief's `upper(nullif(...))`, which would write NULL on empty and violate NOT NULL.)
      category           = coalesce(upper(nullif(s.category, '')), t.category),
      rejected_reason    = nullif(s.rejection_reason, ''),
      approved_at        = case
                             when s.mapped_status = 'approved' and t.approved_at is null then now()
                             else t.approved_at
                           end,
      provider_synced_at = now(),
      updated_at         = now()
    from src s
    where t.provider_template_id = s.sid
    returning t.provider_template_id as sid
  )
  select sid, count(*)::bigint from upd group by sid;
end;
$$;

-- New function default grants EXECUTE to PUBLIC. Lock to service_role only.
revoke all on function public.apply_template_provider_status(jsonb) from public, anon, authenticated;
grant execute on function public.apply_template_provider_status(jsonb) to service_role;
