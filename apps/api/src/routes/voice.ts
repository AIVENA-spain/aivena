import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

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
        EXISTS (
          SELECT 1 FROM provider_accounts pa
           WHERE pa.agency_id = current_setting('app.current_agency_id', true)
             AND pa.provider_type = 'twilio_whatsapp'
             AND COALESCE(pa.status, '') <> 'disabled'
        )                                                                          AS provider_live
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

export default route;
