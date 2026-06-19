import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Conversations — read surface for the persistent inbox composer.
 *
 * The only path here is a direct SELECT for the single pending suggested_reply
 * task of a conversation (RLS + an explicit agency filter for defence in depth,
 * matching the lead-notes list pattern). The composer polls this to surface a
 * freshly-drafted AI suggestion after the buyer replies.
 *
 * dashboard_tasks.conversation_id is TEXT — compare as text, never ::uuid cast.
 *
 * Paths (mounted at /api/v1/conversations):
 *   GET /:conversationId/pending-suggestion
 *
 * Suggested-reply SEND/DISMISS reuse the existing POST /api/v1/tasks/:id/approve
 * and /api/v1/tasks/:id/dismiss handlers (approve_dashboard_task /
 * dismiss_dashboard_task) — nothing new here for those.
 */
const route = new Hono();

const GENERIC = 'Something went wrong — please try again.';

type PendingRow = {
  id: string;
  message_body: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: Date | string;
};

// GET /:conversationId/pending-suggestion — the newest pending suggested_reply
// for the conversation, or null. Friendly 500 on throw (never leak detail).
route.get('/:conversationId/pending-suggestion', async (c) => {
  const tx = c.get('tx');
  const conversationId = c.req.param('conversationId');
  if (!conversationId) {
    return c.json({ ok: false, error: 'A valid conversation id is required.' }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT id, message_body, raw_payload, created_at
        FROM public.dashboard_tasks
       WHERE conversation_id = ${conversationId}
         AND agency_id = current_setting('app.current_agency_id', true)
         AND task_type = 'suggested_reply'
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1
    `);
    const rows = result as unknown as PendingRow[];
    const row = rows[0];
    if (!row) {
      return c.json({ ok: true, data: null });
    }
    const payload = row.raw_payload ?? {};
    const aiDraftPending =
      payload.ai_draft_pending === 'true' || payload.ai_draft_pending === true;
    const leadLanguage =
      typeof payload.lead_language === 'string' ? payload.lead_language : null;
    return c.json({
      ok: true,
      data: {
        id: row.id,
        message_body: row.message_body ?? '',
        ai_draft_pending: aiDraftPending,
        lead_language: leadLanguage,
      },
    });
  } catch (err) {
    console.error('[conversations/pending-suggestion] failed:', conversationId, err);
    return c.json({ ok: false, error: GENERIC }, 500);
  }
});

export default route;
