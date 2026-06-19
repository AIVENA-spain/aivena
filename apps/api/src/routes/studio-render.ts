import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { supabaseAdmin } from '../lib/supabase-admin';

/**
 * Studio template render (Phase 1) — Railway port of the `studio-template-render`
 * Supabase Edge Function (v0.1). The edge function hits the platform's hard
 * 256 MB / 2 s limit on the heavier templates (HTTP 546 WORKER_RESOURCE_LIMIT);
 * roughly half of them exceed it. Railway has real memory and no CPU cap, so the
 * render moves here and every template renders as-is — no per-template surgery.
 *
 * The fill logic is ported VERBATIM from the edge function — only the runtime
 * primitives change:
 *   - resvg-wasm + initWasm  →  @resvg/resvg-js `new Resvg(...)` (same resvg core,
 *     2.6.2, byte-identical output).
 *   - chunked btoa           →  Buffer.from(...).toString('base64').
 *   - Deno.env / fresh client →  the shared service-role `supabaseAdmin` client.
 *   - crypto.randomUUID()     →  node:crypto randomUUID().
 *   - Deno.serve(req)         →  a Hono handler (registered with `.all` so a
 *     non-POST still returns the 405 the contract requires).
 *
 * Hardening added beyond the edge fn (post-review):
 *   - the whole handler body runs inside a try/catch so EVERY response is the
 *     { ok, error, message } envelope — an unexpected throw (e.g. a transport
 *     error on the template read or the property lookup) can never fall through
 *     to Hono's plain-text "Internal Server Error".
 *   - createSignedUrl failures are surfaced (no more ok:true + signed_url:null).
 *   - photo URLs are screened against internal/loopback/private/link-local
 *     targets before fetch (SSRF defence-in-depth; the input is documented as
 *     "public/https" URLs). NOTE for Vega: this does NOT re-validate redirect
 *     hops or guard DNS-rebinding — for a complete fix, allowlist the expected
 *     photo origins (Supabase storage host / agency CDNs) or fetch with a
 *     redirect-validating client.
 *
 * Auth: the request must carry `x-internal-secret` equal to the platform secret
 * IMAGE_GEN_INTERNAL_SECRET (read once via the `_get_platform_secret` Vault RPC,
 * cached for the process — the same single source the edge functions and the
 * studio-wizard proxy use; never hardcoded, never an env var, never logged).
 * Compared in constant time. This route is mounted OUTSIDE `/api/*` precisely so
 * the user-JWT + agency-context middleware never runs on it — internal callers
 * (the n8n test caller now; the kie step later) authenticate by secret, not a
 * Supabase session.
 *
 * Law-2: no schema/table names, stack traces, or internal error text ever reach
 * the response — only the friendly `{ ok:false, error, message }` envelope.
 * Internal detail is logged server-side via console.error only.
 *
 * Forward-compatible (Phase 3): the body accepts extra optional fields. Adding
 * palette/copy/language substitution later is a self-contained change to the
 * substitution loop and does not break this contract.
 *
 * Mounted at /studio:  POST /studio/render
 */

const route = new Hono();

