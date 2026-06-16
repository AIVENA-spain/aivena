import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { env } from '../../../../packages/config/env';
import { supabaseAdmin } from '../lib/supabase-admin';

/**
 * Studio wizard proxy (W13 v0.6) — the browser's ONLY door to Vega's image
 * Edge Functions. Each route:
 *   1. runs under authMiddleware + agencyContextMiddleware (session → agencyId,
 *      tx with app.current_agency_id set, RLS-fenced),
 *   2. resolves agency_id + requested_by from the SESSION (never the body — a
 *      client cannot act on another agency by passing an id),
 *   3. holds the internal secret server-side (read once via _get_platform_secret,
 *      cached for the process; never sent to the browser, never logged, never an
 *      env var), and
 *   4. returns the { ok, error?, message?, ...data } envelope. The EF already
 *      composes/derives/localises everything — we add no generation logic.
 *
 * Browser → THIS → Edge Function (x-internal-secret). The secret never crosses
 * the first arrow.
 */

const route = new Hono();

const EF_BASE = `${env.SUPABASE_URL}/functions/v1`;

// ── internal secret: read once, cache for the process lifetime ─────────────
let secretCache: Promise<string | null> | null = null;
async function fetchSecret(): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('_get_platform_secret', {
      p_name: 'IMAGE_GEN_INTERNAL_SECRET',
    });
    if (error || !data) {
      console.error('[studio] _get_platform_secret failed:', error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.error('[studio] _get_platform_secret threw:', err);
    return null;
  }
}
function internalSecret(): Promise<string | null> {
  if (!secretCache) {
    secretCache = fetchSecret().then((s) => {
      if (s === null) secretCache = null; // a null is transient — allow retry
      return s;
    });
  }
  return secretCache;
}

const GENERIC = 'Something went wrong. Please try again.';
const INVALID = { ok: false, error: 'invalid_request', message: GENERIC } as const;

