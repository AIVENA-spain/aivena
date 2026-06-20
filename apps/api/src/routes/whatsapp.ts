import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * WhatsApp re-engagement — the closed-window path.
 *
 * Outside WhatsApp's 24h window the freeform composer is dead (approve/send raise
 * `whatsapp_window_closed`). The only WhatsApp-legal way to re-engage is an
 * approved template; sending `agency_followup_v1` re-opens the 24h window. This
 * route fronts Vega's `send_reengagement_template` RPC (SECURITY INVOKER — runs
 * under the agency + role GUCs that agencyContextMiddleware already sets on the
 * request tx, so require_role('agent') and the tenant fence both resolve).
 *
 * Law-2: the RPC's P0001 raise tokens are mapped to friendly copy here; the raw
 * code / SQL / table / Twilio detail NEVER leaves the server.
 *
 * Paths (mounted at /api/v1/whatsapp):
 *   POST /reengage          { lead_id }   send_reengagement_template
 *   GET  /reengage-preview  ?lead_id=     rendered agency_followup_v1 body (matches the RPC's render)
 *
 * NOT here: the DB RPC (Vega), the Send-Pusher that drains send_queue (n8n/Vega),
 * the whatsapp-send-execute EF (template mode + failure→`failed` reconcile, v17).
 */
const route = new Hono();

const TEMPLATE_KEY = 'agency_followup_v1';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ReengageBody = z.object({ lead_id: z.string().uuid() });

// Generic fallback for any infra/EF/Twilio/5xx failure (the §5 catch-all row).
const REENGAGE_GENERIC =
  "We couldn't send the check-in message right now — please try again, and contact support if it persists.";

// RPC P0001 raise token → friendly message (Law-2: the raw token never leaves
// this map). All are business rejections → 422.
const REENGAGE_ERROR_MAP: Record<string, string> = {
  lead_not_found: 'Something went wrong — please refresh and try again.',
  lead_opted_out:
    "This contact has opted out of messages, so we can't reach them on WhatsApp.",
  lead_missing_phone: "There's no WhatsApp number on file for this contact.",
  agency_whatsapp_not_configured:
    "WhatsApp isn't connected for your account yet — please contact support.",
  template_not_registered:
    "The check-in message isn't available right now — please contact support.",
  reengagement_cooldown:
    'You already sent a check-in to this contact recently. Give them a little time to reply.',
};

type PgErrorShape = { code: string; message: string };

/** Walk the error chain for a Postgres-shaped error (drizzle wraps it on .cause). */
function asPgError(err: unknown): PgErrorShape | null {
  const SQLSTATE = /^[A-Z0-9]{5}$/;
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur !== 'object') return null;
    const e = cur as Record<string, unknown>;
    const code = typeof e.code === 'string' ? e.code : null;
    const message = typeof e.message === 'string' ? e.message : null;
    if (code && message && SQLSTATE.test(code)) return { code, message };
    cur = e.cause;
  }
  return null;
}

async function readBody(c: import('hono').Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

// POST /reengage { lead_id } — enqueue the approved re-engagement template.
// operatorEmail comes from the verified token, never the client body.
route.post('/reengage', async (c) => {
  const tx = c.get('tx');
  const user = c.get('user');

  const parsed = ReengageBody.safeParse(await readBody(c));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  const leadId = parsed.data.lead_id;
  const operatorEmail = user.email ?? null;

  try {
    const result = await tx.execute(sql`
      SELECT send_queue_id, conversation_message_id, rendered_body
      FROM send_reengagement_template(
        p_lead_id => ${leadId}::uuid,
        p_operator_email => ${operatorEmail}
      )
    `);
    const rows = result as unknown as Array<{
      send_queue_id: string;
      conversation_message_id: string;
      rendered_body: string;
    }>;
    const r = rows[0];
    if (!r?.send_queue_id) {
      console.error('[whatsapp/reengage] RPC returned no row:', leadId);
      return c.json({ ok: false, error: REENGAGE_GENERIC }, 500);
    }
    return c.json({
      ok: true,
      send_queue_id: r.send_queue_id,
      conversation_message_id: r.conversation_message_id,
      rendered_body: r.rendered_body,
    });
  } catch (err) {
    const pg = asPgError(err);
    const mapped =
      pg && pg.code === 'P0001'
        ? REENGAGE_ERROR_MAP[pg.message.trim()]
        : undefined;
    if (mapped) {
      return c.json({ ok: false, error: mapped, code: pg!.message.trim() }, 422);
    }
    console.error('[whatsapp/reengage] failed:', leadId, pg ?? err);
    return c.json({ ok: false, error: REENGAGE_GENERIC }, 500);
  }
});

// GET /reengage-preview?lead_id= — the rendered agency_followup_v1 body so the
// operator sees exactly what will be sent. Renders the SAME way the RPC does
// (template body, {{1}}→buyer first name, {{2}}→agency_settings.agency_name) so
// the preview matches the actual send. RLS-fenced via the leads row.
route.get('/reengage-preview', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.query('lead_id') ?? '';
  if (!UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT replace(
               replace(
                 COALESCE(t.components->>'body', ''),
                 '{{1}}',
                 COALESCE(NULLIF(split_part(COALESCE(l.full_name, ''), ' ', 1), ''), 'there')
               ),
               '{{2}}',
               COALESCE(s.agency_name, '')
             ) AS body
      FROM public.leads l
      LEFT JOIN public.whatsapp_templates t
        ON t.agency_id = l.agency_id
       AND t.template_key = ${TEMPLATE_KEY}
       AND t.status = 'approved'
      LEFT JOIN public.agency_settings s ON s.agency_id = l.agency_id
      WHERE l.id = ${leadId}::uuid
      LIMIT 1
    `);
    const rows = result as unknown as Array<{ body: string | null }>;
    // Empty body = template not registered / lead not visible → null (the FE
    // shows a calm fallback, never an empty preview box). Send still validates.
    const body = rows[0]?.body?.trim() || null;
    return c.json({ ok: true, template_key: TEMPLATE_KEY, body });
  } catch (err) {
    console.error('[whatsapp/reengage-preview] failed:', leadId, err);
    return c.json({ ok: false, error: REENGAGE_GENERIC }, 500);
  }
});

export default route;
