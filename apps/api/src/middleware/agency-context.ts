import { createMiddleware } from 'hono/factory';
import { db } from '../../../packages/db/client';
import { sql } from 'drizzle-orm';

export const agencyContextMiddleware = createMiddleware(async (c, next) => {
  const agencyId = c.get('agencyId');

  if (!agencyId) {
    return c.json({ error: 'No agency context' }, 400);
  }

  // Set the agency context for RLS — every query in this request
  // will be scoped to this agency automatically by Postgres
  await db.execute(sql`SELECT set_config('app.current_agency_id', ${agencyId}, TRUE)`);

  await next();
});