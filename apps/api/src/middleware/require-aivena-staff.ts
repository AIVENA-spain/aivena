import type { Context, Next } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { env } from '../../../../packages/config/env';

/**
 * requireAivenaStaff
 *
 * Gates `/api/v1/admin/*` to AIVENA super-admins. Runs after authMiddleware;
 * agencyContextMiddleware passes admin paths straight through (admin routes are
 * global, never agency-scoped).
 *
 * Per Vega's integration contract, the admin_* RPCs gate on `is_aivena_staff()`
 * → `auth.uid()`, which only resolves when the RPC is called through PostgREST
 * with the caller's JWT (NOT the service-role key, NOT the pooled Drizzle
 * connection). So admin handlers build a per-request Supabase client from the
 * JWT we stash here as `c.get('jwt')`.
 *
 * We verify + read staff status via `auth.getUser(jwt)`, which re-fetches the
 * user from the DB on every call. That returns the LATEST `app_metadata`
 * regardless of token freshness — so a just-granted super-admin works without
 * signing out and back in.
 *
 * A non-staff (or unauthenticated) caller is told the route does not exist
 * (404), so its existence is never revealed. Friendly, Law-2 compliant.
 */

const STAFF_404 = { ok: false, error: 'Not found.' } as const;

export async function requireAivenaStaff(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'Not authorized.' }, 401);
  }
  const jwt = authHeader.slice(7);

  let isStaff = false;
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(jwt);
    if (error || !user) {
      return c.json({ ok: false, error: 'Not authorized.' }, 401);
    }
    const flag = (user.app_metadata as { aivena_staff?: unknown } | undefined)
      ?.aivena_staff;
    isStaff = flag === true || flag === 'true';
  } catch (err) {
    console.error('[admin] staff check failed:', err);
    return c.json(
      {
        ok: false,
        error:
          'Something went wrong — please try again, and contact support if it persists.',
      },
      500,
    );
  }

  if (!isStaff) {
    return c.json(STAFF_404, 404);
  }

  c.set('jwt', jwt);
  await next();
}
