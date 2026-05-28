import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

const route = new Hono();

/**
 * Column-name notes (live schema — source of truth, NOT the Drizzle types):
 *   dashboard_tasks: id, lead_id, conversation_id (TEXT), task_type, status,
 *                    message_subject, message_body, title, description,
 *                    temperature, lead_score, created_at
 *   leads:           id, full_name, email, language, source, source_type,
 *                    score, temperature, intent, listing_id, summary, message
 *   conversation_messages: id, conversation_id (UUID), direction,
 *                          message_type, content, created_at, status, sent_by
 *
 * dashboard_tasks.conversation_id is TEXT, conversation_messages.conversation_id
 * is UUID — we cast the messages column to text when joining so the cast can't
 * fail on malformed values.
 */

type TaskListRow = {
  id: string;
  task_type: string;
  status: string;
  message_subject: string | null;
  message_body: string | null;
  conversation_id: string | null;
  created_at: Date | string;
  lead_id: string;
  full_name: string | null;
  email: string | null;
  language: string | null;
  source: string | null;
  source_type: string | null;
  score: number | null;
  temperature: string | null;
  intent: string | null;
  listing_id: string | null;
  summary: string | null;
};

type TaskDetailRow = TaskListRow & {
  original_message: string | null;
};

type ThreadRow = {
  id: string;
  direction: string;
  message_type: string;
  content: string | null;
  body_clean: string | null;
  created_at: Date | string;
};

type ApproveResultRow = {
  send_queue_id: string;
  conversation_message_id: string;
  final_subject: string | null;
  final_body: string | null;
  was_edited: boolean;
};

const APPROVE_ERROR_MESSAGES: Record<string, string> = {
  task_not_found: 'Task not found.',
  task_wrong_type: "This task can't be approved with this action.",
  task_already_handled: 'This task has already been handled.',
  task_missing_lead: "This task isn't linked to a lead.",
  task_missing_conversation:
    "This reply can't be sent yet — there's no conversation thread for this lead.",
  lead_not_found: 'The lead this task belongs to no longer exists.',
  lead_opted_out: "This lead has opted out, so a reply can't be sent.",
  lead_missing_email: "We don't have an email address for this lead.",
  agency_settings_missing: "Agency settings aren't configured yet.",
  agency_branding_missing: "Agency branding isn't configured yet.",
  final_body_empty: "The message body can't be empty.",
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapTask(r: TaskListRow) {
  return {
    id: r.id,
    taskType: r.task_type,
    status: r.status,
    subject: r.message_subject,
    body: r.message_body ?? '',
    createdAt: toIso(r.created_at),
    conversationId: r.conversation_id,
    lead: {
      id: r.lead_id,
      fullName: r.full_name,
      email: r.email,
      language: r.language,
      source: r.source,
      sourceType: r.source_type,
      score: r.score,
      temperature: r.temperature,
      intent: r.intent,
      listingId: r.listing_id,
      summary: r.summary,
    },
  };
}

type PgErrorShape = { code: string; message: string };

/**
 * Walk an error chain looking for a Postgres-shaped error (string `code`
 * matching a 5-char SQLSTATE, and string `message`).
 *
 * Drizzle 0.45 wraps every error thrown by `tx.execute()` as a
 * `DrizzleQueryError`. The underlying `postgres-js` `PostgresError` — with
 * `.code` and `.message` we want — sits on `.cause`. We walk up to a few
 * levels deep so any future re-wrapping (drizzle, hono, anything) still
 * resolves to the real PG error.
 */
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
    if (code && message && SQLSTATE.test(code)) {
      return { code, message };
    }
    cur = e.cause;
  }
  return null;
}

function isKnownRaise(message: string): boolean {
  return Object.prototype.hasOwnProperty.call(APPROVE_ERROR_MESSAGES, message);
}

function friendlyFor(messageCode: string): string {
  return APPROVE_ERROR_MESSAGES[messageCode] ?? messageCode;
}

// GET /api/v1/tasks — list pending tasks (RLS-scoped to current agency)
route.get('/', async (c) => {
  const tx = c.get('tx');
  const taskType = c.req.query('type') ?? 'suggested_reply';
  const status = c.req.query('status') ?? 'pending';

  const result = await tx.execute(sql`
    SELECT
      dt.id,
      dt.task_type,
      dt.status,
      dt.message_subject,
      dt.message_body,
      dt.conversation_id,
      dt.created_at,
      l.id AS lead_id,
      l.full_name,
      l.email,
      l.language,
      l.source,
      l.source_type,
      l.score,
      l.temperature,
      l.intent,
      l.listing_id,
      l.summary
    FROM public.dashboard_tasks dt
    JOIN public.leads l ON l.id = dt.lead_id
    WHERE dt.task_type = ${taskType}
      AND dt.status = ${status}
    ORDER BY dt.created_at DESC
  `);

  const rows = result as unknown as TaskListRow[];
  return c.json({ tasks: rows.map(mapTask) });
});

