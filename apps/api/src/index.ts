import * as Sentry from '@sentry/node';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql } from 'drizzle-orm';
import { env } from '../../../packages/config/env';
import { logger } from '../../../packages/config/logger';
import { authMiddleware } from './middleware/auth';
import { agencyContextMiddleware } from './middleware/agency-context';
import { whatsappSignatureMiddleware, twilioSignatureMiddleware } from './middleware/webhook-signature';
import meRoute from './routes/me';
import tasksRoute from './routes/tasks';

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

// Protected API routes — require a verified Supabase access token AND a
// transaction-scoped agency context for RLS.
app.use('/api/*', authMiddleware);
app.use('/api/*', agencyContextMiddleware);

app.route('/api/v1/me', meRoute);
app.route('/api/v1/tasks', tasksRoute);

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
