import type { Context } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../../../../packages/config/env';

/**
 * Shared helpers for the admin (`/api/v1/admin/*`) routes.
 *
 * The admin_* RPCs are SECURITY DEFINER and gate on `is_aivena_staff()` →
 * `auth.uid()`, which only resolves when called through PostgREST with the
 * caller's JWT. `userClient(c)` builds that per-request client from the JWT
 * stashed by requireAivenaStaff.
 */

const GENERIC =
  'Something went wrong — please try again, and contact support if it persists.';

/** Supabase client bound to the caller's JWT — auth.uid() resolves to them. */
export function userClient(c: Context): SupabaseClient {
  const jwt = c.get('jwt');
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client for Storage / EF calls that need elevated access. */
export function serviceClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Infer an HTTP status from a friendly RPC error string. */
export function statusForRpcError(error: string): 400 | 404 | 409 {
  const e = error.toLowerCase();
  if (e.includes('not found')) return 404;
  if (
    e.includes('already') ||
    e.includes('in use') ||
    e.includes('pending') ||
    e.includes('maximum number')
  ) {
    return 409;
  }
  return 400;
}

export const ADMIN_GENERIC_ERROR = GENERIC;

/**
 * Standard result-handling for an admin RPC call. `rpc` is the awaited
 * `{ data, error }` from supabase.rpc(...). On a Postgres-level error (e.g.
 * 42501 when auth.uid() didn't resolve) we log the raw detail and return the
 * generic line as 500. On an RPC-level `{ ok:false, error }` we surface the
 * friendly message with an inferred status. On success we return the data.
 */
export function handleRpc(
  c: Context,
  scope: string,
  rpc: { data: unknown; error: { message?: string } | null },
) {
  if (rpc.error) {
    console.error(`[admin/${scope}] rpc error:`, rpc.error);
    return c.json({ ok: false, error: GENERIC }, 500);
  }
  const data = rpc.data as { ok?: boolean; error?: string } | null;
  if (!data || typeof data !== 'object') {
    console.error(`[admin/${scope}] unexpected rpc shape:`, data);
    return c.json({ ok: false, error: GENERIC }, 500);
  }
  if (data.ok === false) {
    const msg = data.error ?? GENERIC;
    return c.json({ ok: false, error: msg }, statusForRpcError(msg));
  }
  return c.json(data);
}

/** Parse a JSON body defensively; returns {} on empty/invalid. */
export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
