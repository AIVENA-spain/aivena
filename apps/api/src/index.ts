import * as Sentry from '@sentry/node';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { env } from '../../../packages/config/env';
import { authMiddleware } from './middleware/auth';
import { agencyContextMiddleware } from './middleware/agency-context';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
});

const app = new Hono();

// Public routes — no auth, no RLS context.
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected API routes — require JWT and run inside an agency-scoped transaction.
// Order matters: auth must run before agencyContext so user.agency_id is available.
app.use('/api/*', authMiddleware);
app.use('/api/*', agencyContextMiddleware);

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
  console.log(`AIVENA API running on port ${PORT}`);
});

export default app;
