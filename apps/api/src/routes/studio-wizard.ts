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
import {
  SMART_CANVAS,
  buildFacts,
  designRenderStore,
} from '../lib/studio-smart-design';
import { usablePhotos } from '../lib/property-images';
import { type CarouselPlan, chrome as carouselChrome } from '../../../../studio/engine/carouselSlides';
import {
  renderPlannedStyled, renderListingStyled, vibraListing, PLANNED_STYLES, LISTING_STYLES, type CarouselStyle,
} from '../../../../studio/engine/carouselStyles';
import { planCarousel, remixHook, topicIdeas, listingCopy, listingStory, PlanSchema } from '../lib/studio-carousel-plan';
import { renderTipsImageStyled, renderTipsImageStyledV2, isTipsImageStyle } from '../../../../studio/engine/carouselTipsImage';
import { renderFreeform, type DesignSpec } from '../../../../studio/engine/renderFreeform';
import { applyGrain, photoPalette } from '../../../../studio/engine/carouselSlides';
import { loadTipsImages, generateTipsImages, loadGenerationImages, TIPS_SCHEMES } from '../lib/studio-carousel-image';

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
// KIE's aspect-ratio enum (seedream-v4-edit accepts exactly these; no custom width/height).
const IMAGE_SIZES = new Set([
  'square', 'square_hd', 'portrait_4_3', 'portrait_3_2', 'portrait_16_9',
  'landscape_4_3', 'landscape_3_2', 'landscape_16_9', 'landscape_21_9',
]);
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

  // SMART design mode (Christian 2026-07-14): KIE composes the whole post — layout AND text — from every
  // selected photo, at the chosen aspect. Only Smart passes this; every other path keeps the deterministic
  // engine (KIE = photos only). `prompt` carries the agent's creative direction.
  if (b.design_mode === true) {
    out.design_mode = true;
    out.template = 'none'; // KIE owns the whole image — no studio-compose overlay on top
  }
  if (enumOr(b.image_size, IMAGE_SIZES)) out.image_size = b.image_size;
  if (typeof b.prompt === 'string' && b.prompt.trim()) out.prompt = b.prompt.trim().slice(0, 3000);

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
    // carousel rows: every slide, in order (cover..CTA)
    slides: Array.isArray((meta as any)?.slides) ? (meta as any).slides.map((sl: any) => sl?.url).filter(Boolean) : undefined,
    // planned carousels: the words (editable via POST /carousel/update) + the ready-to-post caption
    carousel_type: typeof (meta as any)?.carousel_type === 'string' ? (meta as any).carousel_type : undefined,
    carousel_style: typeof (meta as any)?.carousel_style === 'string' ? (meta as any).carousel_style : undefined,
    per_slide_art: (meta as any)?.per_slide_art === true ? true : undefined,
    caption: typeof (meta as any)?.caption === 'string' ? (meta as any).caption : undefined,
    hashtags: Array.isArray((meta as any)?.hashtags) ? (meta as any).hashtags : undefined,
    plan: (meta as any)?.plan && typeof (meta as any).plan === 'object' ? (meta as any).plan : undefined,
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
        -- cleaned-up source photos are intermediates of a finished post, not creations in their own right
        AND COALESCE(raw_request->>'intermediate', 'false') <> 'true'
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
        const imgs = usablePhotos(r.images); // dead portal hotlinks never reach the picker
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
    const photos = usablePhotos(rows[0].images);
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

// ── dead-photo filter ─────────────────────────────────────────────────────────
// The single shared rule (Packet 3, apps/api/src/lib/property-images.ts): a photo counts only if WE host it.
// Replaces the montinmo-specific blocklist — verified identical results across the whole live catalog
// (same 60 usable / 81 not, zero disagreements) and needs no code change when the next host dies.

