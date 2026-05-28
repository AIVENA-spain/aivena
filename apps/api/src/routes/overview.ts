import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

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
        lastOutboundKind: r.last_outbound_kind,
        lastOutboundAt: toIso(r.last_outbound_at),
      })),
    });
  } catch (err) {
    console.error('[/api/v1/overview/inbox] RPC failed:', err);
    return c.json({ error: 'Failed to load inbox' }, 500);
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
    return c.json({
      rows: rows.map((r) => ({
        eventId: r.event_id,
        leadId: r.lead_id,
        fullName: r.full_name,
        eventType: r.event_type,
        label: r.label,
        channel: r.channel,
        occurredAt: toIso(r.occurred_at) ?? '',
      })),
    });
  } catch (err) {
    console.error('[/api/v1/overview/recent-activity] RPC failed:', err);
    return c.json({ error: 'Failed to load activity' }, 500);
  }
});

export default route;
