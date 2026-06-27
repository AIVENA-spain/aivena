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

// ---------------------------------------------------------------------------
// GET /readiness — provider-approval readiness for the authed agency.
//
// Fronts get_whatsapp_provider_readiness() (SECURITY DEFINER, granted to aivena_app).
// agencyContextMiddleware has already set app.current_agency_id on this tx, so the RPC
// reads the tenant fence server-side — the agency is NEVER taken from the client.
// Law-2: on any failure (agency_context_unset / agency_not_found / contract drift / 5xx)
// we return ONLY the friendly envelope and log the real cause server-side.
// ---------------------------------------------------------------------------

const KeyLang = z.object({ template_key: z.string(), language: z.string() });

// B3 contract (Chat 3 main): "approved" = PROVIDER-VERIFIED (provider_status='approved' AND
// provider_synced_at NOT NULL), never the hand seed; "unknown" = not yet reconciled (synced_at
// NULL). The count is informational — `closed_window_template_ready` is the usability gate and
// stays false without sender readiness. `provider_truth_verified` = resolved set fully provider-backed.
export const WhatsAppReadinessSchema = z.object({
  ok: z.literal(true),
  agency_id: z.string(),
  whatsapp_sender_ready: z.boolean(),
  whatsapp_channel_enabled: z.boolean(),
  templates_provider_approved: z.object({ count: z.number().int(), items: z.array(KeyLang) }),
  templates_provider_unknown: z.object({ count: z.number().int(), items: z.array(KeyLang) }),
  languages_ready: z.array(z.string()),
  languages_pending: z.array(z.string()),
  closed_window_template_ready: z.boolean(),
  provider_truth_verified: z.boolean(),
  last_provider_sync_at: z.string().datetime({ offset: true }).nullable(),
  template_send_path_proven: z.boolean(),
});

export type WhatsAppReadiness = z.infer<typeof WhatsAppReadinessSchema>;

export const READINESS_UNAVAILABLE = {
  ok: false as const,
  error: 'whatsapp_readiness_unavailable',
  message:
    'Could not load WhatsApp status. Please refresh, and contact support if it persists.',
};

route.get('/readiness', async (c) => {
  const tx = c.get('tx');
  try {
    const result = await tx.execute(
      sql`SELECT public.get_whatsapp_provider_readiness() AS readiness`,
    );
    const rows = result as unknown as Array<{ readiness: unknown }>;
    const raw = rows[0]?.readiness;
    // jsonb arrives as an object via postgres-js, but tolerate a string just in case.
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const parsed = WhatsAppReadinessSchema.safeParse(obj);
    if (!parsed.success) {
      // ok:false envelopes (agency_context_unset / agency_not_found) fail the literal(true)
      // check and land here too — exactly what we want: never leak the raw cause.
      console.error(
        '[whatsapp/readiness] unavailable:',
        (obj as { error?: unknown } | null)?.error ?? parsed.error.flatten(),
      );
      return c.json(READINESS_UNAVAILABLE, 503);
    }
    return c.json(parsed.data);
  } catch (err) {
    console.error('[whatsapp/readiness] failed:', err);
    return c.json(READINESS_UNAVAILABLE, 503);
  }
});

export default route;