async function readJson(c: import('hono').Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Forward a body to an Edge Function with the internal secret; return the EF's
 *  status + JSON verbatim (the EF responses are already the envelope, carrying
 *  Vega's specific error codes + friendly messages + status codes). */
async function callEf(
  c: import('hono').Context,
  fnName: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const secret = await internalSecret();
  if (!secret) {
    return c.json({ ok: false, error: 'credentials_unavailable', message: GENERIC }, 503);
  }
  let res: globalThis.Response;
  try {
    res = await fetch(`${EF_BASE}/${fnName}`, {
      method: 'POST',
      headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[studio] ${fnName} fetch failed:`, err);
    return c.json({ ok: false, error: 'upstream_unreachable', message: GENERIC }, 502);
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) {
    return c.json({ ok: false, error: 'bad_upstream_response', message: GENERIC }, 502);
  }
  // Forward the EF's own status (200, 409 quota, 502 kie, …) and body. Never
  // expose anything the EF didn't already deem user-safe.
  return c.json(json, res.status as 200);
}

// ── shared design-field whitelist ──────────────────────────────────────────
const GEN_TYPES = new Set(['ad_creative', 'social_post', 'renovation']);
const CONTENT_TYPES = new Set(['listing', 'brand', 'educational', 'sold', 'launch']);
const COMPOSITIONS = new Set([
  // Original 6
  'full_bleed', 'bottom_panel', 'side_panel', 'framed', 'split', 'collage',
  // v10 drop — 9 new single-photo layouts (studio-compose v10 / create v10).
  'magazine', 'editorial', 'postcard', 'band', 'quote', 'stat',
  'statement', 'project', 'price_hero',
  // v3.5 — premium new-development hero (studio-compose v3.5.1 / create v0.6.5).
  'launch_hero',
]);
const TEXT_TREATMENTS = new Set(['on_photo', 'scrim', 'negative_space']);
const FONT_SETS = new Set(['serif', 'sans', 'mixed']);
const COLOR_TREATMENTS = new Set(['photo_only', 'accent_line', 'color_block']);
const MOODS = new Set(['sunny_bright', 'golden_hour', 'cozy_evening', 'clean_neutral']);

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;
const enumOr = (v: unknown, set: Set<string>): string | undefined =>
  typeof v === 'string' && set.has(v) ? v : undefined;

/**
 * Build the design body forwarded to image-generate-create (shared by preview
 * + generate). agency_id is injected by the caller, never read from the client.
 * Copy-override fields pass through untouched (incl. "" to hide a derived
 * field, per the EF contract). Unknown/invalid enums are dropped so the EF
 * falls back to its documented defaults.
 */
function buildDesignBody(b: Record<string, unknown>): Record<string, unknown> | null {
  const generation_type = enumOr(b.generation_type, GEN_TYPES);
  const content_type = enumOr(b.content_type, CONTENT_TYPES);
  const composition = enumOr(b.composition, COMPOSITIONS);
  if (!generation_type || !content_type || !composition) return null;

  const out: Record<string, unknown> = { generation_type, content_type, composition };

  const passEnum = (k: string, set: Set<string>) => {
    const v = enumOr(b[k], set);
    if (v) out[k] = v;
  };
  passEnum('text_treatment', TEXT_TREATMENTS);
  passEnum('font_set', FONT_SETS);
  passEnum('color_treatment', COLOR_TREATMENTS);

  // Subject paths.
  if (str(b.source_property_id)) out.source_property_id = b.source_property_id;
  if (Array.isArray(b.image_urls)) {
    out.image_urls = (b.image_urls as unknown[]).filter((u) => typeof u === 'string');
  }
  if (Array.isArray(b.image_storage_paths)) {
    out.image_storage_paths = (b.image_storage_paths as unknown[]).filter(
      (u) => typeof u === 'string',
    );
  }
  if (str(b.source_image_url)) out.source_image_url = b.source_image_url;

  // Format.
  if (Number.isInteger(b.width)) out.width = b.width;
  if (Number.isInteger(b.height)) out.height = b.height;

  if (str(b.language)) out.language = b.language;

  // Copy overrides — pass through verbatim (including empty string = hide).
  // price_text is a display-ready string the renderer draws as-is (sold/launch).
  for (const k of ['headline', 'kicker', 'cta_text', 'tagline', 'badge_text', 'badge_label', 'price_text']) {
    if (typeof b[k] === 'string') out[k] = b[k];
  }
  if (Array.isArray(b.bullets)) {
    out.bullets = (b.bullets as unknown[]).filter((x) => typeof x === 'string').slice(0, 4);
  }
  if (Array.isArray(b.stats)) {
    out.stats = (b.stats as unknown[])
      .filter(
        (s): s is { label: unknown; value: unknown } =>
          !!s && typeof s === 'object' && 'label' in s && 'value' in s,
      )
      .map((s) => ({ label: String(s.label), value: String(s.value) }))
      .slice(0, 3);
  }
  return out;
}

// ── POST /api/studio/preview — free, instant, no quota ─────────────────────
route.post('/preview', async (c) => {
  const agencyId = c.get('agencyId');
  const b = await readJson(c);
  const design = buildDesignBody(b);
  if (!design) return c.json(INVALID, 400);
  return callEf(c, 'image-generate-create', {
    ...design,
    agency_id: agencyId,
    preview_only: true,
  });
});

// ── POST /api/studio/generate — the real render (costs one quota unit) ─────
route.post('/generate', async (c) => {
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  const b = await readJson(c);

  // Renovation (room redesign) is a distinct path: no design overlay, no
  // composition/content_type. template:"none" tells the EF to return the
  // redesigned PHOTO, not a marketing creative. Source must be a public URL
  // kie.ai can fetch; width/height omitted so the room's framing is kept.
  if (b.generation_type === 'renovation') {
    const sourceImageUrl = str(b.source_image_url);
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
    if (!sourceImageUrl) {
      return c.json(
        { ok: false, error: 'missing_source_image', message: 'Please add a room photo to redesign.' },
        400,
      );
    }
    if (!prompt) {
      return c.json(
        { ok: false, error: 'missing_prompt', message: 'Please describe the new look you want.' },
        400,
      );
    }
    const renoBody: Record<string, unknown> = {
      agency_id: agencyId,
      requested_by: user?.sub,
      generation_type: 'renovation',
      template: 'none',
      source_image_url: sourceImageUrl,
      prompt,
    };
    if (str(b.language)) renoBody.language = b.language;
    return callEf(c, 'image-generate-create', renoBody);
  }

  const design = buildDesignBody(b);
  if (!design) return c.json(INVALID, 400);

  const body: Record<string, unknown> = {
    ...design,
    agency_id: agencyId,
    requested_by: user?.sub,
  };
  const mood = enumOr(b.mood, MOODS);
  if (mood) body.mood = mood;
  if (typeof b.prompt === 'string' && b.prompt.trim()) body.prompt = b.prompt.trim();
  return callEf(c, 'image-generate-create', body);
});

// ── POST /api/studio/revise — free natural-language revision (max 2) ───────
route.post('/revise', async (c) => {
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  const b = await readJson(c);
  const generationId = str(b.generation_id);
  const editNote = str(b.edit_note);
  if (!generationId || !editNote || !editNote.trim()) return c.json(INVALID, 400);
  return callEf(c, 'image-generate-revise', {
    generation_id: generationId,
    agency_id: agencyId,
    edit_note: editNote.trim(),
    requested_by: user?.sub,
  });
});

// ── result shaping (status + library) ──────────────────────────────────────
type GenRow = {
  id: string;
  status: string;
  generation_type: string;
  result_image_url: string | null;
  result_metadata: Record<string, unknown> | null;
  raw_request: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
};

function metaNum(meta: Record<string, unknown> | null, ...path: string[]): number | null {
  let cur: unknown = meta;
  for (const p of path) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'number' ? cur : null;
}

function shapeStatus(r: GenRow) {
  const composed = !!(r.result_metadata && r.result_metadata.composed === true);
  const meta = r.result_metadata;
  // Vega v0.4.2: the slot is reserved atomically at accept-time, so
  // `revisions_remaining` (= 2 - revisions_started) is authoritative and
  // accounts for the in-flight one — use it directly, never recompute from
  // completed (`revisions_used` lags ~90s behind kie). Fall back to the
  // started/used math only on older rows that predate these fields.
  const started = metaNum(meta, 'revisions_started');
  const used = metaNum(meta, 'revisions_used') ?? 0;
  const remaining =
    metaNum(meta, 'revisions_remaining') ??
    (started != null ? Math.max(0, 2 - started) : Math.max(0, 2 - used));
  return {
    id: r.id,
    status: r.status,
    generation_type: r.generation_type,
    content_type:
      (r.raw_request && typeof r.raw_request.content_type === 'string'
        ? (r.raw_request.content_type as string)
        : null) ?? null,
    image_url: r.result_image_url,
    composed,
    qc_score: metaNum(r.result_metadata, 'qc', 'score'),
    revisions_used: used, // completed only — for display ("N edits applied")
    revisions_remaining: remaining,
    // A failed revision refunds its slot and leaves the image unchanged.
    last_revision_error: !!(meta && meta.last_revision_error === true),
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

// ── GET /api/studio/status/:id — poll (DB read, RLS-fenced) ────────────────
route.get('/status/:id', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const id = c.req.param('id');
  try {
    const result = await tx.execute(sql`
      SELECT id, status::text AS status, generation_type, result_image_url,
             result_metadata, raw_request, created_at, completed_at
      FROM image_generations
      WHERE id = ${id}::uuid AND agency_id = ${agencyId}
      LIMIT 1
    `);
    const rows = result as unknown as GenRow[];
    if (rows.length === 0) {
      return c.json({ ok: false, error: 'not_found', message: 'That image could not be found.' }, 404);
    }
    const r = rows[0];
    if (r.status === 'failed') {
      return c.json({
        ok: true,
        id: r.id,
        status: 'failed',
        message: "That image couldn't be generated. Please try again.",
      });
    }
    return c.json({ ok: true, ...shapeStatus(r) });
  } catch (err) {
    console.error('[studio/status] failed:', err);
    return c.json({ ok: false, error: 'status_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/library — finished images, newest first ────────────────
route.get('/library', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100);
  const before = c.req.query('before');
  try {
    const result = await tx.execute(sql`
      SELECT id, generation_type, result_image_url, result_metadata, created_at,
             raw_request->>'content_type' AS content_type
      FROM image_generations
      WHERE agency_id = ${agencyId}
        AND status = 'completed' AND result_image_url IS NOT NULL
        ${before ? sql`AND created_at < ${before}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = result as unknown as Array<
      GenRow & { content_type: string | null }
    >;
    return c.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        image_url: r.result_image_url,
        generation_type: r.generation_type,
        content_type: r.content_type,
        created_at: r.created_at,
        revisions_used: metaNum(r.result_metadata, 'revisions_used') ?? 0,
      })),
    });
  } catch (err) {
    console.error('[studio/library] failed:', err);
    return c.json({ ok: false, error: 'library_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/properties — picker list ───────────────────────────────
route.get('/properties', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  try {
    const result = await tx.execute(sql`
      SELECT id, title, location_city, location_region, price, bedrooms, bathrooms, images
      FROM properties
      WHERE agency_id = ${agencyId}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const rows = result as unknown as Array<{
      id: string; title: string; location_city: string | null;
      location_region: string | null; price: string | number | null;
      bedrooms: number | null; bathrooms: number | null; images: string[] | null;
    }>;
    return c.json({
      ok: true,
      items: rows.map((r) => {
        const imgs = Array.isArray(r.images) ? r.images : [];
        return {
          id: r.id,
          title: r.title,
          location_city: r.location_city,
          price: r.price == null ? null : Number(r.price),
          bedrooms: r.bedrooms,
          bathrooms: r.bathrooms,
          photo_count: imgs.length,
          thumb_url: imgs[0] ?? null,
        };
      }),
    });
  } catch (err) {
    console.error('[studio/properties] failed:', err);
    return c.json({ ok: false, error: 'properties_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/properties/:id/photos — gallery for a chosen property ──
route.get('/properties/:id/photos', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const id = c.req.param('id');
  try {
    const result = await tx.execute(sql`
      SELECT id, title, images
      FROM properties
      WHERE id = ${id}::uuid AND agency_id = ${agencyId}
      LIMIT 1
    `);
    const rows = result as unknown as Array<{ id: string; title: string; images: string[] | null }>;
    if (rows.length === 0) {
      return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    }
    const photos = (Array.isArray(rows[0].images) ? rows[0].images : []).filter(
      (u) => typeof u === 'string',
    );
    return c.json({ ok: true, property_id: rows[0].id, title: rows[0].title, photos });
  } catch (err) {
    console.error('[studio/properties/photos] failed:', err);
    return c.json({ ok: false, error: 'photos_failed', message: GENERIC }, 500);
  }
});

export default route;
