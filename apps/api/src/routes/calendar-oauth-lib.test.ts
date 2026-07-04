import { describe, it, expect } from 'vitest';
import {
  signState, verifyState, buildConsentUrl, buildTokenExchangeRequest,
  buildRefreshRequest, computeExpiresAtMs, isExpiring, CALENDAR_SCOPE,
} from './calendar-oauth-lib';

const SECRET = 'test-state-secret-abc';

describe('state token — sign/verify round-trip + tamper/expiry rejection', () => {
  it('signs then verifies a valid, unexpired state', () => {
    const tok = signState({ agencyId: 'ag_1', nonce: 'n1', exp: 1000 }, SECRET);
    const r = verifyState(tok, SECRET, 999);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.agencyId).toBe('ag_1');
  });

  it('rejects an expired state', () => {
    const tok = signState({ agencyId: 'ag_1', nonce: 'n1', exp: 1000 }, SECRET);
    const r = verifyState(tok, SECRET, 1000); // exp is exclusive
    expect(r).toEqual({ ok: false, error: 'expired_state' });
  });

  it('rejects a tampered body (signature mismatch)', () => {
    const tok = signState({ agencyId: 'ag_1', nonce: 'n1', exp: 9999 }, SECRET);
    const [body, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ agencyId: 'ag_ATTACKER', nonce: 'n1', exp: 9999 }), 'utf8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifyState(`${forged}.${sig}`, SECRET, 1)).toEqual({ ok: false, error: 'bad_signature' });
    expect(body).toBeTruthy();
  });

  it('rejects a wrong secret + malformed tokens', () => {
    const tok = signState({ agencyId: 'ag_1', nonce: 'n1', exp: 9999 }, SECRET);
    expect(verifyState(tok, 'other-secret', 1).ok).toBe(false);
    expect(verifyState('nodot', SECRET, 1)).toEqual({ ok: false, error: 'malformed_state' });
    expect(verifyState('a.b.c', SECRET, 1).ok).toBe(false);
  });
});

describe('consent URL', () => {
  const url = buildConsentUrl({ clientId: 'CID', redirectUri: 'https://x/cb', state: 'ST' });
  it('is the Google auth endpoint with offline access + consent prompt + least-privilege scope', () => {
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe(CALENDAR_SCOPE);
    expect(u.searchParams.get('client_id')).toBe('CID');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x/cb');
    expect(u.searchParams.get('state')).toBe('ST');
  });
});

describe('token-exchange + refresh request builders (descriptors only)', () => {
  it('builds the auth-code exchange POST', () => {
    const req = buildTokenExchangeRequest({ code: 'C', clientId: 'CID', clientSecret: 'SEC', redirectUri: 'https://x/cb' });
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://oauth2.googleapis.com/token');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const p = new URLSearchParams(req.body);
    expect(p.get('grant_type')).toBe('authorization_code');
    expect(p.get('code')).toBe('C');
    expect(p.get('client_secret')).toBe('SEC');
  });

  it('builds the refresh POST', () => {
    const req = buildRefreshRequest({ refreshToken: 'R', clientId: 'CID', clientSecret: 'SEC' });
    const p = new URLSearchParams(req.body);
    expect(p.get('grant_type')).toBe('refresh_token');
    expect(p.get('refresh_token')).toBe('R');
  });
});

describe('expiry helpers', () => {
  it('computes absolute expiry and flags near-expiry within skew', () => {
    const exp = computeExpiresAtMs(1_000_000, 3600); // +1h
    expect(exp).toBe(1_000_000 + 3_600_000);
    expect(isExpiring(exp, exp - 120_000)).toBe(false);      // 2 min before → fresh
    expect(isExpiring(exp, exp - 30_000)).toBe(true);        // 30s before → within 60s skew
    expect(isExpiring(exp, exp + 1)).toBe(true);             // past expiry
  });
});
