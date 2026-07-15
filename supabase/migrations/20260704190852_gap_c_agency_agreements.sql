-- PRESERVED FOR SOURCE OF TRUTH — THIS MIGRATION IS ALREADY APPLIED TO PRODUCTION.
-- Applied 2026-07-04 as ledger version 20260704190852 ('gap_c_agency_agreements' in supabase_migrations.schema_migrations).
-- It was applied out-of-band via apply_migration and the file was never committed, so this branch
-- (packet3-gapc-agreements, 4a556b0) held the ONLY git copy of schema that is live right now. Deleting that branch
-- would have destroyed it, and a rebuild-from-migrations would then silently omit live objects.
-- Committing this changes NOTHING in the database: a migration runner finds the version already in
-- the ledger and SKIPS it. The SQL below is byte-exact from the source branch — do not 'tidy' it.
-- STALE CLAIM BELOW: the 'DRAFT — NOT YET APPLIED' wording is FALSE and has been since 2026-07-04.
-- It is left in place so the artifact stays exact; THIS header is the authoritative statement.

-- Gap C — agency_agreements: evidence-grade, append-only, version-bound acceptance records
-- (Packet 3 task 12). DRAFT — NOT YET APPLIED. Built to Packet 1's S4 content contract
-- (AIVENA_S4_DPA_Acceptance_Design_2026-07-04.md §1-2). Real acceptance can't record until S3
-- legal pages are live (versions must point at published text) — this is the storage layer + write/read
-- RPCs; the go-live-flow write + readiness read are separate follow-ups.
--
-- EIPD note: EIPD acceptance is anchored on agency_settings.eipd_signed_at / eipd_doc_url (Packet 1).
-- 'eipd' is included in the type CHECK for future consolidation, but the current anchor stays on
-- agency_settings — a pilot_terms row's metadata.eipd_opted_in drives that column via the go-live flow.
-- Do NOT duplicate EIPD state without a control-tower decision.

CREATE TABLE IF NOT EXISTS public.agency_agreements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           text NOT NULL REFERENCES public.agencies(id),
  agreement_type      text NOT NULL CHECK (agreement_type IN ('pilot_terms','dpa','eipd','terms','privacy')),
  version             text NOT NULL,                       -- the accepted version, e.g. '1.0-pilot'
  accepted_at         timestamptz NOT NULL DEFAULT now(),
  accepted_by         uuid,                                -- acting user (staff-assisted go-live actor)
  accepted_ip         text,                                -- LOPDGDD evidence parity with consent_log
  document_url        text,                                -- exact doc shown
  document_hash       text,                                -- hash of the exact text accepted (provable later)
  source              text NOT NULL DEFAULT 'admin_go_live',  -- channel
  -- pilot_terms entitlement (derived once + FROZEN at acceptance; NULL for other types)
  pilot_tier          text CHECK (pilot_tier IS NULL OR pilot_tier IN ('founding','next3','standard')),
  free_months_granted int,
  price_lock_months   int,
  trial_ends_at       timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- eipd_opted_in + extras
  created_at          timestamptz NOT NULL DEFAULT now()
  -- NOTE: no updated_at — append-only; a re-acceptance (new version) is a NEW row.
);

CREATE INDEX IF NOT EXISTS agency_agreements_agency_type_idx
  ON public.agency_agreements(agency_id, agreement_type, accepted_at DESC);

COMMENT ON TABLE public.agency_agreements IS 'Append-only, version-bound acceptance records (pilot_terms/dpa/eipd/terms/privacy). Evidence-grade: never mutated; re-acceptance = new row. Writes via record_agency_agreement() only.';

-- Evidence-grade append-only: block UPDATE/DELETE at the table level (even for privileged roles).
CREATE OR REPLACE FUNCTION public.agency_agreements_append_only()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'agency_agreements is append-only (no UPDATE/DELETE)';
END;
$function$;
DROP TRIGGER IF EXISTS agency_agreements_no_mutate ON public.agency_agreements;
CREATE TRIGGER agency_agreements_no_mutate
  BEFORE UPDATE OR DELETE ON public.agency_agreements
  FOR EACH ROW EXECUTE FUNCTION public.agency_agreements_append_only();

