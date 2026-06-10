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

/**
 * Invoke the send-invitation-email Edge Function for one invitation. Uses the
 * service-role key (system-initiated send). Returns a stable result — never
 * throws — so callers can surface a friendly status without leaking detail.
 * The invitation row exists regardless of whether the email goes out.
 */
export async function invokeSendInvitationEmail(
  invitationId: string,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/functions/v1/send-invitation-email`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ invitation_id: invitationId }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      sent?: boolean;
      error?: string;
      skipped_reason?: string;
    };
    if (!res.ok || body.sent === false) {
      const detail = body.error ?? body.skipped_reason ?? `EF ${res.status}`;
      return { sent: false, error: detail };
    }
    return { sent: body.sent === true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'send failed',
    };
  }
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