// helper: load a property (facts) + the agency branding for the session's agency.
async function loadPropertyAndBrand(tx: any, agencyId: string, propertyId: string) {
  const pRes = await tx.execute(sql`
    SELECT title, property_type, location_city, location_region, price, area_sqm, area_built_sqm,
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
    title: (pRows[0].title as string | null) ?? null,
    agency, brand,
    images: usablePhotos(pRows[0].images),
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
function parsePhotoTransforms(v: unknown): Record<number, { zoom?: number; x?: number; y?: number }> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<number, { zoom?: number; x?: number; y?: number }> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const i = Number(k);
    const o = val as { zoom?: unknown; x?: unknown; y?: unknown };
    if (!Number.isInteger(i) || i < 0 || i > 20 || !o || typeof o !== 'object') continue;
    const t: { zoom?: number; x?: number; y?: number } = {};
    if (typeof o.zoom === 'number' && Number.isFinite(o.zoom)) t.zoom = Math.min(6, Math.max(1, o.zoom));
    if (typeof o.x === 'number' && Number.isFinite(o.x)) t.x = Math.min(1, Math.max(0, o.x));
    if (typeof o.y === 'number' && Number.isFinite(o.y)) t.y = Math.min(1, Math.max(0, o.y));
    if (Object.keys(t).length) out[i] = t;
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
      photoTransforms: parsePhotoTransforms(b.photo_transforms),
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
    // Pull a wider candidate set by price, then keep the 4 most expensive that actually have USABLE photos.
    // (Most of the catalog hotlinks the dead montinmo.es host — those listings can never render, so they must
    // never be picked for the showcase, or the grid fills with "preview failed".)
    const pRes = await tx.execute(sql`
      SELECT id, title, images
      FROM properties
      WHERE agency_id = ${agencyId} AND price IS NOT NULL
      ORDER BY price DESC
      LIMIT 60
    `);
    const pRows = pRes as unknown as Array<{ id: string; title: string | null; images: string[] | null }>;
    const allListings = pRows
      .map((r) => ({ id: r.id, title: r.title, photos: usablePhotos(r.images) }))
      .filter((l) => l.photos.length > 0);

    // Christian 2026-07-16: ONE house per ROW — the catalogue is 8 rows of 4 (one template per photo-count
    // lane), so we pick the 8 best-looking / most expensive listings that can feed a whole row (every row
    // contains a 4-photo template, so the row's house needs >= 4 usable photos). Row 1 = priciest.
    const rowListings = allListings.filter((l) => l.photos.length >= 4).slice(0, 8);
    const listings = rowListings.length > 0 ? rowListings : allListings.slice(0, 4);

    if (listings.length === 0) {
      return c.json({ ok: true, has_listings: false, templates: [] });
    }

    // one house per ROW: templates i=0..3 are row 1 (one per lane), 4..7 row 2, ... — each row shows the
    // SAME listing across its four templates; k-scan is the safety net if a listing lacks photos.
    const items = editableCatalogue()
      .map((t, i) => {
        const rowStart = Math.floor(i / 4);
        let chosen: { id: string; title: string | null; photos: string[] } | null = null;
        for (let k = 0; k < listings.length; k++) {
          const cand = listings[(rowStart + k) % listings.length];
          if (cand.photos.length >= t.photo_count) { chosen = cand; break; }
        }
        if (!chosen) return null; // no listing has enough photos for this template
        const hex = galleryAccent(i);
        return {
          template_id: t.id,
          number: t.number,
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
      photoTransforms: parsePhotoTransforms(b.photo_transforms),
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

// ── CAROUSEL (Christian 2026-07-16): deterministic multi-slide post — cover + one slide per photo +
// CTA card, drawn by the freeform engine from canonical facts. No AI, no provider: renders in seconds,
// runs async only to stay clear of serverless timeouts. Produces the slide IMAGES (posting to Instagram
// is the agent's job — no publishing integration).
/** Upload rendered slides to their per-generation folder and return signed URLs (1 year). */
async function storeSlides(agencyId: string, genId: string, slides: Buffer[]): Promise<{ path: string; url: string }[]> {
  const stored: { path: string; url: string }[] = [];
  for (let i = 0; i < slides.length; i++) {
    const key = `carousel/${agencyId}/${genId}/slide-${i + 1}.png`;
    const up = await supabaseAdmin.storage.from('generated-images').upload(key, slides[i], { contentType: 'image/png', upsert: true });
    if (up.error) throw new Error(`slide upload: ${up.error.message}`);
    const signed = await supabaseAdmin.storage.from('generated-images').createSignedUrl(key, 60 * 60 * 24 * 365);
    if (signed.error || !signed.data?.signedUrl) throw new Error('slide sign failed');
    stored.push({ path: key, url: signed.data.signedUrl });
  }
  return stored;
}

async function runCarousel(opts: {
  genId: string; agencyId: string; refs: string[]; language: string; style: CarouselStyle; scheme: string;
  facts: {
    title: string; location: string; price: string; specs: string;
    beds: string; baths: string; area: string; agency: string; contact: string; features: string[];
  };
  brand: { navy: string; gold: string; cream: string; text: string };
}): Promise<void> {
  const { genId, agencyId } = opts;
  try {
    const buffers: Buffer[] = [];
    for (const ref of opts.refs) { const buf = await loadPhotoBuffer(ref); if (buf) buffers.push(buf); }
    if (buffers.length < 2) throw new Error('not enough loadable photos');

    let slides: Buffer[];
    let caption: string | undefined;
    let hashtags: string[] | undefined;
    if (opts.style === 'vibra') {
      // VIBRA: vision reads the chosen photos → a line per photo + the property's vibe as artwork
      const story = await listingStory({
        photoUrls: opts.refs,
        facts: { title: opts.facts.title, location: opts.facts.location, price: opts.facts.price, specs: opts.facts.specs, agency: opts.facts.agency },
        language: opts.language, agencyName: opts.facts.agency,
      });
      let art: Buffer | null = null;
      if (story?.vibe_scene) {
        const gen = await generateTipsImages({ style: story.art_style, scheme: opts.scheme, scenes: [story.vibe_scene], agencyId, genId });
        art = gen?.buffers[0] ?? null;
      }
      const st = story ?? { hook: opts.facts.title, photo_lines: [], vibe_scene: '', art_style: 'litoral', caption: '', cta_action: '', cta_keyword: '', hashtags: [], details: [] };
      caption = story?.caption || undefined;
      hashtags = story?.hashtags?.length ? story.hashtags : undefined;
      // THE VIBE LAW: every slide follows its own photo's colours
      const palettes = await Promise.all(buffers.map((b) => photoPalette(b)));
      const specs = vibraListing(opts.facts, st, opts.brand, buffers.length, !!art, opts.language, palettes);
      const all = art ? [...buffers, art] : buffers;
      slides = [];
      for (const sp of specs) slides.push(await applyGrain(await renderFreeform(sp as DesignSpec, { width: 1080, height: 1350 }, all), 0.035));
    } else {
      // best-effort AI copy (hook overlay, lifestyle line, CTA, caption) from the same canonical facts —
      // a copy failure never fails the carousel: the design falls back to deterministic text.
      const copy = await listingCopy({
        facts: { title: opts.facts.title, location: opts.facts.location, price: opts.facts.price, specs: opts.facts.specs, agency: opts.facts.agency, contact: opts.facts.contact },
        language: opts.language, agencyName: opts.facts.agency,
      });
      caption = copy?.caption || undefined;
      hashtags = copy?.hashtags?.length ? copy.hashtags : undefined;
      slides = await renderListingStyled(opts.style, opts.facts, {
        hook: copy?.hook ?? '', lifestyle_line: copy?.lifestyle_line ?? '',
        cta_action: copy?.cta_action ?? '', cta_keyword: copy?.cta_keyword ?? '',
      }, opts.brand, buffers, opts.language);
    }
    const stored = await storeSlides(agencyId, genId, slides);

    await supabaseAdmin.from('image_generations').update({
      status: 'completed',
      result_image_url: stored[0].url,
      result_image_storage_path: stored[0].path,
      result_metadata: {
        engine: 'carousel', carousel_type: 'listing', carousel_style: opts.style, slide_count: stored.length, slides: stored,
        ...(caption ? { caption } : {}), ...(hashtags ? { hashtags } : {}),
        ai_imagery: opts.style === 'vibra',
      },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);
  } catch (err) {
    console.error('[studio/carousel] render failed:', err);
    await supabaseAdmin.from('image_generations').update({
      status: 'failed',
      failure_reason: ((err as Error)?.message ?? 'carousel_failed').slice(0, 240),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);
  }
}

// PLANNED carousels (Christian-approved 2026-07-16): tips/quote posts — the AI plans the WORDS
// (validated, honesty-gated: no figures, no invented facts), the slide library draws every pixel.
// One credit per carousel (it's an AI generation, like Smart); the plan is stored so every slide's
// text stays editable afterwards via POST /carousel/update.
async function runPlannedCarousel(opts: {
  genId: string; agencyId: string;
  type: 'tips' | 'quote'; topic?: string; quoteText?: string; quoteAuthor?: string;
  slideCount?: number; language: string; style: CarouselStyle; scheme: string; includeRecap: boolean; includeContext: boolean;
  agency: { name: string; web: string; phone: string };
  brand: { navy: string; gold: string; cream: string; text: string };
}): Promise<void> {
  const { genId, agencyId } = opts;
  try {
    const plan = await planCarousel({
      type: opts.type, topic: opts.topic, quoteText: opts.quoteText, quoteAuthor: opts.quoteAuthor,
      slideCount: opts.slideCount, language: opts.language, agencyName: opts.agency.name,
    });
    const contact = [opts.agency.web, opts.agency.phone].filter(Boolean).join(' · ');
    // AI-imagery styles compose the pre-seeded generated family; a library miss falls back to the
    // editorial type-only deck — an image can never block a post (spec fallback rule)
    let slides: Buffer[];
    let usedStyle = opts.style;
    let imagePaths: string[] = [];
    let perSlideArt = false;
    if (opts.type === 'tips' && isTipsImageStyle(opts.style)) {
      // per-slide artwork: cover scene + one scene PER TIP (every slide's design = that slide's topic);
      // micro-unique every post. Fallbacks: 3-scene family → seeded approved family → editorial deck.
      const tipScenes = plan.tips.map((t) => t.scene ?? '');
      const coverScene = plan.image_scenes?.[0] ?? '';
      const allScenes = [coverScene, ...tipScenes];
      let images: Buffer[] | null = null;
      if (allScenes.every((x) => typeof x === 'string' && x.trim().length >= 10)) {
        const fresh = await generateTipsImages({ style: opts.style, scheme: opts.scheme, scenes: allScenes, agencyId, genId });
        if (fresh && fresh.buffers.length === plan.tips.length + 1) {
          images = fresh.buffers; imagePaths = fresh.paths; perSlideArt = true;
        }
      }
      if (!images) {
        const fam = await generateTipsImages({ style: opts.style, scheme: opts.scheme, scenes: (plan.image_scenes ?? []).slice(0, 3), agencyId, genId });
        if (fam && fam.buffers.length === 3) { images = fam.buffers; imagePaths = fam.paths; }
      }
      if (!images) images = await loadTipsImages(opts.style);
      if (images) {
        slides = perSlideArt
          ? await renderTipsImageStyledV2(opts.style, plan, opts.agency.name, contact, opts.brand, images, opts.language, opts.includeRecap, opts.includeContext)
          : await renderTipsImageStyled(opts.style, plan, opts.agency.name, contact, opts.brand, images, opts.language);
      } else {
        usedStyle = 'editorial';
        slides = await renderPlannedStyled('editorial', plan, opts.agency.name, contact, opts.brand, opts.language);
      }
    } else {
      slides = await renderPlannedStyled(opts.style, plan, opts.agency.name, contact, opts.brand, opts.language);
    }
    const stored = await storeSlides(agencyId, genId, slides);

    await supabaseAdmin.from('image_generations').update({
      status: 'completed',
      result_image_url: stored[0].url,
      result_image_storage_path: stored[0].path,
      result_metadata: {
        engine: 'carousel', carousel_type: opts.type, carousel_style: usedStyle, slide_count: stored.length, slides: stored,
        ai_imagery: opts.type === 'tips' && isTipsImageStyle(usedStyle),
        image_paths: imagePaths, image_scheme: opts.scheme, per_slide_art: perSlideArt, include_recap: opts.includeRecap, include_context: opts.includeContext,
        plan, caption: plan.caption, hashtags: plan.hashtags,
      },
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);

    const { error: qErr } = await supabaseAdmin.rpc('image_gen_increment_usage', {
      p_agency_id: agencyId, p_generation_type: 'social_post',
    });
    if (qErr) console.error('[studio/carousel] usage increment failed:', qErr.message);
  } catch (err) {
    console.error('[studio/carousel] planned render failed:', err);
    await supabaseAdmin.from('image_generations').update({
      status: 'failed',
      failure_reason: ((err as Error)?.message ?? 'carousel_failed').slice(0, 240),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);
  }
}

const CAROUSEL_LANGS = new Set(['es', 'en', 'de', 'fr', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'ru', 'it', 'pt']);

route.post('/carousel', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  const b = await readJson(c);
  const type = b.type === 'tips' || b.type === 'quote' ? b.type : 'listing';
  const language = typeof b.language === 'string' && CAROUSEL_LANGS.has(b.language) ? b.language : 'es';
  // visual style (Christian-approved stylebook): validated against the post type; default = editorial
  const allowedStyles: CarouselStyle[] = type === 'listing' ? LISTING_STYLES : PLANNED_STYLES[type];
  const style: CarouselStyle = typeof b.style === 'string' && (allowedStyles as string[]).includes(b.style)
    ? (b.style as CarouselStyle) : 'editorial';
  const scheme = typeof b.scheme === 'string' && TIPS_SCHEMES[b.scheme] ? b.scheme : 'clasico';

  try {
    // ── tips / quote: no property needed — brand + agency identity only ──────
    if (type === 'tips' || type === 'quote') {
      const topic = typeof b.topic === 'string' ? b.topic.trim().slice(0, 300) : '';
      const quoteText = typeof b.quote_text === 'string' ? b.quote_text.trim().slice(0, 700) : '';
      const quoteAuthor = typeof b.quote_author === 'string' ? b.quote_author.trim().slice(0, 80) : '';
      // 'slides' = TOTAL deck length the agent asked for (3..10): cover + [context when >=5] + tips +
      // [recap when >=7] + CTA. Legacy slide_count (= tips) still honoured.
      const slidesTotal = Number.isInteger(b.slides) ? Math.min(10, Math.max(3, b.slides as number)) : null;
      const includeContext = slidesTotal === null ? true : slidesTotal >= 5;
      const includeRecap = slidesTotal === null ? true : slidesTotal >= 7;
      const slideCount = slidesTotal !== null
        ? Math.min(7, Math.max(1, slidesTotal - 2 - (includeContext ? 1 : 0) - (includeRecap ? 1 : 0)))
        : (Number.isInteger(b.slide_count) ? Math.min(7, Math.max(3, b.slide_count as number)) : 5);
      if (type === 'tips' && topic.length < 3) {
        return c.json({ ok: false, error: 'invalid_request', message: 'Tell us what the tips should be about.' }, 400);
      }
      if (type === 'quote' && quoteText.length < 10) {
        return c.json({ ok: false, error: 'invalid_request', message: 'Paste the client quote (at least a sentence).' }, 400);
      }

      const bRes = await tx.execute(sql`
        SELECT brand_name, primary_color, accent_color, background_color, text_color,
               phone, whatsapp_number, website_url, sender_email, email_signature_name
        FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
      `);
      const bRows = bRes as unknown as any[];
      const { agency, brand } = mapBranding(bRows[0] || {});

      const label = type === 'tips' ? `Tips carousel · ${topic.slice(0, 80)}` : 'Client quote carousel';
      const ins = await tx.execute(sql`
        INSERT INTO image_generations
          (agency_id, generation_type, status, prompt, requested_by, raw_request)
        VALUES
          (${agencyId}, 'social_post', 'processing', ${label}, ${user?.sub ?? null}::uuid,
           ${JSON.stringify({ engine: 'carousel', content_type: 'carousel', carousel_type: type, carousel_style: style, image_scheme: scheme, include_recap: includeRecap, include_context: includeContext, topic, quote_text: quoteText, quote_author: quoteAuthor, slide_count: slideCount, language })}::jsonb)
        RETURNING id
      `);
      const rows = ins as unknown as Array<{ id: string }>;
      const genId = rows[0]?.id;
      if (!genId) throw new Error('insert failed');

      void runPlannedCarousel({
        genId, agencyId, type, topic, quoteText, quoteAuthor, slideCount, language, style, scheme, includeRecap, includeContext,
        agency: { name: agency.name, web: agency.web, phone: agency.phone }, brand,
      });
      return c.json({ ok: true, generation_id: genId, status: 'processing' });
    }

    // ── listing: the property-photo carousel (deterministic slides + AI caption) ──
    const propertyId = typeof b.property_id === 'string' ? b.property_id : '';
    const refs = Array.isArray(b.photos) ? (b.photos.filter((u: unknown): u is string => typeof u === 'string')).slice(0, 9) : [];
    if (!propertyId || refs.length < 2) {
      return c.json({ ok: false, error: 'invalid_request', message: 'Pick a property and at least 2 photos (up to 9).' }, 400);
    }
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    for (const u of refs) {
      if (!loaded.images.includes(u)) return c.json({ ok: false, error: 'invalid_photo', message: 'One of those photos does not belong to this property.' }, 400);
    }

    const f = buildFacts({ ...loaded.property, title: loaded.title }, loaded.agency);
    const T = carouselChrome(language);
    const bedsN = (f.beds ?? '').replace(/\D/g, '');
    const bathsN = (f.baths ?? '').replace(/\D/g, '');
    const facts = {
      title: f.title ?? 'New listing',
      location: (f.location ?? '').toUpperCase().split(', ').join(' · '),
      price: f.price ?? '',
      specs: [bedsN && `${bedsN} ${T.bed}`, bathsN && `${bathsN} ${T.bath}`, f.area && f.area.toUpperCase()]
        .filter(Boolean).join(' · '),
      beds: (f.beds ?? '').replace(/\D/g, ''),
      baths: (f.baths ?? '').replace(/\D/g, ''),
      area: f.area ?? '',
      agency: f.agency ?? '',
      contact: [f.website, f.phone].filter(Boolean).join(' · '),
      features: [f.feature_1, f.feature_2, f.feature_3, f.feature_4, f.feature_5, f.feature_6].filter((x): x is string => !!x),
    };

    const ins = await tx.execute(sql`
      INSERT INTO image_generations
        (agency_id, generation_type, status, prompt, source_property_id, requested_by, raw_request)
      VALUES
        (${agencyId}, 'social_post', 'processing', ${`Carousel · ${refs.length + 1} slides`}, ${propertyId}::uuid, ${user?.sub ?? null}::uuid,
         ${JSON.stringify({ engine: 'carousel', content_type: 'carousel', carousel_type: 'listing', carousel_style: style, photos: refs, language })}::jsonb)
      RETURNING id
    `);
    const rows = ins as unknown as Array<{ id: string }>;
    const genId = rows[0]?.id;
    if (!genId) throw new Error('insert failed');

    void runCarousel({ genId, agencyId, refs, language, style, scheme, facts, brand: loaded.brand });
    return c.json({ ok: true, generation_id: genId, status: 'processing' });
  } catch (err) {
    console.error('[studio/carousel] failed:', err);
    return c.json({ ok: false, error: 'carousel_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/carousel/update — per-slide TEXT editing on planned carousels ──
// The agent edits the stored plan's words (their own copy — no AI involved, no credit), the same
// deterministic library re-renders every slide over the same storage paths, and fresh signed URLs
// come back. Structure is fixed: same type, same number of tips/quote parts (text edits only).
route.post('/carousel/update', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const b = await readJson(c);
  const genId = typeof b.generation_id === 'string' ? b.generation_id : '';
  if (!genId || !b.plan || typeof b.plan !== 'object') {
    return c.json({ ok: false, error: 'invalid_request', message: 'Missing carousel or edited text.' }, 400);
  }
  try {
    const res = await tx.execute(sql`
      SELECT id, status::text AS status, result_metadata, raw_request
      FROM image_generations
      WHERE id = ${genId}::uuid AND agency_id = ${agencyId} LIMIT 1
    `);
    const rows = res as unknown as Array<{ id: string; status: string; result_metadata: Record<string, unknown> | null; raw_request: Record<string, unknown> | null }>;
    if (rows.length === 0) return c.json({ ok: false, error: 'not_found', message: 'That carousel could not be found.' }, 404);
    const meta = rows[0].result_metadata as any;
    const priorPlan = meta?.plan as CarouselPlan | undefined;
    if (rows[0].status !== 'completed' || meta?.engine !== 'carousel' || !priorPlan) {
      return c.json({ ok: false, error: 'not_editable', message: 'Only finished tips/quote carousels can be edited.' }, 400);
    }

    const parsed = PlanSchema.safeParse({ ...(b.plan as object), type: priorPlan.type });
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_plan', message: 'Some of the edited text is too long or missing.' }, 400);
    }
    const plan = parsed.data as CarouselPlan;
    if (plan.tips.length !== priorPlan.tips.length || plan.quote_parts.length !== priorPlan.quote_parts.length) {
      return c.json({ ok: false, error: 'invalid_plan', message: 'You can edit the text, but not add or remove slides.' }, 400);
    }

    const bRes = await tx.execute(sql`
      SELECT brand_name, primary_color, accent_color, background_color, text_color,
             phone, whatsapp_number, website_url, sender_email, email_signature_name
      FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
    `);
    const bRows = bRes as unknown as any[];
    const { agency, brand } = mapBranding(bRows[0] || {});
    const contact = [agency.web, agency.phone].filter(Boolean).join(' · ');

    // re-render in the SAME visual style the carousel was created with
    const storedStyle: CarouselStyle = typeof meta?.carousel_style === 'string' &&
      (PLANNED_STYLES[priorPlan.type] as string[]).includes(meta.carousel_style)
      ? meta.carousel_style : 'editorial';
    const storedLang = typeof rows[0].raw_request?.language === 'string' ? (rows[0].raw_request.language as string) : 'es';
    let slides: Buffer[];
    if (priorPlan.type === 'tips' && isTipsImageStyle(storedStyle)) {
      const ownPaths = Array.isArray(meta?.image_paths) ? (meta.image_paths as string[]) : [];
      const perSlideArt = meta?.per_slide_art === true && ownPaths.length === plan.tips.length + 1;
      const images = (ownPaths.length >= 3 ? await loadGenerationImages(ownPaths) : null)
        ?? await loadTipsImages(storedStyle);
      if (images) {
        slides = perSlideArt
          ? await renderTipsImageStyledV2(storedStyle, plan, agency.name, contact, brand, images, storedLang, meta?.include_recap !== false, meta?.include_context !== false, typeof meta?.layout_variant === 'number' ? meta.layout_variant : 0)
          : await renderTipsImageStyled(storedStyle, plan, agency.name, contact, brand, images, storedLang);
      } else {
        slides = await renderPlannedStyled('editorial', plan, agency.name, contact, brand, storedLang);
      }
    } else {
      slides = await renderPlannedStyled(storedStyle, plan, agency.name, contact, brand, storedLang);
    }
    const stored = await storeSlides(agencyId, genId, slides);

    await supabaseAdmin.from('image_generations').update({
      result_image_url: stored[0].url,
      result_image_storage_path: stored[0].path,
      result_metadata: {
        ...meta, slide_count: stored.length, slides: stored,
        plan, caption: plan.caption, hashtags: plan.hashtags,
      },
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);

    return c.json({
      ok: true, id: genId,
      slides: stored.map((s) => s.url), plan, caption: plan.caption, hashtags: plan.hashtags,
    });
  } catch (err) {
    console.error('[studio/carousel-update] failed:', err);
    return c.json({ ok: false, error: 'update_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/carousel/topic-ideas — GET INSPIRED: 6 fresh tips topics (free) ──
route.post('/carousel/topic-ideas', async (c) => {
  const b = await readJson(c);
  const language = typeof b.language === 'string' && b.language.trim() ? b.language.trim().slice(0, 5) : 'es';
  const exclude = Array.isArray(b.exclude)
    ? (b.exclude as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 24) : [];
  try {
    const topics = await topicIdeas(language, exclude);
    if (!topics) return c.json({ ok: false, error: 'ideas_failed', message: "Couldn't think of ideas right now — please try again." }, 502);
    return c.json({ ok: true, topics });
  } catch (err) {
    console.error('[studio/topic-ideas] failed:', err);
    return c.json({ ok: false, error: 'ideas_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/suggestions — "Suggested for today" (3 dynamic cards for the Studio home) ──
// A carousel topic (fresh AI ideas, cached per agency+day so a home-page visit costs ~1 AI call/day),
// a REAL listing to turn into a post (best-priced with usable photos, rotated by day), and a stable
// renovation nudge. All honesty rails inherited from topicIdeas (no invented places/prices/stats).
const SUGGEST_CACHE = new Map<string, string[]>();
route.get('/suggestions', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const lang = 'es';   // pilot is the Spanish coast; carousel copy is Spanish
  try {
    const day = Math.floor(Date.now() / 86_400_000);

    // 1) carousel topic — daily-cached so repeated home visits don't each hit the model
    const key = `${agencyId}:${lang}:${day}`;
    let topics = SUGGEST_CACHE.get(key);
    if (!topics) {
      topics = (await topicIdeas(lang, [])) ?? [];
      if (SUGGEST_CACHE.size > 400) SUGGEST_CACHE.clear();   // crude bound; resets on redeploy anyway
      SUGGEST_CACHE.set(key, topics);
    }
    const topic = topics.length ? topics[day % topics.length] : null;

    // 2) a real listing — best-priced first, only ones with usable (non-dead) photos, rotated by day
    const res = await tx.execute(sql`
      SELECT id, title, images
      FROM properties
      WHERE agency_id = ${agencyId}
      ORDER BY price DESC NULLS LAST, created_at DESC
      LIMIT 12`);
    const rows = res as unknown as Array<{ id: string; title: string; images: unknown }>;
    const withPhotos = rows
      .map((r) => ({ id: r.id, title: r.title, photos: usablePhotos(r.images) }))
      .filter((r) => r.photos.length > 0);
    const prop = withPhotos.length ? withPhotos[day % withPhotos.length] : null;

    return c.json({
      ok: true,
      suggestions: {
        carousel: topic ? { topic, language: lang, slides: 5 } : null,
        listing: prop ? { property_id: prop.id, title: prop.title, thumb_url: prop.photos[0] } : null,
        renovation: { idea: 'Kitchen before/after inspiration', room: 'kitchen' },
      },
    });
  } catch (err) {
    console.error('[studio/suggestions] failed:', err);
    return c.json({ ok: false, error: 'suggestions_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/carousel/remix — OTRA VUELTA: one-axis remix of a finished tips deck ──
// Three axes, all reusing the deck's own artwork (no KIE, no credit):
//   hook   → the AI reframes ONLY the cover (different persuasion angle)
//   style  → same words + artwork, next look in the ring (chrome/type treatment changes)
//   layout → same everything, per-tip layout rotation shifts (per-slide-art decks only)
// The remix lands as a NEW generation so the original stays in the library untouched.
const REMIX_IMG_RING = ['bodegon', 'litoral', 'tinta', 'salitre', 'papel', 'arcilla', 'acuarela', 'bordado'];
const REMIX_TYPE_RING = ['editorial', 'cartel', 'encalada', 'sereno'];
route.post('/carousel/remix', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  const b = await readJson(c);
  const parentId = typeof b.generation_id === 'string' ? b.generation_id : '';
  const axis = b.axis === 'hook' || b.axis === 'style' || b.axis === 'layout' ? (b.axis as string) : '';
  if (!parentId || !axis) {
    return c.json({ ok: false, error: 'invalid_request', message: 'Missing carousel or remix choice.' }, 400);
  }
  try {
    const res = await tx.execute(sql`
      SELECT id, status::text AS status, result_metadata, raw_request
      FROM image_generations
      WHERE id = ${parentId}::uuid AND agency_id = ${agencyId} LIMIT 1
    `);
    const rows = res as unknown as Array<{ id: string; status: string; result_metadata: Record<string, unknown> | null; raw_request: Record<string, unknown> | null }>;
    if (rows.length === 0) return c.json({ ok: false, error: 'not_found', message: 'That carousel could not be found.' }, 404);
    const meta = rows[0].result_metadata as any;
    const raw = (rows[0].raw_request ?? {}) as Record<string, unknown>;
    const priorPlan = meta?.plan as CarouselPlan | undefined;
    if (rows[0].status !== 'completed' || meta?.engine !== 'carousel' || !priorPlan || priorPlan.type !== 'tips') {
      return c.json({ ok: false, error: 'not_remixable', message: 'Only finished tips carousels can be remixed.' }, 400);
    }

    const storedStyle: CarouselStyle = typeof meta?.carousel_style === 'string' &&
      (PLANNED_STYLES.tips as string[]).includes(meta.carousel_style) ? meta.carousel_style : 'editorial';
    const storedLang = typeof raw.language === 'string' ? (raw.language as string) : 'es';
    const ownPaths = Array.isArray(meta?.image_paths) ? (meta.image_paths as string[]) : [];
    const perSlideArt = meta?.per_slide_art === true && ownPaths.length === priorPlan.tips.length + 1;
    const priorVariant = typeof meta?.layout_variant === 'number' ? (meta.layout_variant as number) : 0;

    // the one axis that changes
    let plan: CarouselPlan = priorPlan;
    let newStyle: CarouselStyle = storedStyle;
    let layoutVariant = priorVariant;
    if (axis === 'hook') {
      const topic = typeof raw.topic === 'string' ? (raw.topic as string) : '';
      const reframed = await remixHook(priorPlan, storedLang, topic);
      if (!reframed) return c.json({ ok: false, error: 'remix_failed', message: "Couldn't find a better angle right now — please try again." }, 502);
      plan = { ...priorPlan, ...reframed };
    } else if (axis === 'style') {
      const ring = isTipsImageStyle(storedStyle) ? REMIX_IMG_RING : REMIX_TYPE_RING;
      const at = ring.indexOf(storedStyle);
      newStyle = ring[(at + 1) % ring.length] as CarouselStyle;
    } else {
      if (!(isTipsImageStyle(storedStyle) && perSlideArt)) {
        return c.json({ ok: false, error: 'no_layouts', message: "This look doesn't have alternative compositions — try a new hook or another look." }, 400);
      }
      layoutVariant = (priorVariant + 1) % 3;   // three compositions exist; cycle them
    }

    const bRes = await tx.execute(sql`
      SELECT brand_name, primary_color, accent_color, background_color, text_color,
             phone, whatsapp_number, website_url, sender_email, email_signature_name
      FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
    `);
    const bRows = bRes as unknown as any[];
    const { agency, brand } = mapBranding(bRows[0] || {});
    const contact = [agency.web, agency.phone].filter(Boolean).join(' · ');

    // render synchronously — the deck's own artwork is reused, so this is seconds, not minutes
    let slides: Buffer[];
    if (isTipsImageStyle(newStyle)) {
      const images = (ownPaths.length >= 3 ? await loadGenerationImages(ownPaths) : null)
        ?? await loadTipsImages(newStyle);
      if (!images) return c.json({ ok: false, error: 'remix_failed', message: GENERIC }, 500);
      slides = perSlideArt
        ? await renderTipsImageStyledV2(newStyle, plan, agency.name, contact, brand, images, storedLang, meta?.include_recap !== false, meta?.include_context !== false, layoutVariant)
        : await renderTipsImageStyled(newStyle, plan, agency.name, contact, brand, images, storedLang);
    } else {
      slides = await renderPlannedStyled(newStyle, plan, agency.name, contact, brand, storedLang);
    }

    const label = `Remix · ${axis} · ${String(raw.topic ?? '').slice(0, 70) || 'tips carousel'}`;
    const ins = await tx.execute(sql`
      INSERT INTO image_generations
        (agency_id, generation_type, status, prompt, requested_by, raw_request)
      VALUES
        (${agencyId}, 'social_post', 'processing', ${label}, ${user?.sub ?? null}::uuid,
         ${JSON.stringify({ ...raw, engine: 'carousel', content_type: 'carousel', carousel_style: newStyle, remix_of: parentId, remix_axis: axis })}::jsonb)
      RETURNING id
    `);
    const insRows = ins as unknown as Array<{ id: string }>;
    const genId = insRows[0]?.id;
    if (!genId) throw new Error('insert failed');

    const stored = await storeSlides(agencyId, genId, slides);
    // Finish the row via the SAME tx that inserted it — the row is uncommitted until this handler
    // returns, so a PostgREST update on another connection would match 0 rows and strand the remix
    // in 'processing' forever. NOTE: image_paths deliberately point at the PARENT's src artwork
    // (edits reuse it, nothing regenerates); no delete flow exists, but if one ever does, it must
    // leave parent folders alone while remixes reference them.
    const newMeta = {
      engine: 'carousel', carousel_type: 'tips', carousel_style: newStyle, slide_count: stored.length, slides: stored,
      plan, caption: plan.caption, hashtags: plan.hashtags,
      image_paths: ownPaths, image_scheme: meta?.image_scheme, per_slide_art: perSlideArt,
      include_recap: meta?.include_recap !== false, include_context: meta?.include_context !== false,
      layout_variant: layoutVariant, remix_of: parentId, remix_axis: axis,
    };
    await tx.execute(sql`
      UPDATE image_generations
      SET status = 'completed',
          result_image_url = ${stored[0].url},
          result_image_storage_path = ${stored[0].path},
          result_metadata = ${JSON.stringify(newMeta)}::jsonb,
          completed_at = now(), updated_at = now()
      WHERE id = ${genId}::uuid AND agency_id = ${agencyId}
    `);

    return c.json({
      ok: true, generation_id: genId,
      slides: stored.map((sl) => sl.url), plan, caption: plan.caption, hashtags: plan.hashtags,
      carousel_style: newStyle, per_slide_art: perSlideArt,
    });
  } catch (err) {
    console.error('[studio/carousel-remix] failed:', err);
    return c.json({ ok: false, error: 'remix_failed', message: GENERIC }, 500);
  }
});

// ── GET /api/studio/carousel/style-examples — example slides per Look & feel (for the picker) ──
const EXAMPLES_CACHE: { at: number; data: Record<string, string[]> } = { at: 0, data: {} };
route.get('/carousel/style-examples', async (c) => {
  try {
    if (Date.now() - EXAMPLES_CACHE.at < 30 * 60_000 && Object.keys(EXAMPLES_CACHE.data).length) {
      return c.json({ ok: true, examples: EXAMPLES_CACHE.data });
    }
    const COUNTS: Record<string, number> = {
      editorial: 3, horizonte: 3, cartel: 3, encalada: 2, sereno: 2, plano: 3, portada: 3, recorte: 2,
      marea: 2, cuarteto: 2, brisa: 2, riviera: 2, ventana: 2,
      bodegon: 3, litoral: 3, tinta: 3, salitre: 3, papel: 3, arcilla: 3, acuarela: 3, bordado: 3,
    };
    const out: Record<string, string[]> = {};
    for (const [styleId, count] of Object.entries(COUNTS)) {
      const urls: string[] = [];
      for (let i = 1; i <= count; i++) {
        const signed = await supabaseAdmin.storage.from('generated-images')
          .createSignedUrl(`carousel/_examples/${styleId}/${i}.jpg`, 3600 * 12);
        if (signed.data?.signedUrl) urls.push(signed.data.signedUrl);
      }
      if (urls.length) out[styleId] = urls;
    }
    EXAMPLES_CACHE.at = Date.now(); EXAMPLES_CACHE.data = out;
    return c.json({ ok: true, examples: out });
  } catch (err) {
    console.error('[studio/style-examples] failed:', err);
    return c.json({ ok: false, error: 'examples_failed', message: GENERIC }, 500);
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
            // clean_only = remove watermarks and change NOTHING else (no relight, no colour-grade, no declutter).
            // Christian: "if its left empty it should just remove watermark, not change lightning or anything
            // else unless it has been specified." A note is applied as the ONLY extra change.
            clean_only: true,
            ...(note ? { prompt: note } : {}),
          }),
        });
        const j = (await res.json().catch(() => null)) as { ok?: boolean; generation_id?: string; message?: string } | null;
        if (res.ok && j?.ok && j.generation_id) {
          // A cleaned photo is an INTERMEDIATE, not a creation — mark it so the library shows only the finished
          // post (Christian: "just the 4 images showed up in library, not the actual post that was made").
          try {
            await tx.execute(sql`
              UPDATE image_generations
                 SET raw_request = jsonb_set(COALESCE(raw_request, '{}'::jsonb), '{intermediate}', 'true'::jsonb, true)
               WHERE id = ${j.generation_id}::uuid AND agency_id = ${agencyId}
            `);
          } catch { /* marking is best-effort; never fail the clean-up over it */ }
          jobs.push({ photo: ref, generation_id: j.generation_id, error: null });
        } else jobs.push({ photo: ref, generation_id: null, error: j?.message ?? "That photo couldn't be cleaned up." });
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

// ═══════════════════════════════════════════════════════════════════════════
// SMART v2 (Christian 2026-07-14): "AI art-director, deterministic hands." Claude designs a layout blueprint
// from the REAL photos + facts; the freeform engine draws it. Replaces the seedream design mode, whose test
// output blended 3 photos into a fake scene with TWO different prices and a misspelled agency name.
// Flow is async-in-process: the route inserts a 'processing' row and answers immediately; a background task
// does design→render→upload→complete; the browser polls the existing GET /status/:id.
// ═══════════════════════════════════════════════════════════════════════════

async function smartPhotoBuffers(refs: string[]): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const ref of refs) { const b = await loadPhotoBuffer(ref); if (b) out.push(b); }
  return out;
}

// ── Smart photo clean-up (watermark removal) with a cache ──────────────────────
// Cleaning the same photo twice is the same pixels twice AND a credit twice — so a completed clean-only job
// for the exact source ref is reused. Cache key = raw_request.source_ref (the stable catalog ref, not the
// signed URL, which rotates).
async function cachedCleanedPhoto(agencyId: string, ref: string): Promise<{ path: string; url: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('image_generations')
    .select('result_image_storage_path, result_image_url')
    .eq('agency_id', agencyId)
    .eq('status', 'completed')
    .eq('raw_request->>source_ref', ref)
    .eq('raw_request->>clean_only', 'true')
    .not('result_image_storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const r = data?.[0];
  return r?.result_image_storage_path ? { path: r.result_image_storage_path, url: r.result_image_url ?? null } : null;
}

async function startCleanJob(agencyId: string, ref: string, propertyId: string | null, userId: string | null): Promise<string | null> {
  const secret = await internalSecret();
  if (!secret) return null;
  const url = await kieFetchableUrl(ref);
  if (!url) return null;
  try {
    const res = await fetch(`${EF_BASE}/image-generate-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        agency_id: agencyId, generation_type: 'social_post', template: 'none',
        source_image_url: url, source_property_id: propertyId, requested_by: userId, clean_only: true,
      }),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; generation_id?: string } | null;
    if (!res.ok || !j?.ok || !j.generation_id) return null;
    // tag the row: an intermediate (hidden from the library) + the cache key
    const { data: row } = await supabaseAdmin.from('image_generations').select('raw_request').eq('id', j.generation_id).single();
    await supabaseAdmin.from('image_generations')
      .update({ raw_request: { ...(row?.raw_request ?? {}), intermediate: true, clean_only: true, source_ref: ref } })
      .eq('id', j.generation_id).eq('agency_id', agencyId);
    return j.generation_id;
  } catch { return null; }
}

