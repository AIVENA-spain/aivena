import * as Sentry from '@sentry/node';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { env } from '../../../packages/config/env';
import { logger } from '../../../packages/config/logger';
import { authMiddleware } from './middleware/auth';
import { agencyContextMiddleware } from './middleware/agency-context';
import { requireAivenaStaff } from './middleware/require-aivena-staff';
import { whatsappSignatureMiddleware, twilioSignatureMiddleware } from './middleware/webhook-signature';
import meRoute from './routes/me';
import overviewRoute from './routes/overview';
import tasksRoute from './routes/tasks';
import settingsRoute from './routes/settings';
import invitationsRoute from './routes/invitations';
import propertiesRoute from './routes/properties';
import bookingsRoute from './routes/bookings';
import voiceRoute from './routes/voice';
import contentRoute from './routes/content';
import leadNotesRoute from './routes/lead-notes';
import leadsRoute from './routes/leads';
import conversationsRoute from './routes/conversations';
import matchesRoute from './routes/matches';
import handoffsRoute from './routes/handoffs';
import whatsappRoute from './routes/whatsapp';
import readinessRoute from './routes/readiness';
import operationsRoute from './routes/operations';
import studioRoute from './routes/studio';
import studioRenderRoute from './routes/studio-render';
import studioEditableRenderRoute from './routes/studio-editable-render';
import imagesRoute from './routes/images';
import studioWizardRoute from './routes/studio-wizard';
import adminRoute from './routes/admin';
import chatRoute from './routes/chat';
import { apiCalendarRoute, publicCalendarRoute, googleConfig } from './routes/calendar';
import { pollCalendarSyncs } from './routes/calendar-worker';
import amandaAdminRoute from './routes/amanda-admin';
import { drainAmandaInbound, drainBusy, engineEnabled, requestDrainStop } from './amanda-engine/outbox-worker';
import { processTurnDb } from './amanda-engine/process-turn-db';
import { sweepViewingReminders } from './amanda-engine/viewing-reminders';
import { pingTick } from './amanda-engine/agent-ping';
import { safeErr } from './lib/safe-error';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
});

const app = new Hono();

