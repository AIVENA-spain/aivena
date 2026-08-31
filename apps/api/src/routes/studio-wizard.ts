import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { env } from '../../../../packages/config/env';
import { supabaseAdmin } from '../lib/supabase-admin';
import { loadPhotoBuffer } from '../lib/studio-internal';
import {
  catalogue as editableCatalogue,
  editableDefaults,
  renderAndStore,
  editableCacheKey,
  signedForKey,
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
import sharp from 'sharp';
import { usablePhotos } from '../lib/property-images';
import { removeMontinmoWatermark } from '../lib/watermark-removal';
import { type CarouselPlan, chrome as carouselChrome } from '../../../../studio/engine/carouselSlides';
import {
  renderPlannedStyled, renderListingStyled, vibraListing, PLANNED_STYLES, LISTING_STYLES, TYPE_EDITIONS, type CarouselStyle,
} from '../../../../studio/engine/carouselStyles';
import type { CarouselBrand } from '../../../../studio/engine/renderCarousel';
import { planCarousel, editPlan, remixHook, topicIdeas, listingCopy, listingStory, PlanSchema, normalisePlan } from '../lib/studio-carousel-plan';
import { directScenes } from '../lib/studio-carousel-art';
import { renderTipsImageStyled, renderTipsImageStyledV2, isTipsImageStyle } from '../../../../studio/engine/carouselTipsImage';
import { renderFreeform, type DesignSpec } from '../../../../studio/engine/renderFreeform';
import { applyGrain, photoPalette } from '../../../../studio/engine/carouselSlides';
import { loadTipsImages, generateTipsImages, loadGenerationImages, TIPS_SCHEMES, TIPS_MEDIUM } from '../lib/studio-carousel-image';

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
    artwork_source: typeof (meta as any)?.artwork_source === 'string' ? (meta as any).artwork_source : undefined,
    // which slides this deck actually contains — the edit form must not offer fields for an
    // intro or a recap the deck does not have (RULE 3 made both opt-in)
    include_context: (meta as any)?.include_context === true,
    include_recap: (meta as any)?.include_recap === true,
    brand_navy: typeof (r as any).raw_request?.brand_navy === 'string' ? (r as any).raw_request.brand_navy : undefined,
    brand_gold: typeof (r as any).raw_request?.brand_gold === 'string' ? (r as any).raw_request.brand_gold : undefined,
    brand_paper: typeof (r as any).raw_request?.brand_paper === 'string' ? (r as any).raw_request.brand_paper : undefined,
    brand_ink: typeof (r as any).raw_request?.brand_ink === 'string' ? (r as any).raw_request.brand_ink : undefined,
    // the colours the deck actually rendered with (override ?? edition ?? brand) — seeds the pickers
    render_navy: typeof (r as any).raw_request?.render_navy === 'string' ? (r as any).raw_request.render_navy : undefined,
    render_gold: typeof (r as any).raw_request?.render_gold === 'string' ? (r as any).raw_request.render_gold : undefined,
    render_paper: typeof (r as any).raw_request?.render_paper === 'string' ? (r as any).raw_request.render_paper : undefined,
    render_ink: typeof (r as any).raw_request?.render_ink === 'string' ? (r as any).raw_request.render_ink : undefined,
    // per-slide colour overrides, so reopening a deck shows the fine-tuning it was saved with
    slide_colours: (r as any).raw_request?.slide_colours && typeof (r as any).raw_request.slide_colours === 'object'
      ? (r as any).raw_request.slide_colours : undefined,
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

// ── Studio taste profile (Christian 2026-08-28: the this-or-that game) ─────────
// A dozen binary choices stored as {key: value} plus optional likes/dislikes text.
// Read by the carousel pipeline: style recommendations (UI), edition matching and
// art-direction hints (server). Nullable — nothing changes until the game is played.
const PREF_KEYS = new Set([
  'font', 'serif', 'scale', 'ground', 'accent', 'intensity', 'artwork', 'illo', 'density', 'numerals', 'mood', 'devices',
  // 2026-08-28 expansion: real-font duels + colour-world duels ("more fonts and colors so it's specific enough")
  'serif_face', 'serif_flavor', 'display_face', 'sans_face', 'palette_classic', 'palette_depth', 'palette_soft',
  // the ten-palette bracket: the champion world + its hexes (the earlier three keys stay
  // whitelisted so a profile saved before this still reads back)
  'palette', 'palette_main', 'palette_accent', 'palette_base',
]);
route.get('/preferences', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  try {
    const res = await tx.execute(sql`SELECT creative_prefs FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1`);
    const rows = res as unknown as Array<{ creative_prefs: Record<string, unknown> | null }>;
    return c.json({ ok: true, prefs: rows[0]?.creative_prefs ?? null });
  } catch (err) {
    console.error('[studio/preferences] read failed:', err);
    return c.json({ ok: false, error: 'prefs_failed', message: GENERIC }, 500);
  }
});
route.post('/preferences', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const b = await readJson(c);
  const raw = (b.prefs && typeof b.prefs === 'object' ? b.prefs : {}) as Record<string, unknown>;
  const prefs: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (PREF_KEYS.has(k) && typeof v === 'string' && v.length <= 40) prefs[k] = v;
  }
  if (typeof raw.likes === 'string' && raw.likes.trim()) prefs.likes = raw.likes.trim().slice(0, 300);
  if (typeof raw.dislikes === 'string' && raw.dislikes.trim()) prefs.dislikes = raw.dislikes.trim().slice(0, 300);
  try {
    const upd = await tx.execute(sql`UPDATE agency_branding SET creative_prefs = ${JSON.stringify(prefs)}::jsonb WHERE agency_id = ${agencyId} RETURNING agency_id`);
    if ((upd as unknown as unknown[]).length === 0) {
      // agency has no branding row yet — create one carrying just the taste profile
      await tx.execute(sql`INSERT INTO agency_branding (agency_id, creative_prefs) VALUES (${agencyId}, ${JSON.stringify(prefs)}::jsonb)`);
    }
    return c.json({ ok: true, prefs });
  } catch (err) {
    console.error('[studio/preferences] save failed:', err);
    return c.json({ ok: false, error: 'prefs_failed', message: GENERIC }, 500);
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
    // AUTO: a tapped scheme overrides the agency's own brand (validated hex quad). MANUAL: per-layer wheel picks.
    const brand = isBrandColours(b.brand) ? b.brand : loaded.brand;
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : undefined);
    const renderOpts = {
      templateId, property: loaded.property, agency: loaded.agency, brand,
      textOverrides: obj(b.text_overrides),
      colourOverrides: obj(b.colour_overrides),
      manualColours: obj(b.manual_colours),
      positionOverrides: parsePositions(b.position_overrides),
      sizeOverrides: parseSizes(b.size_overrides),
      photoTransforms: parsePhotoTransforms(b.photo_transforms),
      agencyId, propertyId, photoRefs: cleanedIds.length ? cleanedIds : refs,
    };

    // ASK THE CACHE BEFORE FETCHING A SINGLE PHOTO. The key hashes photo REFS, not photo bytes, so it is
    // fully computable here — but the probe used to sit inside renderAndStore, below the download loop.
    // Every warm gallery load was therefore fetching 80 photos (~9.9 MB) and discarding them: a 4-photo
    // tile spent ~0.8s of its ~1.5s step on images it already had rendered.
    const cacheKey = editableCacheKey(renderOpts as never);
    if (cacheKey) {
      const hit = await signedForKey(cacheKey);
      if (hit) return c.json({ ok: true, template_id: templateId, image_url: hit.image_url,
        ...(hit.thumb_url ? { thumb_url: hit.thumb_url } : {}), storage_path: cacheKey });
    }

    const buffers: Buffer[] = cleanedIds.length ? await cleanedBuffers(tx, agencyId, cleanedIds) : [];
    if (!buffers.length) {
      // in parallel — a cold 4-photo tile pays one photo's latency, not four in a row
      const loaded4 = await Promise.all(refs.map((ref) => loadPhotoBuffer(ref)));
      for (const buf of loaded4) if (buf) buffers.push(buf);
    }
    if (buffers.length === 0) return c.json({ ok: false, error: 'photo_fetch_failed', message: "The selected photos couldn't be loaded." }, 422);

    const stored = await renderAndStore({
      ...renderOpts, photoBuffers: buffers,
    });
    return c.json({ ok: true, template_id: templateId, image_url: stored.image_url,
      ...(stored.thumb_url ? { thumb_url: stored.thumb_url } : {}), storage_path: stored.storage_path });
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
          taste_tags: t.taste_tags,                          // lets the gallery badge "For your taste"
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
/** Per-slide colours: render the deck once per DISTINCT palette and take each slide from its
 *  own pass. Two or three passes cost a second or two, where teaching every renderer about
 *  per-slide brands would mean threading a palette through every spec builder in the engine.
 *  Used by BOTH the edit path and the remix path — a remix that ignored these would hand back a
 *  deck repainted in the deck colours while the pickers still showed the per-slide ones. */
