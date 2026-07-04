/**
 * Google Calendar OAuth — PURE helpers (Packet 2 · L1 build-prep).
 *
 * NO network, NO DB, NO secrets held here: callers pass client_id/secret/token
 * as arguments and this module only *builds* the request descriptors + signs/
 * verifies the `state` token. Nothing here executes an HTTP call or reads env.
 * Unit-testable in isolation (node env, no RTL/jsdom) like `chat-lib.ts`.
 *
 * Not wired into any route yet — the `/calendar/*` endpoints + the worker are a
 * separate, approval-gated step (see AIVENA_Packet2_L1_Calendar_OAuth_Plan).
 */
import { createHmac, timingSafeEqual } from 'crypto';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Least-privilege: create/update/delete events only (not read-all-calendars). */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// ── base64url (no padding) ───────────────────────────────────────────────────
const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ── State token (HMAC-signed) ────────────────────────────────────────────────
export type StatePayload = { agencyId: string; nonce: string; exp: number };

/** Sign `<b64url(json)>.<b64url(hmac)>`. `secret` is supplied by the caller. */
export function signState(payload: StatePayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

/** Verify signature (timing-safe) + expiry. `nowSec` is injected for testing. */
export function verifyState(
  token: string,
  secret: string,
  nowSec: number,
): { ok: true; payload: StatePayload } | { ok: false; error: string } {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, error: 'malformed_state' };
  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, error: 'malformed_state' };
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: 'bad_signature' };
  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return { ok: false, error: 'malformed_state' };
  }
  if (!payload || typeof payload.agencyId !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, error: 'malformed_state' };
  }
  if (nowSec >= payload.exp) return { ok: false, error: 'expired_state' };
  return { ok: true, payload };
}

// ── Request builders (descriptors only — caller executes the fetch) ───────────
export type HttpRequest = { url: string; method: 'GET' | 'POST'; headers: Record<string, string>; body?: string };

/** The Google consent URL to redirect the owner to. */
export function buildConsentUrl(o: {
  clientId: string; redirectUri: string; state: string; scope?: string;
}): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scope ?? CALENDAR_SCOPE,
    access_type: 'offline',      // needed to receive a refresh_token
    prompt: 'consent',           // force refresh_token issuance on re-consent
    include_granted_scopes: 'true',
    state: o.state,
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

/** POST to exchange an auth code for tokens. */
export function buildTokenExchangeRequest(o: {
  code: string; clientId: string; clientSecret: string; redirectUri: string;
}): HttpRequest {
  const body = new URLSearchParams({
    code: o.code,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    redirect_uri: o.redirectUri,
    grant_type: 'authorization_code',
  });
  return {
    url: GOOGLE_TOKEN_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

/** POST to refresh an access token using a stored refresh_token. */
export function buildRefreshRequest(o: {
  refreshToken: string; clientId: string; clientSecret: string;
}): HttpRequest {
  const body = new URLSearchParams({
    refresh_token: o.refreshToken,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    grant_type: 'refresh_token',
  });
  return {
    url: GOOGLE_TOKEN_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

// ── Expiry helpers ────────────────────────────────────────────────────────────
/** Absolute expiry (ms epoch) from an issued-at + Google's `expires_in` (sec). */
export function computeExpiresAtMs(issuedAtMs: number, expiresInSec: number): number {
  return issuedAtMs + Math.max(0, Math.trunc(expiresInSec)) * 1000;
}

/** True when the token is at/near expiry (default 60s skew) → refresh before use. */
export function isExpiring(expiresAtMs: number, nowMs: number, skewSec = 60): boolean {
  return nowMs >= expiresAtMs - skewSec * 1000;
}
