import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { env } from '../../../../packages/config/env';
import { supabaseAdmin } from '../lib/supabase-admin';
import { loadPhotoBuffer } from '../lib/studio-internal';
import {
  catalogue as editableCatalogue,
  editableDefaults,
  renderAndStore,
  mapPropertyRow,
  mapBranding,
  isKnownTemplate,
  isBrandColours,
  COLOUR_SCHEMES,
  GALLERY_NEUTRAL,
  galleryAccent,
  galleryAccentOverrides,
} from '../lib/studio-editable';

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
      SELECT id, generation_type, result_image_url, result_metadata, created_at, section,
             raw_request->>'content_type' AS content_type
      FROM image_generations
      WHERE agency_id = ${agencyId}
        AND status = 'completed' AND result_image_url IS NOT NULL
        ${before ? sql`AND created_at < ${before}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = result as unknown as Array<
      GenRow & { content_type: string | null; section: string | null }
    >;
    return c.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id,
        image_url: r.result_image_url,
        generation_type: r.generation_type,
        content_type: r.content_type,
        section: r.section,
        created_at: r.created_at,
        revisions_used: metaNum(r.result_metadata, 'revisions_used') ?? 0,
      })),
    });
  } catch (err) {
    console.error('[studio/library] failed:', err);
    return c.json({ ok: false, error: 'library_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/properties?q= — picker list, optional area/title search ──
route.get('/properties', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const q = (c.req.query('q') || '').trim();
  try {
    // area/title search (Christian's flow: "search for the property using area like torrevieja").
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    const result = q
      ? await tx.execute(sql`
          SELECT id, title, location_city, location_region, price, bedrooms, bathrooms,
                 area_built_sqm, area_sqm, images
          FROM properties
          WHERE agency_id = ${agencyId}
            AND (location_city ILIKE ${like} OR location_region ILIKE ${like} OR title ILIKE ${like})
          ORDER BY created_at DESC LIMIT 100`)
      : await tx.execute(sql`
          SELECT id, title, location_city, location_region, price, bedrooms, bathrooms,
                 area_built_sqm, area_sqm, images
          FROM properties
          WHERE agency_id = ${agencyId}
          ORDER BY created_at DESC LIMIT 100`);
    const rows = result as unknown as Array<{
      id: string; title: string; location_city: string | null;
      location_region: string | null; price: string | number | null;
      bedrooms: number | null; bathrooms: number | null;
      area_built_sqm: number | null; area_sqm: number | null; images: string[] | null;
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
          // built area preferred over plot (Christian: every property card shows beds · baths · area)
          area: r.area_built_sqm ?? r.area_sqm ?? null,
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

// ═══════════════════════════════════════════════════════════════════════════
// EDITABLE-TEMPLATE ENGINE (the 18 accepted strip-plate templates) — Phase 2.
// The browser's door to the deterministic renderer (deriveSlots draws all facts,
// never invents; palette_locked templates keep their colours). This proxy looks
// up the property + agency branding server-side and calls the shared renderer.
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/studio/editable-templates — the catalogue for the picker ──────────
// Metadata per template: photo_count (drives the image-count filter), editable
// text slots, and colour layers. Thumbnails are added by a follow-up.
route.get('/editable-templates', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  try {
    // colour schemes: the agency's OWN brand first ("Your brand"), then the curated presets.
    let schemes = COLOUR_SCHEMES;
    try {
      const bRes = await tx.execute(sql`
        SELECT brand_name, primary_color, accent_color, background_color, text_color,
               phone, whatsapp_number, website_url, sender_email, email_signature_name
        FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
      `);
      const bRows = bRes as unknown as any[];
      if (bRows[0]) {
        const { brand } = mapBranding(bRows[0]);
        schemes = [{ id: 'your_brand', name: 'Your brand', brand }, ...COLOUR_SCHEMES];
      }
    } catch { /* branding read failed → just the presets */ }
    return c.json({ ok: true, templates: editableCatalogue(), colour_schemes: schemes });
  } catch (err) {
    console.error('[studio/editable-templates] failed:', err);
    return c.json({ ok: false, error: 'catalogue_failed', message: GENERIC }, 500);
  }
});

// helper: load a property (facts) + the agency branding for the session's agency.
async function loadPropertyAndBrand(tx: any, agencyId: string, propertyId: string) {
  const pRes = await tx.execute(sql`
    SELECT property_type, location_city, location_region, price, area_sqm, area_built_sqm,
           bedrooms, bathrooms, features, images
    FROM properties WHERE id = ${propertyId}::uuid AND agency_id = ${agencyId} LIMIT 1
  `);
  const pRows = pRes as unknown as any[];
  if (pRows.length === 0) return null;
  const bRes = await tx.execute(sql`
    SELECT brand_name, primary_color, accent_color, background_color, text_color,
           phone, whatsapp_number, website_url, sender_email, email_signature_name
    FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
  `);
  const bRows = bRes as unknown as any[];
  const { agency, brand } = mapBranding(bRows[0] || {});
  return {
    property: mapPropertyRow(pRows[0]),
    agency, brand,
    images: (Array.isArray(pRows[0].images) ? pRows[0].images : []).filter((u: unknown) => typeof u === 'string'),
  };
}

// Interactive-editor override parsers (defensive — reject anything not the {slotId: {x,y}} / {slotId: number} shape).
function parsePositions(v: unknown): Record<string, { x: number; y: number }> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, { x: number; y: number }> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const o = val as { x?: unknown; y?: unknown };
    if (o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number' && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      out[k] = { x: o.x, y: o.y };
    }
  }
  return Object.keys(out).length ? out : undefined;
}
function parseSizes(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val) && val >= 6 && val <= 400) out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

// ── GET /api/studio/editable-defaults?template_id&property_id ─────────────────
// Pre-fill for the editing form: derived default text per slot + effective colour
// per layer (from the agency brand) + the property's photos.
route.get('/editable-defaults', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const templateId = (c.req.query('template_id') || '').trim();
  const propertyId = (c.req.query('property_id') || '').trim();
  if (!isKnownTemplate(templateId)) {
    return c.json({ ok: false, error: 'invalid_template', message: 'Unknown template.' }, 400);
  }
  try {
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    const defaults = editableDefaults(templateId, loaded.property, loaded.agency, loaded.brand);
    return c.json({ ok: true, ...defaults, photos: loaded.images });
  } catch (err) {
    console.error('[studio/editable-defaults] failed:', err);
    return c.json({ ok: false, error: 'defaults_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/editable-preview — render with the user's edits ──────────
// Body: { template_id, property_id, photos: string[] (chosen refs), text_overrides?,
// colour_overrides? }. Free (no quota) — same contract as /preview. Returns a
// signed image URL.
route.post('/editable-preview', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  let b: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }
  const templateId = typeof b.template_id === 'string' ? b.template_id.trim() : '';
  const propertyId = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  if (!isKnownTemplate(templateId)) {
    return c.json({ ok: false, error: 'invalid_template', message: 'Unknown template.' }, 400);
  }
  try {
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    // chosen photos: the refs the wizard selected (must be from this property's own images) — else all of them.
    const chosen = Array.isArray(b.photos) ? (b.photos as unknown[]).filter((u): u is string => typeof u === 'string' && loaded.images.includes(u)) : [];
    const refs = chosen.length ? chosen : loaded.images;
    if (refs.length === 0) return c.json({ ok: false, error: 'no_photos', message: 'This property has no photos to use.' }, 422);
    // Cleaned photos (post-KIE finishing pass) stand in for the raw listing photos — SAME template, SAME text,
    // watermark-free images. Handles are generation IDS only (agency-scoped lookup), never client-supplied URLs.
    const cleanedIds = Array.isArray(b.cleaned_generation_ids)
      ? (b.cleaned_generation_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const buffers: Buffer[] = cleanedIds.length ? await cleanedBuffers(tx, agencyId, cleanedIds) : [];
    if (!buffers.length) {
      for (const ref of refs) { const buf = await loadPhotoBuffer(ref); if (buf) buffers.push(buf); }
    }
    if (buffers.length === 0) return c.json({ ok: false, error: 'photo_fetch_failed', message: "The selected photos couldn't be loaded." }, 422);

    // AUTO: a tapped scheme overrides the agency's own brand (validated hex quad). MANUAL: per-layer wheel picks.
    const brand = isBrandColours(b.brand) ? b.brand : loaded.brand;
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : undefined);
    const stored = await renderAndStore({
      templateId, property: loaded.property, agency: loaded.agency, brand, photoBuffers: buffers,
      textOverrides: obj(b.text_overrides),
      colourOverrides: obj(b.colour_overrides),
      manualColours: obj(b.manual_colours),
      positionOverrides: parsePositions(b.position_overrides),
      sizeOverrides: parseSizes(b.size_overrides),
      agencyId, propertyId, photoRefs: cleanedIds.length ? cleanedIds : refs, // deterministic cache key → reuse identical renders, no churn
    });
    return c.json({ ok: true, template_id: templateId, image_url: stored.image_url, storage_path: stored.storage_path });
  } catch (err) {
    console.error('[studio/editable-preview] failed:', err);
    return c.json({ ok: false, error: 'preview_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/editable-gallery — the Templates gallery render PLAN ────────
// Christian 2026-07-13: the Templates section shows every template against the agency's most-expensive listings,
// in a neutral palette with a shifting pop accent, so it always looks great. This returns the PLAN (which listing
// + which photos + which neutral-brand/accent per template); the browser then renders each via /editable-preview,
// which caches on a deterministic key so repeat visits are instant.
route.get('/editable-gallery', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  try {
    // top listings by price. price IS NOT NULL — else Postgres sorts NULLs first on DESC and the "top" would be
    // null-price rows.
    const pRes = await tx.execute(sql`
      SELECT id, title, images
      FROM properties
      WHERE agency_id = ${agencyId} AND price IS NOT NULL
      ORDER BY price DESC
      LIMIT 4
    `);
    const pRows = pRes as unknown as Array<{ id: string; title: string | null; images: string[] | null }>;
    const listings = pRows
      .map((r) => ({
        id: r.id, title: r.title,
        photos: (Array.isArray(r.images) ? r.images : []).filter((u): u is string => typeof u === 'string'),
      }))
      .filter((l) => l.photos.length > 0);

    if (listings.length === 0) {
      return c.json({ ok: true, has_listings: false, templates: [] });
    }

    // assign each template a listing that has enough photos (round-robin from the tile index so the four houses
    // vary across the grid) + a shifting accent.
    const items = editableCatalogue()
      .map((t, i) => {
        let chosen: { id: string; title: string | null; photos: string[] } | null = null;
        for (let k = 0; k < listings.length; k++) {
          const cand = listings[(i + k) % listings.length];
          if (cand.photos.length >= t.photo_count) { chosen = cand; break; }
        }
        if (!chosen) return null; // no listing has enough photos for this template
        const hex = galleryAccent(i);
        return {
          template_id: t.id,
          property_id: chosen.id,
          property_title: chosen.title,
          photos: chosen.photos.slice(0, t.photo_count),
          palette_locked: t.palette_locked,
          brand: { ...GALLERY_NEUTRAL, gold: hex },          // neutral base, shifting accent in the gold slot
          colour_overrides: galleryAccentOverrides(hex),      // pin the accent to roles every template draws
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return c.json({ ok: true, has_listings: true, templates: items });
  } catch (err) {
    console.error('[studio/editable-gallery] failed:', err);
    return c.json({ ok: false, error: 'gallery_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/editable-sections — the agency's own library sections ──────
route.get('/editable-sections', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  try {
    const res = await tx.execute(sql`
      SELECT DISTINCT section FROM image_generations
      WHERE agency_id = ${agencyId} AND section IS NOT NULL AND section <> ''
      ORDER BY section
    `);
    const rows = res as unknown as Array<{ section: string }>;
    return c.json({ ok: true, sections: rows.map((r) => r.section) });
  } catch (err) {
    console.error('[studio/editable-sections] failed:', err);
    return c.json({ ok: false, error: 'sections_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/set-section — file an EXISTING creation under a section ────
// Used by the AI flow (its image is already a row); pass section='' or null to clear.
route.post('/set-section', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  let b: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }
  const id = typeof b.generation_id === 'string' ? b.generation_id.trim() : '';
  const section = typeof b.section === 'string' && b.section.trim() ? b.section.trim().slice(0, 80) : null;
  if (!id) return c.json({ ok: false, error: 'invalid_id', message: 'Missing creation id.' }, 400);
  try {
    const res = await tx.execute(sql`
      UPDATE image_generations SET section = ${section}
      WHERE id = ${id}::uuid AND agency_id = ${agencyId}
      RETURNING id
    `);
    const rows = res as unknown as Array<{ id: string }>;
    if (rows.length === 0) return c.json({ ok: false, error: 'not_found', message: 'That creation could not be found.' }, 404);
    return c.json({ ok: true, id: rows[0].id, section });
  } catch (err) {
    console.error('[studio/set-section] failed:', err);
    return c.json({ ok: false, error: 'set_section_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/editable-generate — render + SAVE TO LIBRARY (+ section) ──
// The explicit "save" action from the edit step (unlike /editable-preview, which is the free, high-frequency
// live-preview path and records nothing). Records one image_generations row so the creation shows in Recent
// creations / Your library, filed under an optional section. Deterministic (does NOT consume AI quota — templates
// are the free, deterministic path; the counter in agency_settings is untouched).
route.post('/editable-generate', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  let b: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }
  const templateId = typeof b.template_id === 'string' ? b.template_id.trim() : '';
  const propertyId = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  const section = typeof b.section === 'string' && b.section.trim() ? b.section.trim().slice(0, 80) : null;
  if (!isKnownTemplate(templateId)) {
    return c.json({ ok: false, error: 'invalid_template', message: 'Unknown template.' }, 400);
  }
  try {
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    const chosen = Array.isArray(b.photos) ? (b.photos as unknown[]).filter((u): u is string => typeof u === 'string' && loaded.images.includes(u)) : [];
    const refs = chosen.length ? chosen : loaded.images;
    if (refs.length === 0) return c.json({ ok: false, error: 'no_photos', message: 'This property has no photos to use.' }, 422);
    // Cleaned photos (post-KIE finishing pass) stand in for the raw listing photos — SAME template, SAME text,
    // watermark-free images. Handles are generation IDS only (agency-scoped lookup), never client-supplied URLs.
    const cleanedIds = Array.isArray(b.cleaned_generation_ids)
      ? (b.cleaned_generation_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const buffers: Buffer[] = cleanedIds.length ? await cleanedBuffers(tx, agencyId, cleanedIds) : [];
    if (!buffers.length) {
      for (const ref of refs) { const buf = await loadPhotoBuffer(ref); if (buf) buffers.push(buf); }
    }
    if (buffers.length === 0) return c.json({ ok: false, error: 'photo_fetch_failed', message: "The selected photos couldn't be loaded." }, 422);

    const brand = isBrandColours(b.brand) ? b.brand : loaded.brand;
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : undefined);
    const stored = await renderAndStore({
      templateId, property: loaded.property, agency: loaded.agency, brand, photoBuffers: buffers,
      textOverrides: obj(b.text_overrides),
      colourOverrides: obj(b.colour_overrides),
      manualColours: obj(b.manual_colours),
      positionOverrides: parsePositions(b.position_overrides),
      sizeOverrides: parseSizes(b.size_overrides),
      agencyId, propertyId, photoRefs: cleanedIds.length ? cleanedIds : refs,
    });

    // Record in the library (RLS-fenced tx). content_type lives inside raw_request (no such column); the library
    // reads raw_request->>'content_type'. generation_type must satisfy the CHECK (ad_creative|social_post|
    // renovation) → 'social_post'; the real discriminator is engine:'editable_template'.
    const inserted = await tx.execute(sql`
      INSERT INTO image_generations
        (agency_id, generation_type, status, prompt, source_property_id, requested_by,
         result_image_url, result_image_storage_path, section, raw_request, result_metadata, completed_at)
      VALUES
        (${agencyId}, 'social_post', 'completed', ${`Template ${templateId}`}, ${propertyId}::uuid, ${user?.sub ?? null}::uuid,
         ${stored.image_url}, ${stored.storage_path}, ${section},
         ${JSON.stringify({ engine: 'editable_template', template_id: templateId, content_type: 'template' })}::jsonb,
         ${JSON.stringify({ engine: 'editable_template' })}::jsonb, now())
      RETURNING id
    `);
    const rows = inserted as unknown as Array<{ id: string }>;
    return c.json({
      ok: true, id: rows[0]?.id ?? null, template_id: templateId,
      image_url: stored.image_url, storage_path: stored.storage_path, section,
    });
  } catch (err) {
    console.error('[studio/editable-generate] failed:', err);
    return c.json({ ok: false, error: 'generate_failed', message: GENERIC }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KIE FINISHING PASS (Christian 2026-07-14). The deterministic template renders the RAW listing photos, which
// carry portal watermarks. KIE's role is PHOTOS ONLY: hand it each chosen photo, tell it to remove watermarks +
// make the minor aesthetic/lighting changes asked for, and put the cleaned photo BACK INTO THE TEMPLATE. It
// never sees or touches the text or the layout — the engine still draws every fact itself.
// One KIE job per photo (each job returns one cleaned image). `template:'none'` = raw cleaned photo out, no
// overlay. ENHANCE_BASE (watermark removal + scene lock) is always applied; `prompt` rides as extra direction.
// ═══════════════════════════════════════════════════════════════════════════

// KIE fetches the source itself, so it must be a PUBLICLY reachable URL. Portal hotlinks already are; an
// owned photo lives in the private property-images bucket and needs a signed URL.
async function kieFetchableUrl(ref: string): Promise<string | null> {
  if (/^https?:\/\//i.test(ref)) return ref;
  const { data, error } = await supabaseAdmin.storage.from('property-images').createSignedUrl(ref, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Resolve cleaned-photo generation ids → image buffers. Agency-scoped + completed-only (a client can never
 *  point this at someone else's image, and ids are the only accepted handle — never raw URLs). */
async function cleanedBuffers(tx: any, agencyId: string, ids: string[]): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const id of ids) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) continue;
    const res = await tx.execute(sql`
      SELECT result_image_storage_path FROM image_generations
      WHERE id = ${id}::uuid AND agency_id = ${agencyId} AND status = 'completed'
      LIMIT 1
    `);
    const rows = res as unknown as Array<{ result_image_storage_path: string | null }>;
    const path = rows[0]?.result_image_storage_path;
    if (!path) continue;
    const dl = await supabaseAdmin.storage.from('generated-images').download(path);
    if (dl.error || !dl.data) continue;
    out.push(Buffer.from(await dl.data.arrayBuffer()));
  }
  return out;
}

// ── POST /api/studio/editable-finish — hand each chosen photo to KIE (watermark + aesthetic) ──
// Body: { property_id, photos?: string[], note?: string }. Returns one job per photo; the browser polls
// /api/studio/status/:id for each, then re-renders the template with cleaned_generation_ids.
route.post('/editable-finish', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  let b: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }
  const propertyId = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 900) : '';
  try {
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    const chosen = Array.isArray(b.photos) ? (b.photos as unknown[]).filter((u): u is string => typeof u === 'string' && loaded.images.includes(u)) : [];
    const refs = chosen.length ? chosen : loaded.images;
    if (refs.length === 0) return c.json({ ok: false, error: 'no_photos', message: 'This property has no photos to clean up.' }, 422);

    const secret = await internalSecret();
    if (!secret) return c.json({ ok: false, error: 'unavailable', message: "The photo service isn't available right now. Please try again shortly." }, 503);

    const jobs: { photo: string; generation_id: string | null; error: string | null }[] = [];
    for (const ref of refs) {
      const url = await kieFetchableUrl(ref);
      if (!url) { jobs.push({ photo: ref, generation_id: null, error: "That photo couldn't be opened." }); continue; }
      try {
        const res = await fetch(`${EF_BASE}/image-generate-create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
          body: JSON.stringify({
            agency_id: agencyId,
            generation_type: 'social_post',
            template: 'none',          // raw cleaned photo out — no overlay, no text: KIE only touches the image
            source_image_url: url,
            source_property_id: propertyId,
            requested_by: user?.sub ?? null,
            ...(note ? { prompt: note } : {}), // extra asks ride as creative direction; watermark removal is always applied
          }),
        });
        const j = (await res.json().catch(() => null)) as { ok?: boolean; generation_id?: string; message?: string } | null;
        if (res.ok && j?.ok && j.generation_id) jobs.push({ photo: ref, generation_id: j.generation_id, error: null });
        else jobs.push({ photo: ref, generation_id: null, error: j?.message ?? "That photo couldn't be cleaned up." });
      } catch {
        jobs.push({ photo: ref, generation_id: null, error: "That photo couldn't be cleaned up." });
      }
    }
    if (!jobs.some((j) => j.generation_id)) {
      return c.json({ ok: false, error: 'finish_failed', message: "The photo clean-up couldn't be started. Please try again.", jobs }, 502);
    }
    return c.json({ ok: true, jobs });
  } catch (err) {
    console.error('[studio/editable-finish] failed:', err);
    return c.json({ ok: false, error: 'finish_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/translate-slots — author-language text → the post's output language ──────
// Christian's flow: type the copy in ANY language, the post renders in the language you picked.
// DeepL auto-detects the source (translate-text EF, source_lang:'auto'). Only the TYPED slot text is
// translated — the engine already localises the facts (price/beds/city). A slot whose translation fails
// keeps its original text (a design never blanks out because DeepL hiccuped).
const TRANSLATE_LANGS = new Set(['en', 'es', 'de', 'nl', 'fr', 'it', 'pl', 'pt', 'ru', 'sv', 'no', 'nb', 'da', 'fi']);
let translateSecretCache: Promise<string | null> | null = null;
async function fetchTranslateSecret(): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('_get_platform_secret', { p_name: 'INTERNAL_TRANSLATE_SECRET' });
    if (error || !data) {
      console.error('[studio/translate] secret unavailable:', error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.error('[studio/translate] secret threw:', err);
    return null;
  }
}
function translateSecret(): Promise<string | null> {
  if (!translateSecretCache) {
    // a null is transient (vault hiccup) → clear the cache so the next call retries
    translateSecretCache = fetchTranslateSecret().then((s) => { if (s === null) translateSecretCache = null; return s; });
  }
  return translateSecretCache;
}

route.post('/translate-slots', async (c) => {
  let b: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }
  const target = typeof b.target_lang === 'string' ? b.target_lang.trim() : '';
  const texts = b.texts && typeof b.texts === 'object' && !Array.isArray(b.texts) ? (b.texts as Record<string, unknown>) : null;
  if (!texts) return c.json({ ok: false, error: 'invalid_texts', message: 'There is nothing to translate.' }, 400);
  if (!TRANSLATE_LANGS.has(target)) return c.json({ ok: false, error: 'invalid_target', message: "That language isn't supported yet." }, 400);

  const secret = await translateSecret();
  if (!secret) return c.json({ ok: false, error: 'translate_unavailable', message: "Translation isn't available right now. Please try again shortly." }, 503);

  const entries = Object.entries(texts).filter(([, v]) => typeof v === 'string' && (v as string).trim().length > 0) as [string, string][];
  const out: Record<string, string> = {};
  await Promise.all(entries.map(async ([id, v]) => {
    try {
      const res = await fetch(`${EF_BASE}/translate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ text: v, source_lang: 'auto', target_lang: target }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; translated_text?: string | null } | null;
      // skipped (source === target) returns translated_text:null → keep the original.
      out[id] = res.ok && j?.ok && typeof j.translated_text === 'string' && j.translated_text ? j.translated_text : v;
    } catch {
      out[id] = v; // never blank a slot on a translation failure
    }
  }));
  return c.json({ ok: true, texts: out });
});

export default route;
