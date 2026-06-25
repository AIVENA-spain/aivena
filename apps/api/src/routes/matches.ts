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

// GET /:leadId/explanation?propertyId=<uuid> — honest "why matched" per-dimension
// + per-feature explanation for a lead's matches (Day-2 Client Intelligence).
// Read-only via dashboard_match_explanation (SECURITY INVOKER, STABLE), which is
// RLS-fenced by app.current_agency_id and returns its own { ok, ... } envelope:
// a missing/foreign lead comes back as { ok:false, error:'lead_not_found' }. We
// surface that as a calm message and NEVER leak the raw code (Law 2).
//
// Declared BEFORE GET /:leadId so the more specific two-segment path wins.
route.get('/:leadId/explanation', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!leadId || !UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  // Optional single-card focus. An invalid value is ignored (treated as "all").
  const propertyIdRaw = c.req.query('propertyId') ?? '';
  const propertyId = UUID_RE.test(propertyIdRaw) ? propertyIdRaw : null;

  try {
    const result = await tx.execute(
      sql`SELECT dashboard_match_explanation(${leadId}::uuid, ${propertyId}::uuid) AS result`,
    );
    const rows = result as unknown as Array<{ result: unknown }>;
    const payload = rows[0]?.result as
      | { ok?: boolean; error?: string; [k: string]: unknown }
      | null
      | undefined;

    if (payload && payload.ok === true) {
      return c.json(payload);
    }
    // The only business error the RPC raises is lead_not_found — map it; never
    // surface the raw code.
    const code = payload && typeof payload.error === 'string' ? payload.error : '';
    if (code === 'lead_not_found') {
      return c.json({ ok: false, error: "Couldn't load this lead's match details." }, 404);
    }
    console.error('[matches/explanation] unmapped RPC result:', payload);
    return c.json({ ok: false, error: FRIENDLY }, 422);
  } catch (err) {
    console.error('[matches/explanation] read failed:', err);
    return c.json({ ok: false, error: 'Could not load match details.' }, 500);
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
