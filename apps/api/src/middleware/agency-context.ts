import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';
import { listMembershipsForUser } from '../lib/supabase-admin';

/**
 * agencyContextMiddleware
 *
 * Runs after authMiddleware. Supabase access tokens do not carry an agency
 * claim, so we derive one by looking up the user's memberships in
 * `public.user_agencies` (via the service-role Supabase client, since the
 * pooled `aivena_app` connection cannot read user_agencies without an agency
 * context already being set).
 *
 * Selects the membership with is_default = true; otherwise the first one
 * returned. Returns 403 if the user has zero memberships.
 *
 * Then opens a Postgres transaction, sets `app.current_agency_id` inside it,
 * and exposes the transaction-scoped client as `c.set('tx', tx)`. Handlers
 * MUST use `c.get('tx')` so every query is RLS-scoped to this agency.
 *
 * The transaction commits when next() resolves successfully. If the handler
 * returned ≥400 or threw, the transaction rolls back.
 */
export async function agencyContextMiddleware(c: Context, next: Next) {
  const user = c.get('user');
  if (!user?.sub) {
    return c.json({ error: 'No authenticated user on context' }, 401);
  }

  let memberships;
  try {
    memberships = await listMembershipsForUser(user.sub);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `Failed to resolve agency: ${message}` }, 500);
  }

  if (memberships.length === 0) {
    return c.json(
      {
        error:
          "You're not assigned to an agency yet — contact your administrator.",
      },
      403,
    );
  }

  const active =
    memberships.find((m) => m.is_default === true) ?? memberships[0];
  const agencyId = active.agency_id;
  const role = active.role;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_agency_id', ${agencyId}, true)`,
      );

      c.set('tx', tx);
      c.set('agencyId', agencyId);
      c.set('role', role);

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