// CORS — allow the dashboard origin to call the API with the Supabase Bearer
// token. In dev that's http://localhost:3000; in production it's whatever
// DASHBOARD_URL is set to. We allow both so the same binary runs in either.
const ALLOWED_ORIGINS = Array.from(
  new Set([env.DASHBOARD_URL, 'http://localhost:3000']),
);
app.use(
  '*',
  cors({
    origin: ALLOWED_ORIGINS,
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

// Public routes — no auth, no RLS context.
app.get('/health', (c) => {
  // The commit is here so a deploy can be VERIFIED from outside, not assumed.
  // Twice now a deploy has shipped a tree that was not what we thought it was,
  // and a bare {status:'ok'} cannot tell those two cases apart. Railway sets
  // RAILWAY_GIT_COMMIT_SHA on every build; 'unknown' means running elsewhere.
  // Public endpoint, so it exposes the short SHA only — never a branch, message
  // or anything about the environment.
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA;
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    commit: sha ? sha.slice(0, 7) : 'unknown',
  });
});

// Studio template render (Phase 1) — mounted OUTSIDE /api/* on purpose: it is
// authenticated by x-internal-secret (internal callers — the n8n test caller,
// the kie step later), NOT a user JWT, so the /api/* auth + agency-context
// middleware must never run on it. POST /studio/render.
app.route('/studio', studioRenderRoute);
// Studio EDITABLE-template render (Engine Proof B) — the 18 accepted strip-plate templates rendered with real
// property data; same x-internal-secret auth, mounted OUTSIDE /api/*. POST /studio/editable-render.
app.route('/studio', studioEditableRenderRoute);

// Amanda web-chat (Amanda Phase A) — mounted OUTSIDE /api/* on purpose: PUBLIC,
// unauthenticated visitor endpoints (no user JWT, no agency-context middleware).
// The agency is derived from :agencySlug and every write goes through the
// SECURITY DEFINER amanda_capture_lead RPC. Gated to is_test agencies (slice 1).
// NOTE (Phase B / widget): browser calls from agency origins need a per-agency
// CORS allow-list; the global dashboard-only CORS above still applies here today,
// so slice 1 is exercised server-side. POST /chat/:agencySlug/contact.
app.route('/chat', chatRoute);

// Google Calendar OAuth callback (Packet 2 · L1) — PUBLIC, OUTSIDE /api/* on
// purpose: Google redirects the browser here; it is authenticated by the
// HMAC-signed `state` (which carries the agency id), NOT a user JWT. Inert (503)
// until the Google secrets exist. GET /calendar/google/callback.
app.route('/calendar', publicCalendarRoute);

// Protected API routes — require a verified Supabase access token AND a
// transaction-scoped agency context for RLS.
app.use('/api/*', authMiddleware);
// Staff-only admin gate — registered BEFORE agencyContextMiddleware so it owns
// the transaction for /api/v1/admin/*; agencyContextMiddleware passes those
// paths straight through (it never sets an agency context for admin routes).
app.use('/api/v1/admin/*', requireAivenaStaff);
app.use('/api/*', agencyContextMiddleware);

// Admin (super-admin / aivena_staff) surface — onboarding console.
app.route('/api/v1/admin', adminRoute);

app.route('/api/v1/me', meRoute);
app.route('/api/v1/overview', overviewRoute);
app.route('/api/v1/tasks', tasksRoute);
app.route('/api/v1/settings', settingsRoute);
app.route('/api/v1/amanda', amandaAdminRoute);   // Amanda auto-mode agency surface (§6) — dark pre-migration
app.route('/api/v1/invitations', invitationsRoute);
// Property catalog ingestion (§5.17) — paths are /api/v1/agencies/:id/property-imports[...]
app.route('/api/v1/agencies', propertiesRoute);
// Bookings / viewings read surface (W11-lite).
app.route('/api/v1/bookings', bookingsRoute);
// Voice / missed-call recovery read surface (P2-A) — readiness + call log, no send.
app.route('/api/v1/voice', voiceRoute);
// Google Calendar connect / status / disconnect (Packet 2 · L1) — authed agency
// owner. Inert (503) until the Google secrets are set; no live Google call is made
// until an agency connects. Manual-task fallback (L3) stays until then.
app.route('/api/v1/calendar', apiCalendarRoute);
// Content library read surface (Studio Library tab).
app.route('/api/v1/content', contentRoute);
// Lead notes — direct SELECT read + SECURITY DEFINER write RPCs.
app.route('/api/v1/lead-notes', leadNotesRoute);
// Leads — write-side lead actions via SECURITY DEFINER RPCs (suggest-properties,
// freeform reply) plus the WhatsApp-window read for the persistent composer.
app.route('/api/v1/leads', leadsRoute);
// Conversations — pending suggested-reply read for the persistent composer.
app.route('/api/v1/conversations', conversationsRoute);
// Matches (W20) — read-only reverse-prospecting via two SECURITY INVOKER RPCs.
app.route('/api/v1/matches', matchesRoute);
// Human handoffs (Amanda Live L1) — the "Needs a human" queue + claim/release.
app.route('/api/v1/handoffs', handoffsRoute);
// WhatsApp re-engagement — closed-window template send (send_reengagement_template).
app.route('/api/v1/whatsapp', whatsappRoute);
// Go-live readiness (Phase 1, read-only) — per-item/provider/gate status computed
// from live signals; owner/aivena_staff; consumes WhatsApp readiness, degrades honestly.
app.route('/api/v1/readiness', readinessRoute);
// Command center / operations (F1+F2+F4, read-only) — aggregated failed sends,
// open action queue, provider health, and lead-lifecycle health from live
// signals; all agency members; each signal savepoint-isolated (degrade, never fake).
app.route('/api/v1/operations', operationsRoute);
// Studio uploads — agent's own reference image → agency-assets bucket.
app.route('/api/v1/studio', studioRoute);
// Image generation (W13) — create via Edge Function, poll/list via fenced reads.
app.route('/api/v1/images', imagesRoute);
// Studio wizard proxy (W13 v0.6) — browser's only door to the image EFs.
app.route('/api/studio', studioWizardRoute);

// Webhook signature validation — provider-specific.
// WhatsApp uses x-hub-signature-256 (Meta HMAC SHA-256 of raw body).
// Twilio uses x-twilio-signature (validation stub until Phase 4).
app.use('/webhooks/whatsapp/*', whatsappSignatureMiddleware);
app.use('/webhooks/twilio/*', twilioSignatureMiddleware);

// Test route to prove the full stack works:
// - authMiddleware verifies JWT and sets c.set('user', payload)
// - agencyContextMiddleware opens a transaction, sets app.current_agency_id,
//   and exposes tx via c.set('tx', tx)
// - This handler reads back current_setting to prove the agency context is active
//   and queries leads to prove RLS filters correctly.
app.get('/api/v1/test-rls', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');

  const settingResult = await tx.execute(
    sql`SELECT current_setting('app.current_agency_id', true) AS agency_in_session`
  );

  const leadsCountResult = await tx.execute(
    sql`SELECT count(*)::int AS visible_leads FROM public.leads`
  );

  return c.json({
    agency_id_claimed: agencyId,
    agency_id_in_session: (settingResult as unknown as Array<{ agency_in_session: string | null }>)[0]?.agency_in_session ?? null,
    visible_leads: (leadsCountResult as unknown as Array<{ visible_leads: number }>)[0]?.visible_leads ?? 0,
  });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info('AIVENA API running', { port: PORT });
});

