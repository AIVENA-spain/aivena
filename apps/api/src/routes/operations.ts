import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { WhatsAppReadinessSchema } from './whatsapp';
import {
  computeOperations,
  type OperationsSignals,
  type FailedSendRow,
  type OpenTaskRow,
  type LifecycleRow,
  type WhatsAppOpsSignal,
} from '../lib/operations/compute';

const route = new Hono();

/**
 * GET /api/v1/operations — the command-center / ops read surface (F1 + F2 + F4).
 *
 * READ-ONLY. Aggregates "what needs attention" from LIVE signals only:
 *   - failed/undelivered sends (F2)             ← conversation_messages
 *   - the open action queue, grouped (F2 + F1)  ← dashboard_tasks (pending/open)
 *   - provider health (WhatsApp/email)          ← consumed readiness RPC + config
 *   - lead-lifecycle health / at-risk (F4)      ← dashboard_inbox (derived)
 *
 * Audience: all agency members (same as the inbox/overview it summarises) — this
 * is the daily work queue, NOT the admin-only go-live readiness view. Tenant
 * fencing is the per-request agency-context tx (RLS GUC) + explicit agency_id
 * filters for defence in depth (matching the lead-notes/conversations pattern).
 *
 * Honesty: each signal runs in its OWN savepoint so one missing table/RPC
 * degrades that single signal (→ `available:false` / provider `unavailable`)
 * without aborting the request or faking a state. It never writes or sends.
 */

/**
 * Run one signal query in its own savepoint. The whole request is a single
 * agency-context transaction, so an un-savepointed failure would abort
 * everything. A failure here degrades that one signal to `fallback` and logs.
 */
async function safe<T>(tx: Tx, fn: (sp: Tx) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await tx.transaction(async (sp) => fn(sp as unknown as Tx));
  } catch (err) {
    console.error('[operations] signal degraded:', err instanceof Error ? err.message : err);
    return fallback;
  }
}

const rows = <T>(r: unknown): T[] => r as unknown as T[];
const AGENCY_GUC = sql`current_setting('app.current_agency_id', true)`;
const asJson = (raw: unknown): unknown => (typeof raw === 'string' ? JSON.parse(raw) : raw);

function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

type RawFailed = {
  message_id: string;
  lead_id: string | null;
  lead_name: string | null;
  channel: string | null;
  status: string;
  at: Date | string | null;
  preview: string | null;
};
type RawTask = {
  task_id: string;
  lead_id: string | null;
  lead_name: string | null;
  task_type: string;
  status: string;
  priority: string | null;
  temperature: string | null;
  title: string | null;
  created_at: Date | string | null;
};
type RawLife = {
  lead_id: string;
  lead_name: string | null;
  channel: string | null;
  temperature: string | null;
  task_status: string | null;
  age_seconds: number | null;
  latest_inbound_at: Date | string | null;
  last_outbound_at: Date | string | null;
  lead_status: string | null;
};