/** Clean the chosen photos via KIE (watermark-only), reusing cached results. Falls back to the original photo
 *  per-ref on any failure — a stubborn watermark never blocks the post. Returns per-ref buffers + vision URLs. */
async function cleanedSmartPhotos(
  agencyId: string, refs: string[], propertyId: string | null, userId: string | null,
): Promise<{ buffers: Buffer[]; urls: string[] }> {
  const byRef = new Map<string, { path: string; url: string | null }>();
  const pending = new Map<string, string>(); // genId -> ref

  for (const ref of refs) {
    const hit = await cachedCleanedPhoto(agencyId, ref);
    if (hit) { byRef.set(ref, hit); continue; }
    const id = await startCleanJob(agencyId, ref, propertyId, userId);
    if (id) pending.set(id, ref);
  }

  const deadline = Date.now() + 150 * 1000; // KIE takes ~30-60s/photo; jobs run in parallel
  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 6000));
    const ids = [...pending.keys()];
    const { data } = await supabaseAdmin
      .from('image_generations')
      .select('id, status, result_image_storage_path, result_image_url')
      .in('id', ids);
    for (const row of data ?? []) {
      if (row.status === 'completed' && row.result_image_storage_path) {
        byRef.set(pending.get(row.id)!, { path: row.result_image_storage_path, url: row.result_image_url ?? null });
        pending.delete(row.id);
      } else if (row.status === 'failed') {
        pending.delete(row.id); // fall back to the original photo
      }
    }
  }

  const buffers: Buffer[] = [];
  const urls: string[] = [];
  for (const ref of refs) {
    const cleaned = byRef.get(ref);
    if (cleaned) {
      const dl = await supabaseAdmin.storage.from('generated-images').download(cleaned.path);
      if (!dl.error && dl.data) {
        buffers.push(Buffer.from(await dl.data.arrayBuffer()));
        urls.push(cleaned.url ?? (await kieFetchableUrl(ref)) ?? ref);
        continue;
      }
    }
    const buf = await loadPhotoBuffer(ref);
    if (buf) { buffers.push(buf); urls.push((await kieFetchableUrl(ref)) ?? ref); }
  }
  return { buffers, urls };
}

