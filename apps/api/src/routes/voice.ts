import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// agent_send_voice_recovery `reason` → { friendly message, http status }. Law-2:
// the raw token never leaves this map. Pure + exported so it's unit-tested with no
// DB. A missing/unknown reason → the calm generic 500.
const RECOVERY_SEND_GENERIC =
  "We couldn't send the text-back right now — please try again, and contact support if it persists.";
const RECOVERY_REASON_MAP: Record<string, { msg: string; status: 404 | 409 | 422 }> = {
  call_not_found: { msg: "Couldn't find that call — please refresh and try again.", status: 404 },
  not_missed: { msg: 'That call was answered — there is no missed-call text-back to send.', status: 422 },
  already_sent: { msg: 'A text-back has already been sent for this call.', status: 409 },
  no_contact: { msg: "There's no phone number on this call to text back.", status: 422 },
  opted_out: { msg: "This contact has opted out of messages, so we can't text them.", status: 422 },
  no_whatsapp_provider: { msg: "WhatsApp sending isn't connected yet — this will send once it is.", status: 422 },
  no_template: { msg: "The missed-call text-back message isn't approved yet — this will send once it is.", status: 422 },
};

export function classifyRecoverySend(
  reason: unknown,
): { error: string; status: 404 | 409 | 422 | 500 } {
  const mapped = typeof reason === 'string' ? RECOVERY_REASON_MAP[reason] : undefined;
  if (mapped) return { error: mapped.msg, status: mapped.status };
  return { error: RECOVERY_SEND_GENERIC, status: 500 };
}

/**
 * Voice / missed-call recovery read surface (P2-A). Read-only. Powers the dashboard
 * "Calls" page: the honest readiness state of the missed-call WhatsApp text-back
 * (the exact prerequisites `prepare_voice_recovery` gates on — the flag, an approved
 * `voice_recovery` template, and a live WhatsApp provider) plus the recent call log
 * with per-call recovery status. Runs as aivena_app inside the agency-context tx
 * (RLS-scoped). This route NEVER sends or enables anything — it only reports.
 */
const route = new Hono();

// GET /api/v1/voice/recovery-status — { readiness, calls }.
route.get('/recovery-status', async (c) => {
  const tx = c.get('tx');
  try {
    // The raw prerequisite facts (the dashboard's pure model turns these into a
    // mode + blockers). Mirrors the gates inside prepare_voice_recovery exactly.
    const readinessRes = await tx.execute(sql`
      SELECT
        COALESCE(s.voice_recovery_whatsapp_enabled, false)                         AS flag_enabled,
        COALESCE(s.voice_recovery_template_key, 'voice_recovery')                  AS template_key,
        (s.reply_rules #>> '{dashboard_toggles,auto_whatsapp_recovery}')           AS auto_toggle,
        COALESCE(s.reply_rules #>> '{by_channel,whatsapp}',
                 s.reply_rules #>> '{default_lane}', 'review_first')               AS whatsapp_lane,
        EXISTS (
          SELECT 1 FROM whatsapp_templates wt
           WHERE wt.agency_id = current_setting('app.current_agency_id', true)
             AND wt.template_key = COALESCE(s.voice_recovery_template_key, 'voice_recovery')
             AND wt.status = 'approved'
             AND COALESCE(btrim(wt.provider_template_id), '') <> ''
        )                                                                          AS template_approved,
        -- Provider readiness uses the SAME signal the actual queue-send checks
        -- (agent_send_voice_recovery / send_reengagement_template) so the card and
        -- the send can never disagree: a connected Twilio WhatsApp on agency_settings.
        (s.whatsapp_provider IS NOT DISTINCT FROM 'twilio'
          AND s.whatsapp_from_number IS NOT NULL
          AND s.whatsapp_access_token_connected IS TRUE)                           AS provider_live
      FROM agency_settings s
      WHERE s.agency_id = current_setting('app.current_agency_id', true)
    `);
    const readinessRows = readinessRes as unknown as Array<Record<string, unknown>>;
    // No settings row (unlikely) → everything false, the page shows "not configured".
    const readiness = readinessRows[0] ?? {
      flag_enabled: false,
      template_key: 'voice_recovery',
      auto_toggle: null,
      whatsapp_lane: 'review_first',
      template_approved: false,
      provider_live: false,
    };

    const callsRes = await tx.execute(sql`
      SELECT vc.id,
             vc.status::text     AS status,
             vc.direction,
             vc.from_number,
             vc.lead_id,
             l.full_name         AS lead_name,
             l.opt_in_status     AS lead_opt_in,
             COALESCE(vc.recovery_sent, false) AS recovery_sent,
             vc.created_at,
             vc.started_at
        FROM voice_calls vc
        LEFT JOIN leads l ON l.id = vc.lead_id
       WHERE vc.agency_id = current_setting('app.current_agency_id', true)
       ORDER BY COALESCE(vc.started_at, vc.created_at) DESC
       LIMIT 100
    `);
    const calls = callsRes as unknown as Array<Record<string, unknown>>;

    return c.json({ readiness, calls });
  } catch (err) {
    console.error('[/voice/recovery-status] read failed:', err);
    return c.json({ error: 'Failed to load call recovery status' }, 500);
  }
});

// POST /api/v1/voice/calls/:id/send-recovery — the approval-first "send text-back"
// action. Calls agent_send_voice_recovery (agent-authorized; NOT the auto flag/K2
// path). It enqueues the WhatsApp text-back when the provider + template exist, and
// otherwise returns the exact reason (e.g. no WhatsApp provider yet). It never sends
// directly — the send_queue drain (n8n/EF) performs the Twilio send.
route.post('/calls/:id/send-recovery', async (c) => {
  const tx = c.get('tx');
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) {
    return c.json({ ok: false, error: 'A valid call id is required.' }, 400);
  }
  // operatorEmail comes from the verified token, never the client body.
  const user = c.get('user');
  const operatorEmail = user?.email ?? null;
  try {
    const result = await tx.execute(sql`
      SELECT public.agent_send_voice_recovery(${id}::uuid, ${operatorEmail}) AS result
    `);
    const rows = result as unknown as Array<{ result: { sent?: boolean; reason?: string } }>;
    const payload = rows[0]?.result ?? {};
    if (payload.sent === true) {
      return c.json({ ok: true });
    }
    const { error, status } = classifyRecoverySend(payload.reason);
    if (status === 500) console.error('[/voice send-recovery] unmapped reason:', payload);
    return c.json({ ok: false, error }, status);
  } catch (err) {
    console.error('[/voice send-recovery] failed:', id, err);
    return c.json({ ok: false, error: RECOVERY_SEND_GENERIC }, 500);
  }
});

export default route;