// Google Calendar sync worker (Packet 2 · L2 wiring) — replaces the abandoned
// n8n watcher path (which never refreshed tokens). Scheduled ONLY when the
// Google env config is present (same googleConfig() gate as the routes) — with
// no secrets nothing starts and pollCalendarSyncs stays uncalled, exactly as
// before. First tick ~30s after boot, then every 5 minutes. Safe to run on
// multiple instances: the claim RPC uses FOR UPDATE SKIP LOCKED. A tick must
// never crash the process — each one is fully caught.
const CALENDAR_SYNC_FIRST_TICK_MS = 30_000;
const CALENDAR_SYNC_INTERVAL_MS = 30 * 60_000;
if (googleConfig() !== null) {
  const calendarTick = async () => {
    try {
      await pollCalendarSyncs();
    } catch (err) {
      console.error('[calendar/worker] tick failed', safeErr(err));
    }
  };
  setTimeout(() => {
    void calendarTick();
    setInterval(() => { void calendarTick(); }, CALENDAR_SYNC_INTERVAL_MS);
  }, CALENDAR_SYNC_FIRST_TICK_MS);
  logger.info('Calendar sync worker scheduled', {
    firstTickMs: CALENDAR_SYNC_FIRST_TICK_MS,
    intervalMs: CALENDAR_SYNC_INTERVAL_MS,
  });
}

// Amanda auto-mode engine worker (Packet 2 · P0) — DOUBLY inert by default:
// starts only with AMANDA_ENGINE_ENABLED=true (unset in prod until the P0
// schema migration is applied + approved), and even then every agency's
// amanda_mode defaults to 'off' so no conversation is touched until an agency
// is explicitly dialed up. Drains the amanda_inbound_queue outbox every 20s
// (claim RPC = FOR UPDATE SKIP LOCKED + lease steal, safe across instances).
const AMANDA_ENGINE_TICK_MS = 5_000;   // latency budget: debounce(≤6s) + tick(≤5s) + model(~15-20s)
if (engineEnabled()) {
  // Graceful shutdown (the 2026-08-27 demo stall): a deploy's SIGTERM used to
  // kill the worker mid-turn, orphaning the claimed row into a lease-length
  // silence. Now: stop claiming, let the in-flight drain finish (idempotency
  // keys make even a hard kill double-send-safe), then exit. Pair with
  // RAILWAY_DEPLOYMENT_DRAINING_SECONDS=90 so Railway waits for us.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    requestDrainStop();   // finish the in-flight turn, release the unstarted batch
    logger.info('Amanda engine draining for shutdown', { signal, busy: drainBusy() });
    const started = Date.now();
    const waiter = setInterval(() => {
      if (!drainBusy() || Date.now() - started > 75_000) {
        clearInterval(waiter);
        logger.info('Amanda engine shutdown complete', { waitedMs: Date.now() - started });
        process.exit(0);
      }
    }, 1_000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const engineTick = async () => {
    if (shuttingDown) return;
    try {
      const r = await drainAmandaInbound(processTurnDb);
      if (r.claimed > 0) logger.info('Amanda engine drained', r);
    } catch (err) {
      console.error('[amanda-engine] tick failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
    }
  };
  setInterval(() => { void engineTick(); }, AMANDA_ENGINE_TICK_MS);
  logger.info('Amanda engine worker scheduled', { intervalMs: AMANDA_ENGINE_TICK_MS });

  // Viewing day-before reminders (§11.1) — every 30 min; the claim RPC gates on
  // engine-enabled agencies + their local daytime, so the sweep is cheap and
  // quiet. Rides the approved viewing_reminder_v1 template via the live executor.
  const reminderTick = async () => {
    try {
      const r = await sweepViewingReminders();
      if (r.enqueued > 0) logger.info('Viewing reminders enqueued', r);
    } catch (err) {
      console.error('[amanda-reminders] tick failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
    }
  };
  setInterval(() => { void reminderTick(); }, 30 * 60_000);

  // Agent question pings — every 2 minutes. Cheap: the query only returns
  // questions that are OPEN and due, and the worker declines to send far more
  // often than it sends (nobody on shift, window closed, already pinged), each
  // decline recorded rather than retried in a spin. Gated behind the same
  // AMANDA_PING_ENABLED flag discipline as the engine so it can be switched off
  // without a deploy.
  // Tolerant of how the flag was typed. A masked Railway variable cannot be
  // read back, so an exact-string check turns a typo ('True', '1', a trailing
  // space) into a worker that is silently never armed with nothing on screen to
  // say why. Accept the obvious affirmatives and STATE the decision at boot, so
  // "is the pinger on?" is answerable from the logs instead of by inference.
  const pingFlag = (process.env.AMANDA_PING_ENABLED ?? '').trim().toLowerCase();
  const pingArmed = ['true', '1', 'yes', 'on'].includes(pingFlag);
  logger.info('Agent ping worker', {
    armed: pingArmed,
    flagPresent: pingFlag.length > 0,   // value never logged, only presence
  });
  if (pingArmed) {
    const pingTickRun = async () => {
      try {
        const outcomes = await pingTick();
        const sent = outcomes.filter((o) => o.sent).length;
        if (sent > 0) logger.info('Agent pings sent', { sent, considered: outcomes.length });
      } catch (err) {
        console.error('[agent-ping] tick failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
      }
    };
    setInterval(() => { void pingTickRun(); }, 2 * 60_000);
    logger.info('Agent ping worker armed');
  }
}

export default app;
