import type { Context, Next } from 'hono';
import { db } from '../../../../packages/db/client';
import { sql } from 'drizzle-orm';

export async function agencyContextMiddleware(c: Context, next: Next) {
  const user = c.get('user') as { agency_id?: string } | undefined;

  if (!user?.agency_id) {
    return c.json({ error: 'No agency context' }, 403);
  }

  await db.execute(sql`SELECT set_config('app.current_agency_id', ${user.agency_id}, true)`);

  c.set('agencyId', user.agency_id);
  await next();
}
