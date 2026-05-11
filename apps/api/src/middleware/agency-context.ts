import type { Context, Next } from 'hono';
import { db } from '../../../../packages/db/client';
import { sql } from 'drizzle-orm';

/**
 * agency_context_middleware
 *
 * Runs after authMiddleware. Reads user.agency_id from Hono context,
 * opens a Postgres transaction, sets app.current_agency_id inside that
 * transaction, exposes the transaction-scoped client as c.set('tx', tx),
 * and runs the rest of the request inside the transaction.
 *
 * Route handlers MUST use c.get('tx') for all DB queries — not the
 * top-level db client — so that every query is subject to the RLS
 * agency scope. Queries made via the top-level db client outside this
 * transaction will see zero rows (aivena_app role has NOBYPASSRLS and
 * no app.current_agency_id is set on those connections).
 *
 * The transaction commits when next() resolves successfully. If the
 * handler returned a 4xx or 5xx response, or threw, the transaction
 * rolls back so partial writes are not persisted.
 */
export async function agencyContextMiddleware(c: Context, next: Next) {
  const user = c.get('user') as { agency_id?: string; sub?: string } | undefined;

  if (!user?.agency_id) {
    return c.json({ error: 'No agency context' }, 403);
  }

  const agencyId = user.agency_id;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_agency_id', ${agencyId}, true)`
      );

      c.set('tx', tx);
      c.set('agencyId', agencyId);

      await next();

      const status = c.res.status;
      if (status >= 400) {
        throw new RouteHandlerError(status);
      }
    });
  } catch (err) {
    if (err instanceof RouteHandlerError) return;
    throw err;
  }
}

class RouteHandlerError extends Error {
  constructor(public status: number) {
    super(`Route handler returned status ${status}`);
    this.name = 'RouteHandlerError';
  }
}
