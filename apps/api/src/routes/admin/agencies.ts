import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../../../../../packages/db/client';
import {
  userClient,
  handleRpc,
  readJson,
  invokeSendInvitationEmail,
  statusForRpcError,
  ADMIN_GENERIC_ERROR,
} from './_shared';
import { gatherReadinessSignals } from '../../lib/readiness/gather';
import {
  computeReadiness,
  evaluateGoLive,
  type PilotStatus,
  type GoLiveAttestations,
} from '../../lib/readiness/compute';

/**
 * Admin → Agencies. Staff-only (gated by requireAivenaStaff). Each handler is a
 * thin proxy over a SECURITY DEFINER `admin_*` RPC called through the caller's
 * JWT (so is_aivena_staff() resolves). The RPCs own all validation and return
 * friendly `{ ok, ... }` envelopes; handleRpc maps those to HTTP responses.
 */

const route = new Hono();

const PLAN_TIERS = ['starter', 'pro', 'unlimited'] as const;

// Reserved slugs — mirror of the RPC's list, for the live check-slug endpoint.
const RESERVED_SLUGS = new Set([
  'admin','api','app','auth','account','accounts','login','logout','register',
  'signup','signin','signout','dashboard','settings','profile','system','public',
  'www','mail','root','support','help','billing','agency','agencies','new','edit',
  'delete','create','update','reset','verify','confirm','password','about','contact',
  'privacy','terms','legal','blog','careers','jobs','status','team','users','user',
  'members','member','leads','properties','lead','property','assets','staff','onboarding',
]);

const createSchema = z.object({
  slug: z
    .string()
    .min(3, 'Identifier must be at least 3 characters.')
    .max(50, 'Identifier must be 50 characters or fewer.')
    .regex(
      /^[a-z][a-z0-9-]*[a-z0-9]$/,
      'Identifier can only contain lowercase letters, numbers, and hyphens.',
    )
    .refine((s) => !s.includes('--'), 'Identifier cannot contain consecutive hyphens.'),
  trading_name: z.string().min(2, 'Trading name is required.').max(100),
  legal_name: z.string().max(200).optional(),
  cif_nif: z.string().max(40).optional(),
  primary_owner_email: z.string().email('Please enter a valid email address.'),
  primary_owner_phone: z.string().max(40).optional(),
  primary_region: z.string().max(120).optional(),
  supported_languages: z.array(z.string().min(2).max(8)).min(1).default(['en']),
  default_language: z.string().min(2).max(8).default('en'),
  plan_tier: z.enum(PLAN_TIERS).default('starter'),
  send_invitation: z.boolean().default(true),
});

// ─── GET /api/v1/admin/agencies/check-slug?slug=… — live availability ────────
// Registered before /:id so the static path wins.
route.get('/check-slug', async (c) => {
  const slug = c.req.query('slug')?.toLowerCase().trim() ?? '';
  if (slug.length < 3 || slug.length > 50) {
    return c.json({ available: false, reason: 'Identifier must be 3–50 characters.' });
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return c.json({
      available: false,
      reason: 'Identifier can only contain lowercase letters, numbers, and hyphens.',
    });
  }
  if (slug.includes('--')) {
    return c.json({ available: false, reason: 'Identifier cannot contain consecutive hyphens.' });
  }
  if (RESERVED_SLUGS.has(slug)) {
    return c.json({ available: false, reason: 'This identifier is reserved. Try a different one.' });
  }
  try {
    const supabase = userClient(c);
    const { data, error } = await supabase
      .from('agencies')
      .select('id')
      .or(`id.eq.${slug},slug.eq.${slug}`)
      .limit(1);
    if (error) {
      console.error('[admin/check-slug] query error:', error);
      return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
    }
    const taken = Array.isArray(data) && data.length > 0;
    return c.json({
      available: !taken,
      reason: taken ? 'This identifier is already in use. Try something else.' : null,
    });
  } catch (err) {
    console.error('[admin/check-slug] failed:', err);
    return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
  }
});

// ─── GET /api/v1/admin/agencies — list (optional ?status, ?search) ──────────
route.get('/', async (c) => {
  const statusRaw = c.req.query('status');
  const search = c.req.query('search')?.trim() || null;
  const status =
    statusRaw && ['active', 'paused', 'archived'].includes(statusRaw)
      ? statusRaw
      : null;
  const supabase = userClient(c);
  const rpc = await supabase.rpc('admin_list_agencies', {
    p_status: status,
    p_search: search,
  });
  return handleRpc(c, 'list', rpc);
});

