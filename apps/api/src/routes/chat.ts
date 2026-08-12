import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../../../../packages/db/client';
import { validateContact, validateMessage, mapCaptureError, createRateLimiter } from './chat-lib';
import { parseMessage, classifyIntent, turnReply, hasContact, nextStep, interpretFunnelAnswer, type Collected } from './amanda-flow';
import {
  buildSearchFilters, wantsViewing, toPropertyCard, searchReply, specificReply, viewingReply,
  listingDetailReply, isListingQuestion, featuresAnswering, listingConditionReply, isBrowseRequest,
  isReferenceFollowup, resolveReference,
  type PropertyRow, type PropertyCard,
} from './amanda-catalogue';
import { usablePhotos } from '../lib/property-images';
import { groundedListingAnswer, type ListingForLlm } from './amanda-llm';

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
const allowRequest = createRateLimiter(20, 60_000);
// Phase D cost backstops (LLM calls cost money). Per-session fairness cap AND a
// per-instance global circuit-breaker so a spoofed X-Forwarded-For (which the
// general limiter keys on) can never run up an unbounded Anthropic bill.
const allowLlmSession = createRateLimiter(15, 60_000);
const allowLlmGlobal = createRateLimiter(240, 60_000);
function llmBudgetAvailable(sessionToken: string, now: number): boolean {
  return allowLlmGlobal('all', now) && allowLlmSession(sessionToken, now);
}

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
// The grounding corpus for the Phase-D LLM: the card's verbatim fields + the
// listing's public description. Nothing else ever reaches the model.
function listingForLlm(row: PropertyRow, card: PropertyCard): ListingForLlm {
  return {
    ref: card.ref, title: card.title, propertyType: card.propertyType,
    price: card.price, currency: card.currency, bedrooms: card.bedrooms,
    bathrooms: card.bathrooms, areaSqm: card.areaSqm, locationCity: card.locationCity,
    locationRegion: typeof (row as { location_region?: unknown }).location_region === 'string'
      ? (row as { location_region?: string }).location_region as string : null,
    features: card.features,
    description: typeof (row as { description?: unknown }).description === 'string'
      ? ((row as { description?: string }).description as string).slice(0, 4000)
      : null,
  };
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
    // Human request → flag the lead needs-human (AI muted until an agent releases)
    // + realtime dashboard alert. NO send — the team contacts the visitor.
    if (v.human && v.sessionToken) {
      await db.execute(sql`
        SELECT * FROM public.amanda_tag_human_request(${slug}, ${v.sessionToken}, ${REQUIRE_TEST_AGENCY})
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
    // Amanda Live L1: the visitor asked for a PERSON this turn — after capture we
    // flag the lead needs-human (AI muted until an agent releases) + alert agents.
    const humanRequested = intent === 'human_request';
    let funnelExtra: Partial<Collected> = {};
    // The funnel step being ANSWERED = the step before THIS message's facts merged.
    // (The RPC already merged this turn's patch, so subtract freshly-added keys.)
    const prevCollected: Collected = { ...collected };
    for (const k of Object.keys(patch) as Array<keyof Collected>) {
      if (prevCollected[k] !== undefined && prevCollected[k] === patch[k]) delete prevCollected[k];
    }
    const stepBefore = nextStep(prevCollected);

    const filters = buildSearchFilters(collected, v.message);
    const lastRef = collected.lastRef ?? null;
    // A message counts as a NEW search (breaks out of the current property) only when
    // it states >=2 fresh criteria, or names a DIFFERENT listing reference.
    const newCriteria = [patch.location, patch.propertyType, patch.budgetMax, patch.bedroomsMin]
      .filter((x) => x !== undefined).length;
    // "Show me a few / what else do you have / some options" is ALWAYS a browse
    // request → cards, even mid-listing-chat (Christian, 2026-08-12).
    const browse = isBrowseRequest(v.message);
    // At the "anything specific?" step, property-flavoured words (pool, sea views,
    // garden) are the ANSWER to the question — route them into the funnel, not a
    // fresh search (browse and human requests still win).
    const answeringSpecifics = stepBefore === 'specifics' && !browse && !humanRequested && !wantsViewing(v.message);
    const isNewSearch = newCriteria >= 2 || (filters.ref !== null && filters.ref !== lastRef) || browse;
    // ANSWER-FIRST (Christian, 2026-08-12): once a property is on screen, the warm
    // LLM agent owns the whole conversation — property questions, AREA/lifestyle
    // questions, and small talk — UNLESS the visitor clearly starts a new search or
    // asks for a person. This ends the brittle "did a regex match?" misrouting.
    // Reference to one of SEVERAL shown cards ("the top one", "the one in Cabo Roig"):
    // re-run the deterministic search to get the exact set on screen, then resolve.
    let activeRef = lastRef;
    let resolvedViaReference = false;
    if (activeRef === null && !browse && !humanRequested && !isNewSearch && !answeringSpecifics
        && isReferenceFollowup(v.message)) {
      const shown = await searchProperties(slug, v.sessionToken, buildSearchFilters(collected, ''), 3);
      const idx = resolveReference(v.message, shown.map((r) => ({ title: (r as { title?: string | null }).title ?? null, city: (r as { location_city?: string | null }).location_city ?? null })));
      if (idx !== null && shown[idx]) { activeRef = (shown[idx] as { external_id?: string | null }).external_id ?? null; resolvedViaReference = true; }
    }
    // A positional reference ("the top one") is a POINTER, not a question about the
    // property — neutralize the ordinal so the LLM doesn't read "top" as a feature.
    const llmQuestion = resolvedViaReference
      ? v.message.replace(/\b(the |that )?(top|first|1st|second|2nd|third|3rd|last|bottom|final)(\s+(one|listing|property|apartment|villa|house|flat|townhouse))?\b/gi, 'this property')
      : v.message;
    const inListingChat = activeRef !== null && !humanRequested && !isNewSearch && !answeringSpecifics;

    if (inListingChat && wantsViewing(v.message)) {
      viewing = true;
      viewingRef = filters.ref ?? lastRef;
      reply = viewingReply(have, lang);
      messageType = 'viewing_request';
      awaitingContact = !have;
      readyToCapture = have;
      const rows = await searchProperties(slug, v.sessionToken, { ref: viewingRef }, 1);
      if (rows[0]) attachments = [cardOf(rows[0])];
    } else if (inListingChat) {
      // The warm agent answers about the listing on screen: property facts grounded
      // in the data, area/lifestyle from general local knowledge, chit-chat handled
      // gracefully. LLM failure / over-budget → deterministic honest fallback.
      const rows = await searchProperties(slug, v.sessionToken, { ref: activeRef }, 1);
      const card = rows[0] ? cardOf(rows[0]) : null;
      const llm = card && llmBudgetAvailable(v.sessionToken, Date.now())
        ? await groundedListingAnswer({ agencyName: slug, listing: listingForLlm(rows[0], card), question: llmQuestion, lang })
        : ({ ok: false } as const);
      messageType = 'property_answer';
      if (llm.ok) {
        reply = llm.answer;
        // Show the contact form ONLY when the agent decided the team is the next
        // step (legal/viewing/property-specific unknown) — never force it otherwise.
        awaitingContact = llm.needsTeam && !have;
        readyToCapture = llm.needsTeam && have;
      } else if (card && isListingQuestion(v.message)) {
        const matched = featuresAnswering(v.message, card.features);
        reply = listingConditionReply(matched, lang);
        awaitingContact = matched ? false : !have;
        readyToCapture = matched ? false : have;
      } else {
        reply = card ? listingDetailReply(card, lang) : specificReply(false, activeRef ?? "", lang);
        awaitingContact = false;
        readyToCapture = false;
      }
    } else if ((intent === 'property_question' || browse) && !answeringSpecifics) {
      // Fresh search / specific-listing lookup / viewing request (no listing on screen yet).
      if (wantsViewing(v.message)) {
        viewing = true;
        viewingRef = filters.ref ?? lastRef;
        reply = viewingReply(have, lang);
        messageType = 'viewing_request';
        awaitingContact = !have;
        readyToCapture = have;
        if (viewingRef) {
          const rows = await searchProperties(slug, v.sessionToken, { ref: viewingRef }, 1);
          if (rows[0]) attachments = [cardOf(rows[0])];
        }
      } else if (filters.ref) {
        const rows = await searchProperties(slug, v.sessionToken, { ref: filters.ref }, 1);
        if (rows[0]) {
          const card = cardOf(rows[0]);
          attachments = [card];
          reply = listingDetailReply(card, lang);
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
        reply = attachments.length === 1 ? listingDetailReply(attachments[0], lang) : searchReply(rows.length, false, lang);
        messageType = 'property_answer';
        awaitingContact = rows.length === 0 ? !have : false;
        readyToCapture = rows.length === 0 ? have : false;
      }
    } else {
      // Step-contextual interpretation: yes/no to "may I ask a few questions?",
      // bare numbers to the room question just asked, free text to "anything
      // specific?". Merged locally for THIS reply + persisted via the outbound patch.
      funnelExtra = interpretFunnelAnswer(stepBefore, v.message, patch);
      Object.assign(collected, funnelExtra);
      const addedNothing = Object.keys(patch).length === 0 && Object.keys(funnelExtra).length === 0;
      const t = turnReply(collected, addedNothing, answeringSpecifics ? 'qualify' : intent, lang);
      reply = t.reply;
      messageType = t.messageType;
      awaitingContact = t.awaitingContact;
      readyToCapture = t.readyToCapture;
      // Funnel complete (or permission declined) → SHOW the narrowed matches as cards.
      if (t.messageType === 'matches' || t.messageType === 'browse') {
        const rows = await searchProperties(slug, v.sessionToken, buildSearchFilters(collected, ''), 3);
        attachments = rows.map(cardOf);
        if (attachments.length === 0) reply = searchReply(0, false, lang);
      }
    }

    // 2) Append Amanda's outbound reply. When exactly ONE listing was shown, its
    //    ref becomes the session's lastRef (volatile — newest wins in the RPC), so
    //    the next "the property / features / link / view it" resolves to it.
    // Pin lastRef: a single shown card, OR the reference we just resolved+answered.
    const shownRef = attachments.length === 1 ? attachments[0].ref
      : (inListingChat && activeRef ? activeRef : null);
    const outPatch = JSON.stringify({ ...funnelExtra, ...(shownRef ? { lastRef: shownRef } : {}) });
    await db.execute(sql`
      SELECT * FROM public.amanda_append_message(
        ${slug}, ${v.sessionToken}, ${'outbound'}, ${reply}, ${outPatch}::jsonb, ${REQUIRE_TEST_AGENCY}
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
      if (humanRequested) {
        await db.execute(sql`
          SELECT * FROM public.amanda_tag_human_request(${slug}, ${v.sessionToken}, ${REQUIRE_TEST_AGENCY})
        `);
      }
    }

    return c.json({ ok: true, reply, messageType, attachments, collected, captured, awaitingContact, viewing, viewingRef, human: humanRequested });
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
