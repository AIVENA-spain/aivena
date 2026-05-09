import * as Sentry from '@sentry/node';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { env } from '../../../packages/config/env';

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
});

const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`AIVENA API running on port ${PORT}`);
});

export default app;
