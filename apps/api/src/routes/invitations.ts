import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase-admin';

const route = new Hono();

/**
 * Invitations — Phase 1 stub-with-real-INSERT per Vera's brief.
 *
 * POST /             creates a real row in public.invitations via the
 *                    service-role client (bypasses RLS at this gateway, then
 *                    handlers downstream still rely on RLS for reads).
 *                    The token is a placeholder; Vega's Phase-2 RPCs
 *                    (create_invitation / revoke_invitation / resend_invitation
 *                    / accept_invitation) land in ~3 days and will own the
 *                    auth+email flow — same row shape, no UI change.
 *
 * POST /:id/revoke   plain stub. Returns success without writing — Phase 2
 *                    will swap the body for an RPC call.
 *
 * POST /:id/resend   plain stub. Same pattern.
 */

const INVITE_ROLES = new Set(['owner', 'agent', 'viewer']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

route.post('/', async (c) => {
  const user = c.get('user');
  const agencyId = c.get('agencyId');
  const body = await readJson(c);

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!EMAIL_RE.test(email)) {
    return c.json({ error: 'Please enter a valid email address.' }, 400);
  }
  const role = typeof body.role === 'string' ? body.role : '';
  if (!INVITE_ROLES.has(role)) {
    return c.json({ error: 'Pick a role from the available options.' }, 400);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const token = `stub-${randomUUID()}`;

  const { data, error } = await supabaseAdmin
    .from('invitations')
    .insert({
      agency_id: agencyId,
      email,
      role,
      token,
      status: 'pending',
      invited_by: user.sub,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      send_attempts: 0,
      raw_payload: { via: 'cc_stub_phase1' },
    })
    .select('id, token, expires_at')
    .single();

  if (error) {
    console.error('[/api/v1/invitations] insert failed:', error);
    return c.json(
      { error: 'Couldn\'t create that invite right now — please try again.' },
      500,
    );
  }

  return c.json({
    invitation_id: data.id,
    token: data.token,
    expires_at: data.expires_at,
    sent: false,
  });
});

route.post('/:id/revoke', async (c) => {
  // Plain stub — Phase 2 will call revoke_invitation(id). Returning success
  // here lets the UI exercise the optimistic update path; the seeded test
  // invite stays visible on hard-refresh because no DB write happens yet.
  return c.json({
    revoked: true,
    revoked_at: new Date().toISOString(),
  });
});

route.post('/:id/resend', async (c) => {
  // Plain stub — Phase 2 will call resend_invitation(id) which bumps
  // send_attempts and last_sent_at via the email Edge Function.
  return c.json({
    resent: true,
    sent_at: new Date().toISOString(),
    attempts: 1,
  });
});

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
