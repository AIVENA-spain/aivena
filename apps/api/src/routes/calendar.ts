import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../../../packages/db/client';
import { signState, verifyState, buildConsentUrl, buildTokenExchangeRequest } from './calendar-oauth-lib';
import { parseGoogleTokenResponse } from './calendar-lib';

/**
 * Google Calendar OAuth (Packet 2 · L1). Two mounts:
 *   - apiCalendarRoute  → /api/v1/calendar  (authed: connect / status / disconnect)
 *   - publicCalendarRoute → /calendar        (public OAuth callback, OUTSIDE /api/*)
 *
 * Calendar stays INERT until the Google secrets are set: googleConfig() returns
 * null without them and every entry point answers 503 "not configured", so
 * mounting/deploying this is safe BEFORE the (gated) secrets exist — no agency
 * can connect and no Google call is made. Tokens are written only via the
 * SECURITY DEFINER store RPC (granted to aivena_app/service_role, not authenticated).
 * The callback trusts the HMAC-signed `state` (agency id); connect uses the authed
 * agency JWT. Never invents a booking; L3 manual-task stays the fallback until connected.
 */
const PROVIDER = 'google_calendar';
const STATE_TTL_SEC = 600;
const dashboardUrl = () => (process.env.DASHBOARD_URL || 'https://aivena.es/dashboard').replace(/\/$/, '');

function googleConfig(): { clientId: string; clientSecret: string; redirectUri: string; stateSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const stateSecret = process.env.OAUTH_STATE_SECRET;
  if (!clientId || !clientSecret || !redirectUri || !stateSecret) return null;
  return { clientId, clientSecret, redirectUri, stateSecret };
}
const NOT_CONFIGURED = { ok: false, error: 'Calendar isn’t connected on this AIVENA yet.' };

// ── Authed API routes (mounted under /api/v1/calendar) ───────────────────────
export const apiCalendarRoute = new Hono();

// GET /api/v1/calendar/google/connect — returns the Google consent URL to open.
apiCalendarRoute.get('/google/connect', async (c) => {
  const cfg = googleConfig();
  if (!cfg) return c.json(NOT_CONFIGURED, 503);
  const agencyId = c.get('agencyId') as string;
  const state = signState(
    { agencyId, nonce: randomUUID(), exp: Math.floor(Date.now() / 1000) + STATE_TTL_SEC },
    cfg.stateSecret,
  );
  return c.json({ ok: true, url: buildConsentUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state }) });
});

// GET /api/v1/calendar/status — connection status for the current agency (RLS tx).
apiCalendarRoute.get('/status', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId') as string;
  const rows = await tx.execute(sql`
    SELECT status, external_account_email, expires_at
    FROM public.agency_oauth_credentials
    WHERE agency_id = ${agencyId} AND provider = ${PROVIDER}
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `);
  const r = (rows as unknown as Array<{ status: string; external_account_email: string | null; expires_at: string | null }>)[0];
  return c.json({
    ok: true,
    connected: Boolean(r && r.status === 'connected'),
    status: r?.status ?? 'not_connected',
    accountEmail: r?.external_account_email ?? null,
    expiresAt: r?.expires_at ?? null,
    configured: googleConfig() !== null,
  });
});

// POST /api/v1/calendar/google/disconnect — revoke; bookings fall back to L3 manual.
apiCalendarRoute.post('/google/disconnect', async (c) => {
  const agencyId = c.get('agencyId') as string;
  await db.execute(sql`SELECT public.revoke_agency_oauth_credential(${agencyId}, ${PROVIDER}, ${'user_disconnect'})`);
  return c.json({ ok: true });
});

// ── Public OAuth callback (mounted at /calendar, OUTSIDE /api/*) ──────────────
export const publicCalendarRoute = new Hono();

// GET /calendar/google/callback?code&state — exchange the code, store the tokens.
publicCalendarRoute.get('/google/callback', async (c) => {
  const cfg = googleConfig();
  if (!cfg) return c.json(NOT_CONFIGURED, 503);
  const done = (r: string) => c.redirect(`${dashboardUrl()}/settings?calendar=${r}`);
  const code = c.req.query('code') ?? '';
  const v = verifyState(c.req.query('state') ?? '', cfg.stateSecret, Math.floor(Date.now() / 1000));
  if (!v.ok || !code) return done('error');

  try {
    const req = buildTokenExchangeRequest({ code, clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri });
    const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!resp.ok) {
      console.error('[calendar/callback] token exchange status', resp.status);
      return done('error');
    }
    const parsed = parseGoogleTokenResponse((await resp.json()) as Record<string, unknown>, Date.now());
    await db.execute(sql`
      SELECT * FROM public.store_agency_oauth_credential(
        ${v.payload.agencyId}, ${PROVIDER}, ${parsed.accessToken}, ${parsed.refreshToken},
        ${parsed.tokenType}, ${new Date(parsed.expiresAtMs).toISOString()}::timestamptz,
        ${parsed.scopes}::text[], ${null}, ${null}
      )
    `);
    return done('connected');
  } catch (err) {
    console.error('[calendar/callback] failed', err instanceof Error ? err.message : 'error');
    return done('error');
  }
});
