import { Hono } from 'hono';
import { internalSecret, constantTimeEqual, loadPhotoBuffer, isStr } from '../lib/studio-internal';
import { isKnownTemplate, renderAndStore } from '../lib/studio-editable';
import { DeriveProperty, DeriveAgency, BrandColours } from '../../../../studio/engine/derive';

/**
 * Studio EDITABLE-template render (Engine Proof B) — the deterministic template engine (the 18 accepted
 * strip-plate templates) wired into production. Takes a template id + real property facts + agency data +
 * brand colours + chosen photos and returns the finished 1080-wide PNG, byte-faithful to the accepted local
 * proofs. Distinct from `studio-compose` (the existing kie fixed-layout renderer) and `studio-render`
 * (photo-fill only). The SAME engine + deriveSlots the harness proved — no per-property hacks, missing facts
 * hide their slot + companion art. palette_locked templates (#10) keep their own colours.
 *
 * Auth: x-internal-secret == IMAGE_GEN_INTERNAL_SECRET (Vault). Mounted OUTSIDE /api/* so the user-JWT /
 * agency-context middleware never runs — internal callers authenticate by secret. The wizard API (Phase 2)
 * assembles the body from the DB (property row → facts, agency_branding → brand + contact) and calls this.
 *
 * Law-2: only the friendly { ok, error, message } envelope ever reaches the response.
 *
 * Mounted at /studio:  POST /studio/editable-render
 */

const route = new Hono();
const TEMPLATE_ID = /^[A-Za-z0-9_]+$/;
// contrast-safe fallback brand (only used if the caller omits `brand` on a non-locked template).
const DEFAULT_BRAND: BrandColours = { navy: '#1a2b4a', gold: '#c8a24b', cream: '#f4f1ea', text: '#333333' };

route.all('/editable-render', async (c) => {
  if (c.req.method !== 'POST') {
    return c.json({ ok: false, error: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
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

  try {
    const templateId = isStr(body.template_id) ? body.template_id.trim() : '';
    if (!templateId || !TEMPLATE_ID.test(templateId)) {
      return c.json({ ok: false, error: 'invalid_template', message: 'A valid template_id is required.' }, 400);
    }
    if (!isKnownTemplate(templateId)) {
      return c.json({ ok: false, error: 'template_not_found', message: "That template couldn't be found." }, 404);
    }

    const property = (body.property ?? {}) as DeriveProperty;
    const agency = (body.agency ?? {}) as DeriveAgency;
    if (!agency || !isStr((agency as any).name)) {
      return c.json({ ok: false, error: 'invalid_agency', message: 'Agency name is required.' }, 400);
    }
    const brand = (body.brand ?? DEFAULT_BRAND) as BrandColours;
    const photoRefs = Array.isArray(body.photos) ? (body.photos as unknown[]).filter(isStr) : [];
    if (photoRefs.length === 0) {
      return c.json({ ok: false, error: 'no_photos', message: 'At least one photo is required.' }, 400);
    }

    // Download the chosen photos (in order) to buffers.
    const buffers: Buffer[] = [];
    for (const ref of photoRefs) {
      const buf = await loadPhotoBuffer(ref);
      if (buf) buffers.push(buf);
    }
    if (buffers.length === 0) {
      return c.json({ ok: false, error: 'photo_fetch_failed', message: "The selected photos couldn't be loaded." }, 422);
    }

    // Render via the shared engine (deriveSlots draws all facts; overrides supported for the wizard proxy).
    const stored = await renderAndStore({
      templateId, property, agency, brand, photoBuffers: buffers,
      textOverrides: (body.text_overrides ?? undefined) as Record<string, string> | undefined,
      colourOverrides: (body.colour_overrides ?? undefined) as Record<string, string> | undefined,
    });

    return c.json({ ok: true, template_id: templateId, image_url: stored.image_url, storage_path: stored.storage_path, width: 1080 });
  } catch (err) {
    console.error('[studio-editable-render] render threw:', err);
    return c.json({ ok: false, error: 'render_failed', message: "The image couldn't be generated." }, 500);
  }
});

export default route;
