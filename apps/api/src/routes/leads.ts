import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

/**
 * Leads — write-side actions that go through SECURITY DEFINER RPCs (which read
 * app.current_agency_id / app.current_user_id, both set per-request by
 * agencyContextMiddleware). The RPC returns a jsonb envelope { ok, ... } and we
 * map any { ok:false, error:<code> } to a friendly message — the raw code,
 * SQL, table, or status NEVER leaves the server (Law 2).
 *
 * Paths (mounted at /api/v1/leads):
 *   POST /:leadId/suggest-properties  {limit?}  create_property_suggestion_task
 *   POST /:leadId/reply               {body, subject?, channel}  send_custom_reply
 *   GET  /:leadId/whatsapp-state                dashboard_lead_whatsapp_state
 */
const route = new Hono();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RPC error code → friendly message. The raw code never leaves this map.
const SUGGEST_ERROR_MAP: Record<string, string> = {
  no_matches: 'No matched properties to suggest for this lead yet.',
  no_conversation: "There's no active conversation to send this to.",
  lead_not_found: 'Something went wrong — please refresh and try again.',
};

const GENERIC = 'Something went wrong — please try again.';

// Freeform-send generic — same calm fallback the composer server action uses.
const SEND_GENERIC =
  'Something went wrong sending that — please try again, and contact support if it keeps happening.';

// send_custom_reply RAISE code → { friendly message, http status } (Law 2 — the
// raw code/SQL/table NEVER leaves this map). body_empty is a 400 (input), the
// rest are 422 business rejections.
const REPLY_ERROR_MAP: Record<string, { msg: string; status: 400 | 422 }> = {
  lead_opted_out: {
    msg: "This buyer has opted out of messages, so we can't send to them.",
    status: 422,
  },
  lead_missing_phone: {
    msg: "We don't have a phone number for this buyer, so WhatsApp can't be sent.",
    status: 422,
  },
  lead_missing_email: {
    msg: "We don't have an email for this buyer, so email can't be sent.",
    status: 422,
  },
  body_empty: { msg: 'Please write a message before sending.', status: 400 },
  whatsapp_window_closed: {
    msg: "This buyer hasn't replied in over 24 hours, so WhatsApp can't send right now.",
    status: 422,
  },
};

type PgErrorShape = { code: string; message: string };

