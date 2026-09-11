import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../../packages/db/client';
import { correctedOutboundKind, originOf, sentLabel, type OutboundOrigin } from '../lib/outbound-origin';
import { safeErr } from '../lib/safe-error';

const route = new Hono();

/**
 * Overview RPC wrappers.
 *
 * Each handler runs inside the agency-context transaction opened by
 * agencyContextMiddleware (RLS scoped via `app.current_agency_id`). The RPCs
 * themselves were built by Vega and tested in Supabase; we just hand off the
 * agency-scoped tx to PostgreSQL.
 *
 * If `aivena_app` doesn't have EXECUTE on a function yet, this surfaces as
 * a Postgres permission error → the handler returns 500 with a generic
 * message. The technical detail is logged server-side only; the dashboard
 * translates it into a calm "Something went wrong" message.
 */

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = parseInt(value ?? '', 10);
  if (Number.isNaN(n) || n < min) return fallback;
  return Math.min(n, max);
}

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

type OriginRow = { id: string; requested_by: string | null };

/**
 * Who asked for a set of messages (send_queue.requested_by — see lib/outbound-origin.ts), read in its
 * own savepoint: the request is one agency-context transaction, so an un-savepointed failure would
 * abort it. A failure returns null and the caller degrades honestly — it never guesses "automatic".
 */
async function readOrigins(tx: Tx, query: ReturnType<typeof sql>): Promise<Map<string, OutboundOrigin> | null> {
  try {
    return await tx.transaction(async (sp) => {
      const rows = (await (sp as unknown as Tx).execute(query)) as unknown as OriginRow[];
      return new Map(rows.map((r) => [r.id, originOf(r.requested_by)]));
    });
  } catch (err) {
    console.error('[/api/v1/overview] message-origin lookup skipped:', safeErr(err));
    return null;
  }
}

/** Who asked for the message behind each followup_sent event. */
function originsByEvent(tx: Tx, eventIds: string[]): Promise<Map<string, OutboundOrigin> | null> {
  if (eventIds.length === 0) return Promise.resolve(new Map());
  return readOrigins(tx, sql`
    SELECT le.id::text AS id, sq.requested_by
      FROM lead_events le
      JOIN conversation_messages cm
        ON cm.provider_message_id = le.external_message_id AND cm.agency_id = le.agency_id
      LEFT JOIN send_queue sq ON sq.id = cm.send_queue_id
     WHERE le.agency_id = current_setting('app.current_agency_id', true)
       AND le.id = ANY(string_to_array(${eventIds.join(',')}, ',')::uuid[])
  `);
}

/** Who asked for each lead's latest outbound message. */
function lastOutboundOriginByLead(tx: Tx, leadIds: string[]): Promise<Map<string, OutboundOrigin> | null> {
  if (leadIds.length === 0) return Promise.resolve(new Map());
  return readOrigins(tx, sql`
    SELECT DISTINCT ON (cm.lead_id) cm.lead_id::text AS id, sq.requested_by
      FROM conversation_messages cm
      LEFT JOIN send_queue sq ON sq.id = cm.send_queue_id
     WHERE cm.agency_id = current_setting('app.current_agency_id', true)
       AND cm.direction = 'outbound'
       AND cm.lead_id = ANY(string_to_array(${leadIds.join(',')}, ',')::uuid[])
     ORDER BY cm.lead_id, cm.created_at DESC
  `);
}

type NeedsYouRow = {
  task_id: string;
  lead_id: string;
  full_name: string | null;
  lead_type: string | null;
  area: string | null;
  source: string | null;
  channel: string | null;
  language: string | null;
  lead_status: string | null;
  temperature: string | null;
  score: number | null;
  ai_reply_subject: string | null;
  ai_reply_body: string | null;
  priority: string;
  task_created_at: Date | string;
  whatsapp_window_open: boolean | null;
  last_inbound_whatsapp_at: Date | string | null;
};

type ActivityRow = {
  event_id: string;
  lead_id: string | null;
  full_name: string | null;
  event_type: string;
  label: string;
  channel: string | null;
  occurred_at: Date | string;
};

type DashboardInboxRow = {
  task_id: string;
  lead_id: string;
  conversation_id: string | null;
  full_name: string | null;
  channel: string | null;
  language: string | null;
  temperature: string | null;
  lead_status: string | null;
  task_status: string | null;
  bucket: string | null;
  ai_reply_subject: string | null;
  ai_reply_body: string | null;
  priority: string;
  created_at: Date | string;
  handled_at: Date | string | null;
  handled_by: string | null;
  age_seconds: number | null;
  latest_inbound_preview: string | null;
  latest_inbound_at: Date | string | null;
  last_outbound_kind: string | null;
  last_outbound_at: Date | string | null;
  lead_type: string | null;
  area: string | null;
  source: string | null;
  score: number | null;
};

route.get('/kpis', async (c) => {
  const tx = c.get('tx');
  const periodDays = clampInt(c.req.query('period_days'), 7, 1, 365);

  try {
    const result = await tx.execute(sql`
      SELECT dashboard_overview_kpis(${periodDays}::int) AS kpis
    `);
    const rows = result as unknown as Array<{ kpis: unknown }>;
    return c.json(rows[0]?.kpis ?? null);
  } catch (err) {
    console.error('[/api/v1/overview/kpis] RPC failed:', err);
    return c.json({ error: 'Failed to load KPIs' }, 500);
  }
});

