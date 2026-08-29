import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { scrubKnowledge } from '../amanda-engine/knowledge-scrub';
import { parseAmandaMode } from '../amanda-engine/modes';
import { parseAmandaSettings } from '../amanda-engine/backends-db';

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
    // ONE parse (the engine's own) so the settings card always shows exactly
    // what Amanda will actually do — defaults included.
    const parsed = parseAmandaSettings(s);
    return c.json({
      ok: true,
      configured: true,
      mode: parseAmandaMode(r.amanda_mode),
      settings: {
        viewing_duration_min: parsed.viewingDurationMin,
        viewing_notice_hours: parsed.viewingNoticeHours,
        timezone: parsed.timezone,
        viewing_hours_by_weekday: parsed.viewingHoursByWeekday,
        blocked_dates: parsed.blockedDates,
        blocked_slots: parsed.blockedSlots,
        calendar_notes: parsed.calendarNotes,
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
  // Viewing-hours grid: { "0".."6": int hours 8-21 } — the tap grid in settings.
  // Saved even when a day empties out (an empty object clears back to defaults
  // at read time via the engine's fallback, so an agency can't brick booking).
  if (body.viewing_hours_by_weekday && typeof body.viewing_hours_by_weekday === 'object' && !Array.isArray(body.viewing_hours_by_weekday)) {
    const hours: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(body.viewing_hours_by_weekday as Record<string, unknown>)) {
      const day = Number(k);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(v)) continue;
      const hs = (v as unknown[]).filter((h): h is number => typeof h === 'number' && Number.isInteger(h) && h >= 8 && h <= 21);
      if (hs.length) hours[String(day)] = [...new Set(hs)].sort((a, b) => a - b).slice(0, 14);
    }
    // Review-caught trap: saving an all-empty grid would silently fall back
    // to the DEFAULT hours at read time — the agent sees "everything off,
    // saved" while Amanda keeps offering 11:00/17:00. Refuse it honestly.
    if (Object.keys(hours).length === 0) {
      return c.json({ error: 'Keep at least one viewing hour — for time off use blocked days, or ask us to switch Amanda off.' }, 400);
    }
    patch.viewing_hours_by_weekday = hours;
  }
  // Blocked days: YYYY-MM-DD only, capped, past dates dropped server-side too.
  if (Array.isArray(body.blocked_dates)) {
    const today = new Date().toISOString().slice(0, 10);
    patch.blocked_dates = [...new Set(
      (body.blocked_dates as unknown[])
        .filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
    )].sort().slice(0, 120);
  }
  // One-off hour blocks on a date ("busy Tuesday 12-14"): {date, from, to},
  // hours 8-22, same past-date drop and cap.
  if (Array.isArray(body.blocked_slots)) {
    const today = new Date().toISOString().slice(0, 10);
    patch.blocked_slots = (body.blocked_slots as unknown[])
      .filter((s): s is { date: string; from: number; to: number } => {
        const x = s as { date?: unknown; from?: unknown; to?: unknown };
        return (
          typeof x?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= today &&
          typeof x.from === 'number' && Number.isInteger(x.from) &&
          typeof x.to === 'number' && Number.isInteger(x.to) &&
          x.from >= 8 && x.to > x.from && x.to <= 22
        );
      })
      .map((s) => ({ date: s.date, from: s.from, to: s.to }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)
      .slice(0, 120);
  }
  // Calendar notes (tap-a-square): each note passes the SAME deterministic
  // scrubber as the knowledge box — a rejected note fails the save with its
  // reason instead of being silently dropped.
  if (Array.isArray(body.calendar_notes)) {
    const today = new Date().toISOString().slice(0, 10);
    const notes: Array<{ date: string; from: number; to: number; note: string; color: string }> = [];
    for (const n of body.calendar_notes as unknown[]) {
      const x = n as { date?: unknown; from?: unknown; to?: unknown; note?: unknown };
      if (
        typeof x?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || x.date < today ||
        typeof x.from !== 'number' || !Number.isInteger(x.from) ||
        typeof x.to !== 'number' || !Number.isInteger(x.to) ||
        x.from < 8 || x.to <= x.from || x.to > 22 ||
        typeof x.note !== 'string' || !x.note.trim()
      ) continue;
      const note = x.note.trim().slice(0, 240);
      const verdict = scrubKnowledge(note);
      if (!verdict.ok) {
        return c.json({ error: 'note_rejected', reason: verdict.reason }, 422);
      }
      const colorRaw = (n as { color?: unknown }).color;
      const color = typeof colorRaw === 'string' && ['violet', 'blue', 'amber', 'pink', 'teal', 'slate'].includes(colorRaw) ? colorRaw : 'violet';
      notes.push({ date: x.date, from: x.from, to: x.to, note, color });
    }
    patch.calendar_notes = notes
      .sort((a, b) => a.date.localeCompare(b.date) || a.from - b.from)
      .slice(0, 60);
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

// ── Agent roster (Christian 2026-08-28) ─────────────────────────────────────
// "the agency needs to have a place for managing their real estate agents…
//  name, what language speaks, office and work hours, unavailable hours,
//  whats email and whatsapp nr, so that amanda can ping the agent that is
//  correct for the client". RLS-fenced through the request tx like everything
//  else here. whatsapp_e164 is the STAFF REGISTRY the inbound router checks
//  before find-or-create-lead, so its format is validated hard on the way in:
//  a mistyped local number would be an invisible routing failure, not a typo.

const E164 = /^\+[1-9][0-9]{6,14}$/;
const LANG_CODE = /^[a-z]{2}$/;

/** Accepts what a human types (+34 600 111 222, 0034…) and returns E.164. */
function toE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let v = raw.trim().replace(/[\s()\-.]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return E164.test(v) ? v : null;
}

route.get('/agents', async (c) => {
  const tx = c.get('tx');
  try {
    const rows = (await tx.execute(sql`
      SELECT id, full_name, whatsapp_e164, email, languages, office, work_hours,
             unavailable_dates, receives_pings, last_checkin_at, status
        FROM agency_agents
       WHERE agency_id = current_setting('app.current_agency_id', true)
         AND status <> 'removed'
       ORDER BY full_name ASC
    `)) as unknown as Array<Record<string, unknown>>;
    return c.json({ ok: true, configured: true, agents: rows });
  } catch (err) {
    // Pre-migration safety, same convention as the settings GET above.
    console.error('[amanda-admin] agents read degraded:', err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'error');
    return c.json({ ok: true, configured: false, agents: [] });
  }
});

route.post('/agents', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId') as string;
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { body = {}; }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim().slice(0, 120) : '';
  if (!fullName) return c.json({ error: 'Give the agent a name.' }, 400);

  const whatsapp = toE164(body.whatsapp_e164);
  if (!whatsapp) {
    return c.json({ error: 'That WhatsApp number needs the country code, e.g. +34 600 111 222.' }, 400);
  }
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().slice(0, 160) : null;
  const office = typeof body.office === 'string' && body.office.trim() ? body.office.trim().slice(0, 80) : null;
  const languages = Array.isArray(body.languages)
    ? [...new Set((body.languages as unknown[]).filter((l): l is string => typeof l === 'string' && LANG_CODE.test(l)))].slice(0, 8)
    : [];
  const receivesPings = body.receives_pings !== false;

  // Same shape + bounds as Amanda's viewing hours, so the UI can reuse the editor.
  const hours: Record<string, number[]> = {};
  if (body.work_hours && typeof body.work_hours === 'object' && !Array.isArray(body.work_hours)) {
    for (const [k, v] of Object.entries(body.work_hours as Record<string, unknown>)) {
      const day = Number(k);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !Array.isArray(v)) continue;
      const hs = (v as unknown[]).filter((h): h is number => typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23);
      if (hs.length) hours[String(day)] = [...new Set(hs)].sort((a, b) => a - b).slice(0, 24);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const unavailable = Array.isArray(body.unavailable_dates)
    ? [...new Set((body.unavailable_dates as unknown[]).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today))].sort().slice(0, 120)
    : [];

  const id = typeof body.id === 'string' && body.id ? body.id : null;
  try {
    if (id) {
      const rows = (await tx.execute(sql`
        UPDATE agency_agents
           SET full_name = ${fullName}, whatsapp_e164 = ${whatsapp}, email = ${email},
               languages = string_to_array(${languages.join(',')}, ','),
               office = ${office},
               work_hours = ${JSON.stringify(hours)}::jsonb,
               unavailable_dates = string_to_array(${unavailable.join(',')}, ','),
               receives_pings = ${receivesPings}, updated_at = now()
         WHERE id = ${id}::uuid
           AND agency_id = current_setting('app.current_agency_id', true)
         RETURNING id
      `)) as unknown as unknown[];
      if (rows.length === 0) return c.json({ error: 'That agent could not be found.' }, 404);
      return c.json({ ok: true, id });
    }
    const rows = (await tx.execute(sql`
      INSERT INTO agency_agents (agency_id, full_name, whatsapp_e164, email, languages, office,
                                 work_hours, unavailable_dates, receives_pings)
      VALUES (${agencyId}, ${fullName}, ${whatsapp}, ${email},
              string_to_array(${languages.join(',')}, ','), ${office},
              ${JSON.stringify(hours)}::jsonb,
              string_to_array(${unavailable.join(',')}, ','), ${receivesPings})
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return c.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/agency_agents_agency_id_whatsapp_e164_key|duplicate key/i.test(msg)) {
      return c.json({ error: 'Another agent already uses that WhatsApp number.' }, 409);
    }
    console.error('[amanda-admin] agent save failed:', msg.split('\n')[0].slice(0, 140));
    return c.json({ error: 'That agent could not be saved — please try again.' }, 500);
  }
});

// Soft delete: the number must stop being staff, but history stays truthful.
route.post('/agents/:id/remove', async (c) => {
  const tx = c.get('tx');
  await tx.execute(sql`
    UPDATE agency_agents SET status = 'removed', receives_pings = false, updated_at = now()
     WHERE id = ${c.req.param('id')}::uuid
       AND agency_id = current_setting('app.current_agency_id', true)
  `);
  return c.json({ ok: true });
});

export default route;
