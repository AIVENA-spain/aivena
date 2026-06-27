-- migration: whatsapp_templates_provider_sync_columns  (Phase 1a)
-- Chat 3 WhatsApp Provider-Sync brief, 2026-06-26.
-- Adds provider-truth columns so the DB can mirror Twilio approval status instead of
-- trusting the hand seed. Both columns nullable, no backfill (the sync populates them).
-- Existing columns (status, category, rejected_reason, approved_at) are reused, not altered.
--
-- Apply path: this file is the reviewable source; it is applied to the live DB via the
-- Supabase MCP `apply_migration` (the repo does not use the Supabase CLI), gated on approval.

alter table public.whatsapp_templates
  add column if not exists provider_status    text,         -- raw Twilio approval_requests.status, verbatim
  add column if not exists provider_synced_at timestamptz;  -- last reconcile vs Twilio for this row

create index if not exists whatsapp_templates_provider_template_id_idx
  on public.whatsapp_templates (provider_template_id)
  where provider_template_id is not null;
