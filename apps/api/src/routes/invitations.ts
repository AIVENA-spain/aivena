import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

const route = new Hono();

/**
 * Invitations — Phase 2 wiring per Vera's combined brief.
 *
 * POST /             → calls public.create_invitation(p_email, p_role). The
 *                      RPC owns token generation, expires_at, invited_by, and
 *                      raw_payload — this handler is purely a thin proxy that
 *                      translates the RPC's typed errors into machine-readable
 *                      error_codes for the client to localize. Runs inside the
 *                      agency-context tx so the RPC reads
 *                      app.current_agency_id / app.current_user_id /
 *                      app.current_user_role.
 *
 * POST /:id/revoke   plain stub (Phase 2b deferred — not shipped by Vega yet).
 * POST /:id/resend   plain stub (same).
 */

type RpcErrorCode =
  | 'no_agency_context'
  | 'no_auth_context'
  | 'no_role_context'
  | 'invalid_role_context'
  | 'insufficient_role'
  | 'missing_email'
  | 'invalid_email'
  | 'invalid_invitation_role'
  | 'already_member'
  | 'pending_invite_exists';

const KNOWN_RPC_CODES: ReadonlySet<RpcErrorCode> = new Set([
  'no_agency_context',
  'no_auth_context',
  'no_role_context',
  'invalid_role_context',
  'insufficient_role',
  'missing_email',
  'invalid_email',
  'invalid_invitation_role',
  'already_member',
  'pending_invite_exists',
]);

route.post('/', async (c) => {
  const tx = c.get('tx');
  const body = await readJson(c);

  // Don't pre-validate — create_invitation raises typed errors for missing /
  // invalid email and role, which we translate below. Pre-validating would
  // double-gate (and could drift from the RPC's regex).
  const email = typeof body.email === 'string' ? body.email : '';
  const role = typeof body.role === 'string' ? body.role : '';

  try {
    const result = await tx.execute(sql`
      SELECT create_invitation(${email}::text, ${role}::text) AS row
    `);
    const rows = result as unknown as Array<{ row: Record<string, unknown> | null }>;
    const row = rows[0]?.row;
    if (!row) {
      console.error('[/api/v1/invitations] create_invitation returned empty result');
      return c.json(
        { error_code: 'unknown', error: "Couldn't create that invite — please try again." },
        500,
      );
    }
    return c.json({
      invitation_id: row.invitation_id,
      token: row.token,
      expires_at: row.expires_at,
      sent: false,
      email: row.email,
      role: row.role,
    });
  } catch (err) {
    return mapCreateError(c, err, email);
  }
});

route.post('/:id/revoke', async (c) => {
  // Plain stub — Phase 2b will swap for revoke_invitation(id). Returns success
  // here so the UI's optimistic-remove flow keeps working; the seeded test
  // invite reappears on hard refresh because no DB write happens yet.
  return c.json({
    revoked: true,
    revoked_at: new Date().toISOString(),
  });
});

route.post('/:id/resend', async (c) => {
  // Plain stub — Phase 2b will swap for resend_invitation(id).
  return c.json({
    resent: true,
    sent_at: new Date().toISOString(),
    attempts: 1,
  });
});

// ---------- helpers ----------

function mapCreateError(
  c: import('hono').Context,
  err: unknown,
  email: string,
): Response {
  const pgCode = extractField(err, 'code');
  const pgMessage = extractField(err, 'message');
  const pgDetail = extractField(err, 'detail');
  // Drizzle/pg surfaces the RAISE EXCEPTION's first argument as `message`.
  // Sometimes the wrapped message is prefixed with extra noise; match against
  // the known token-list rather than equality.
  const rpcCode = matchKnownCode(pgMessage);

  console.error(
    '[/api/v1/invitations] create_invitation failed:',
    JSON.stringify({ pgCode, pgMessage, pgDetail, rpcCode }),
  );

  if (!rpcCode) {
    return c.json(
      { error_code: 'unknown', error: "Couldn't create that invite — please try again." },
      500,
    );
  }

  // Map each known RPC code to: HTTP status + machine code + an English
  // fallback. The dashboard client looks at error_code first and localizes;
  // `error` is the safety net for clients without translations.
  switch (rpcCode) {
    case 'no_agency_context':
    case 'no_auth_context':
    case 'no_role_context':
    case 'invalid_role_context':
      return c.json(
        {
          error_code: 'context_error',
          error: 'Something went wrong creating that invite. Please refresh and try again.',
        },
        500,
      );
    case 'insufficient_role':
      return c.json(
        {
          error_code: 'insufficient_role',
          error: 'Only the agency owner can send invites.',
        },
        403,
      );
    case 'missing_email':
    case 'invalid_email':
      return c.json(
        { error_code: 'invalid_email', error: 'Please enter a valid email address.' },
        400,
      );
    case 'invalid_invitation_role':
      return c.json(
        {
          error_code: 'invalid_invitation_role',
          error: 'Please choose Agent or Viewer for the role.',
        },
        400,
      );
    case 'already_member':
      return c.json(
        {
          error_code: 'already_member',
          email,
          error: `${email} is already on your team.`,
        },
        409,
      );
    case 'pending_invite_exists':
      return c.json(
        {
          error_code: 'pending_invite_exists',
          email,
          error: `${email} already has a pending invitation.`,
        },
        409,
      );
  }
}

function matchKnownCode(message: string | null): RpcErrorCode | null {
  if (!message) return null;
  for (const code of KNOWN_RPC_CODES) {
    if (message.includes(code)) return code as RpcErrorCode;
  }
  return null;
}

function extractField(err: unknown, key: string): string | null {
  if (!err || typeof err !== 'object') return null;
  const value = (err as Record<string, unknown>)[key];
  if (typeof value === 'string') return value;
  // node-pg often nests the original on `cause`; check one level deep.
  const cause = (err as Record<string, unknown>).cause;
  if (cause && typeof cause === 'object') {
    const nested = (cause as Record<string, unknown>)[key];
    if (typeof nested === 'string') return nested;
  }
  return null;
}

async function readJson(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export default route;
