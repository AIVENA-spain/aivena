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
import contentRoute from './routes/content';
import leadNotesRoute from './routes/lead-notes';
import leadsRoute from './routes/leads';
import conversationsRoute from './routes/conversations';
import matchesRoute from './routes/matches';
import whatsappRoute from './routes/whatsapp';
import readinessRoute from './routes/readiness';
import operationsRoute from './routes/operations';
import studioRoute from './routes/studio';
import studioRenderRoute from './routes/studio-render';
import imagesRoute from './routes/images';
import studioWizardRoute from './routes/studio-wizard';
import adminRoute from './routes/admin';
import chatRoute from './routes/chat';

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
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Studio template render (Phase 1) — mounted OUTSIDE /api/* on purpose: it is
// authenticated by x-internal-secret (internal callers — the n8n test caller,
// the kie step later), NOT a user JWT, so the /api/* auth + agency-context
// middleware must never run on it. POST /studio/render.
app.route('/studio', studioRenderRoute);

// Amanda web-chat (Amanda Phase A) — mounted OUTSIDE /api/* on purpose: PUBLIC,
// unauthenticated visitor endpoints (no user JWT, no agency-context middleware).
// The agency is derived from :agencySlug and every write goes through the
// SECURITY DEFINER amanda_capture_lead RPC. Gated to is_test agencies (slice 1).
// NOTE (Phase B / widget): browser calls from agency origins need a per-agency
// CORS allow-list; the global dashboard-only CORS above still applies here today,
// so slice 1 is exercised server-side. POST /chat/:agencySlug/contact.
app.route('/chat', chatRoute);

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
app.route('/api/v1/invitations', invitationsRoute);
// Property catalog ingestion (§5.17) — paths are /api/v1/agencies/:id/property-imports[...]
app.route('/api/v1/agencies', propertiesRoute);
// Bookings / viewings read surface (W11-lite).
app.route('/api/v1/bookings', bookingsRoute);
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

export default app;
