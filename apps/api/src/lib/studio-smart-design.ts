import { randomUUID } from 'node:crypto';
import { env } from '../../../../packages/config/env';
import { supabaseAdmin } from './supabase-admin';
import './studio-data-root';
import { renderFreeform, normaliseSpec, DesignSpec } from '../../../../studio/engine/renderFreeform';
import { vaultFamilies } from '../../../../studio/engine/renderEditable';
import { DeriveProperty, DeriveAgency, BrandColours } from '../../../../studio/engine/derive';

// SMART v2 (Christian 2026-07-14): "AI art-director, deterministic hands."
// Claude LOOKS at the chosen photos and DESIGNS a layout (a DesignSpec blueprint); the freeform engine draws
// it. The AI never renders pixels and never types a fact — fact texts are substituted server-side from the
// database, so the price can never be wrong and the agency can never be misspelled. Born from the seedream
// design-mode test: 3 photos blended into a fake scene, TWO different prices, "Maditerrâneo", "Agarty".

// The 9 size options the UI offers (same keys the old KIE enum used, now honest pixel sizes).
export const SMART_CANVAS: Record<string, { width: number; height: number }> = {
  square:          { width: 1080, height: 1080 },
  square_hd:       { width: 1080, height: 1080 },
  portrait_4_3:    { width: 1080, height: 1350 },  // 4:5 — the real Instagram portrait
  portrait_3_2:    { width: 1080, height: 1620 },
  portrait_16_9:   { width: 1080, height: 1920 },  // Story / Reel
  landscape_4_3:   { width: 1440, height: 1080 },
  landscape_3_2:   { width: 1620, height: 1080 },
  landscape_16_9:  { width: 1920, height: 1080 },
  landscape_21_9:  { width: 2520, height: 1080 },
};

function fmtPrice(n: number | null | undefined): string | null {
  if (n == null || !isFinite(n) || n <= 0) return null;
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
}

/** The canonical fact strings — the ONLY numbers/names allowed on the design. Absent facts stay absent. */
export function buildFacts(property: DeriveProperty & { title?: string | null }, agency: DeriveAgency): Record<string, string> {
  const f: Record<string, string> = {};
  if (property.title) f.title = String(property.title);
  const price = fmtPrice(property.price);
  if (price) f.price = price;
  if (property.beds != null) f.beds = `${property.beds} bed`;
  if (property.baths != null) f.baths = `${property.baths} bath`;
  if (property.size != null) f.area = `${property.size} m²`;
  const specs = [f.beds, f.baths, f.area].filter(Boolean).join(' · ');
  if (specs) f.specs = specs;
  const loc = [property.city, property.region].filter(Boolean).join(', ');
  if (loc) f.location = loc;
  if (agency.name) f.agency = agency.name;
  if (agency.web) f.website = agency.web;
  if (agency.phone) f.phone = agency.phone;
  (property.features ?? []).slice(0, 6).forEach((feat, i) => { f[`feature_${i + 1}`] = feat; });
  return f;
}