// ─── POST /api/v1/admin/agencies — create ───────────────────────────────────
// Two steps: admin_create_agency (creates the agency + invitation row), then —
// if send_invitation — invoke the send-invitation-email Edge Function. The
// response reports `email_sent` so the UI can show the true status (and a
// retry) rather than claiming an email went out when it didn't.
route.post('/', async (c) => {
  const parsed = createSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Please check the form and try again.';
    return c.json({ ok: false, error: msg }, 400);
  }
  const b = parsed.data;
  const supabase = userClient(c);
  const rpc = await supabase.rpc('admin_create_agency', {
    p_slug: b.slug,
    p_trading_name: b.trading_name,
    p_primary_owner_email: b.primary_owner_email,
    p_legal_name: b.legal_name ?? null,
    p_cif_nif: b.cif_nif ?? null,
    p_primary_owner_phone: b.primary_owner_phone ?? null,
    p_primary_region: b.primary_region ?? null,
    p_supported_languages: b.supported_languages,
    p_default_language: b.default_language,
    p_plan_tier: b.plan_tier,
    p_send_invitation: b.send_invitation,
  });

  if (rpc.error) {
    console.error('[admin/create] rpc error:', rpc.error);
    return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
  }
  const data = rpc.data as
    | { ok?: boolean; error?: string; invitation_id?: string }
    | null;
  if (!data || typeof data !== 'object') {
    return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
  }
  if (data.ok === false) {
    const msg = data.error ?? ADMIN_GENERIC_ERROR;
    return c.json({ ok: false, error: msg }, statusForRpcError(msg));
  }

  // Step 2 — send the invitation email if requested and one was created.
  let emailSent: boolean | undefined;
  if (b.send_invitation && data.invitation_id) {
    const sendResult = await invokeSendInvitationEmail(String(data.invitation_id));
    emailSent = sendResult.sent;
    if (!sendResult.sent) {
      console.error('[admin/create] invite email failed:', sendResult.error);
    }
  }

  return c.json({ ...data, email_sent: emailSent });
});

// ─── POST /api/v1/admin/agencies/:id/invitations/:invitationId/send ─────────
// Retry sending an invitation email (e.g. from the wizard's success screen when
// the first send failed). Plain re-send — no token rotation (Phase 3's resend
// rotates the token via admin_resend_invitation).
route.post('/:id/invitations/:invitationId/send', async (c) => {
  const invitationId = c.req.param('invitationId');
  if (!invitationId) {
    return c.json({ ok: false, error: 'That invitation could not be found.' }, 404);
  }
  const result = await invokeSendInvitationEmail(invitationId);
  if (!result.sent) {
    console.error('[admin/invite-send] failed:', result.error);
    return c.json(
      { ok: false, error: 'The invitation email could not be sent. Please try again.' },
      502,
    );
  }
  return c.json({ ok: true, email_sent: true });
});

// ─── GET /api/v1/admin/agencies/:id — detail ────────────────────────────────
route.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const supabase = userClient(c);
  const rpc = await supabase.rpc('admin_get_agency', { p_agency_id: id });
  return handleRpc(c, 'detail', rpc);
});

