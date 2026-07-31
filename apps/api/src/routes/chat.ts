import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../../../../packages/db/client';
import { validateContact, validateMessage, mapCaptureError, createRateLimiter } from './chat-lib';
import { parseMessage, classifyIntent, turnReply, hasContact, type Collected } from './amanda-flow';
import {
  buildSearchFilters, wantsViewing, toPropertyCard, searchReply, specificReply, viewingReply,
  type PropertyRow, type PropertyCard,
} from './amanda-catalogue';
import { usablePhotos } from '../lib/property-images';

/**
 * Amanda web-chat — PUBLIC (unauthenticated) endpoints, mounted at /chat OUTSIDE
 * /api/* so the JWT auth + agency-context middleware never run. The agency is
 * derived from :agencySlug; every DB call goes through a SECURITY DEFINER RPC that
 * resolves the agency + is_test-gates itself. NO LLM, NO provider/WhatsApp send.
 *
 * Phase A: capture (lead + conversation + pending Inbox task + consent_log).
 * Phase B: the 'property_question' intent is answered from the VERIFIED catalogue —
 *   `amanda_search_properties` (read-only, status='active', safe columns) returns up
 *   to 3 cards through the `attachments` envelope; a specific reference returns one
 *   active listing; a viewing request is CAPTURED (tagged task) — never booked, never
 *   sent. Amanda emits only template copy + verbatim column values (no invented facts);
 *   if nothing matches / a listing isn't found / data is missing, she defers to an agent.
 */
const route = new Hono();

const REQUIRE_TEST_AGENCY = true;              // Phase A/B stay is_test-only until go-live.
const CONSENT_RECORDED_BY = 'amanda_chat_capture';
const allowRequest = createRateLimiter(8, 60_000);

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

