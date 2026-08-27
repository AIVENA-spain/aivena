import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { scrubKnowledge } from '../amanda-engine/knowledge-scrub';
import { parseAmandaMode } from '../amanda-engine/modes';

/**
 * Amanda auto-mode agency surface (design §6 "smallest lovable settings" +
 * the agency-knowledge write half of "our standard and then they can adjust").
 * Mounted at /api/v1/amanda inside the authed agency context (RLS tx).
 *
 * Deliberate boundaries:
 *  - amanda_mode is READ-ONLY here: the dial is promoted by evidence
 *    (design §6), never self-served from settings; changes go through the
 *    gated admin path.
 *  - Knowledge writes pass the deterministic §5 save-time scrubber; a
 *    rejection returns its reason and stores NOTHING. Entries are versioned
 *    by supersession (status flips, rows never deleted — audit trail).
 *  - Ships dark: every query touches Amanda P0 tables that exist only after
 *    the approval-gated migration; the GET degrades to configured:false so
 *    the settings page never breaks pre-migration.
 */
const route = new Hono();

const SETTINGS_KEYS = ['viewing_duration_min', 'viewing_notice_hours', 'timezone'] as const;

route.get('/settings', async (c) => {
  const tx = c.get('tx');
  try {
    const rows = (await tx.execute(sql`
      SELECT amanda_mode, amanda_settings FROM agency_settings
       WHERE agency_id = current_setting('app.current_agency_id', true)
       LIMIT 1
    `)) as unknown as Array<{ amanda_mode: string; amanda_settings: Record<string, unknown> | null }>;
    const r = rows[0];
    if (!r) return c.json({ ok: true, configured: false });
    const s = r.amanda_settings ?? {};
    const knowledge = (await tx.execute(sql`
      SELECT id, content, status, created_at FROM agency_amanda_knowledge
       WHERE agency_id = current_setting('app.current_agency_id', true)
         AND status IN ('active', 'pending_review')
       ORDER BY created_at ASC LIMIT 50
    `)) as unknown as Array<{ id: string; content: string; status: string; created_at: string }>;
    return c.json({
      ok: true,
      configured: true,
      mode: parseAmandaMode(r.amanda_mode),
      settings: {
        viewing_duration_min: typeof s.viewing_duration_min === 'number' ? s.viewing_duration_min : 60,
        viewing_notice_hours: typeof s.viewing_notice_hours === 'number' ? s.viewing_notice_hours : 24,
        timezone: typeof s.timezone === 'string' && s.timezone ? s.timezone : 'Europe/Madrid',
      },
      knowledge: knowledge.map((k) => ({ id: k.id, content: k.content, status: k.status, createdAt: k.created_at })),
    });
  } catch (err) {
    // Pre-migration (tables/columns absent): the card renders "not set up yet".
    console.error('[amanda-admin] settings read degraded:', err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'error');
    return c.json({ ok: true, configured: false });
  }
});

route.post('/settings', async (c) => {
  const tx = c.get('tx');
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const patch: Record<string, unknown> = {};
  if (typeof body.viewing_duration_min === 'number' && body.viewing_duration_min >= 15 && body.viewing_duration_min <= 240) {
    patch.viewing_duration_min = Math.round(body.viewing_duration_min);
  }
  if (typeof body.viewing_notice_hours === 'number' && body.viewing_notice_hours >= 1 && body.viewing_notice_hours <= 168) {
    patch.viewing_notice_hours = Math.round(body.viewing_notice_hours);
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'Nothing valid to save — durations 15-240 min, notice 1-168 hours.' }, 400);
  }
  void SETTINGS_KEYS;
  await tx.execute(sql`
    UPDATE agency_settings
       SET amanda_settings = COALESCE(amanda_settings, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
           updated_at = now()
     WHERE agency_id = current_setting('app.current_agency_id', true)
  `);
  return c.json({ ok: true, saved: patch });
});

route.post('/knowledge', async (c) => {
  const tx = c.get('tx');
  const user = c.get('user');
  let body: { content?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const verdict = scrubKnowledge(content);
  if (!verdict.ok) {
    // The reason key maps to friendly copy client-side (13 locales).
    return c.json({ error: 'rejected', reason: verdict.reason }, 422);
  }
  const agencyId = c.get('agencyId') as string;
  const rows = (await tx.execute(sql`
    INSERT INTO agency_amanda_knowledge (agency_id, content, status, source, screen_result, screened_at, created_by)
    VALUES (
      ${agencyId}, ${content}, 'active', 'settings',
      jsonb_build_object('scrubber', 'deterministic_v1', 'verdict', 'ok'), now(), ${user.email}
    )
    RETURNING id, content, status, created_at
  `)) as unknown as Array<{ id: string; content: string; status: string; created_at: string }>;
  const k = rows[0];
  return c.json({ ok: true, entry: { id: k.id, content: k.content, status: k.status, createdAt: k.created_at } });
});

route.post('/knowledge/:id/remove', async (c) => {
  const tx = c.get('tx');
  const id = c.req.param('id');
  await tx.execute(sql`
    UPDATE agency_amanda_knowledge
       SET status = 'superseded', updated_at = now()
     WHERE id = ${id}::uuid
       AND agency_id = current_setting('app.current_agency_id', true)
       AND status IN ('active', 'pending_review')
  `);
  return c.json({ ok: true });
});

export default route;
