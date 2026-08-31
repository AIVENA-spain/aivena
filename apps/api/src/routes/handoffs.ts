import { Hono } from 'hono';
import { isShapeOnly } from '../amanda-engine/validators';
import { sql } from 'drizzle-orm';

/**
 * Human handoffs (Amanda Live L1) — the dashboard's "Needs a human" queue.
 *
 * A website visitor who asks for a person flags their lead needs-human (AI muted
 * via ai_autoreply_blocked until an agent releases it). These authenticated,
 * RLS-fenced routes let agents see the queue, claim a handoff (first click wins),
 * and release the lead back to the assistant. NO send happens here — the actual
 * client contact is WhatsApp/phone/email, gated elsewhere (Phase C).
 *
 *   GET  /                  → get_human_handoff_queue()      (oldest wait first)
 *   POST /:leadId/claim     → claim_human_handoff(lead, operator)
 *   POST /:leadId/release   → release_human_handoff(lead, operator)
 *
 * Law 2: any throw collapses to ONE calm message; raw SQL never leaves the server.
 */
const route = new Hono();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRIENDLY = 'Something went wrong with the handoff queue. Please refresh, and contact support if it persists.';

// GET / — open human requests for this agency, oldest wait first.
route.get('/', async (c) => {
  const tx = c.get('tx');
  try {
    const result = await tx.execute(sql`SELECT * FROM public.get_human_handoff_queue()`);
    const rows = result as unknown as Array<Record<string, unknown>>;
    // Enrich with WHY Amanda stopped (Christian 2026-08-30: the card "just says
    // exactly what i wrote from martes phone ... even if a agent wanted to
    // answer that they dont know which proeprty its about either"). The open
    // review task already holds the buyer's question, the properties in play
    // and the reply Amanda wanted to send; carrying them here turns the card
    // from a nudge into something answerable in one read. Read-only, no
    // migration, and a failure degrades to the plain card.
    try {
      const ctxRows = (await tx.execute(sql`
        SELECT DISTINCT ON (lead_id)
               lead_id,
               raw_payload->>'buyer_asked'   AS buyer_asked,
               raw_payload->>'blocked_draft' AS blocked_draft,
               raw_payload->>'gate_detail'   AS gate_detail,
               raw_payload->'property_refs'  AS property_refs
          FROM dashboard_tasks
         WHERE agency_id = current_setting('app.current_agency_id', true)
           AND task_type = 'human_review_needed'
           AND status = 'pending'
         ORDER BY lead_id, created_at DESC
      `)) as unknown as Array<Record<string, unknown>>;
      const byLead = new Map(ctxRows.map((r) => [String(r.lead_id), r]));
      for (const r of rows) {
        const extra = byLead.get(String(r.lead_id));
        if (!extra) continue;
        r.buyer_asked = extra.buyer_asked ?? null;
        r.blocked_draft = extra.blocked_draft ?? null;
        // WHY it was blocked decides whether that draft is safe to pre-fill.
        // A draft stopped for being too long is fine to send as it stands; a
        // draft stopped by the fact-check is stopped BECAUSE it is wrong, and
        // pre-filling it invites the agent to send the very thing the gate
        // caught — tonight it would have told a buyer Wednesday was "tomorrow"
        // (2026-08-31). Shape-only failures stay pre-fillable; anything else is
        // shown as a warning and the box starts empty.
        const detail = String(extra.gate_detail ?? '');
        r.draft_failed_fact_check = detail.length > 0 && !isShapeOnly(detail.split(/,\s*/));
        r.property_refs = extra.property_refs ?? null;
      }
    } catch (ctxErr) {
      console.error('[handoffs/list] context enrich skipped:', ctxErr);
    }
    return c.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[handoffs/list] read failed:', err);
    return c.json({ ok: false, error: FRIENDLY }, 500);
  }
});

// POST /:leadId/claim — any available agent takes it; first click wins.
route.post('/:leadId/claim', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  // Operator identity comes from the verified token, never the client body.
  const user = c.get('user');
  const operator = user?.email ?? 'agent';
  try {
    const result = await tx.execute(sql`
      SELECT * FROM public.claim_human_handoff(${leadId}::uuid, ${operator})
    `);
    const rows = result as unknown as Array<{ ok: boolean; claimed_by: string | null }>;
    const r = rows[0];
    if (r?.ok) return c.json({ ok: true, claimedBy: r.claimed_by });
    return c.json(
      { ok: false, error: r?.claimed_by ? `Already claimed by ${r.claimed_by}.` : 'This request is no longer open.', claimedBy: r?.claimed_by ?? null },
      409,
    );
  } catch (err) {
    console.error('[handoffs/claim] failed:', err);
    return c.json({ ok: false, error: FRIENDLY }, 500);
  }
});

// POST /:leadId/release — hand the conversation back to the assistant (un-mutes AI).
route.post('/:leadId/release', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  const user = c.get('user');
  const operator = user?.email ?? 'agent';
  try {
    const result = await tx.execute(sql`
      SELECT public.release_human_handoff(${leadId}::uuid, ${operator}) AS ok
    `);
    const rows = result as unknown as Array<{ ok: boolean }>;
    if (rows[0]?.ok) return c.json({ ok: true });
    return c.json({ ok: false, error: 'This request is no longer open.' }, 409);
  } catch (err) {
    console.error('[handoffs/release] failed:', err);
    return c.json({ ok: false, error: FRIENDLY }, 500);
  }
});

export default route;
