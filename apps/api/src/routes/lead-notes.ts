import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Lead notes (W4a lead-notes feature). Reads go through a direct SELECT (RLS
 * allows agency-scoped SELECT on lead_notes); writes go through the four
 * SECURITY DEFINER RPCs, which read app.current_agency_id AND app.current_user_id
 * (both set per-request by agencyContextMiddleware). The RPCs RAISE short codes
 * on failure — we map them to friendly messages and NEVER surface the raw code.
 *
 * Paths (mounted at /api/v1/lead-notes):
 *   GET    /?leadId=<uuid>            list notes for a lead (newest first)
 *   POST   /         {leadId, body}   add_lead_note
 *   PATCH  /:noteId  {body}           update_lead_note
 *   DELETE /:noteId                   delete_lead_note
 *   POST   /:noteId/ai-context {contextForAi}  toggle_note_ai_context
 */
const route = new Hono();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RAISE code → { friendly message, http status }. The raw code never leaves
// this map.
const NOTE_ERROR_MAP: Record<string, { msg: string; status: number }> = {
  no_agency_context: { msg: 'Something went wrong — please refresh and try again.', status: 422 },
  no_auth_context: { msg: 'Something went wrong — please refresh and try again.', status: 422 },
  body_empty: { msg: 'Please type a note before saving.', status: 400 },
  context_for_ai_required: { msg: 'Please type a note before saving.', status: 400 },
  lead_not_found: { msg: 'That note could not be found — it may have been removed.', status: 404 },
  note_not_found: { msg: 'That note could not be found — it may have been removed.', status: 404 },
  lead_wrong_agency: { msg: 'Something went wrong — please refresh.', status: 422 },
  note_wrong_agency: { msg: 'Something went wrong — please refresh.', status: 422 },
  require_role: { msg: "You don't have permission to add notes.", status: 403 },
  insufficient_role: { msg: "You don't have permission to add notes.", status: 403 },
};

const GENERIC = 'Something went wrong — please try again, and contact support if it persists.';

type PgErrorShape = { code: string; message: string };

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

/** Map any thrown error to { error, status } with a friendly message only. */
function friendly(err: unknown, scope: string): { error: string; status: 400 | 403 | 404 | 422 | 500 } {
  const pg = asPgError(err);
  const raise = pg?.message?.trim();
  if (raise) {
    const mapped = NOTE_ERROR_MAP[raise];
    if (mapped) return { error: mapped.msg, status: mapped.status as 400 | 403 | 404 | 422 };
    // Heuristic: anything mentioning a role is a permission problem.
    if (/role/i.test(raise)) return { error: "You don't have permission to add notes.", status: 403 };
  }
  console.error(`[lead-notes/${scope}] unmapped error:`, pg ?? err);
  return { error: GENERIC, status: pg ? 422 : 500 };
}

async function readBody(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// GET /?leadId=<uuid> — direct SELECT, RLS-scoped (+ explicit agency filter for
// defence in depth since RLS is the only fence on this read path).
route.get('/', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.query('leadId');
  if (!leadId || !UUID_RE.test(leadId)) {
    return c.json({ error: 'A valid lead id is required.' }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT id, body, author_user_id, context_for_ai, created_at, updated_at
        FROM public.lead_notes
       WHERE lead_id = ${leadId}::uuid
         AND agency_id = current_setting('app.current_agency_id', true)
       ORDER BY created_at DESC
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    return c.json({ notes: rows });
  } catch (err) {
    console.error('[lead-notes/list] read failed:', err);
    return c.json({ error: 'Failed to load notes' }, 500);
  }
});

// POST / {leadId, body} — add_lead_note
route.post('/', async (c) => {
  const tx = c.get('tx');
  const body = await readBody(c);
  const leadId = typeof body.leadId === 'string' ? body.leadId : '';
  const noteBody = typeof body.body === 'string' ? body.body : '';
  if (!UUID_RE.test(leadId)) return c.json({ error: 'A valid lead id is required.' }, 400);
  if (!noteBody.trim()) return c.json({ error: 'Please type a note before saving.' }, 400);
  try {
    const result = await tx.execute(sql`
      SELECT add_lead_note(${leadId}::uuid, ${noteBody}) AS note
    `);
    const rows = result as unknown as Array<{ note: unknown }>;
    return c.json({ ok: true, note: rows[0]?.note ?? null });
  } catch (err) {
    const f = friendly(err, 'add');
    return c.json({ error: f.error }, f.status);
  }
});

// PATCH /:noteId {body} — update_lead_note
route.patch('/:noteId', async (c) => {
  const tx = c.get('tx');
  const noteId = c.req.param('noteId');
  if (!UUID_RE.test(noteId)) return c.json({ error: 'A valid note id is required.' }, 400);
  const body = await readBody(c);
  const noteBody = typeof body.body === 'string' ? body.body : '';
  if (!noteBody.trim()) return c.json({ error: 'Please type a note before saving.' }, 400);
  try {
    const result = await tx.execute(sql`
      SELECT update_lead_note(${noteId}::uuid, ${noteBody}) AS note
    `);
    const rows = result as unknown as Array<{ note: unknown }>;
    return c.json({ ok: true, note: rows[0]?.note ?? null });
  } catch (err) {
    const f = friendly(err, 'update');
    return c.json({ error: f.error }, f.status);
  }
});

// DELETE /:noteId — delete_lead_note
route.delete('/:noteId', async (c) => {
  const tx = c.get('tx');
  const noteId = c.req.param('noteId');
  if (!UUID_RE.test(noteId)) return c.json({ error: 'A valid note id is required.' }, 400);
  try {
    await tx.execute(sql`SELECT delete_lead_note(${noteId}::uuid)`);
    return c.json({ ok: true });
  } catch (err) {
    const f = friendly(err, 'delete');
    return c.json({ error: f.error }, f.status);
  }
});

// POST /:noteId/ai-context {contextForAi} — toggle_note_ai_context
route.post('/:noteId/ai-context', async (c) => {
  const tx = c.get('tx');
  const noteId = c.req.param('noteId');
  if (!UUID_RE.test(noteId)) return c.json({ error: 'A valid note id is required.' }, 400);
  const body = await readBody(c);
  if (typeof body.contextForAi !== 'boolean') {
    return c.json({ error: 'A valid value is required.' }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT toggle_note_ai_context(${noteId}::uuid, ${body.contextForAi}) AS note
    `);
    const rows = result as unknown as Array<{ note: unknown }>;
    return c.json({ ok: true, note: rows[0]?.note ?? null });
  } catch (err) {
    const f = friendly(err, 'toggle');
    return c.json({ error: f.error }, f.status);
  }
});

export default route;
