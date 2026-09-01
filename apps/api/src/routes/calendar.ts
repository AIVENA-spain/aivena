import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, withAgency } from '../../../../packages/db/client';
import { signState, verifyState, buildConsentUrl, buildTokenExchangeRequest } from './calendar-oauth-lib';
import { parseGoogleTokenResponse } from './calendar-lib';
import { safeErr } from '../lib/safe-error';

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
// DASHBOARD_URL doubles as a CORS origin (bare domain, no path) — so normalize
// here instead of asking ops to change it: the dashboard app lives under
// /dashboard, and a redirect to the bare domain 404s on the marketing site.
const dashboardUrl = () => {
  const base = (process.env.DASHBOARD_URL || 'https://aivena.es').replace(/\/$/, '');
  return base.endsWith('/dashboard') ? base : `${base}/dashboard`;
};

export function googleConfig(): { clientId: string; clientSecret: string; redirectUri: string; stateSecret: string } | null {
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
    connected: Boolean(r && r.status === 'active'),   // 'active' is the CHECK-valid connected status
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
      // Google's error body names the exact cause (invalid_client = bad client
      // secret, redirect_uri_mismatch, invalid_grant = expired/reused code) and
      // never contains tokens — log a truncated copy so ops can diagnose.
      const errBody = await resp.text().catch(() => '');
      console.error('[calendar/callback] token exchange status', resp.status, errBody.slice(0, 200));
      return done('error');
    }
    const parsed = parseGoogleTokenResponse((await resp.json()) as Record<string, unknown>, Date.now());
    await db.execute(sql`
      SELECT * FROM public.store_agency_oauth_credential(
        ${v.payload.agencyId}, ${PROVIDER}, ${parsed.accessToken}, ${parsed.refreshToken},
        ${parsed.tokenType}, ${new Date(parsed.expiresAtMs).toISOString()}::timestamptz,
        string_to_array(nullif(${parsed.scopes.join(',')}, ''), ','), ${null}, ${null}
      )
    `);
    // Reset-on-connect: while the calendar was disconnected, new viewings were
    // enqueued as not_required (L2 gate) and earlier syncs may have given up
    // (failed_permanent). Now that a credential exists, re-queue this agency's
    // FUTURE, still-happening bookings so the worker pushes them; attempts reset
    // so a failed_permanent booking gets a fresh retry budget. Runs inside
    // withAgency (the HMAC-verified state carries the agency id) — bookings has
    // FORCED agency-scoped RLS, so a bare db.execute would match zero rows.
    // Best-effort — a re-queue hiccup must not turn a successful connect into
    // an error redirect.
    try {
      await withAgency(v.payload.agencyId, async (tx) => {
        await tx.execute(sql`
          UPDATE public.bookings
          SET calendar_sync_status = 'pending',
              calendar_sync_attempts = 0,
              calendar_sync_last_error = NULL,
              calendar_sync_next_retry_at = NULL,
              updated_at = now()
          WHERE agency_id = ${v.payload.agencyId}
            AND calendar_sync_status IN ('not_required', 'failed_permanent')
            AND scheduled_at > now()
            AND status NOT IN ('cancelled'::public.booking_status, 'no_show'::public.booking_status)
        `);
      });
    } catch (err) {
      console.error('[calendar/callback] reset-on-connect re-queue failed', safeErr(err));
    }
    return done('connected');
  } catch (err) {
    // NEVER log the full drizzle message here — on a failed query it embeds the
    // bind params, which for this call include OAuth tokens. Cause/first line only.
    const causeMsg = (err as { cause?: { message?: string } })?.cause?.message;
    const firstLine = err instanceof Error ? err.message.split('\n')[0].slice(0, 300) : 'error';
    console.error('[calendar/callback] failed', causeMsg ?? firstLine);
    return done('error');
  }
});