-- RLS: read = owning agency (GUC) OR aivena staff. No INSERT/UPDATE/DELETE policy → writes via the
-- SECURITY DEFINER RPC only (aivena_app cannot DML directly). Mirrors the consent_log / lead_notes discipline.
ALTER TABLE public.agency_agreements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_agreements_read ON public.agency_agreements;
CREATE POLICY agency_agreements_read ON public.agency_agreements FOR SELECT
  USING (agency_id = current_setting('app.current_agency_id', true) OR public.is_aivena_staff());

REVOKE ALL ON public.agency_agreements FROM PUBLIC;
GRANT SELECT ON public.agency_agreements TO aivena_app, authenticated, service_role;  -- RLS-fenced

-- ── Write path (staff-assisted go-live): append-only insert, staff-gated ────────────────
CREATE OR REPLACE FUNCTION public.record_agency_agreement(
  p_agency_id      text,
  p_agreement_type text,
  p_version        text,
  p_document_url   text DEFAULT NULL,
  p_document_hash  text DEFAULT NULL,
  p_source         text DEFAULT 'admin_go_live',
  p_accepted_ip    text DEFAULT NULL,
  p_pilot_tier     text DEFAULT NULL,          -- required when agreement_type='pilot_terms'
  p_metadata       jsonb DEFAULT '{}'::jsonb   -- e.g. {"eipd_opted_in": true}
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_free int; v_lock int := 12; v_trial timestamptz; v_id uuid;
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM agencies WHERE id = p_agency_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Agency not found.');
  END IF;
  IF p_agreement_type NOT IN ('pilot_terms','dpa','eipd','terms','privacy') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unknown agreement type.');
  END IF;
  IF btrim(COALESCE(p_version,'')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A version is required.');
  END IF;

  IF p_agreement_type = 'pilot_terms' THEN
    v_free := CASE p_pilot_tier WHEN 'founding' THEN 12 WHEN 'next3' THEN 3 WHEN 'standard' THEN 0
                ELSE NULL END;
    IF v_free IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pilot_terms requires pilot_tier founding|next3|standard.');
    END IF;
    v_trial := CASE WHEN v_free > 0 THEN now() + (v_free || ' months')::interval ELSE NULL END;
  END IF;

  INSERT INTO agency_agreements
    (agency_id, agreement_type, version, accepted_by, accepted_ip, document_url, document_hash,
     source, pilot_tier, free_months_granted, price_lock_months, trial_ends_at, metadata)
  VALUES
    (p_agency_id, p_agreement_type, btrim(p_version), auth.uid(), p_accepted_ip, p_document_url, p_document_hash,
     COALESCE(p_source,'admin_go_live'),
     CASE WHEN p_agreement_type='pilot_terms' THEN p_pilot_tier END,
     CASE WHEN p_agreement_type='pilot_terms' THEN v_free END,
     CASE WHEN p_agreement_type='pilot_terms' THEN v_lock END,
     v_trial, COALESCE(p_metadata,'{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id,
    'free_months_granted', CASE WHEN p_agreement_type='pilot_terms' THEN v_free END,
    'trial_ends_at', v_trial);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_agency_agreement(text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_agency_agreement(text,text,text,text,text,text,text,text,jsonb) TO authenticated, service_role;

-- ── Read path (staff): the latest acceptance per type for an agency ───────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_agency_agreements(p_agency_id text)
 RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_aivena_staff() THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.accepted_at DESC), '[]'::jsonb) INTO v
    FROM agency_agreements a WHERE a.agency_id = p_agency_id;
  RETURN jsonb_build_object('ok', true, 'agreements', v);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_agency_agreements(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_agency_agreements(text) TO authenticated, service_role;

-- ROLLBACK (documented, not run):
--   DROP FUNCTION IF EXISTS public.admin_list_agency_agreements(text);
--   DROP FUNCTION IF EXISTS public.record_agency_agreement(text,text,text,text,text,text,text,text,jsonb);
--   DROP TABLE IF EXISTS public.agency_agreements;   -- (drops trigger too)
--   DROP FUNCTION IF EXISTS public.agency_agreements_append_only();
