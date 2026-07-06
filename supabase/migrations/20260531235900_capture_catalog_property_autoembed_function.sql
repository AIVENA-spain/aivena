-- CAPTURE (version control) of the deploy-only, CATALOG-OWNED trigger function
-- public.trg_property_autoembed() — the function behind the `property_autoembed`
-- trigger on `properties` (the trigger itself is captured in the companion
-- 20260601000000_capture_catalog_schema_properties.sql).
--
-- Provenance: captured 2026-07-06 via pg_get_functiondef (READ-ONLY). Verbatim body,
-- adversarially byte-verified: SHA256 d0ff366eccd328bf02566344481ed21634a97c996b20febf48824d895947691f
-- (2254 bytes), pg_proc oid 21139, no overloads. The DEPLOYED function is authoritative —
-- if this file ever diverges, re-fetch and reconcile.
--
-- Ownership: CATALOG-OWNED (verified). Exactly ONE trigger uses it —
--   `property_autoembed AFTER INSERT OR UPDATE ON public.properties FOR EACH ROW` —
-- and nothing else in any schema references it (pg_depend + broadened name search both
-- came back with only public.properties). It reads only `properties` columns and POSTs
-- property_id/agency_id to the generate-property-embedding Edge Function. It is NOT a
-- generic primitive. (Contrast: public.set_updated_at() is SHARED-GENERIC — 22 triggers
-- across 21 unrelated tables — so it is deliberately NOT captured here; it belongs in a
-- separate shared-core capture, not the catalog band.)
--
-- Ordering: this file sorts immediately BEFORE 20260601000000 (which creates the
-- `property_autoembed` trigger that references this function), so on a from-scratch
-- rebuild the function exists before the trigger is created. It is CREATE OR REPLACE, so
-- applying it against the live DB is a no-op-equivalent (identical body replaces identical
-- body). Documentation/version-control only — this migration is NOT applied by this change.
--
-- DEPENDENCIES / FINDINGS (captured as-is, not changed here):
--   1. Runtime dependency on the `pg_net` extension (net.http_post). pg_net is enabled by
--      the separate real migration 20260611151301_enable_pg_net. Not enabled here (plpgsql
--      bodies are not dependency-checked at CREATE time, so this is safe to define first).
--   2. HARDENING FINDING: the SECURITY DEFINER body inlines the project's `anon`
--      (publishable) JWT as a string literal `v_anon` instead of reading a Vault secret.
--      The anon key is public by design (RLS enforces access), so it is captured verbatim
--      for fidelity — but inlining it means the key can't be rotated without editing the
--      function. Recommended future hardening: read it from vault.decrypted_secrets. Flagged,
--      NOT changed (capture must reflect what is actually deployed).
--   3. Still UNCAPTURED (reported, not in this change): public.set_updated_at() (shared),
--      and the sibling catalog tables / _get_platform_secret RPC noted in 20260601000000.

CREATE OR REPLACE FUNCTION public.trg_property_autoembed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0bWludmhyeWJ4ZWdwZHRubnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODYwMTIsImV4cCI6MjA5MjM2MjAxMn0.0qjbss98ognSdwger90DpD7hMVwL3PXPwUrf046G5wE';
  content_changed boolean;
BEGIN
  -- Nothing to embed without text
  IF NEW.title IS NULL AND NEW.description IS NULL THEN
    RETURN NEW;
  END IF;

  -- On INSERT: skip if the row already arrived with an embedding
  IF TG_OP = 'INSERT' THEN
    IF NEW.embedding IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  -- On UPDATE: only re-embed when embeddable content actually changed.
  -- This deliberately excludes embedding/vector_synced_at/embedding_model_version/updated_at,
  -- so the embedding write-back from the function does NOT retrigger (no loop).
  IF TG_OP = 'UPDATE' THEN
    content_changed :=
         NEW.title            IS DISTINCT FROM OLD.title
      OR NEW.description       IS DISTINCT FROM OLD.description
      OR NEW.property_type     IS DISTINCT FROM OLD.property_type
      OR NEW.location_city     IS DISTINCT FROM OLD.location_city
      OR NEW.location_region   IS DISTINCT FROM OLD.location_region
      OR NEW.location_country  IS DISTINCT FROM OLD.location_country
      OR NEW.bedrooms          IS DISTINCT FROM OLD.bedrooms
      OR NEW.bathrooms         IS DISTINCT FROM OLD.bathrooms
      OR NEW.area_sqm          IS DISTINCT FROM OLD.area_sqm
      OR NEW.price             IS DISTINCT FROM OLD.price
      OR NEW.price_currency    IS DISTINCT FROM OLD.price_currency
      OR NEW.features          IS DISTINCT FROM OLD.features;
    IF NOT content_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM net.http_post(
    url := 'https://atminvhrybxegpdtnnpl.supabase.co/functions/v1/generate-property-embedding',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object('property_id', NEW.id::text, 'agency_id', NEW.agency_id),
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$function$