/** FOUR SLOTS, not two. Christian 2026-08-31: "since there is at least 2 other colors also, i
 *  would like to have those colors customisable also, so you can change the beige or the black
 *  etc." He is right that they exist: agency_branding has carried primary/accent/background/text
 *  since the beginning, mapBranding reads all four, and CarouselBrand carries all four into every
 *  renderer. Only two were ever CHOOSABLE, so the paper and the ink sat at their seed defaults for
 *  every agency that has ever used Studio.
 *
 *  main = the dominant colour · accent = the second · paper = the pale ground · ink = the dark
 *  text. They map onto the engine's existing navy/gold/cream/text, so nothing downstream changes. */
export const SLOTS = ['main', 'accent', 'paper', 'ink'] as const;
export type SlotColours = Partial<Record<(typeof SLOTS)[number], string>>;
const SLOT_FIELD = { main: 'navy', accent: 'gold', paper: 'cream', ink: 'text' } as const;

/** Read the four slots out of a request body. Accepts the legacy two-colour keys as well, because
 *  every stored deck and the deployed dashboard still speak brand_navy / brand_gold. */
function parseSlots(src: Record<string, unknown>, prefix = 'brand_'): SlotColours {
  const out: SlotColours = {};
  for (const k of SLOTS) {
    const v = hexColour(src[`${prefix}${k}`]);
    if (v) out[k] = v;
  }
  if (!out.main) { const v = hexColour(src[`${prefix}navy`]); if (v) out.main = v; }
  if (!out.accent) { const v = hexColour(src[`${prefix}gold`]); if (v) out.accent = v; }
  return out;
}

function applySlots<B extends CarouselBrand>(brand: B, s: SlotColours): B {
  const bv = brand as unknown as Record<string, string>;
  for (const k of SLOTS) { const v = s[k]; if (v) bv[SLOT_FIELD[k]] = v; }
  return brand;
}

/** Merge an incoming per-slide colour map over the stored one. An entry with no colours at all
 *  clears that slide (it goes back to following the deck). */
function mergeSlideColours(
  prior: Record<string, unknown>,
  incoming: unknown,
): Record<string, SlotColours> {
  // Every deck already stored speaks {navy, gold}. parseSlots reads those as main/accent, so the
  // old rows convert on read; without this an existing per-slide override would still be in the
  // row, still be echoed to the picker, and quietly stop painting.
  const out: Record<string, SlotColours> = {};
  for (const [k, v] of Object.entries(prior ?? {})) {
    const n = parseSlots((v ?? {}) as Record<string, unknown>, '');
    if (Object.keys(n).length) out[k] = n;
  }
  if (!incoming || typeof incoming !== 'object') return out;
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i > 12) continue;
    const src = (v ?? {}) as Record<string, unknown>;
    const next = parseSlots(src, '');
    if (!Object.keys(next).length) { delete out[String(i)]; continue; }
    out[String(i)] = next;
  }
  return out;
}


/** Christian 2026-08-31: "i putted a bright orange color on the 2nd slide to see where it shows up
 *  and it didnt." It didn't because #ff6f00 reads 2.43:1 on the cream paper and RULE 1 — the rule
 *  he set — swaps an unreadable ink for a legible one. That is correct, and it was SILENT: the
 *  warning in the renderer only fires when no colour works at all, so a choice that simply gets
 *  overruled disappears without a word. A picker that ignores you and says nothing is worse than
 *  one that refuses you. These notes go back with the render so the UI can say what happened. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function colourNotes(brand: CarouselBrand, slideCols: Record<string, SlotColours>): string[] {
  const notes: string[] = [];
  const check = (ink: string, paper: string, where: string) => {
    const r = contrast(ink, paper);
    if (r >= 4.5) return;
    notes.push(`${where} ${ink} reads ${r.toFixed(1)}:1 against the paper — body text needs 4.5:1, so a darker ink was used instead. Pick something deeper if you want to see this colour.`);
  };
  check(brand.text, brand.cream, 'Your text colour');
  for (const [k, o] of Object.entries(slideCols)) {
    if (!o.ink) continue;
    check(o.ink, o.paper ?? brand.cream, `Slide ${Number(k) + 1}'s text colour`);
  }
  return notes.slice(0, 4);
}

/** RULE 10 — contact details are assembled in ONE place, always from agency_branding (mapBranding
 *  reads brand_name / website_url / phone). No carousel path builds this string itself. */
function contactLine(agency: { web?: string | null; phone?: string | null }): string {
  return [agency.web, agency.phone].filter(Boolean).join(' · ');
}