const TEMPLATE_BUCKET = 'studio-templates';
const PHOTO_BUCKET = 'property-images';
const OUT_BUCKET = 'generated-images';
const SIGNED_TTL = 60 * 60 * 24 * 365; // 1 year
const RENDER_WIDTH = 1080;
// 1x1 transparent PNG — only used to blank a stray photo token that somehow
// survived the fill (should never happen).
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ── internal secret: read once via Vault RPC, cache for the process lifetime ──
// Mirrors apps/api/src/routes/studio-wizard.ts. A transient null (RPC failed)
// clears the cache so the next request retries instead of caching the failure.
let secretCache: Promise<string | null> | null = null;
async function fetchSecret(): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('_get_platform_secret', {
      p_name: 'IMAGE_GEN_INTERNAL_SECRET',
    });
    if (error || !data) {
      console.error('[studio-render] _get_platform_secret failed:', error?.message);
      return null;
    }
    return String(data);
  } catch (err) {
    console.error('[studio-render] _get_platform_secret threw:', err);
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

/** Length-checked constant-time string compare (ported from the edge fn). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * Reject photo URLs that point at internal/loopback/private/link-local targets
 * before we fetch them server-side (SSRF defence-in-depth — the input is
 * documented as public/https URLs). Public hostnames (e.g. the Supabase storage
 * host) pass untouched. This screens the literal-target vectors only; it does
 * not follow/validate redirect hops or resolve DNS, so a complete fix is an
 * origin allowlist owned by the pipeline security model (Vega).
 */
function isHttpUrlSafe(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  // special / internal hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return false;
  }
  // IPv6 literals are bracketed in URL.hostname, e.g. "[::1]" — never a domain.
  if (host.startsWith('[')) {
    const ip = host.slice(1, -1);
    if (
      ip === '::1' ||
      ip === '::' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe80') ||
      ip.startsWith('fec')
    ) {
      return false;
    }
    return true;
  }
  // IPv4 literal ranges (loopback / private / link-local+metadata / CGNAT / this-host)
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/** Download a photo (storage path → property-images, or any https URL) → data URI. */
async function loadPhoto(
  storagePath: string | undefined,
  urlVal: string | undefined,
): Promise<string | null> {
  try {
    if (storagePath) {
      const { data, error } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .download(storagePath);
      if (error || !data) return null;
      return toDataUri(new Uint8Array(await data.arrayBuffer()), data.type || 'image/jpeg');
    }
    if (urlVal && isHttpUrlSafe(urlVal)) {
      const r = await fetch(urlVal);
      if (!r.ok) return null;
      return toDataUri(
        new Uint8Array(await r.arrayBuffer()),
        r.headers.get('content-type') || 'image/jpeg',
      );
    }
  } catch {
    return null;
  }
  return null;
}

const isStr = (v: unknown): v is string => typeof v === 'string';

// ── POST /studio/render ──────────────────────────────────────────────────────
// Registered with `.all` so a non-POST hits this handler and gets the 405 the
// contract requires (rather than Hono's default 404). CORS preflight (OPTIONS)
// is short-circuited by the global cors() middleware before it reaches here.
route.all('/render', async (c) => {
  if (c.req.method !== 'POST') {
    return c.json({ ok: false, error: 'method_not_allowed', message: 'Use POST.' }, 405);
  }

  // Auth — x-internal-secret vs the Vault secret, constant-time.
  const presented = c.req.header('x-internal-secret') ?? '';
  const expected = await internalSecret();
  if (!expected || !constantTimeEqual(presented, expected)) {
    return c.json({ ok: false, error: 'unauthorized', message: 'Authentication failed.' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const raw = await c.req.json();
    body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return c.json({ ok: false, error: 'invalid_json', message: 'Request body must be valid JSON.' }, 400);
  }

  // Everything after the body parse runs inside this try so that EVERY response
  // is the { ok, error, message } envelope — an unexpected throw (a transport
  // error on the template read, the property lookup, the render, …) maps to a
  // friendly render_failed/500 rather than Hono's plain-text default.
  try {
    const template = isStr(body.template) ? body.template.trim() : '';
    if (!template || /[^a-zA-Z0-9_-]/.test(template)) {
      return c.json({ ok: false, error: 'invalid_template', message: 'A valid template is required.' }, 400);
    }

    // Fetch the tokenized template SVG (studio-templates is private → service-role).
    const tplName = `${template}.tokenized.svg`;
    const { data: tplBlob, error: tplErr } = await supabaseAdmin.storage
      .from(TEMPLATE_BUCKET)
      .download(tplName);
    if (tplErr || !tplBlob) {
      return c.json({ ok: false, error: 'template_not_found', message: "That template couldn't be found." }, 404);
    }
    let svg = await tplBlob.text();

    // Discover the photo-slot tokens present in this template, ordered 0..N.
    const tokenSet = new Set<string>();
    for (const m of svg.matchAll(/@@PHOTO(\d+)@@/g)) tokenSet.add(m[0]);
    const tokens = Array.from(tokenSet).sort(
      (a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10),
    );

    // Inspect mode: report tokens + <image> count without rendering (no photos).
    if (body.inspect === true) {
      const imageTags = (svg.match(/<image\b[^>]*>/g) || []).length;
      const allTokens = Array.from(new Set(svg.match(/@@[A-Za-z0-9_]+@@/g) || [])).sort();
      return c.json({
        ok: true,
        inspect: true,
        template: tplName,
        bytes: svg.length,
        photo_tokens: tokens,
        all_tokens: allTokens,
        image_tags: imageTags,
      });
    }

    if (tokens.length === 0) {
      return c.json({ ok: false, error: 'no_photo_slots', message: 'This template has no photo slots to fill.' }, 422);
    }

    // Resolve photos in slot order: explicit URLs / storage paths, else a
    // property's image list (in order).
    let orderedUrls: string[] = Array.isArray(body.photo_urls)
      ? (body.photo_urls as unknown[]).filter((x): x is string => isStr(x) && x.startsWith('http'))
      : [];
    const orderedPaths: string[] = Array.isArray(body.photo_storage_paths)
      ? (body.photo_storage_paths as unknown[]).filter((x): x is string => isStr(x) && x.length > 0)
      : [];

    const propertyId = isStr(body.property_id) && body.property_id ? body.property_id : null;
    const agencyId = isStr(body.agency_id) && body.agency_id ? body.agency_id : null;
    if (orderedUrls.length === 0 && orderedPaths.length === 0 && propertyId) {
      let q = supabaseAdmin.from('properties').select('images, agency_id').eq('id', propertyId);
      if (agencyId) q = q.eq('agency_id', agencyId);
      const { data: prop } = await q.maybeSingle();
      if (prop) {
        const rawImages = (prop as { images: unknown }).images;
        let imgs: unknown[] = [];
        try {
          imgs = Array.isArray(rawImages)
            ? rawImages
            : JSON.parse(typeof rawImages === 'string' ? rawImages : '[]');
        } catch {
          imgs = [];
        }
        orderedUrls = imgs.filter((u): u is string => isStr(u) && u.startsWith('http'));
      }
    }

    const sourceCount = Math.max(orderedUrls.length, orderedPaths.length);
    if (sourceCount === 0) {
      return c.json({ ok: false, error: 'no_photos', message: 'Please provide at least one photo.' }, 422);
    }

    // One data URI per token. Reuse the last supplied photo when fewer photos
    // than slots are provided (never leave a slot unfilled).
    const dataUris: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const idx = i < sourceCount ? i : sourceCount - 1;
      const uri = await loadPhoto(orderedPaths[idx], orderedUrls[idx]);
      if (!uri) {
        return c.json({ ok: false, error: 'photo_unavailable', message: "One of the photos couldn't be loaded." }, 422);
      }
      dataUris.push(uri);
    }

    // Force crop-to-fill on every photo-slot <image> tag (matches Canva). Done on
    // the SHORT tokens, before substitution, so the [^>]* match never has to scan
    // a multi-MB data URI. Baked graphics/logos (no token) are left untouched.
    svg = svg.replace(/<image\b[^>]*>/g, (tag) => {
      if (!/@@PHOTO\d+@@/.test(tag)) return tag;
      let t = tag.replace(/\s+preserveAspectRatio\s*=\s*"[^"]*"/g, '');
      t = t.replace(/^<image\b/, '<image preserveAspectRatio="xMidYMid slice"');
      return t;
    });

    // Substitute each token with its data URI (all occurrences — stacked layers
    // share a token), then blank any stray token as a safety net.
    tokens.forEach((tok, i) => {
      svg = svg.split(tok).join(dataUris[i]);
    });
    svg = svg.replace(/@@PHOTO\d+@@/g, PIXEL);

    const outPath =
      isStr(body.out_path) && body.out_path && !body.out_path.includes('..')
        ? body.out_path
        : `${agencyId ?? 'studio'}/studio_${template}_${randomUUID().replace(/-/g, '')}.png`;

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: RENDER_WIDTH },
      font: { loadSystemFonts: false },
    });
    const rendered = resvg.render();
    const png = rendered.asPng();

    const { error: upErr } = await supabaseAdmin.storage
      .from(OUT_BUCKET)
      .upload(outPath, png, { contentType: 'image/png', upsert: true });
    if (upErr) {
      console.error('[studio-render] upload failed:', upErr.message);
      return c.json({ ok: false, error: 'storage_upload_failed', message: "The image couldn't be saved. Please try again." }, 500);
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(OUT_BUCKET)
      .createSignedUrl(outPath, SIGNED_TTL);
    if (signErr || !signed?.signedUrl) {
      console.error('[studio-render] sign failed:', signErr?.message);
      return c.json({ ok: false, error: 'storage_upload_failed', message: "The image couldn't be saved. Please try again." }, 500);
    }

    return c.json({
      ok: true,
      template,
      storage_path: outPath,
      signed_url: signed.signedUrl,
      bytes: png.length,
      width: rendered.width,
      height: rendered.height,
      slots_filled: tokens.length,
      photos_used: sourceCount,
    });
  } catch (e) {
    console.error('[studio-render] template_render_failed:', (e as Error)?.message);
    return c.json({ ok: false, error: 'render_failed', message: "The post couldn't be rendered. Please try again." }, 500);
  }
});

export default route;
