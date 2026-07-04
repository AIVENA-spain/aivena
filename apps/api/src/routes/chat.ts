import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../../../../packages/db/client';
import { validateContact, validateMessage, mapCaptureError, createRateLimiter } from './chat-lib';
import { parseMessage, replyForCollected, type Collected } from './amanda-flow';

/**
 * Amanda web-chat — PUBLIC (unauthenticated) capture endpoints. Mounted at /chat
 * OUTSIDE /api/* so the JWT auth + agency-context middleware never run. There is
 * no user/agency context here; the agency is derived from the :agencySlug and
 * all writes go through the SECURITY DEFINER `amanda_capture_lead` RPC, which
 * resolves the agency + sets the RLS GUC itself.
 *
 * Slice 1: POST /chat/:agencySlug/contact — a structured contact capture becomes
 * a real lead (channel=website / source=aivena_website / source_type=website_chat)
 * + a website conversation + a dashboard task, visible in the existing Inbox /
 * Tasks / ClientIntelligence with property matches. NO LLM, NO provider/WhatsApp
 * send, NO live message — pure data capture.
 *
 * Production-safe guards: consent required, input validated + length-capped, a
 * basic in-memory rate limit, IP is HASHED (never stored/logged raw), and the
 * RPC is gated to is_test agencies (REQUIRE_TEST) until the public widget ships.
 */
const route = new Hono();

// Slice-1 safety: only is_test agencies may be captured to until the widget
// launches. Flip to false (per-agency enablement) when going live.
const REQUIRE_TEST_AGENCY = true;

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
  return createHash('sha256').update(raw).digest('hex').slice(0, 32); // hashed — raw IP never stored/logged
}

async function readBody(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// POST /chat/:agencySlug/contact — capture → lead + conversation + task.
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

  try {
    await db.execute(sql`
      SELECT * FROM public.amanda_capture_lead(
        ${slug}, ${v.sessionToken}, ${v.name}, ${v.email}, ${v.phone}, ${true},
        ${v.language}, ${v.intent}, ${v.budget}, ${v.budgetMax}, ${v.location}, ${v.bedroomsMin},
        ${v.propertyType}, ${v.transcript ? JSON.stringify(v.transcript) : null}::jsonb,
        ${v.pageUrl}, ${v.referrer}, ${ipHash}, ${REQUIRE_TEST_AGENCY}
      )
    `);
    // No internal ids returned to the public caller.
    return c.json({ ok: true });
  } catch (err) {
    const pg = asPgError(err);
    if (pg && pg.code === 'P0001') {
      const m = mapCaptureError(pg.message.trim());
      return c.json({ ok: false, error: m.msg }, m.status);
    }
    // Never leak SQL/table/code; log only the slug + generic detail.
    console.error('[chat/contact] capture failed for slug:', slug, pg ? pg.code : 'non-pg-error');
    return c.json({ ok: false, error: 'Something went wrong — please try again.' }, 500);
  }
});

// POST /chat/:agencySlug/message — Slice 2: one rules-based conversational turn
// (NO LLM). Appends the visitor's message + merges parsed qualification, returns a
// deterministic next prompt, and — only when contact is present AND consent is
// given — hands off to the existing amanda_capture_lead to materialise the lead.
// is_test-gated; no provider/send; no automation.
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

  try {
    // 1) Parse light facts; append the visitor's inbound message + merge the patch.
    const patch = parseMessage(v.message);
    const inbound = await db.execute(sql`
      SELECT * FROM public.amanda_append_message(
        ${slug}, ${v.sessionToken}, ${'inbound'}, ${v.message},
        ${JSON.stringify(patch)}::jsonb, ${REQUIRE_TEST_AGENCY}
      )
    `);
    const collected = ((inbound as unknown as Array<{ collected: Record<string, unknown> }>)[0]?.collected ?? {}) as Collected;

    // 2) Deterministic reply (no LLM) from the server-merged state.
    const addedNothing = Object.keys(patch).length === 0;
    const { reply, readyToCapture } = replyForCollected(collected, addedNothing, v.language ?? undefined);

    // 3) Append Amanda's outbound reply.
    await db.execute(sql`
      SELECT * FROM public.amanda_append_message(
        ${slug}, ${v.sessionToken}, ${'outbound'}, ${reply}, ${'{}'}::jsonb, ${REQUIRE_TEST_AGENCY}
      )
    `);

    // 4) Hand off to capture ONLY when contact is ready AND the visitor consented.
    let captured = false;
    if (readyToCapture && v.consent) {
      await db.execute(sql`
        SELECT * FROM public.amanda_capture_lead(
          ${slug}, ${v.sessionToken}, ${collected.name ?? null}, ${collected.email ?? null}, ${collected.phone ?? null}, ${true},
          ${v.language}, ${collected.intent ?? null}, ${null}, ${collected.budgetMax ?? null},
          ${collected.location ?? null}, ${collected.bedroomsMin ?? null}, ${collected.propertyType ?? null},
          ${null}::jsonb, ${null}, ${null}, ${ipHash}, ${REQUIRE_TEST_AGENCY}
        )
      `);
      captured = true;
    }

    // Return the deterministic next prompt + the visitor's own collected facts
    // (no internal ids). `captured` tells the widget the lead was materialised.
    return c.json({ ok: true, reply, collected, captured });
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