async function renderWithSlideColours<B extends CarouselBrand>(
  brand: B,
  slideCols: Record<string, SlotColours>,
  render: (b: B, locked: boolean) => Promise<Buffer[]>,
  deckLocked = false,
): Promise<Buffer[]> {
  const base = await render(brand, deckLocked);
  const groups = new Map<string, number[]>();
  const bv = brand as unknown as Record<string, string>;
  const resolve = (o: SlotColours) => SLOTS.map((k) => o[k] ?? bv[SLOT_FIELD[k]]);
  const deckKey = SLOTS.map((k) => bv[SLOT_FIELD[k]]).join('|');
  base.forEach((_, i) => {
    const o = slideCols[String(i)];
    if (!o || !Object.keys(o).length) return;
    const key = resolve(o).join('|');
    if (key === deckKey) return;              // the override IS the deck palette — nothing to redraw
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  for (const [key, idxs] of groups) {
    const parts = key.split('|');
    const b = { ...brand } as unknown as Record<string, string>;
    SLOTS.forEach((k, j) => { b[SLOT_FIELD[k]] = parts[j]; });
    const pass = await render(b as unknown as B, true);
    for (const i of idxs) if (pass[i]) base[i] = pass[i];
  }
  return base;
}

// Slides upload in PARALLEL. Sequentially this was ~5s of the ~9s an edit/recolour made the
// browser wait for — long enough to hit the hosting platform's request ceiling on the only
// synchronous request in the Studio (creation is fire-and-forget). Order comes from the index,
// not from completion order.
async function storeSlides(agencyId: string, genId: string, slides: Buffer[]): Promise<{ path: string; url: string }[]> {
  return Promise.all(slides.map(async (buf, i) => {
    const key = `carousel/${agencyId}/${genId}/slide-${i + 1}.png`;
    const up = await supabaseAdmin.storage.from('generated-images').upload(key, buf, { contentType: 'image/png', upsert: true });
    if (up.error) throw new Error(`slide upload: ${up.error.message}`);
    const signed = await supabaseAdmin.storage.from('generated-images').createSignedUrl(key, 60 * 60 * 24 * 365);
    if (signed.error || !signed.data?.signedUrl) throw new Error('slide sign failed');
    return { path: key, url: signed.data.signedUrl };
  }));
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
  agencyProfile?: string;  // RULE 9: what the agency does — the closing slide is written from it
  styleEdition?: number;   // type-only styles: which font/colour edition this deck wears
  lockPalette?: boolean;   // user picked custom colours — edition may not recolour
  agencyTaste?: string;    // one-line taste profile from the this-or-that game (art-director hint)
}): Promise<void> {
  const { genId, agencyId } = opts;
  try {
    // Variety across generations (Christian 2026-08-28: "a key or a luggage appears" on every
    // house/moving topic): hand the planner the hero objects from this agency's recent decks so it
    // must find fresh ones. Best-effort — a fetch failure never blocks the post.
    let avoidMotifs: string[] = [];
    if (opts.type === 'tips') {
      try {
        const { data: prev } = await supabaseAdmin.from('image_generations')
          .select('result_metadata').eq('agency_id', agencyId).eq('status', 'completed')
          .order('created_at', { ascending: false }).limit(14);
        const motifs = new Set<string>();
        for (const g of prev ?? []) {
          const meta = (g as { result_metadata?: { engine?: string; plan?: { image_scenes?: unknown; tips?: { scene?: unknown }[] } } }).result_metadata;
          if (meta?.engine !== 'carousel') continue;
          const scenes = [
            ...(Array.isArray(meta.plan?.image_scenes) ? meta.plan.image_scenes : []),
            ...(Array.isArray(meta.plan?.tips) ? meta.plan.tips.map((t) => t?.scene) : []),
          ];
          for (const s of scenes) {
            if (typeof s !== 'string' || !s.trim()) continue;
            const hero = s.split(/[,;—.]/)[0].trim().toLowerCase().split(/\s+/).slice(0, 6).join(' ');
            if (hero.length >= 6) motifs.add(hero);
          }
        }
        avoidMotifs = [...motifs].slice(0, 18);
      } catch { /* variety hint only */ }
    }
    let plan = await planCarousel({
      type: opts.type, topic: opts.topic, quoteText: opts.quoteText, quoteAuthor: opts.quoteAuthor,
      slideCount: opts.slideCount, language: opts.language, agencyName: opts.agency.name,
      agencyProfile: opts.agencyProfile, avoidMotifs,
    });
    // EDITOR pass (Christian 2026-08-28): a skeptical second read of the copy — sense, value,
    // trust — before anything renders. Quote decks are verbatim client words and skip it.
    let copyQa: { revised: boolean; notes: string[] } | undefined;
    if (opts.type === 'tips') {
      const edited = await editPlan(plan, opts.topic ?? '', opts.language);
      if (edited) {
        plan = edited.plan;
        copyQa = { revised: edited.notes.length > 0, notes: edited.notes };
      }
    }
    const contact = contactLine(opts.agency);
    // AI-imagery styles compose the pre-seeded generated family; a library miss falls back to the
    // editorial type-only deck — an image can never block a post (spec fallback rule)
    let slides: Buffer[];
    let usedStyle = opts.style;
    let imagePaths: string[] = [];
    let perSlideArt = false;
    let artworkSource: 'fresh_per_slide' | 'fresh_family' | 'library' | 'none' = 'none';
    let artworkQa: { reviewed: number; regenerated: number; still_flagged: number } | undefined;
    let artworkError: string | undefined;
    const onFail = (reason: string) => { artworkError = artworkError ?? reason; };
    if (opts.type === 'tips' && isTipsImageStyle(opts.style)) {
      // per-slide artwork: cover scene + one scene PER TIP (every slide's design = that slide's topic);
      // micro-unique every post. Fallbacks: 3-scene family → seeded approved family → editorial deck.
      // ART DIRECTOR (Christian 2026-08-28: "more thought in the image generation process") — a
      // dedicated pass writes idea+scene per slide; its scenes REPLACE the copywriter's one-shot
      // scenes and its ideas power the vision reviewer. Fails → the planner's scenes stand.
      const direction = await directScenes({
        topic: opts.topic ?? '', hook: plan.hook_title,
        tips: plan.tips.map((t) => ({ title: t.title, body: t.body })),
        includeContext: opts.includeContext, avoidMotifs,
        taste: opts.agencyTaste || undefined,
      });
      if (direction) {
        // Keep the stored plan PlanSchema-valid (scenes ≤300 chars, image_scenes entries ≥10, no
        // '' placeholders) — /carousel/update re-parses this plan on every later edit, so an
        // out-of-bounds scene here would lock the deck out of editing forever.
        const clampScene = (s: unknown) => (typeof s === 'string' ? s.trim().slice(0, 300) : '');
        const cand = [clampScene(direction.cover.scene), clampScene(direction.context?.scene ?? plan.image_scenes?.[1]), clampScene(plan.image_scenes?.[2])];
        const scenes: string[] = [];
        for (const s of cand) { if (s.length >= 10) scenes.push(s); else break; }
        plan.image_scenes = scenes;
        direction.tips.forEach((b, i) => { if (plan.tips[i]) plan.tips[i].scene = clampScene(b.scene); });
      }
      const tipScenes = plan.tips.map((t) => t.scene ?? '');
      const coverScene = plan.image_scenes?.[0] ?? '';
      // slide 2 (context) gets its OWN artwork from image_scenes[1] (Christian 2026-08-28: the
      // cover-crop reuse on slide 2 "looks bad" on the two attention slides); absent/short → the
      // renderer falls back to the cover crop as before
      const contextScene = opts.includeContext ? (plan.image_scenes?.[1] ?? '') : '';
      const hasContextArt = typeof contextScene === 'string' && contextScene.trim().length >= 10;
      const allScenes = [coverScene, ...(hasContextArt ? [contextScene] : []), ...tipScenes];
      const allIdeas = direction
        ? [direction.cover.idea, ...(hasContextArt && direction.context ? [direction.context.idea] : hasContextArt ? [''] : []), ...direction.tips.map((b) => b.idea)]
        : undefined;
      // RULE 1: the quiet region the director composed for, in the same order as the scenes
      const allZones = direction
        ? [direction.cover.quiet_zone, ...(hasContextArt ? [direction.context?.quiet_zone] : []), ...direction.tips.map((b) => b.quiet_zone)]
        : undefined;
      let images: Buffer[] | null = null;
      let contextArt = false;
      if (allScenes.every((x) => typeof x === 'string' && x.trim().length >= 10)) {
        const fresh = await generateTipsImages({ style: opts.style, scheme: opts.scheme, scenes: allScenes, agencyId, genId, ideas: allIdeas, quietZones: allZones, brandColours: opts.lockPalette ? { navy: opts.brand.navy, gold: opts.brand.gold } : undefined, onFail });
        if (fresh && fresh.buffers.length === allScenes.length) {
          images = fresh.buffers; imagePaths = fresh.paths; perSlideArt = true; artworkSource = 'fresh_per_slide';
          contextArt = hasContextArt;
          if (fresh.qa?.reviewed) artworkQa = fresh.qa;
        }
      }
      if (!images) {
        const fam = await generateTipsImages({ style: opts.style, scheme: opts.scheme, scenes: (plan.image_scenes ?? []).slice(0, 3), agencyId, genId, brandColours: opts.lockPalette ? { navy: opts.brand.navy, gold: opts.brand.gold } : undefined, onFail });
        if (fam && fam.buffers.length === 3) { images = fam.buffers; imagePaths = fam.paths; artworkSource = 'fresh_family'; }
      }
      if (!images) { images = await loadTipsImages(opts.style); if (images) artworkSource = 'library'; }
      if (images) {
        slides = perSlideArt
          ? await renderTipsImageStyledV2(opts.style, plan, opts.agency.name, contact, opts.brand, images, opts.language, opts.includeRecap, opts.includeContext, 0, contextArt)
          : await renderTipsImageStyled(opts.style, plan, opts.agency.name, contact, opts.brand, images, opts.language, opts.includeContext, opts.includeRecap);
      } else {
        usedStyle = 'editorial';
        slides = await renderPlannedStyled('editorial', plan, opts.agency.name, contact, opts.brand, opts.language, opts.styleEdition ?? 0, opts.lockPalette ?? false, opts.includeContext, opts.includeRecap);
      }
    } else {
      slides = await renderPlannedStyled(opts.style, plan, opts.agency.name, contact, opts.brand, opts.language, opts.styleEdition ?? 0, opts.lockPalette ?? false, opts.includeContext, opts.includeRecap);
    }
    const stored = await storeSlides(agencyId, genId, slides);

    await supabaseAdmin.from('image_generations').update({
      status: 'completed',
      result_image_url: stored[0].url,
      result_image_storage_path: stored[0].path,
      result_metadata: {
        engine: 'carousel', carousel_type: opts.type, carousel_style: usedStyle, slide_count: stored.length, slides: stored,
        ai_imagery: opts.type === 'tips' && isTipsImageStyle(usedStyle),
        image_paths: imagePaths, image_scheme: opts.scheme, per_slide_art: perSlideArt, artwork_source: artworkSource, artwork_error: artworkError, artwork_qa: artworkQa, copy_qa: copyQa, include_recap: opts.includeRecap, include_context: opts.includeContext,
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
  // optional two-colour override (Christian 2026-08-28): main = brand.navy, accent = brand.gold —
  // chrome/type only; artwork palette stays with the colour-mood scheme
  const chosen = parseSlots(b);                       // main / accent / paper / ink
  const brandNavy = chosen.main ?? null;
  const brandGold = chosen.accent ?? null;

  try {
    // ── tips / quote: no property needed — brand + agency identity only ──────
    if (type === 'tips' || type === 'quote') {
      const topic = typeof b.topic === 'string' ? b.topic.trim().slice(0, 300) : '';
      const quoteText = typeof b.quote_text === 'string' ? b.quote_text.trim().slice(0, 700) : '';
      const quoteAuthor = typeof b.quote_author === 'string' ? b.quote_author.trim().slice(0, 80) : '';
      // 'slides' = TOTAL deck length the agent asked for (3..10): cover + [context when >=5] + tips +
      // [recap when >=7] + CTA. Legacy slide_count (= tips) still honoured.
      // 7 tips is the plan schema's hard max, so with one hero and one closing the deck ceiling
      // is 9 — asking for 10 used to silently return 9.
      const slidesTotal = Number.isInteger(b.slides) ? Math.min(9, Math.max(3, b.slides as number)) : null;
      // RULE 3 — a deck is ONE hero, N tips, ONE closing. The intro ("second cover") and the
      // recap were on by default, which is how a cover promising "the order nobody explains"
      // was followed by a slide promising the same thing again before any advice arrived.
      // They are opt-in now: the agent asks for them by name, nothing adds them silently.
      const includeContext = b.include_context === true;
      const includeRecap = b.include_recap === true;
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
               phone, whatsapp_number, website_url, sender_email, email_signature_name, creative_prefs,
               city, region, country, tone, brand_voice, content_style
        FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
      `);
      const bRows = bRes as unknown as any[];
      const { agency, brand } = mapBranding(bRows[0] || {});
      applySlots(brand, chosen);
      const prefs = (bRows[0]?.creative_prefs && typeof bRows[0].creative_prefs === 'object'
        ? bRows[0].creative_prefs : null) as Record<string, string> | null;
      // RULE 9: what this agency actually does — and ONLY from fields that actually say so.
      // The first version passed the name, town and tone as "the agency profile", which is
      // non-empty for every branded agency but says nothing about their services — so the
      // writer had no choice but to invent the claim printed on the closing slide. A name and a
      // town are context, not a service: they are passed as context, and the SERVICE claim is
      // only requested when brand_voice or content_style actually describe the business.
      // brand_voice and content_style describe HOW this agency writes, not WHAT it sells —
      // labelling them "what they do" made the writer turn a tone note into a service claim,
      // which is the same fabrication in a new costume. They are passed as voice context only.
      // Nothing in agency_branding states the agency's actual services yet, so RULE 9's line
      // stays empty until that field exists: an empty closing line is honest, an invented
      // speciality is not.
      const agencyProfile = [
        bRows[0]?.brand_name ? `Name: ${bRows[0].brand_name}` : null,
        [bRows[0]?.city, bRows[0]?.region, bRows[0]?.country].filter(Boolean).join(', ') || null,
        bRows[0]?.brand_voice ? `Voice (how they write, NOT what they sell): ${String(bRows[0].brand_voice).slice(0, 200)}` : null,
        bRows[0]?.content_style ? `Content style (NOT services): ${String(bRows[0].content_style).slice(0, 200)}` : null,
      ].filter(Boolean).join(' · ') || undefined;

      // each new type-only deck wears an edition (fonts + colour world) — matched to the agency's
      // taste profile when the this-or-that game has been played, random otherwise; stored so
      // every re-render of this deck reproduces the exact same look
      const styleEdition = pickEditionForTaste(style, prefs, { navy: brand.navy, gold: brand.gold });
      // any chosen slot locks the palette — otherwise setting only the paper or only the ink
      // would leave the edition free to overwrite it
      const lockPalette = Object.keys(chosen).length > 0;
      const agencyTaste = tasteLine(prefs);
      // The colours this deck will ACTUALLY render with (override ?? edition palette ?? agency
      // brand) — stored so the finished-deck colour pickers open on the truth instead of generic
      // defaults, which silently overwrote real brand/edition colours on "Apply colours".
      const edPal = !lockPalette ? ((TYPE_EDITIONS[style] ?? [])[styleEdition] ?? {}) : {};
      const renderNavy = chosen.main ?? edPal.navy ?? brand.navy;
      const renderGold = chosen.accent ?? edPal.gold ?? brand.gold;
      const renderPaper = chosen.paper ?? edPal.cream ?? brand.cream;
      const renderInk = chosen.ink ?? brand.text;

      const label = type === 'tips' ? `Tips carousel · ${topic.slice(0, 80)}` : 'Client quote carousel';
      const ins = await tx.execute(sql`
        INSERT INTO image_generations
          (agency_id, generation_type, status, prompt, requested_by, raw_request)
        VALUES
          (${agencyId}, 'social_post', 'processing', ${label}, ${user?.sub ?? null}::uuid,
           ${JSON.stringify({ engine: 'carousel', content_type: 'carousel', carousel_type: type, carousel_style: style, image_scheme: scheme, include_recap: includeRecap, include_context: includeContext, topic, quote_text: quoteText, quote_author: quoteAuthor, slide_count: slideCount, language, brand_navy: brandNavy, brand_gold: brandGold, brand_paper: chosen.paper ?? null, brand_ink: chosen.ink ?? null, render_navy: renderNavy, render_gold: renderGold, render_paper: renderPaper, render_ink: renderInk, style_edition: styleEdition })}::jsonb)
        RETURNING id
      `);
      const rows = ins as unknown as Array<{ id: string }>;
      const genId = rows[0]?.id;
      if (!genId) throw new Error('insert failed');

      void runPlannedCarousel({
        genId, agencyId, type, topic, quoteText, quoteAuthor, slideCount, language, style, scheme, includeRecap, includeContext,
        agency: { name: agency.name, web: agency.web, phone: agency.phone }, brand,
        agencyProfile, styleEdition, lockPalette, agencyTaste,
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

    // Self-heal the round-tripped SCENE fields before validating (the user can't see or edit
    // them): clamp overlong director scenes to the schema cap and drop invalid image_scenes
    // tails — otherwise a deck stored with an out-of-bounds scene can never be edited again.
    const pIn: Record<string, unknown> = { ...(b.plan as Record<string, unknown>), type: priorPlan.type };
    if (Array.isArray(pIn['image_scenes'])) {
      const healed: string[] = [];
      for (const s of pIn['image_scenes'] as unknown[]) {
        const t = typeof s === 'string' ? s.trim().slice(0, 300) : '';
        if (t.length >= 10) healed.push(t); else break;
      }
      pIn['image_scenes'] = healed;
    }
    if (Array.isArray(pIn['tips'])) {
      pIn['tips'] = (pIn['tips'] as Record<string, unknown>[]).map((t) =>
        t && typeof t === 'object' ? { ...t, scene: typeof t['scene'] === 'string' ? (t['scene'] as string).trim().slice(0, 300) : '' } : t);
    }
    const parsed = PlanSchema.safeParse(pIn);
    if (!parsed.success) {
      return c.json({ ok: false, error: 'invalid_plan', message: 'Some of the edited text is too long or missing.' }, 400);
    }
    // RULE 7 and RULE 8 are enforced in normalisePlan(), which until now ran only on the paths
    // where a MODEL wrote the copy. A human editing the same fields here reached the renderer
    // untouched: "DM: PRICE" shipped as the closing pill, a tip title kept its comma splice, and
    // a "P.D." caption line survived — the three things those rules exist to prevent. Worse, the
    // un-normalised plan is stored back below and read as priorPlan by /carousel/remix, so one
    // edit propagated into every later deck. The rule belongs to every path or it is not a rule.
    const editLang = typeof rows[0].raw_request?.language === 'string' ? (rows[0].raw_request.language as string) : 'es';
    const plan = normalisePlan(parsed.data as CarouselPlan, editLang);
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
    // colour override: a NEW choice sent with this edit wins over the stored one, and is
    // persisted so every later re-render keeps it (Christian 2026-08-28: "possible to edit
    // those colors when you get to the finished product too")
    const rawU = (rows[0].raw_request ?? {}) as Record<string, unknown>;
    // A NEW choice on this edit wins; otherwise the deck keeps whatever it already chose.
    const chosenU: SlotColours = { ...parseSlots(rawU), ...parseSlots(b) };
    applySlots(brand, chosenU);
    // A per-slide override changes ONE channel; the others have to come from the colours this deck
    // actually rendered with, not from the agency's defaults. Creation stores those as render_*
    // (the picker reads them), but this path never did — so on a deck wearing an edition palette,
    // touching the accent under one slide also snapped that slide's headline back to the agency
    // navy and shifted its paper. Same reason an override that happened to equal the agency's own
    // hex compared equal to the base and was silently dropped.
    const rendered = parseSlots(rawU, 'render_');
    for (const k of SLOTS) if (!chosenU[k] && rendered[k]) applySlots(brand, { [k]: rendered[k] });
    {
      // an unlocked deck still wears its edition's paper, which render_paper may predate
      const edStyle = typeof meta?.carousel_style === 'string' ? meta.carousel_style : '';
      const edN = typeof rawU.style_edition === 'number' ? rawU.style_edition : 0;
      const edCream = !Object.keys(chosenU).length && !rendered.paper
        ? ((TYPE_EDITIONS[edStyle] ?? [])[edN] ?? {}).cream : undefined;
      if (edCream) brand.cream = edCream;
    }
    const effNavy = chosenU.main ?? null, effGold = chosenU.accent ?? null;
    const deckLocked = Object.keys(chosenU).length > 0;
    const contact = contactLine(agency);

    // PER-SLIDE colours (Christian 2026-08-28: "no matter what color i choose, in some places
    // one color wont show as good as it does in other places — it must be possible to change on
    // each page individually"). One palette cannot serve a full-bleed colour ground and a cream
    // page with fine gold rules equally well. Overrides are keyed by slide index and merge over
    // the deck colours; a slide with no override keeps them.
    const priorSlideCols = (rawU.slide_colours && typeof rawU.slide_colours === 'object' ? rawU.slide_colours : {}) as Record<string, unknown>;
    const slideCols = mergeSlideColours(priorSlideCols, b.slide_colours);
    const renderDeck = (render: (b: typeof brand, locked: boolean) => Promise<Buffer[]>) =>
      renderWithSlideColours(brand, slideCols, render, deckLocked);

    // re-render in the SAME visual style the carousel was created with
    const storedStyle: CarouselStyle = typeof meta?.carousel_style === 'string' &&
      (PLANNED_STYLES[priorPlan.type] as string[]).includes(meta.carousel_style)
      ? meta.carousel_style : 'editorial';
    const storedLang = typeof rows[0].raw_request?.language === 'string' ? (rows[0].raw_request.language as string) : 'es';
    let slides: Buffer[];
    if (priorPlan.type === 'tips' && isTipsImageStyle(storedStyle)) {
      const ownPaths = Array.isArray(meta?.image_paths) ? (meta.image_paths as string[]) : [];
      const ctxArt = ownPaths.length === plan.tips.length + 2;   // deck stored with its own context artwork
      const perSlideArt = meta?.per_slide_art === true && (ownPaths.length === plan.tips.length + 1 || ctxArt);
      const own = ownPaths.length >= 3 ? await loadGenerationImages(ownPaths) : null;
      const images = own ?? await loadTipsImages(storedStyle);
      // ctxArt describes the STORED set — when it fails to load and the 3-image library stands
      // in, keeping ctxArt would collapse the tip rotation onto a single artwork
      const ctxArtEff = ctxArt && !!own;
      if (images) {
        slides = await renderDeck((br) => perSlideArt
          ? renderTipsImageStyledV2(storedStyle, plan, agency.name, contact, br, images, storedLang, meta?.include_recap === true, meta?.include_context === true, typeof meta?.layout_variant === 'number' ? meta.layout_variant : 0, ctxArtEff)
          : renderTipsImageStyled(storedStyle, plan, agency.name, contact, br, images, storedLang, meta?.include_context === true, meta?.include_recap === true));
      } else {
        slides = await renderDeck((br, locked) => renderPlannedStyled('editorial', plan, agency.name, contact, br, storedLang, typeof rawU.style_edition === 'number' ? rawU.style_edition : 0, locked, meta?.include_context === true, meta?.include_recap === true, deckLocked));
      }
    } else {
      slides = await renderDeck((br, locked) => renderPlannedStyled(storedStyle, plan, agency.name, contact, br, storedLang, typeof rawU.style_edition === 'number' ? rawU.style_edition : 0, locked, meta?.include_context === true, meta?.include_recap === true, deckLocked));
    }
    const stored = await storeSlides(agencyId, genId, slides);

    await supabaseAdmin.from('image_generations').update({
      result_image_url: stored[0].url,
      result_image_storage_path: stored[0].path,
      result_metadata: {
        ...meta, slide_count: stored.length, slides: stored,
        plan, caption: plan.caption, hashtags: plan.hashtags,
      },
      ...(Object.keys(parseSlots(b)).length || b.slide_colours
        ? { raw_request: { ...rawU, slide_colours: slideCols,
            // store BOTH the choice and what it actually rendered as, under the new slot keys
            // and the legacy two so a deck saved today still opens in the deployed dashboard
            ...(chosenU.main ? { brand_navy: chosenU.main, render_navy: chosenU.main, brand_main: chosenU.main, render_main: chosenU.main } : {}),
            ...(chosenU.accent ? { brand_gold: chosenU.accent, render_gold: chosenU.accent, brand_accent: chosenU.accent, render_accent: chosenU.accent } : {}),
            ...(chosenU.paper ? { brand_paper: chosenU.paper, render_paper: chosenU.paper } : {}),
            ...(chosenU.ink ? { brand_ink: chosenU.ink, render_ink: chosenU.ink } : {}) } }
        : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', genId).eq('agency_id', agencyId);

    return c.json({
      ok: true, id: genId, slide_colours: slideCols,
      colour_notes: colourNotes(brand, slideCols),
      slides: stored.map((s) => s.url), plan, caption: plan.caption, hashtags: plan.hashtags,
    });
  } catch (err) {
    console.error('[studio/carousel-update] failed:', err);
    return c.json({ ok: false, error: 'update_failed', message: GENERIC }, 500);
  }
});

// ── POST /api/studio/carousel/topic-ideas — GET INSPIRED: 6 fresh tips topics (free) ──
route.post('/carousel/topic-ideas', async (c) => {
  const tx = c.get('tx');
  const agencyId = c.get('agencyId');
  const b = await readJson(c);
  const language = typeof b.language === 'string' && b.language.trim() ? b.language.trim().slice(0, 5) : 'es';
  const exclude = Array.isArray(b.exclude)
    ? (b.exclude as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 24) : [];
  try {
    // Christian 2026-08-30: "i feel like i have seen the same ones over and over again — they
    // shouldn't get resent as inspiration over and over, it should be new ones, just a few
    // reused every time and changed the way they're said." The client only excluded what it had
    // shown in THIS session, so a fresh visit re-offered the same ideas. The agency's OWN
    // history is the real exclusion list: every topic it has been shown or generated from.
    let seen: string[] = [];
    try {
      const hist = await tx.execute(sql`
        SELECT DISTINCT raw_request->>'topic' AS topic
        FROM image_generations
        WHERE agency_id = ${agencyId} AND raw_request->>'topic' IS NOT NULL
        LIMIT 60
      `);
      seen = (hist as unknown as Array<{ topic: string }>).map((r) => r.topic).filter(Boolean);
    } catch { /* history unavailable — the session list still applies */ }
    const topics = await topicIdeas(language, [...new Set([...exclude, ...seen])].slice(0, 60));
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
// RULE 11 — one medium per deck: a style remix rotates WITHIN the deck's medium, so an
// illustrated deck never comes back photographic (the compositions advance too, so the axis
// still looks new). Keyed off TIPS_MEDIUM, the single place the medium is declared.
const REMIX_IMG_RING = ['bodegon', 'litoral', 'tinta', 'salitre', 'papel', 'arcilla', 'acuarela', 'bordado', 'pueblo', 'mercado'];
const isPhotoMedium = (style: string) => /photograph/i.test(TIPS_MEDIUM[style] ?? '');
const mediumRing = (style: string) => {
  const same = REMIX_IMG_RING.filter((s) => isPhotoMedium(s) === isPhotoMedium(style));
  return same.length > 1 ? same : REMIX_IMG_RING;
};

/** strict #rrggbb or null — the only shape the colour override accepts */
const hexColour = (v: unknown): string | null => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;

/** taste → type-style edition (editions tagged by accent temperature / ground); no profile → random */
/** squared RGB distance — good enough to say which edition palette is nearest their world */
function colourGap(a?: string, b?: string): number {
  if (!a || !b || !/^#[0-9a-fA-F]{6}$/.test(a) || !/^#[0-9a-fA-F]{6}$/.test(b)) return Number.POSITIVE_INFINITY;
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const d = [16, 8, 0].map((s) => (((x >> s) & 255) - ((y >> s) & 255)) ** 2);
  return d[0] + d[1] + d[2];
}
/** the edition whose colour world sits closest to the palette they crowned in the taste game */
function nearestEdition(style: string, prefs: Record<string, string>, brand: { navy: string; gold: string }): number | null {
  const main = prefs['palette_main'], accent = prefs['palette_accent'];
  if (!main || !accent) return null;
  const eds = TYPE_EDITIONS[style] ?? [];
  if (!eds.length) return null;
  let best = 0, bestGap = Number.POSITIVE_INFINITY;
  eds.forEach((ed, i) => {
    const gap = colourGap(ed.navy ?? brand.navy, main) + colourGap(ed.gold ?? brand.gold, accent);
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return Number.isFinite(bestGap) ? best : null;
}

function pickEditionForTaste(style: string, prefs: Record<string, string> | null, brand?: { navy: string; gold: string }): number {
  const rnd = () => Math.floor(Math.random() * 3);
  if (!prefs) return rnd();
  // FONT answers outrank colour ("make the fonts the ones they choose"); the style-specific
  // rules below run first, and the palette bracket decides anything they leave open.
  const byPalette = () => (brand ? nearestEdition(style, prefs, brand) : null);
  // FONT answers outrank colour answers (Christian 2026-08-28: "in carousel it should make the
  // fonts the ones they choose") — each edition carries a display face, so the serif duel picks
  // the edition wearing that face; the palette duels break ties; the old mood/accent heuristics
  // remain the final fallback.
  if (style === 'editorial') {
    if (prefs.serif_face === 'prata') return 1;                 // Prata + warm ink/terracotta
    if (prefs.serif_face === 'playfair') return 2;              // Playfair + deep green/brass
    if (prefs.serif_flavor === 'caslon') return 0;              // Caslon classic
    return byPalette() ?? (prefs.accent === 'warm' ? 1 : prefs.accent === 'cool' ? 2 : rnd());
  }
  if (style === 'cartel') {
    // cartel wears Anton in every edition — the face is the style, so colour decides here
    return byPalette() ?? (prefs.ground === 'dark' ? 2 : prefs.mood === 'bold' ? 1 : rnd());
  }
  if (style === 'encalada') {
    if (prefs.display_face === 'italiana') return 1;            // Italiana + indigo/clay
    if (prefs.serif_face === 'prata') return 2;                 // Prata + earth/olive
    return byPalette() ?? (prefs.accent === 'cool' ? 1 : prefs.accent === 'warm' ? 2 : rnd());
  }
  if (style === 'sereno') {
    if (prefs.serif_face === 'playfair') return 1;              // Playfair + slate/sand
    if (prefs.serif_face === 'prata') return 2;                 // Prata + steel blue
    return byPalette() ?? (prefs.accent === 'warm' ? 1 : prefs.accent === 'cool' ? 2 : rnd());
  }
  return byPalette() ?? rnd();
}

/** taste → one compact line for the art director; empty string when no profile exists */
function tasteLine(prefs: Record<string, string> | null): string {
  if (!prefs) return '';
  const bits: string[] = [];
  if (prefs.artwork === 'illustration') bits.push('leans illustrated/painterly over photographic');
  if (prefs.artwork === 'photo') bits.push('leans photographic over illustrated');
  if (prefs.accent === 'warm') bits.push('prefers warm tones (terracotta, gold, sand)');
  if (prefs.accent === 'cool') bits.push('prefers cool tones (olive, sea, slate)');
  if (prefs.density === 'minimal') bits.push('prefers calm minimal scenes with few objects');
  if (prefs.density === 'decorated') bits.push('enjoys richer, layered compositions');
  if (prefs.mood === 'bold') bits.push('bold striking imagery welcome');
  if (prefs.mood === 'calm') bits.push('keep the mood calm and premium');
  const palWords: Record<string, string> = {
    'navy-gold': 'deep navy and gold', terracotta: 'terracotta and cream',
    'green-brass': 'deep green and aged brass', noche: 'ink black and gold',
    'indigo-clay': 'indigo and burnt clay', 'earth-olive': 'earth browns and olive',
    aegean: 'sea blue and sand', plum: 'plum and apricot',
    cobalt: 'cobalt blue and sun yellow', 'slate-sand': 'slate grey and sand',
  };
  const chosen = prefs.palette ? palWords[prefs.palette] : null;
  const legacy = [prefs.palette_classic, prefs.palette_depth, prefs.palette_soft]
    .map((p) => (p ? palWords[p] : null)).filter(Boolean);
  if (chosen) bits.push(`their colour world is ${chosen}`);
  else if (legacy.length) bits.push(`their chosen colour worlds: ${legacy.join(', ')}`);
  if (prefs.likes) bits.push(`they love: ${prefs.likes}`);
  if (prefs.dislikes) bits.push(`AVOID: ${prefs.dislikes}`);
  return bits.join('; ');
}
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
    const ctxArt = ownPaths.length === priorPlan.tips.length + 2;   // deck stored with its own context artwork
    const perSlideArt = meta?.per_slide_art === true && (ownPaths.length === priorPlan.tips.length + 1 || ctxArt);
    const priorVariant = typeof meta?.layout_variant === 'number' ? (meta.layout_variant as number) : 0;

    // the one axis that changes
    let plan: CarouselPlan = priorPlan;
    let newStyle: CarouselStyle = storedStyle;
    let layoutVariant = priorVariant;
    let styleEdition = typeof raw.style_edition === 'number' ? (raw.style_edition as number) : 0;
    if (axis === 'hook') {
      const topic = typeof raw.topic === 'string' ? (raw.topic as string) : '';
      const reframed = await remixHook(priorPlan, storedLang, topic);
      if (!reframed) return c.json({ ok: false, error: 'remix_failed', message: "Couldn't find a better angle right now — please try again." }, 502);
      plan = { ...priorPlan, ...reframed };
    } else if (axis === 'style') {
      // "New look" has to LOOK new. On an AI-imagery deck the artwork is deliberately reused
      // (a remix is free), and several of those styles differ mainly in their artwork — so
      // swapping the style key alone could return a deck the agent could not tell apart. The
      // compositions now advance with it. On a type-only deck the EDITION moves too, which
      // changes the display face and the colour world — the biggest visible change available.
      const ring = isTipsImageStyle(storedStyle) ? mediumRing(storedStyle) : REMIX_TYPE_RING;
      const at = ring.indexOf(storedStyle);
      newStyle = ring[(at + 1) % ring.length] as CarouselStyle;
      if (isTipsImageStyle(newStyle) && perSlideArt) layoutVariant = (priorVariant + 1) % 6;
      else styleEdition = (styleEdition + 1) % ((TYPE_EDITIONS[newStyle] ?? [{}]).length || 1);
    } else {
      if (!(isTipsImageStyle(storedStyle) && perSlideArt)) {
        return c.json({ ok: false, error: 'no_layouts', message: "This look doesn't have alternative compositions — try a new hook or another look." }, 400);
      }
      // six: three mixed rotations, then three where every tip shares one composition
      layoutVariant = (priorVariant + 1) % 6;
    }

    const bRes = await tx.execute(sql`
      SELECT brand_name, primary_color, accent_color, background_color, text_color,
             phone, whatsapp_number, website_url, sender_email, email_signature_name
      FROM agency_branding WHERE agency_id = ${agencyId} LIMIT 1
    `);
    const bRows = bRes as unknown as any[];
    const { agency, brand } = mapBranding(bRows[0] || {});
    const chosenR = parseSlots(raw);
    applySlots(brand, chosenR);
    const contact = contactLine(agency);

    // A style remix repaints the deck in the NEW style's edition palette, so the parent's
    // "colours actually rendered" no longer describe this child — recompute them, or the
    // finished-deck pickers would open on the old style's colours and overwrite the new look.
    // Computed BEFORE the render, not after: a per-slide override supplies one channel and the
    // other has to come from what this child actually wears, or the override pass repaints the
    // slide out of the new style's edition entirely.
    const remixLock = Object.keys(chosenR).length > 0;
    const remixEd = !remixLock ? ((TYPE_EDITIONS[newStyle] ?? [])[styleEdition] ?? {}) : {};
    const remixNavy = chosenR.main ?? remixEd.navy ?? brand.navy;
    const remixGold = chosenR.accent ?? remixEd.gold ?? brand.gold;
    const remixPaper = chosenR.paper ?? remixEd.cream ?? brand.cream;
    const remixInk = chosenR.ink ?? brand.text;
    brand.navy = remixNavy; brand.gold = remixGold; brand.cream = remixPaper; brand.text = remixInk;

    // render synchronously — the deck's own artwork is reused, so this is seconds, not minutes
    let slides: Buffer[];
    // the deck's per-slide colour overrides ride through every remix — without this a remix
    // repainted everything in the deck colours while the pickers still showed the per-slide ones
    const remixSlideCols = mergeSlideColours(
      (raw.slide_colours && typeof raw.slide_colours === 'object' ? raw.slide_colours : {}) as Record<string, unknown>,
      b.slide_colours,
    );
    if (isTipsImageStyle(newStyle)) {
      const own = ownPaths.length >= 3 ? await loadGenerationImages(ownPaths) : null;
      const images = own ?? await loadTipsImages(newStyle);
      if (!images) return c.json({ ok: false, error: 'remix_failed', message: GENERIC }, 500);
      // same guard as /carousel/update: library stand-in → drop ctxArt or the rotation collapses
      const ctxArtEff = ctxArt && !!own;
      slides = await renderWithSlideColours(brand, remixSlideCols, (br) => perSlideArt
        ? renderTipsImageStyledV2(newStyle, plan, agency.name, contact, br, images, storedLang, meta?.include_recap === true, meta?.include_context === true, layoutVariant, ctxArtEff)
        : renderTipsImageStyled(newStyle, plan, agency.name, contact, br, images, storedLang, meta?.include_context === true, meta?.include_recap === true));
    } else {
      slides = await renderWithSlideColours(brand, remixSlideCols, (br, locked) =>
        renderPlannedStyled(newStyle, plan, agency.name, contact, br, storedLang, styleEdition, locked, meta?.include_context === true, meta?.include_recap === true, remixLock),
        remixLock);
    }

    const label = `Remix · ${axis} · ${String(raw.topic ?? '').slice(0, 70) || 'tips carousel'}`;
    const ins = await tx.execute(sql`
      INSERT INTO image_generations
        (agency_id, generation_type, status, prompt, requested_by, raw_request)
      VALUES
        (${agencyId}, 'social_post', 'processing', ${label}, ${user?.sub ?? null}::uuid,
         ${JSON.stringify({ ...raw, engine: 'carousel', content_type: 'carousel', carousel_style: newStyle, style_edition: styleEdition, render_navy: remixNavy, render_gold: remixGold, render_paper: remixPaper, render_ink: remixInk, render_main: remixNavy, render_accent: remixGold, slide_colours: remixSlideCols, remix_of: parentId, remix_axis: axis })}::jsonb)
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
      include_recap: meta?.include_recap === true, include_context: meta?.include_context === true,
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
      // the child's OWN colours — without these the result-screen pickers keep showing the
      // parent style's palette and one "Apply colours" repaints the remix back to the old look
      render_navy: remixNavy, render_gold: remixGold, render_paper: remixPaper, render_ink: remixInk,
      slide_colours: remixSlideCols,
      brand_navy: chosenR.main, brand_gold: chosenR.accent, brand_paper: chosenR.paper, brand_ink: chosenR.ink,
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

/** Resolve cleaned-photo generation ids → image buffers, ONE per id and IN ORDER. Agency-scoped +
 *  completed-only (a client can never point this at someone else's image; ids are the only accepted
 *  handle — never raw URLs). If a cleaned image can't be downloaded, fall back to that intermediate's
 *  ORIGINAL source photo so the template slot is never dropped/shifted (order + count preserved). */
async function cleanedBuffers(tx: any, agencyId: string, ids: string[]): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const id of ids) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) continue;
    const res = await tx.execute(sql`
      SELECT result_image_storage_path, raw_request->>'source_ref' AS source_ref FROM image_generations
      WHERE id = ${id}::uuid AND agency_id = ${agencyId} AND status = 'completed'
      LIMIT 1
    `);
    const rows = res as unknown as Array<{ result_image_storage_path: string | null; source_ref: string | null }>;
    const path = rows[0]?.result_image_storage_path;
    if (path) {
      const dl = await supabaseAdmin.storage.from('generated-images').download(path);
      if (!dl.error && dl.data) { out.push(Buffer.from(await dl.data.arrayBuffer())); continue; }
    }
    // download miss → keep the slot with the original source photo (never shift the deck)
    const orig = rows[0]?.source_ref ? await loadPhotoBuffer(rows[0].source_ref) : null;
    if (orig) out.push(orig);
  }
  return out;
}

// ── POST /api/studio/editable-finish — SURGICAL local watermark removal (Christian 2026-07-19) ──
// Replaces the seedream "clean up" that REPAINTED the whole photo (moved furniture, reframed the
// house). Now each chosen photo is de-watermarked LOCALLY: only the montinmo logo's own pixels are
// altered, everything else is byte-identical (see lib/watermark-removal). It's instant + free + can't
// drift the house. Every chosen photo yields ONE completed intermediate (a cleaned image, or — if the
// photo isn't the calibrated montinmo size, or removal fails — the ORIGINAL passed through unchanged),
// IN ORDER, so the template slots never shift (fixes the old failed-clean-collapse reorder bug).
// Body: { property_id, photos?: string[] }. Returns one job per photo (completed immediately); the
// browser polls /status/:id (instant), then re-renders with cleaned_generation_ids.
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
  try {
    const loaded = await loadPropertyAndBrand(tx, agencyId, propertyId);
    if (!loaded) return c.json({ ok: false, error: 'not_found', message: 'That property could not be found.' }, 404);
    const chosen = Array.isArray(b.photos) ? (b.photos as unknown[]).filter((u): u is string => typeof u === 'string' && loaded.images.includes(u)) : [];
    const refs = chosen.length ? chosen : loaded.images;
    if (refs.length === 0) return c.json({ ok: false, error: 'no_photos', message: 'This property has no photos to clean up.' }, 422);

    const jobs: { photo: string; generation_id: string | null; cleaned: boolean; error: string | null }[] = [];
    for (const ref of refs) {
      const buf = await loadPhotoBuffer(ref);
      if (!buf) { jobs.push({ photo: ref, generation_id: null, cleaned: false, error: "That photo couldn't be opened." }); continue; }
      // surgical removal; null → keep the ORIGINAL (never a generative guess). Either way the slot is filled.
      // An undecodable photo (corrupt bytes, unsupported codec) must degrade THIS photo only, never 500 the batch.
      let outBuf: Buffer | null = null; let cleaned = false;
      try {
        const removed = await removeMontinmoWatermark(buf);
        if (removed) { outBuf = removed; cleaned = true; } else { outBuf = await sharp(buf).png().toBuffer(); }
      } catch {
        try { outBuf = await sharp(buf).png().toBuffer(); } catch { /* undecodable — fall through to null-id job */ }
      }
      if (!outBuf) { jobs.push({ photo: ref, generation_id: null, cleaned: false, error: "That photo couldn't be processed." }); continue; }
      // store as a completed intermediate (hidden from the library) so cleaned_generation_ids stays in order
      try {
        const ins = await tx.execute(sql`
          INSERT INTO image_generations (agency_id, generation_type, status, prompt, source_property_id, requested_by, raw_request)
          VALUES (${agencyId}, 'social_post', 'processing', 'Cleaned photo', ${propertyId}::uuid, ${user?.sub ?? null}::uuid,
                  ${JSON.stringify({ engine: 'watermark_removal', intermediate: true, content_type: 'listing', cleaned, source_ref: ref })}::jsonb)
          RETURNING id
        `);
        const id = (ins as unknown as Array<{ id: string }>)[0]?.id;
        if (!id) throw new Error('insert failed');
        const key = `studio/cleaned/${agencyId}/${id}.png`;
        const up = await supabaseAdmin.storage.from('generated-images').upload(key, outBuf, { contentType: 'image/png', upsert: true });
        if (up.error) throw new Error(up.error.message);
        const signed = await supabaseAdmin.storage.from('generated-images').createSignedUrl(key, 60 * 60 * 24 * 365);
        await tx.execute(sql`
          UPDATE image_generations
             SET status = 'completed', result_image_url = ${signed.data?.signedUrl ?? ''}, result_image_storage_path = ${key}, completed_at = now()
           WHERE id = ${id}::uuid AND agency_id = ${agencyId}
        `);
        jobs.push({ photo: ref, generation_id: id, cleaned, error: null });
      } catch (e) {
        console.error('[studio/editable-finish] store failed:', (e as Error).message);
        jobs.push({ photo: ref, generation_id: null, cleaned: false, error: "That photo couldn't be cleaned up." });
      }
    }
    if (!jobs.some((j) => j.generation_id)) {
      return c.json({ ok: false, error: 'finish_failed', message: "The photo clean-up couldn't be done. Please try again.", jobs }, 502);
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