// JSON Schema for the forced tool call (mirrors the zod DesignSpec; kept permissive — zod is the real gate).
const DESIGN_TOOL = {
  name: 'submit_design',
  description: 'Submit the final design blueprint for the social media post.',
  input_schema: {
    type: 'object',
    required: ['background', 'elements'],
    properties: {
      background: { type: 'string', description: 'page background as #rrggbb' },
      elements: {
        type: 'array', maxItems: 40,
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['photo', 'rect', 'scrim', 'text'] },
            bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
            photo: { type: 'integer' },
            zoom: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
            fill: { type: 'string' }, radius: { type: 'number' }, opacity: { type: 'number' },
            colour: { type: 'string' }, direction: { type: 'string', enum: ['up', 'down'] },
            content: { type: 'string' }, fact: { type: 'string' }, font: { type: 'string' },
            size: { type: 'number' }, align: { type: 'string', enum: ['left', 'center', 'right'] },
            weight: { type: 'string' }, italic: { type: 'boolean' }, tracking: { type: 'number' },
            uppercase: { type: 'boolean' }, line_height: { type: 'number' },
            valign: { type: 'string', enum: ['top', 'center', 'bottom'] },
            pill: {
              type: 'object',
              description: 'measured button/badge drawn around this text, perfectly centered by the renderer',
              properties: {
                fill: { type: 'string' }, radius: { type: 'number' },
                pad_x: { type: 'number' }, pad_y: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
} as const;

function designBrief(opts: {
  canvas: { width: number; height: number };
  facts: Record<string, string>;
  brand: BrandColours;
  photoCount: number;
  brief: string | null;
  priorSpec?: unknown;
  editNote?: string;
}): string {
  const fonts = vaultFamilies().map((f) => f.family + (f.weights.some((w) => w >= 600) ? ' (has bold)' : '')).join(', ');
  const factList = Object.entries(opts.facts).map(([k, v]) => `  ${k}: "${v}"`).join('\n');
  const base = `You are the art director of a premium Spanish real-estate brand, designing ONE social media post.

CANVAS: ${opts.canvas.width}x${opts.canvas.height}px. All bbox coordinates are [x0,y0,x1,y1] in these pixels.

THE ${opts.photoCount} PHOTOS shown above are the listing's real photos, in order (photo index 0..${opts.photoCount - 1}). Use ALL of them — each in its own frame. Photos render BELOW every rect/scrim/text. A photo element's optional zoom (1-4) and x/y (FRACTIONS 0-1 of the source, 0.5/0.5 = centre) fine-tune the crop — omit all three for automatic framing.

FACTS (the only real-world text allowed — reference by key, never retype):
${factList}

RULES — these are hard:
- A text element that shows a fact MUST use {"fact": "<key>"} — its content is substituted server-side. NEVER put prices, numbers, phone numbers, area, or the agency name in literal content.
- Literal "content" text is ONLY for short generic marketing copy (e.g. "Your Mediterranean escape awaits") — it must contain NO digits and NO factual claims beyond the facts list.
- Fonts: choose ONLY from: ${fonts}. Use at most 2 families (one display + one supporting).
- LEGIBILITY: text sitting on a photo must be LIGHT (near-white) over a scrim/dark rect placed before it. DARK text belongs ONLY on solid light panels/background — never directly on a photo. Elements render in array order (painter's algorithm): a rect before a photo sits under it, after it sits on top.
- BUTTONS/BADGES/PRICE TAGS: use ONE text element with a "pill" ({fill, pad_x, pad_y, radius?}) — NEVER a separate rect with text placed on top of it. The renderer sizes the pill to the measured text and centers it perfectly, so it can never be misaligned or cut off. Single-line labels inside panels should use valign "center".
- Keep ~48px min margins for text unless the design is deliberately full-bleed. Min text size 22px (small labels), headline 60-140px.
- Colours: design around the brand (navy ${opts.brand.navy}, accent ${opts.brand.gold}, light ${opts.brand.cream}, text ${opts.brand.text}) OR a tasteful neutral palette with one accent. 6-digit hex only.
- Layout craft: strong hierarchy (one dominant element), aligned edges, generous whitespace, deliberate asymmetry beats centering everything. Vary your approach — hero full-bleed with panel, split, framed gallery, magazine cover, big-type poster are all valid.
- 8-20 elements total is the sweet spot.`;

  const direction = opts.brief ? `\n\nTHE AGENT'S DIRECTION (follow it): ${opts.brief}` : '';
  const revision = opts.priorSpec
    ? `\n\nThis is a REVISION. Here is your previous design:\n${JSON.stringify(opts.priorSpec)}\n\nApply ONLY this change, keeping everything else as close as possible to the previous design: ${opts.editNote}`
    : '';
  return base + direction + revision + '\n\nSubmit the design with the submit_design tool.';
}

/** Call Claude (vision) to design the post; returns a validated DesignSpec. One retry on invalid output. */
export async function designWithClaude(opts: {
  photoUrls: string[];
  canvas: { width: number; height: number };
  facts: Record<string, string>;
  brand: BrandColours;
  brief: string | null;
  priorSpec?: unknown;
  editNote?: string;
}): Promise<DesignSpec> {
  const content: unknown[] = opts.photoUrls.slice(0, 6).map((u) => ({ type: 'image', source: { type: 'url', url: u } }));
  content.push({ type: 'text', text: designBrief({ ...opts, photoCount: Math.min(6, opts.photoUrls.length) }) });

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = {
      model: 'claude-sonnet-5',
      max_tokens: 6000,
      tools: [DESIGN_TOOL],
      tool_choice: { type: 'tool', name: 'submit_design' },
      messages: [{ role: 'user', content: attempt === 0 ? content : [...content, { type: 'text', text: `Your previous design was invalid: ${lastErr}. Fix it and resubmit.` }] }],
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      lastErr = `api_${res.status}`;
      if (res.status >= 500 || res.status === 429) continue;
      throw new Error(`design call failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const tool = data.content?.find((c) => c.type === 'tool_use');
    // normalise before validating — don't fail a good design over syntax (colour vs fill, pixel x/y, nulls…)
    const parsed = DesignSpec.safeParse(normaliseSpec(tool?.input));
    if (parsed.success) return parsed.data;
    lastErr = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  }
  throw new Error(`design spec invalid after retry: ${lastErr}`);
}

/**
 * The critique pass — the designer finally SEES its own render. One-shot coordinate design is blind (that's
 * why one-shot image generators look better); showing the model the rendered PNG lets it catch what blind
 * design can't: illegible contrast, collisions, dead space, bad crops. Returns a corrected spec, or null to
 * keep the original (critique is best-effort — a broken critique never breaks the generation).
 */
export async function critiqueDesign(opts: {
  renderedPng: Buffer;
  spec: DesignSpec;
  canvas: { width: number; height: number };
  facts: Record<string, string>;
  brief: string | null;
}): Promise<DesignSpec | null> {
  try {
    const sharp = (await import('sharp')).default;
    const jpeg = await sharp(opts.renderedPng).resize({ width: 840 }).jpeg({ quality: 82 }).toBuffer();
    const prompt =
      `Above is the RENDER of the design you specified (canvas ${opts.canvas.width}x${opts.canvas.height}). ` +
      `Review it like a demanding art director and fix every visual problem you can see: illegible text ` +
      `(dark text on photos, weak contrast), overlapping or colliding elements, text touching or clipped by ` +
      `the edge of its button/panel or not centered in it (convert any rect+text button into ONE text element ` +
      `with a pill), awkward empty space, cramped or uneven margins, badly cropped photos, anything unfinished. Keep the same overall concept, ` +
      `all the same facts (by key) and all the photos. If it already looks excellent, resubmit it unchanged. ` +
      `Resubmit the COMPLETE corrected design with the submit_design tool.\n\nYour current design:\n` +
      JSON.stringify(opts.spec);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 6000,
        tools: [DESIGN_TOOL],
        tool_choice: { type: 'tool', name: 'submit_design' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const tool = data.content?.find((c) => c.type === 'tool_use');
    const parsed = DesignSpec.safeParse(normaliseSpec(tool?.input));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Enforce the fact guarantees on a spec: substitute canonical strings, drop digit-carrying free copy. */
export function enforceFacts(spec: DesignSpec, facts: Record<string, string>): DesignSpec {
  const fonts = new Set(vaultFamilies().map((f) => f.family));
  const elements = spec.elements
    .map((el) => {
      if (el.type !== 'text') return el;
      const font = fonts.has(el.font) ? el.font : 'Poppins';
      if (el.fact) {
        const canonical = facts[el.fact];
        if (!canonical) return null;                    // a fact we don't have → the element disappears (data honesty)
        return { ...el, font, content: canonical };     // the AI cannot type a fact — we do
      }
      if (/\d/.test(el.content)) return null;           // free copy may not carry digits (no invented numbers)
      return { ...el, font };
    })
    .filter((el): el is NonNullable<typeof el> => el !== null);
  return { ...spec, elements };
}

const OUT_BUCKET = 'generated-images';

/** Store a rendered design; returns the signed URL + path. */
export async function storeFreeformPng(png: Buffer, agencyId: string): Promise<{ image_url: string; storage_path: string }> {
  const key = `smart/${agencyId}/${randomUUID()}.png`;
  const up = await supabaseAdmin.storage.from(OUT_BUCKET).upload(key, png, { contentType: 'image/png', upsert: false });
  if (up.error) throw new Error(`smart upload: ${up.error.message}`);
  const signed = await supabaseAdmin.storage.from(OUT_BUCKET).createSignedUrl(key, 60 * 60 * 24 * 365);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`smart sign: ${signed.error?.message}`);
  return { image_url: signed.data.signedUrl, storage_path: key };
}

/**
 * The full design pipeline: design (vision) → render → CRITIQUE (the model sees its own render and corrects
 * it) → final render → store. Returns the stored image + the final spec (the revision seed).
 */
export async function designRenderStore(opts: {
  photoUrls: string[];
  canvas: { width: number; height: number };
  facts: Record<string, string>;
  brand: BrandColours;
  brief: string | null;
  photoBuffers: Buffer[];
  agencyId: string;
  priorSpec?: unknown;
  editNote?: string;
}): Promise<{ image_url: string; storage_path: string; spec: DesignSpec }> {
  const raw = await designWithClaude(opts);
  let spec = enforceFacts(raw, opts.facts);
  let png = await renderFreeform(spec, opts.canvas, opts.photoBuffers);

  const critiqued = await critiqueDesign({ renderedPng: png, spec, canvas: opts.canvas, facts: opts.facts, brief: opts.brief });
  if (critiqued) {
    const spec2 = enforceFacts(critiqued, opts.facts);
    try {
      png = await renderFreeform(spec2, opts.canvas, opts.photoBuffers);
      spec = spec2;
    } catch { /* a broken critique never breaks the generation — keep the first render */ }
  }

  const stored = await storeFreeformPng(png, opts.agencyId);
  return { ...stored, spec };
}