/**
 * Walk an error chain looking for a Postgres-shaped error (string `code`
 * matching a 5-char SQLSTATE, and string `message`). Drizzle wraps thrown
 * errors; the real PostgresError sits a few `.cause` levels deep.
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
    if (code && message && SQLSTATE.test(code)) return { code, message };
    cur = e.cause;
  }
  return null;
}

async function readBody(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Coerce an optional limit to an integer in 1..20; invalid / missing → 4.
function coerceLimit(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 4;
  const i = Math.trunc(n);
  if (i < 1 || i > 20) return 4;
  return i;
}

// POST /:leadId/suggest-properties {limit?} — create_property_suggestion_task.
// Returns the RPC envelope on success; maps {ok:false} codes to friendly copy.
route.post('/:leadId/suggest-properties', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  const body = await readBody(c);
  const limit = coerceLimit(body.limit);
  try {
    const result = await tx.execute(sql`
      SELECT public.create_property_suggestion_task(${leadId}::uuid, ${limit}) AS result
    `);
    const rows = result as unknown as Array<{ result: unknown }>;
    const payload = rows[0]?.result as
      | { ok?: boolean; error?: string; [k: string]: unknown }
      | null
      | undefined;

    if (payload && payload.ok === true) {
      return c.json(payload);
    }

    const code = payload && typeof payload.error === 'string' ? payload.error : '';
    const friendly = SUGGEST_ERROR_MAP[code];
    if (friendly) {
      // no_matches / no_conversation are expected business states (422);
      // lead_not_found is treated as a refresh-and-retry case (422 too).
      return c.json({ ok: false, error: friendly }, 422);
    }
    // Unknown / missing code — never surface it.
    console.error('[leads/suggest-properties] unmapped RPC result:', payload);
    return c.json({ ok: false, error: GENERIC }, 422);
  } catch (err) {
    console.error('[leads/suggest-properties] failed:', err);
    return c.json({ ok: false, error: GENERIC }, 500);
  }
});

// POST /:leadId/reply {body, subject?, channel} — freeform send via
// send_custom_reply (SECURITY DEFINER). operatorEmail comes from the verified
// token, never the client body. PG RAISE codes map to friendly copy (Law 2 —
// raw code/SQL/table never leaves the server).
route.post('/:leadId/reply', async (c) => {
  const tx = c.get('tx');
  const user = c.get('user');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  const raw = await readBody(c);
  const body = typeof raw.body === 'string' ? raw.body : '';
  const subject =
    typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject : null;
  const channelRaw = typeof raw.channel === 'string' ? raw.channel.toLowerCase() : '';
  const channel = channelRaw === 'whatsapp' || channelRaw === 'email' ? channelRaw : '';

  if (!body.trim()) {
    return c.json({ ok: false, error: 'Please write a message before sending.' }, 400);
  }
  if (!channel) {
    return c.json({ ok: false, error: SEND_GENERIC }, 400);
  }

  const operatorEmail = user.email;

  try {
    const result = await tx.execute(sql`
      SELECT send_custom_reply(
        ${leadId}::uuid,
        ${body},
        ${subject},
        ${channel},
        ${operatorEmail}
      ) AS result
    `);
    const rows = result as unknown as Array<{ result: unknown }>;
    const payload = rows[0]?.result;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return c.json({ ok: true, ...(payload as Record<string, unknown>) });
    }
    return c.json({ ok: true });
  } catch (err) {
    const pg = asPgError(err);
    const mapped = pg ? REPLY_ERROR_MAP[pg.message.trim()] : undefined;
    if (mapped) {
      return c.json({ ok: false, error: mapped.msg, code: pg!.message.trim() }, mapped.status);
    }
    console.error('[leads/reply] failed:', leadId, pg ?? err);
    return c.json({ ok: false, error: SEND_GENERIC }, 500);
  }
});

// GET /:leadId/intel — read-only buyer-intelligence fields for the selected lead
// (Day-2 Client Intelligence right panel: Buyer Profile, Next Best Action,
// Follow-up). Repo-native direct SELECT, tenant-fenced by the agency GUC the
// middleware set per-request (defence in depth alongside RLS) — exactly the
// pattern the lead-notes list read uses. NO Day-3 columns (motivation/objections/
// best_property_angle) and NO writes. Any null field is a real "not captured yet"
// and the UI renders it as "—"; we never fabricate a value (Law 2 — honesty).
route.get('/:leadId/intel', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  try {
    // Phase-2 add: two fields surfacing WHEN a buyer message last updated this lead's
    // interest. latest_pref_event picks the most-recent 'interest_updated_from_conversation'
    // lead_event (written by BOTH apply_conversation_interest [deterministic] and
    // apply_extracted_intent [llm], so this covers both paths). The CTE carries the SAME
    // agency GUC fence as the leads read; the LEFT JOIN leaves both fields NULL when there is
    // no such event, and a missing/wrong-tenant lead still yields zero rows. Purely additive.
    const result = await tx.execute(sql`
      WITH latest_pref_event AS (
        SELECT summary   AS preferences_update_summary,
               timestamp AS preferences_updated_from_message_at
          FROM public.lead_events
         WHERE lead_id = ${leadId}::uuid
           AND agency_id = current_setting('app.current_agency_id', true)
           AND type = 'interest_updated_from_conversation'
         ORDER BY timestamp DESC
         LIMIT 1
      )
      SELECT l.urgency,
             l.timeframe,
             l.budget_extracted,
             l.budget_raw,
             l.location_interest_extracted,
             l.location_interest_raw,
             l.bedrooms_min,
             l.bedrooms_max,
             l.bathrooms_min,
             l.property_type_pref,
             l.next_action,
             l.recommended_channel,
             l.reasoning_summary,
             l.followup_paused,
             l.next_followup_at,
             e.preferences_updated_from_message_at,
             e.preferences_update_summary
        FROM public.leads l
        LEFT JOIN latest_pref_event e ON true
       WHERE l.id = ${leadId}::uuid
         AND l.agency_id = current_setting('app.current_agency_id', true)
    `);
    const rows = result as unknown as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      // Missing or wrong-tenant lead — calm, not an error surface.
      return c.json({ ok: false, error: "Couldn't load this lead's details." }, 404);
    }
    return c.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[leads/intel] read failed:', leadId, err);
    return c.json({ ok: false, error: GENERIC }, 500);
  }
});

// GET /:leadId/whatsapp-state — dashboard_lead_whatsapp_state (SECURITY INVOKER;
// runs under the same agency + role tx context). Never leaks: any throw → calm
// generic 500 with null data is never returned; we return a friendly error.
route.get('/:leadId/whatsapp-state', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT dashboard_lead_whatsapp_state(${leadId}::uuid) AS state
    `);
    const rows = result as unknown as Array<{ state: unknown }>;
    return c.json({ ok: true, data: rows[0]?.state ?? null });
  } catch (err) {
    console.error('[leads/whatsapp-state] failed:', leadId, err);
    return c.json({ ok: false, error: GENERIC }, 500);
  }
});

// The only editable buyer-preference keys. The RPC is authoritative — this list is a friendly
// early 400 so an obviously-wrong body never reaches the DB. Mirrors the RPC whitelist exactly.
export const EDITABLE_PREF_KEYS = [
  'location_interest_extracted',
  'budget_extracted',
  'property_type_pref',
  'bedrooms_min',
  'bedrooms_max',
  'bathrooms_min',
] as const;

// update_lead_preferences RAISE code → { friendly message, http status }. The raw code / SQL / table
// NEVER leaves this map (Law 2). `lead_wrong_agency` maps to the same 404 as not-found so a probe
// can't tell "exists in another agency" from "doesn't exist". require_role denial (SQLSTATE 42501)
// is handled separately as a 403.
const PREF_ERROR_MAP: Record<string, { msg: string; status: 400 | 403 | 404 | 422 }> = {
  invalid_patch: { msg: 'Please provide the preferences to update.', status: 400 },
  no_fields: { msg: 'No editable preferences were provided.', status: 400 },
  unknown_field: { msg: "That preference field can't be edited here.", status: 400 },
  invalid_budget: { msg: 'Budget must be a number of euros (or empty to clear it).', status: 400 },
  invalid_number: { msg: 'Bedrooms and bathrooms must be whole numbers.', status: 400 },
  invalid_bedrooms_range: { msg: 'Minimum bedrooms can’t be more than the maximum.', status: 400 },
  not_a_buyer_lead: { msg: 'Preferences can only be set on buyer leads.', status: 422 },
  lead_not_found: { msg: "Couldn't find that lead — please refresh and try again.", status: 404 },
  lead_wrong_agency: { msg: "Couldn't find that lead — please refresh and try again.", status: 404 },
  // require_role('agent') denial — a viewer (or no-role context). RAISEd as P0001/insufficient_role.
  insufficient_role: { msg: "You don't have permission to edit this lead's preferences.", status: 403 },
};

/**
 * Classify an error thrown by update_lead_preferences into a friendly response. Pure + exported so
 * the mapping is unit-tested without a DB. All of the RPC's business rejections (incl. require_role's
 * `insufficient_role`) are RAISEd with SQLSTATE P0001, so we map on the message. SQLSTATE 42501 is
 * handled defensively as a permission denial too. Anything unrecognised → calm generic 500 (never leaks).
 */
