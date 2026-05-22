import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

const route = new Hono();

type TaskRow = {
  id: string;
  task_type: string;
  status: string;
  message_subject: string | null;
  message_body: string | null;
  created_at: Date | string;
  lead_id: string;
  full_name: string | null;
  email: string | null;
  language_detected: string | null;
  source: string | null;
  source_type: string | null;
  score: number | null;
  temperature: string | null;
  intent: string | null;
  conversation_id: string | null;
  reasoning_summary: string | null;
};

route.get('/', async (c) => {
  const tx = c.get('tx');
  const taskType = c.req.query('type') ?? 'suggested_reply';
  const status = c.req.query('status') ?? 'pending';

  // RLS on dashboard_tasks scopes to current_agency_id automatically.
  const result = await tx.execute(sql`
    SELECT
      dt.id,
      dt.task_type,
      dt.status,
      dt.message_subject,
      dt.message_body,
      dt.created_at,
      l.id                  AS lead_id,
      l.full_name,
      l.email,
      l.language_detected,
      l.source,
      l.source_type,
      l.score,
      l.temperature,
      l.intent,
      l.conversation_id,
      l.reasoning_summary
    FROM public.dashboard_tasks dt
    JOIN public.leads l ON l.id = dt.lead_id
    WHERE dt.task_type = ${taskType}
      AND dt.status = ${status}
    ORDER BY dt.created_at DESC
  `);

  const rows = result as unknown as TaskRow[];

  const tasks = rows.map((r) => ({
    id: r.id,
    taskType: r.task_type,
    status: r.status,
    subject: r.message_subject,
    body: r.message_body ?? '',
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
    conversationId: r.conversation_id,
    lead: {
      id: r.lead_id,
      fullName: r.full_name,
      email: r.email,
      language: r.language_detected,
      source: r.source,
      sourceType: r.source_type,
      score: r.score,
      temperature: r.temperature,
      intent: r.intent,
      listingId: null,
      summary: r.reasoning_summary,
    },
  }));

  return c.json({ tasks });
});

export default route;