function ipHashOf(c: import('hono').Context): string {
  const raw = (c.req.header('x-forwarded-for') ?? '').split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown';
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}
function userAgentOf(c: import('hono').Context): string | null {
  const ua = (c.req.header('user-agent') ?? '').trim();
  return ua ? ua.slice(0, 400) : null;
}
async function readBody(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Read-only catalogue search (SECURITY DEFINER, status='active', is_test-gated).
async function searchProperties(slug: string, sessionToken: string | null, filters: unknown, limit: number): Promise<PropertyRow[]> {
  const res = await db.execute(sql`
    SELECT * FROM public.amanda_search_properties(
      ${slug}, ${sessionToken}, ${JSON.stringify(filters)}::jsonb, ${limit}, ${REQUIRE_TEST_AGENCY}
    )
  `);
  return res as unknown as PropertyRow[];
}
// Shape a verified row into a safe card; image is a pre-vetted own-bucket URL or null.
function cardOf(row: PropertyRow): PropertyCard {
  const usable = usablePhotos((row as { images?: unknown }).images);
  return toPropertyCard(row, usable[0] ?? null);
}

// POST /chat/:agencySlug/contact — capture → lead + conversation + task + consent_log.
route.post('/:agencySlug/contact', async (c) => {
  const slug = c.req.param('agencySlug');
  if (!slug || slug.length > 100) return c.json({ ok: false, error: 'This chat is not available.' }, 404);

  const ipHash = ipHashOf(c);
  if (!allowRequest(`${ipHash}:${slug}`, Date.now())) {
    return c.json({ ok: false, error: 'Too many requests — please wait a moment and try again.' }, 429);
  }

  const parsed = validateContact(await readBody(c));
  if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
  const v = parsed.input;
  const userAgent = userAgentOf(c);

  try {
    await db.execute(sql`
      SELECT * FROM public.amanda_capture_lead(
        ${slug}, ${v.sessionToken}, ${v.name}, ${v.email}, ${v.phone}, ${true},
        ${v.language}, ${v.intent}, ${v.budget}, ${v.budgetMax}, ${v.location}, ${v.bedroomsMin},
        ${v.propertyType}, ${v.transcript ? JSON.stringify(v.transcript) : null}::jsonb,
        ${v.pageUrl}, ${v.referrer}, ${ipHash}, ${REQUIRE_TEST_AGENCY},
        ${v.consentText}, ${v.consentMethod}, ${userAgent}, ${CONSENT_RECORDED_BY}
      )
    `);
    // Viewing request → tag the just-created Inbox task (never a booking, never a send).
    if (v.viewing && v.sessionToken) {
      await db.execute(sql`
        SELECT * FROM public.amanda_tag_viewing_request(${slug}, ${v.sessionToken}, ${v.viewingRef}, ${REQUIRE_TEST_AGENCY})
      `);
    }
    return c.json({ ok: true });
  } catch (err) {
    const pg = asPgError(err);
    if (pg && pg.code === 'P0001') {
      const m = mapCaptureError(pg.message.trim());
      return c.json({ ok: false, error: m.msg }, m.status);
    }
    console.error('[chat/contact] capture failed for slug:', slug, pg ? pg.code : 'non-pg-error');
    return c.json({ ok: false, error: 'Something went wrong — please try again.' }, 500);
  }
});

// POST /chat/:agencySlug/message — one deterministic turn (NO LLM).
route.post('/:agencySlug/message', async (c) => {
  const slug = c.req.param('agencySlug');
  if (!slug || slug.length > 100) return c.json({ ok: false, error: 'This chat is not available.' }, 404);

  const ipHash = ipHashOf(c);
  if (!allowRequest(`${ipHash}:${slug}`, Date.now())) {
    return c.json({ ok: false, error: 'Too many requests — please wait a moment and try again.' }, 429);
  }

  const parsed = validateMessage(await readBody(c));
  if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 400);
  const v = parsed.input;
  const userAgent = userAgentOf(c);
  const lang = v.language ?? undefined;

  try {
    // 1) Parse + append the visitor's inbound message; get the server-merged state.
    const patch = parseMessage(v.message);
    const inbound = await db.execute(sql`
      SELECT * FROM public.amanda_append_message(
        ${slug}, ${v.sessionToken}, ${'inbound'}, ${v.message}, ${JSON.stringify(patch)}::jsonb, ${REQUIRE_TEST_AGENCY}
      )
    `);
    const collected = ((inbound as unknown as Array<{ collected: Record<string, unknown> }>)[0]?.collected ?? {}) as Collected;
    const have = hasContact(collected);
    const intent = classifyIntent(v.message);

    let reply: string;
    let messageType: string;
    let attachments: PropertyCard[] = [];
    let awaitingContact: boolean;
    let readyToCapture: boolean;
    let viewing = false;
    let viewingRef: string | null = null;

    if (intent === 'property_question') {
      // Phase B: answer from the VERIFIED catalogue — never invent.
      const filters = buildSearchFilters(collected, v.message);
      if (wantsViewing(v.message)) {
        viewing = true;
        viewingRef = filters.ref;                       // specific listing, or null (general)
        reply = viewingReply(have, lang);
        messageType = 'viewing_request';
        awaitingContact = !have;
        readyToCapture = have;
        if (filters.ref) {
          const rows = await searchProperties(slug, v.sessionToken, { ref: filters.ref }, 1);
          if (rows[0]) attachments = [cardOf(rows[0])];  // show what they're asking to view
        }
      } else if (filters.ref) {
        // Specific-listing lookup — active only; missing/inactive → defer to an agent.
        const rows = await searchProperties(slug, v.sessionToken, { ref: filters.ref }, 1);
        if (rows[0]) {
          reply = specificReply(true, filters.ref, lang);
          attachments = [cardOf(rows[0])];
          messageType = 'property_answer';
          awaitingContact = false;
          readyToCapture = false;
        } else {
          reply = specificReply(false, filters.ref, lang);
          messageType = 'property_answer';
          awaitingContact = !have;
          readyToCapture = have;
        }
      } else {
        // Criteria search — up to 3 active listings; zero → honest defer + capture.
        const rows = await searchProperties(slug, v.sessionToken, filters, 3);
        attachments = rows.map(cardOf);
        reply = searchReply(rows.length, false, lang);
        messageType = 'property_answer';
        awaitingContact = rows.length === 0 ? !have : false;
        readyToCapture = rows.length === 0 ? have : false;
      }
    } else {
      const t = turnReply(collected, Object.keys(patch).length === 0, intent, lang);
      reply = t.reply;
      messageType = t.messageType;
      awaitingContact = t.awaitingContact;
      readyToCapture = t.readyToCapture;
    }

    // 2) Append Amanda's outbound reply.
    await db.execute(sql`
      SELECT * FROM public.amanda_append_message(
        ${slug}, ${v.sessionToken}, ${'outbound'}, ${reply}, ${'{}'}::jsonb, ${REQUIRE_TEST_AGENCY}
      )
    `);

    // 3) Capture handoff ONLY when contact is ready AND consent given (free-text path).
    let captured = false;
    if (readyToCapture && v.consent) {
      await db.execute(sql`
        SELECT * FROM public.amanda_capture_lead(
          ${slug}, ${v.sessionToken}, ${collected.name ?? null}, ${collected.email ?? null}, ${collected.phone ?? null}, ${true},
          ${v.language}, ${collected.intent ?? null}, ${null}, ${collected.budgetMax ?? null},
          ${collected.location ?? null}, ${collected.bedroomsMin ?? null}, ${collected.propertyType ?? null},
          ${null}::jsonb, ${null}, ${null}, ${ipHash}, ${REQUIRE_TEST_AGENCY},
          ${v.consentText}, ${v.consentMethod}, ${userAgent}, ${CONSENT_RECORDED_BY}
        )
      `);
      captured = true;
      if (viewing) {
        await db.execute(sql`
          SELECT * FROM public.amanda_tag_viewing_request(${slug}, ${v.sessionToken}, ${viewingRef}, ${REQUIRE_TEST_AGENCY})
        `);
      }
    }

    return c.json({ ok: true, reply, messageType, attachments, collected, captured, awaitingContact, viewing, viewingRef });
  } catch (err) {
    const pg = asPgError(err);
    if (pg && pg.code === 'P0001') {
      const m = mapCaptureError(pg.message.trim());
      return c.json({ ok: false, error: m.msg }, m.status);
    }
    console.error('[chat/message] failed for slug:', slug, pg ? pg.code : 'non-pg-error');
    return c.json({ ok: false, error: 'Something went wrong — please try again.' }, 500);
  }
});

export default route;