export function classifyPrefError(err: unknown): { error: string; status: 400 | 403 | 404 | 422 | 500 } {
  const pg = asPgError(err);
  if (pg) {
    const mapped = PREF_ERROR_MAP[pg.message.trim()];
    if (mapped) return { error: mapped.msg, status: mapped.status };
    if (pg.code === '42501') {
      return { error: "You don't have permission to edit this lead's preferences.", status: 403 };
    }
  }
  return { error: GENERIC, status: 500 };
}

// PATCH /:leadId/preferences {location_interest_extracted?, budget_extracted?, property_type_pref?,
//   bedrooms_min?, bedrooms_max?, bathrooms_min?} — agent-editable buyer preferences via
// update_lead_preferences (SECURITY DEFINER; agency + role + cross-agency + buyer guards live in the
// RPC). A present key sets that field (null clears it); an absent key is left unchanged. Writing
// these columns fires the autoembed + automatch triggers, so matches refresh on their own.
route.patch('/:leadId/preferences', async (c) => {
  const tx = c.get('tx');
  const leadId = c.req.param('leadId');
  if (!UUID_RE.test(leadId)) {
    return c.json({ ok: false, error: 'A valid lead id is required.' }, 400);
  }
  const patch = await readBody(c);
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return c.json({ ok: false, error: 'No editable preferences were provided.' }, 400);
  }
  const unknown = keys.find((k) => !(EDITABLE_PREF_KEYS as readonly string[]).includes(k));
  if (unknown) {
    return c.json({ ok: false, error: "That preference field can't be edited here." }, 400);
  }
  try {
    const result = await tx.execute(sql`
      SELECT public.update_lead_preferences(${leadId}::uuid, ${JSON.stringify(patch)}::jsonb) AS result
    `);
    const rows = result as unknown as Array<{ result: unknown }>;
    const payload = rows[0]?.result;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return c.json({ ok: true, ...(payload as Record<string, unknown>) });
    }
    return c.json({ ok: true });
  } catch (err) {
    const { error, status } = classifyPrefError(err);
    if (status === 500) console.error('[leads/preferences] failed:', leadId, asPgError(err) ?? err);
    return c.json({ ok: false, error }, status);
  }
});

export default route;