route.get('/', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');

  // --- F2: failed/undelivered outbound sends (last 30 days) -----------------
  const failedSends = await safe<FailedSendRow[] | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(sql`
        SELECT cm.id AS message_id,
               cm.lead_id,
               l.full_name AS lead_name,
               cm.message_type AS channel,
               cm.status,
               COALESCE(cm.sent_at, cm.created_at) AS at,
               COALESCE(cm.body_clean, cm.content) AS preview
          FROM public.conversation_messages cm
          LEFT JOIN public.leads l ON l.id = cm.lead_id
         WHERE cm.agency_id = ${AGENCY_GUC}
           AND cm.direction = 'outbound'
           AND cm.status IN ('undelivered', 'failed', 'cancelled')
           AND cm.created_at > now() - interval '30 days'
         ORDER BY COALESCE(cm.sent_at, cm.created_at) DESC
         LIMIT 100
      `);
      return rows<RawFailed>(r).map((x) => ({
        message_id: x.message_id,
        lead_id: x.lead_id,
        lead_name: x.lead_name,
        channel: x.channel,
        status: x.status,
        at: toIso(x.at),
        preview: x.preview,
      }));
    },
    null,
  );

  // --- F2 + F1: the open action queue (pending/open dashboard_tasks) ---------
  const openTasks = await safe<OpenTaskRow[] | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(sql`
        SELECT dt.id AS task_id,
               dt.lead_id,
               l.full_name AS lead_name,
               dt.task_type,
               dt.status,
               dt.priority,
               dt.temperature,
               dt.title,
               dt.created_at
          FROM public.dashboard_tasks dt
          LEFT JOIN public.leads l ON l.id = dt.lead_id
         WHERE dt.agency_id = ${AGENCY_GUC}
           AND dt.status IN ('pending', 'open')
         ORDER BY dt.created_at DESC
         LIMIT 200
      `);
      return rows<RawTask>(r).map((x) => ({
        task_id: x.task_id,
        lead_id: x.lead_id,
        lead_name: x.lead_name,
        task_type: x.task_type,
        status: x.status,
        priority: x.priority,
        temperature: x.temperature,
        title: x.title,
        created_at: toIso(x.created_at),
      }));
    },
    null,
  );

  // --- F4: lead-lifecycle health, derived from the proven inbox RPC ----------
  const lifecycle = await safe<LifecycleRow[] | null>(
    tx,
    async (sp) => {
      const r = await sp.execute(sql`
        SELECT lead_id, full_name AS lead_name, channel, temperature, task_status,
               age_seconds, latest_inbound_at, last_outbound_at, lead_status
          FROM dashboard_inbox(200::int, 30::int)
      `);
      return rows<RawLife>(r).map((x) => ({
        lead_id: x.lead_id,
        lead_name: x.lead_name,
        channel: x.channel,
        temperature: x.temperature,
        task_status: x.task_status,
        age_seconds: x.age_seconds,
        latest_inbound_at: toIso(x.latest_inbound_at),
        last_outbound_at: toIso(x.last_outbound_at),
        lead_status: x.lead_status,
      }));
    },
    null,
  );

  // --- Provider health: WhatsApp consumed from Chat 3's RPC (degrade null) ---
  const whatsapp = await safe<WhatsAppOpsSignal>(
    tx,
    async (sp) => {
      const r = await sp.execute(sql`SELECT public.get_whatsapp_provider_readiness() AS readiness`);
      const parsed = WhatsAppReadinessSchema.safeParse(
        asJson(rows<{ readiness: unknown }>(r)[0]?.readiness),
      );
      if (!parsed.success) return null;
      const w = parsed.data;
      return {
        whatsapp_sender_ready: w.whatsapp_sender_ready,
        whatsapp_channel_enabled: w.whatsapp_channel_enabled,
        template_send_path_proven: w.template_send_path_proven,
        last_provider_sync_at: w.last_provider_sync_at,
      };
    },
    null,
  );

  // --- Email config presence (never reported as verified/connected) ---------
  const email = await safe<{ from_email: string | null; domain_verified: boolean | null } | null>(
    tx,
    async (sp) => {
      // agency_email_config has NO verified-send flag (domain verification lives
      // at the provider, not here) — so domain_verified is always null and email
      // is never reported as "verified"/"connected".
      const r = await sp.execute(
        sql`SELECT from_email
              FROM public.agency_email_config
             WHERE agency_id = ${AGENCY_GUC}
             LIMIT 1`,
      );
      const row = rows<{ from_email: string | null }>(r)[0];
      return { from_email: row?.from_email ?? null, domain_verified: null };
    },
    null,
  );

  const signals: OperationsSignals = {
    failedSends,
    openTasks,
    lifecycle,
    whatsapp,
    email,
    nowMs: Date.now(),
  };

  const result = computeOperations(agencyId, signals);
  return c.json({ computedAt: new Date().toISOString(), ...result });
});

export default route;
