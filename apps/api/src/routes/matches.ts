import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Matches (W20 reverse-prospecting, read-only). Two SECURITY INVOKER RPCs,
 * RLS-fenced by app.current_agency_id (set per-request by
 * agencyContextMiddleware), do all the work — this route only reads:
 *
 *   GET /            → get_leads_with_matches()   (scored buyers with ≥1 match)
 *   GET /:leadId     → get_lead_matches(lead, n)  (top properties for one lead)
 *
 * No writes, no recompute. The RPCs already scope to the caller's agency, so a
 * foreign/unknown leadId simply returns zero rows ({ ok:true, data:[] }) — that
 * is a valid empty result, NOT an error. Law 2: any throw collapses to ONE calm
 * message; raw SQL / table / status / stack never leaves the server.
 */
const route = new Hono();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRIENDLY =
  'Something went wrong loading matches. Please refresh, and contact support if it persists.';

// GET / — all scored buyers in the agency that have at least one property match.
route.get('/', async (c) => {
  const tx = c.get('tx');
  try {
    const result = await tx.execute(sql`SELECT * FROM get_leads_with_matches()`);
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[matches/list] read failed:', err);
    return c.json({ ok: false, error: FRIENDLY }, 500);
  }
});

// GET /:leadId?limit=5 — top property matches for a single lead.
route.get('/:leadId', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!leadId || !UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }

  // Clamp limit to an int in 1..20 (default 5). Anything non-numeric → default.
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(20, Math.max(1, rawLimit))
    : 5;

  try {
    const result = await tx.execute(
      sql`SELECT * FROM get_lead_matches(${leadId}::uuid, ${limit})`,
    );
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[matches/byLead] read failed:', err);
    return c.json({ ok: false, error: FRIENDLY }, 500);
  }
});

export default route;