// GET /api/v1/tasks/:id — single task with conversation thread
route.get('/:id', async (c) => {
  const tx = c.get('tx');
  const taskId = c.req.param('id');

  const taskResult = await tx.execute(sql`
    SELECT
      dt.id,
      dt.task_type,
      dt.status,
      dt.message_subject,
      dt.message_body,
      dt.conversation_id,
      dt.created_at,
      l.id AS lead_id,
      l.full_name,
      l.email,
      l.language,
      l.source,
      l.source_type,
      l.score,
      l.temperature,
      l.intent,
      l.listing_id,
      l.summary,
      l.message AS original_message
    FROM public.dashboard_tasks dt
    JOIN public.leads l ON l.id = dt.lead_id
    WHERE dt.id = ${taskId}::uuid
    LIMIT 1
  `);

  const taskRows = taskResult as unknown as TaskDetailRow[];
  if (taskRows.length === 0) {
    return c.json({ error: 'Task not found' }, 404);
  }
  const r = taskRows[0];

  let thread: ThreadRow[] = [];
  if (r.conversation_id) {
    const threadResult = await tx.execute(sql`
      SELECT id, direction, message_type, content, body_clean, created_at
      FROM public.conversation_messages
      WHERE conversation_id::text = ${r.conversation_id}
      ORDER BY created_at ASC
    `);
    thread = threadResult as unknown as ThreadRow[];
  }

  const task = mapTask(r);

  return c.json({
    task: {
      id: task.id,
      taskType: task.taskType,
      status: task.status,
      subject: task.subject,
      body: task.body,
      conversationId: task.conversationId,
      createdAt: task.createdAt,
    },
    lead: task.lead,
    originalMessage: r.original_message,
    thread: thread.map((t) => ({
      id: t.id,
      direction: t.direction,
      messageType: t.message_type,
      content: t.content,
      bodyClean: t.body_clean,
      createdAt: toIso(t.created_at),
    })),
  });
});

// POST /api/v1/tasks/:id/approve
route.post('/:id/approve', async (c) => {
  const tx = c.get('tx');
  const user = c.get('user');
  const taskId = c.req.param('id');

  // operatorEmail comes from the verified token — never from the client body.
  const operatorEmail = user.email;

  let body: { editedBody?: unknown; editedSubject?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const editedBody =
    typeof body.editedBody === 'string' ? body.editedBody : null;
  const editedSubject =
    typeof body.editedSubject === 'string' ? body.editedSubject : null;

  try {
    const result = await tx.execute(sql`
      SELECT *
      FROM approve_dashboard_task(
        ${taskId}::uuid,
        ${editedBody},
        ${editedSubject},
        ${operatorEmail}
      )
    `);
    const rows = result as unknown as ApproveResultRow[];
    const r = rows[0];
    if (!r) {
      return c.json({ error: 'Approve function returned no row' }, 500);
    }
    return c.json({
      ok: true,
      sendQueueId: r.send_queue_id,
      conversationMessageId: r.conversation_message_id,
      finalSubject: r.final_subject,
      finalBody: r.final_body,
      wasEdited: Boolean(r.was_edited),
    });
  } catch (err) {
    const pg = asPgError(err);
    if (pg && pg.code === 'P0001' && isKnownRaise(pg.message)) {
      return c.json(
        { error: friendlyFor(pg.message), code: pg.message },
        422,
      );
    }
    throw err;
  }
});

// POST /api/v1/tasks/:id/dismiss
route.post('/:id/dismiss', async (c) => {
  const tx = c.get('tx');
  const user = c.get('user');
  const taskId = c.req.param('id');

  let body: { reason?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return c.json({ error: 'reason is required' }, 400);
  }

  const operatorEmail = user.email;

  try {
    await tx.execute(sql`
      SELECT * FROM dismiss_dashboard_task(
        ${taskId}::uuid,
        ${reason},
        ${operatorEmail}
      )
    `);
    return c.json({ ok: true });
  } catch (err) {
    const pg = asPgError(err);
    if (pg && pg.code === 'P0001') {
      return c.json(
        { error: friendlyFor(pg.message), code: pg.message },
        422,
      );
    }
    throw err;
  }
});

export default route;