async function runSmartDesign(opts: {
  genId: string; agencyId: string;
  property: ReturnType<typeof mapPropertyRow> & { title?: string | null };
  agency: { name: string; phone: string; web: string };
  brand: { navy: string; gold: string; cream: string; text: string };
  refs: string[]; size: string; brief: string | null; cleanPhotos: boolean;
  propertyId: string | null; userId: string | null;
  priorSpec?: unknown; editNote?: string; isRevision: boolean; revisionNumber?: number;
}): Promise<void> {
  const { genId, agencyId } = opts;
  try {
    const canvas = SMART_CANVAS[opts.size] ?? SMART_CANVAS.square_hd;
    const facts = buildFacts(opts.property, opts.agency);

    // photos: watermark-cleaned via KIE when asked (cached — a photo is only ever cleaned once), else raw.
    let buffers: Buffer[];
    let photoUrls: string[];
    if (opts.cleanPhotos) {
      const cleaned = await cleanedSmartPhotos(agencyId, opts.refs, opts.propertyId, opts.userId);
      buffers = cleaned.buffers; photoUrls = cleaned.urls;
    } else {
      buffers = await smartPhotoBuffers(opts.refs);
      photoUrls = [];
      for (const ref of opts.refs) { const u = await kieFetchableUrl(ref); if (u) photoUrls.push(u); }
    }
    if (!buffers.length || !photoUrls.length) throw new Error('no fetchable photos');

    const stored = await designRenderStore({
      photoUrls, canvas, facts, brand: opts.brand, brief: opts.brief,
      photoBuffers: buffers, agencyId,
      priorSpec: opts.priorSpec, editNote: opts.editNote,
    });
    const spec = stored.spec;

    const started = opts.isRevision ? (opts.revisionNumber ?? 1) : 0;
    const { error } = await supabaseAdmin.from('image_generations').update({
      status: 'completed',
      result_image_url: stored.image_url,
      result_image_storage_path: stored.storage_path,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result_metadata: {
        engine: 'smart_design', composed: true,
        revisions_started: started,
        revisions_remaining: Math.max(0, 2 - started),
      },
      // the spec is the revision seed: "make the price bigger" edits THIS design, not a restart
      raw_request: {
        engine: 'smart_design', content_type: 'listing',
        size: opts.size, brief: opts.brief, photos: opts.refs, clean_photos: opts.cleanPhotos, design_spec: spec,
      },
    }).eq('id', genId).eq('agency_id', agencyId);
    if (error) throw new Error(error.message);

    if (!opts.isRevision) {
      const { error: qErr } = await supabaseAdmin.rpc('image_gen_increment_usage', {
        p_agency_id: agencyId, p_generation_type: 'social_post',
      });
      if (qErr) console.error('[smart-design] usage increment failed:', qErr.message);
    }
  } catch (err) {
    console.error('[smart-design] failed:', err);
    await supabaseAdmin.from('image_generations').update({
      status: 'failed',
      failure_reason: String((err as Error).message ?? 'smart_design_failed').slice(0, 300),
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);
  }
}

// ── POST /api/studio/smart-design — AI designs the post; engine renders it ────
route.post('/smart-design', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const user = c.get('user');
  const b = await readJson(c);
  const propertyId = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  const size = typeof b.size === 'string' && SMART_CANVAS[b.size] ? b.size : 'square_hd';
  const brief = typeof b.brief === 'string' && b.brief.trim() ? b.brief.trim().slice(0, 2000) : null;
  const cleanPhotos = b.clean_photos !== false; // default ON — KIE removes watermarks before designing
  try {
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    const chosen = Array.isArray(b.photos) ? (b.photos as unknown[]).filter((u): u is string => typeof u === 'string' && loaded.images.includes(u)) : [];
    const refs = (chosen.length ? chosen : loaded.images).slice(0, 6);
    if (!refs.length) return c.json({ ok: false, error: 'no_photos', message: 'This property has no usable photos.' }, 422);

    // quota: same pool as the other AI generations; charged only on success (in the background task).
    const qRes = await tx.execute(sql`SELECT image_gen_check_quota(${agencyId}::text, 'social_post'::text) AS q`);
    const q = (qRes as unknown as Array<{ q: { ok?: boolean } | null }>)[0]?.q;
    if (!q?.ok) return c.json({ ok: false, error: 'quota_unavailable', message: "You've reached your plan's limit for this. Upgrade or wait for the next cycle." }, 409);

    const ins = await tx.execute(sql`
      INSERT INTO image_generations
        (agency_id, generation_type, status, prompt, source_property_id, requested_by, raw_request)
      VALUES
        (${agencyId}, 'social_post', 'processing', ${brief ?? 'Smart design'}, ${propertyId}::uuid, ${user?.sub ?? null}::uuid,
         ${JSON.stringify({ engine: 'smart_design', content_type: 'listing', size, brief, photos: refs, clean_photos: cleanPhotos })}::jsonb)
      RETURNING id
    `);
    const genId = (ins as unknown as Array<{ id: string }>)[0]?.id;
    if (!genId) return c.json({ ok: false, error: 'create_failed', message: GENERIC }, 500);

    // fire-and-forget: Railway is a long-lived process; the browser polls /status/:id.
    void runSmartDesign({
      genId, agencyId,
      property: { ...loaded.property, title: loaded.title },
      agency: loaded.agency, brand: loaded.brand,
      refs, size, brief, cleanPhotos,
      propertyId, userId: user?.sub ?? null, isRevision: false,
    });
    return c.json({ ok: true, generation_id: genId, status: 'processing' });
  } catch (err) {
    console.error('[studio/smart-design] failed:', err);
    return c.json({ ok: false, error: 'smart_design_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/smart-design/revise — Claude edits its own previous design ──
route.post('/smart-design/revise', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const b = await readJson(c);
  const genId = typeof b.generation_id === 'string' ? b.generation_id.trim() : '';
  const editNote = typeof b.edit_note === 'string' ? b.edit_note.trim().slice(0, 1000) : '';
  if (!genId || !editNote) return c.json(INVALID, 400);
  try {
    // atomic revision reservation: one UPDATE guards status + the 2-change cap.
    const upd = await tx.execute(sql`
      UPDATE image_generations
         SET status = 'processing',
             result_metadata = jsonb_set(COALESCE(result_metadata, '{}'::jsonb), '{revisions_started}',
               to_jsonb(COALESCE((result_metadata->>'revisions_started')::int, 0) + 1), true),
             raw_request = jsonb_set(COALESCE(raw_request, '{}'::jsonb), '{last_edit_note}', to_jsonb(${editNote}::text), true),
             updated_at = now()
       WHERE id = ${genId}::uuid AND agency_id = ${agencyId}
         AND status = 'completed'
         AND raw_request->>'engine' = 'smart_design'
         AND COALESCE((result_metadata->>'revisions_started')::int, 0) < 2
       RETURNING source_property_id, raw_request,
                 (result_metadata->>'revisions_started')::int AS revision_number
    `);
    const rows = upd as unknown as Array<{ source_property_id: string; raw_request: Record<string, unknown>; revision_number: number }>;
    if (!rows.length) return c.json({ ok: false, error: 'not_revisable', message: "That design can't be changed any further." }, 409);
    const rr = rows[0].raw_request ?? {};

    const loaded = await loadPropertyAndBrand(tx, agencyId, rows[0].source_property_id);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    const refs = Array.isArray(rr.photos) ? (rr.photos as string[]).filter((u) => typeof u === 'string') : loaded.images.slice(0, 6);

    const task = {
      genId, agencyId,
      property: { ...loaded.property, title: loaded.title },
      agency: loaded.agency, brand: loaded.brand,
      refs, size: typeof rr.size === 'string' ? rr.size : 'square_hd',
      brief: typeof rr.brief === 'string' ? rr.brief : null,
      cleanPhotos: rr.clean_photos !== false, // cached — revisions reuse the already-cleaned photos for free
      propertyId: rows[0].source_property_id ?? null, userId: null,
      priorSpec: rr.design_spec, editNote, isRevision: true,
      revisionNumber: rows[0].revision_number,
    } as Parameters<typeof runSmartDesign>[0];
    void runSmartDesign(task);
    return c.json({ ok: true, generation_id: genId, status: 'processing', revisions_remaining: Math.max(0, 2 - rows[0].revision_number) });
  } catch (err) {
    console.error('[studio/smart-design/revise] failed:', err);
    return c.json({ ok: false, error: 'revise_failed', message: GENERIC }, 500);
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
