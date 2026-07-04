-- Amanda/Calendar L1 — OAuth credential store/read/revoke RPCs (Packet 2).
-- DRAFT: NOT applied to prod until Calendar is approved for deploy.
--
-- Reuses the existing (empty) agency_oauth_credentials table. Adds one unique
-- key (one credential per agency+provider) + three SECURITY DEFINER RPCs. These
-- handle OAuth TOKENS, so — per the 2026-07-04 cross-tenant lesson — EXECUTE is
-- granted to aivena_app + service_role ONLY (NEVER authenticated/anon): the API
-- (aivena_app) mediates connect/disconnect/status; the worker (service_role or
-- aivena_app) reads for sync. No function trusts a caller-supplied identity that
-- isn't already proven (connect = authed agency JWT; callback = HMAC-signed state).

ALTER TABLE public.agency_oauth_credentials
  ADD CONSTRAINT agency_oauth_agency_provider_uniq UNIQUE (agency_id, provider);

-- 1) Store (connect + refresh). Preserves the refresh_token when Google omits it
--    on a plain refresh (p_refresh_token NULL → keep existing).
CREATE OR REPLACE FUNCTION public.store_agency_oauth_credential(
  p_agency_id     text,
  p_provider      text,
  p_access_token  text,
  p_refresh_token text,
  p_token_type    text,
  p_expires_at    timestamptz,
  p_scopes        text[],
  p_account_email text,
  p_account_id    text,
  OUT id             uuid,
  OUT external_email text,
  OUT status         text
)
RETURNS record
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  INSERT INTO public.agency_oauth_credentials AS c (
    agency_id, provider, access_token, refresh_token, token_type, expires_at, scopes,
    external_account_email, external_account_id, status, issued_at, last_refreshed_at,
    consecutive_failures, last_error, last_error_at, revoked_at, revoked_reason
  ) VALUES (
    p_agency_id, p_provider, p_access_token, p_refresh_token, coalesce(p_token_type,'Bearer'),
    p_expires_at, p_scopes, p_account_email, p_account_id, 'connected', now(), now(),
    0, NULL, NULL, NULL, NULL
  )
  ON CONFLICT (agency_id, provider) DO UPDATE SET
    access_token          = EXCLUDED.access_token,
    refresh_token         = coalesce(EXCLUDED.refresh_token, c.refresh_token),
    token_type            = EXCLUDED.token_type,
    expires_at            = EXCLUDED.expires_at,
    scopes                = EXCLUDED.scopes,
    external_account_email= coalesce(EXCLUDED.external_account_email, c.external_account_email),
    external_account_id   = coalesce(EXCLUDED.external_account_id, c.external_account_id),
    status                = 'connected',
    last_refreshed_at     = now(),
    consecutive_failures  = 0,
    last_error = NULL, last_error_at = NULL, revoked_at = NULL, revoked_reason = NULL,
    updated_at            = now()
  RETURNING c.id, c.external_account_email, c.status
  INTO id, external_email, status;
END;
$function$;

-- 2) Read (worker / refresh). Returns tokens → aivena_app/service_role only.
CREATE OR REPLACE FUNCTION public.get_agency_oauth_credential(
  p_agency_id text,
  p_provider  text,
  OUT access_token  text,
  OUT refresh_token text,
  OUT expires_at    timestamptz,
  OUT scopes        text[],
  OUT status        text,
  OUT external_email text
)
RETURNS record
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  SELECT c.access_token, c.refresh_token, c.expires_at, c.scopes, c.status, c.external_account_email
    INTO access_token, refresh_token, expires_at, scopes, status, external_email
  FROM public.agency_oauth_credentials c
  WHERE c.agency_id = p_agency_id AND c.provider = p_provider
  ORDER BY c.updated_at DESC NULLS LAST LIMIT 1;
END;
$function$;

-- 3) Revoke (disconnect). Clears tokens + marks revoked; falls back to L3 manual.
CREATE OR REPLACE FUNCTION public.revoke_agency_oauth_credential(
  p_agency_id text,
  p_provider  text,
  p_reason    text,
  OUT revoked boolean
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
BEGIN
  UPDATE public.agency_oauth_credentials c
     SET status = 'revoked', revoked_at = now(), revoked_reason = coalesce(p_reason,'user_disconnect'),
         access_token = NULL, refresh_token = NULL, updated_at = now()
   WHERE c.agency_id = p_agency_id AND c.provider = p_provider AND c.status <> 'revoked';
  revoked := FOUND;
END;
$function$;

-- Grants — TOKEN-HANDLING: aivena_app + service_role ONLY (never authenticated/anon).
DO $grants$
DECLARE sig text;
BEGIN
  FOR sig IN SELECT unnest(ARRAY[
    'store_agency_oauth_credential(text,text,text,text,text,timestamptz,text[],text,text)',
    'get_agency_oauth_credential(text,text)',
    'revoke_agency_oauth_credential(text,text,text)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO aivena_app, service_role', sig);
  END LOOP;
END $grants$;