route.get('/needs-you', async (c) => {
  const tx = c.get('tx');
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);

  try {
    const result = await tx.execute(sql`
      SELECT * FROM dashboard_needs_you(${limit}::int)
    `);
    const rows = result as unknown as NeedsYouRow[];
    return c.json({
      rows: rows.map((r) => ({
        taskId: r.task_id,
        leadId: r.lead_id,
        fullName: r.full_name,
        leadType: r.lead_type,
        area: r.area,
        source: r.source,
        channel: r.channel,
        language: r.language,
        leadStatus: r.lead_status,
        temperature: r.temperature,
        score: r.score,
        aiReplySubject: r.ai_reply_subject,
        aiReplyBody: r.ai_reply_body,
        priority: r.priority,
        taskCreatedAt: toIso(r.task_created_at) ?? '',
        whatsappWindowOpen: r.whatsapp_window_open,
        lastInboundWhatsappAt: toIso(r.last_inbound_whatsapp_at),
      })),
    });
  } catch (err) {
    console.error('[/api/v1/overview/needs-you] RPC failed:', err);
    return c.json({ error: 'Failed to load needs-you' }, 500);
  }
});

route.get('/inbox', async (c) => {
  const tx = c.get('tx');
  const limit = clampInt(c.req.query('limit'), 100, 1, 200);
  const days = clampInt(c.req.query('days'), 30, 1, 365);

  try {
    const result = await tx.execute(sql`
      SELECT * FROM dashboard_inbox(${limit}::int, ${days}::int)
    `);
    const rows = result as unknown as DashboardInboxRow[];
    // dashboard_inbox maps every followup_sent to 'auto', but the send path writes followup_sent for
    // EVERY delivered message — a reply a person sent ("Answer it" → operator_custom_reply) would read
    // "Auto-handled". Correct it from send_queue.requested_by; if that can't be read, keep the RPC's answer.
    const autoLeads = [...new Set(rows.filter((r) => r.last_outbound_kind === 'auto').map((r) => r.lead_id))];
    const kindOrigins = await lastOutboundOriginByLead(tx, autoLeads);
    return c.json({
      rows: rows.map((r) => ({
        taskId: r.task_id,
        leadId: r.lead_id,
        conversationId: r.conversation_id,
        fullName: r.full_name,
        channel: r.channel,
        language: r.language,
        temperature: r.temperature,
        leadStatus: r.lead_status,
        taskStatus: r.task_status,
        bucket: r.bucket,
        aiReplySubject: r.ai_reply_subject,
        aiReplyBody: r.ai_reply_body,
        priority: r.priority,
        // dashboard_inbox exposes the task's created_at as `created_at`; the
        // dashboard keeps the `taskCreatedAt` name it already renders against.
        taskCreatedAt: toIso(r.created_at) ?? '',
        handledAt: toIso(r.handled_at),
        handledBy: r.handled_by,
        ageSeconds: r.age_seconds,
        latestInboundPreview: r.latest_inbound_preview,
        latestInboundAt: toIso(r.latest_inbound_at),
        lastOutboundKind: correctedOutboundKind(r.last_outbound_kind, kindOrigins?.get(r.lead_id)),
        lastOutboundAt: toIso(r.last_outbound_at),
        leadType: r.lead_type,
        area: r.area,
        source: r.source,
        score: r.score,
      })),
    });
  } catch (err) {
    console.error('[/api/v1/overview/inbox] RPC failed:', err);
    return c.json({ error: 'Failed to load inbox' }, 500);
  }
});

route.get('/performance', async (c) => {
  const tx = c.get('tx');
  // Optional ISO date params passed straight through; omitted → the RPC
  // defaults to current week-to-date (Mon→today, Europe/Madrid).
  const from = c.req.query('from') ?? null;
  const to = c.req.query('to') ?? null;

  try {
    const result = await tx.execute(sql`
      SELECT dashboard_performance(${from}::date, ${to}::date) AS perf
    `);
    const rows = result as unknown as Array<{ perf: unknown }>;
    return c.json(rows[0]?.perf ?? null);
  } catch (err) {
    console.error('[/api/v1/overview/performance] RPC failed:', err);
    return c.json({ error: 'Failed to load performance' }, 500);
  }
});

route.get('/recent-activity', async (c) => {
  const tx = c.get('tx');
  const limit = clampInt(c.req.query('limit'), 20, 1, 100);

  try {
    const result = await tx.execute(sql`
      SELECT * FROM dashboard_recent_activity(${limit}::int)
    `);
    const rows = result as unknown as ActivityRow[];
    // followup_sent is written for EVERY delivered WhatsApp message, whoever asked for it, and the RPC
    // labels them all "Auto-reply sent". Label each by who actually requested it; if that can't be read,
    // say "WhatsApp message sent" rather than guess "automatic".
    const origins = await originsByEvent(
      tx,
      rows.filter((r) => r.event_type === 'followup_sent').map((r) => r.event_id),
    );
    return c.json({
      rows: rows.map((r) => ({
        eventId: r.event_id,
        leadId: r.lead_id,
        fullName: r.full_name,
        eventType: r.event_type,
        label: r.event_type === 'followup_sent' ? sentLabel(origins?.get(r.event_id) ?? 'unknown') : r.label,
        channel: r.channel,
        excerpt: (r as Record<string, unknown>).excerpt ?? null,
        excerptTranslated: (r as Record<string, unknown>).excerpt_translated ?? null,
        occurredAt: toIso(r.occurred_at) ?? '',
      })),
    });
  } catch (err) {
    console.error('[/api/v1/overview/recent-activity] RPC failed:', err);
    return c.json({ error: 'Failed to load activity' }, 500);
  }
});

export default route;