// Recompute the B2 readiness model for a TARGET agency (not the caller). Sets the RLS
// GUC to :id in its own tx, gathers live signals, computes — the exact recompute the
// go-live gate uses, so the admin readiness panel and the go-live decision always agree.
async function recomputeReadinessForAgency(id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_agency_id', ${id}, true),
                 set_config('app.current_user_role', 'aivena_staff', true)`,
    );
    const signals = await gatherReadinessSignals(tx);
    return computeReadiness(id, signals, { catalogEnforce: process.env.O5_CATALOG_GATE_ENFORCE === 'block' });
  });
}

// ─── GET /api/v1/admin/agencies/:id/readiness — staff readiness read for a target agency (C4) ──
// Staff-only (requireAivenaStaff gates /api/v1/admin/*). READ-ONLY, no writes, no grants.
// The admin go-live UI needs a target agency's readiness to render honestly; GET
// /api/v1/readiness is self-scoped to the caller's agency, so staff use this instead.
route.get('/:id/readiness', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  try {
    const result = await recomputeReadinessForAgency(id);
    return c.json({ computedAt: new Date().toISOString(), ...result });
  } catch (err) {
    console.error('[admin/readiness] recompute failed:', err);
    return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
  }
});

// ─── POST /api/v1/admin/agencies/:id/go-live — staff sets the pilot lifecycle (C3) ──
// Staff-only (requireAivenaStaff gates /api/v1/admin/*). Server-side readiness
// recompute for the TARGET agency (never trust the browser); `live` requires every
// manual attestation; an explicit override bypasses ONLY soft readiness gaps (and is
// recorded), never the attestations. The actual write + audit happen in the
// SECURITY DEFINER set_agency_pilot_status RPC, called staff-JWT-bound so auth.uid()
// resolves (is_aivena_staff()) — `aivena_app` cannot write pilot_status directly.
const PILOT_TARGETS = ['setup', 'ready_for_pilot', 'live', 'paused', 'blocked'];

route.post('/:id/go-live', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);

  const body = await readJson(c);
  const target = body.target;
  if (typeof target !== 'string' || !PILOT_TARGETS.includes(target)) {
    return c.json(
      { ok: false, error: 'Choose a valid pilot status (setup, ready_for_pilot, live, paused, blocked).' },
      400,
    );
  }
  const attestations = (body.attestations && typeof body.attestations === 'object' && !Array.isArray(body.attestations)
    ? body.attestations
    : {}) as GoLiveAttestations;
  const override = body.override === true;
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;

  // Server-side readiness recompute for the TARGET agency (never trust the browser).
  let readiness;
  try {
    readiness = await recomputeReadinessForAgency(id);
  } catch (err) {
    console.error('[admin/go-live] readiness recompute failed:', err);
    return c.json({ ok: false, error: ADMIN_GENERIC_ERROR }, 500);
  }

  const decision = evaluateGoLive(target as PilotStatus, readiness, attestations, override);
  if (!decision.allowed) {
    return c.json(
      {
        ok: false,
        error: decision.reason,
        blockedBy: decision.configBlockers,
        missingAttestations: decision.missingAttestations,
      },
      422,
    );
  }

  // Write + audit via the staff-JWT-bound SECURITY DEFINER RPC (the only writer).
  const metadata = {
    via: 'admin_go_live_endpoint',
    target,
    override: decision.overrideUsed,
    override_blockers: decision.overrideUsed ? decision.configBlockers : [],
    reason,
    eligibility_snapshot: {
      pilot_status_before: readiness.pilotStatus,
      go_live_blocked_by: readiness.goLive.blockedBy,
    },
    ...(target === 'live' ? { attestations } : {}),
  };

  const supabase = userClient(c);
  const rpc = await supabase.rpc('set_agency_pilot_status', {
    p_agency_id: id,
    p_target: target,
    p_metadata: metadata,
  });
  return handleRpc(c, 'go-live', rpc);
});

// ─── POST /api/v1/admin/agencies/:id/status — staff archive/restore (Phase 1) ──
// Staff-only. Soft archive/restore via agencies.status (NO hard delete). The RPC
// blocks archiving a live agency, requires the slug for a non-test agency (strong
// confirm), requires a reason, and audits every change.
route.post('/:id/status', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const body = await readJson(c);
  const status = typeof body.status === 'string' ? body.status : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const confirmSlug = typeof body.confirm_slug === 'string' ? body.confirm_slug : null;
  const rpc = await userClient(c).rpc('admin_set_agency_status', {
    p_agency_id: id,
    p_status: status,
    p_reason: reason,
    p_confirm_slug: confirmSlug,
  });
  return handleRpc(c, 'set-status', rpc);
});

// ─── POST /api/v1/admin/agencies/:id/test-flag — staff mark/unmark test (Phase 1) ──
route.post('/:id/test-flag', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const body = await readJson(c);
  const isTest = body.is_test === true;
  const reason = typeof body.reason === 'string' ? body.reason : null;
  const rpc = await userClient(c).rpc('admin_set_agency_test_flag', {
    p_agency_id: id,
    p_is_test: isTest,
    p_reason: reason,
  });
  return handleRpc(c, 'test-flag', rpc);
});

// ─── GET /api/v1/admin/agencies/:id/audit — staff read of the agency's audit trail ──
route.get('/:id/audit', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const rpc = await userClient(c).rpc('admin_list_agency_audit', { p_agency_id: id, p_limit: 100 });
  return handleRpc(c, 'audit', rpc);
});

// ─── POST /api/v1/admin/agencies/:id/details — staff edit core agency fields (Phase 2) ──
// Staff-only. Whitelisted patch (legal/trading name, CIF, region, owner email/phone, notes) —
// the RPC CANNOT touch slug/id/status/is_test/pilot_status. Validated + audited server-side.
const EDITABLE_FIELDS = [
  'legal_name', 'trading_name', 'cif_nif', 'primary_region',
  'primary_owner_email', 'primary_owner_phone', 'notes',
];
route.post('/:id/details', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const body = await readJson(c);
  // Only forward whitelisted keys — never let an arbitrary column patch through.
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (k in body) patch[k] = body[k];
  if (Object.keys(patch).length === 0) {
    return c.json({ ok: false, error: 'No editable fields were provided.' }, 400);
  }
  const rpc = await userClient(c).rpc('admin_update_agency', { p_agency_id: id, p_patch: patch });
  return handleRpc(c, 'update-details', rpc);
});

// ─── GET /api/v1/admin/agencies/:id/invitations — staff list of the agency's invites ──
route.get('/:id/invitations', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ ok: false, error: 'That agency could not be found.' }, 404);
  const rpc = await userClient(c).rpc('admin_list_agency_invitations', { p_agency_id: id });
  return handleRpc(c, 'invitations', rpc);
});

// ─── POST /api/v1/admin/agencies/:id/invitations/:invitationId/revoke — staff revoke (soft) ──
// Uses the existing admin_revoke_invitation RPC (marks revoked_at; does NOT delete the row).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
route.post('/:id/invitations/:invitationId/revoke', async (c) => {
  const invitationId = c.req.param('invitationId');
  // The RPC param is uuid — a malformed id would 500 on the cast; return a clean 404 instead.
  if (!invitationId || !UUID_RE.test(invitationId)) {
    return c.json({ ok: false, error: 'That invitation could not be found.' }, 404);
  }
  const rpc = await userClient(c).rpc('admin_revoke_invitation', { p_invitation_id: invitationId });
  return handleRpc(c, 'revoke-invitation', rpc);
});

export default route;
