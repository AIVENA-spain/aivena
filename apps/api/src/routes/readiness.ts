import { Hono } from 'hono';
import { computeReadiness } from '../lib/readiness/compute';
import { gatherReadinessSignals } from '../lib/readiness/gather';

const route = new Hono();

/**
 * Read gate for go-live readiness. Unlike settings' canWriteSettings (which gates
 * WRITES and lets every GET through), readiness is owner/aivena_staff even for GET:
 * the go-live picture is sensitive and admin-facing, so it is method-agnostic.
 * Exported for unit testing the truth table.
 */
const READINESS_READ_ROLES = new Set(['owner', 'aivena_staff']);

export function canReadReadiness(role: string | null | undefined): boolean {
  return !!role && READINESS_READ_ROLES.has(role);
}

route.use('*', async (c, next) => {
  if (!canReadReadiness(c.get('role'))) {
    return c.json(
      { error: "You don't have permission to view go-live readiness — ask an agency owner." },
      403,
    );
  }
  return next();
});

/**
 * GET /api/v1/readiness — read-only, agency-scoped (RLS GUC = agencies.id, never
 * the slug). Computes per-item + per-provider + per-gate status + go-live
 * eligibility from LIVE signals only. No write, no migration, no provider write.
 * Signal-gathering lives in lib/readiness/gather (shared with the admin go-live
 * recompute); WhatsApp is consumed from Chat 3's RPC and degrades honestly.
 */
route.get('/', async (c) => {
  const signals = await gatherReadinessSignals(c.get('tx'));
  const result = computeReadiness(c.get('agencyId'), signals);
  return c.json({ computedAt: new Date().toISOString(), ...result });
});

export default route;
