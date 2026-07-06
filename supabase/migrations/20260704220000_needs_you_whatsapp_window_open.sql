-- Bug 1 — add WhatsApp-window awareness to dashboard_needs_you so the Overview can
-- match the Inbox (which is window-aware) and never present a stale property draft
-- as sendable when the 24h window is closed.
-- DRAFT: NOT applied.
--
-- NON-ADDITIVE caveat: adding columns to a RETURNS TABLE changes the return type,
-- which CREATE OR REPLACE cannot do → this DROPs and re-CREATEs the function in one
-- migration (atomic). Existing columns/order are preserved; the two new columns are
-- APPENDED at the end, and the API reads it via `SELECT *` + name mapping, so the
-- add is backward-compatible for callers. whatsapp_window_open is computed EXACTLY
-- like dashboard_lead_whatsapp_state (single source of truth) so the two agree.

DROP FUNCTION IF EXISTS public.dashboard_needs_you(integer);

CREATE FUNCTION public.dashboard_needs_you(p_limit integer DEFAULT 50)
 RETURNS TABLE(
   task_id uuid, lead_id uuid, full_name text, lead_type text, area text, source text,
   channel text, language text, lead_status text, temperature text, score integer,
   ai_reply_subject text, ai_reply_body text, priority text, task_created_at timestamptz,
   whatsapp_window_open boolean,            -- NEW
   last_inbound_whatsapp_at timestamptz     -- NEW
 )
 LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_agency text := current_setting('app.current_agency_id', true);
BEGIN
  IF v_agency IS NULL OR v_agency = '' THEN
    RAISE EXCEPTION 'no_agency_context' USING ERRCODE='P0001';
  END IF;
  PERFORM public.require_role('viewer'::public.agency_role);
  RETURN QUERY
  SELECT dt.id, l.id, l.full_name, l.lead_type,
         COALESCE(l.location_interest_extracted, l.location_interest_raw),
         l.source, COALESCE(dt.channel, l.channel),
         l.language_detected, l.status, COALESCE(dt.temperature, l.temperature),
         COALESCE(dt.lead_score, l.score), dt.message_subject, dt.message_body,
         dt.priority, dt.created_at,
         -- Window open iff a WhatsApp inbound arrived within 24h (mirrors
         -- dashboard_lead_whatsapp_state / the approve_dashboard_task guard EXACTLY).
         (l.last_inbound_whatsapp_at IS NOT NULL
            AND (now() - l.last_inbound_whatsapp_at) < interval '24 hours') AS whatsapp_window_open,
         l.last_inbound_whatsapp_at
  FROM dashboard_tasks dt
  JOIN leads l ON l.id = dt.lead_id
  WHERE dt.agency_id = v_agency
    AND dt.task_type = 'suggested_reply'
    AND dt.status = 'pending'
  ORDER BY (CASE dt.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END),
           dt.created_at ASC
  LIMIT p_limit;
END;
$function$;

-- Restore grants (DROP removes them). Match the prior grant set EXACTLY for this read
-- RPC: aivena_app, authenticated, service_role (+ postgres owner). Explicitly revoke
-- anon/authenticated first because Supabase ALTER DEFAULT PRIVILEGES auto-grants EXECUTE
-- to anon+authenticated on every newly-created public function — REVOKE FROM PUBLIC alone
-- would leave a stray anon grant the prior function never had.
REVOKE ALL ON FUNCTION public.dashboard_needs_you(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_needs_you(integer) TO aivena_app, authenticated, service_role;

-- Rollback: DROP FUNCTION public.dashboard_needs_you(integer); then re-CREATE the
-- prior 15-column version (captured in the changelog/PR).
