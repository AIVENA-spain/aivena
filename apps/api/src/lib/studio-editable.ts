import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase-admin';
import { STUDIO_ROOT } from './studio-data-root';
import {
  renderEditable,
  loadEditableManifest,
  pickPhotos,
} from '../../../../studio/engine/renderEditable';
import {
  deriveSlots,
  agencyPalette,
  applyDerived,
  DeriveProperty,
  DeriveAgency,
  BrandColours,
} from '../../../../studio/engine/derive';

// Shared logic for the editable-template engine (the 18 accepted strip-plate templates) — used by the internal
// render route AND the user-facing wizard proxy. Catalogue metadata (so the UI builds the picker + editing form
// dynamically), the render-with-overrides function, and the DB-row → engine-input mappers all live here (one
// source). #4 uses the bespoke composeOne engine and is NOT in this set yet (follow-up); this serves the 17
// renderEditable templates.

// #3 REMOVED 2026-07-15 (Christian): its "LUXURY" lettering + glass features panel are baked artwork that
// can't be edited — rather than ship a template that ignores taps, it's out. #29 was removed earlier.
// CC-authored families (Christian-approved 2026-07-15): 30/31/32 = 2-photo (Collector's Card / La Entrada /
// Riviera); 33/34/35 = 3-photo (Azulejos / Postal / Sol). #5, #14, #21, #22 RETIRED 2026-07-15 (Christian:
// "not the biggest fan"), joining #3 (uneditable baked art) and #29.
export const EDITABLE_TEMPLATE_IDS = ['1', '2', '6', '7', '8', '10', '11', '24', '25', '26', '27', '28', '30', '31', '32', '33', '34', '35'];

// Pre-made colour SCHEMES (Christian 2026-07-13) — curated coordinated palettes the agency taps to apply to the
// whole template, instead of fiddling per-layer. Each maps to the four brand slots agencyPalette consumes:
// navy = the strong dark (title-on-light + badges), gold = accent, cream = the light (title-on-dark), text = body.
// The agency's OWN brand is offered first (built at runtime from agency_branding); these are the alternatives.
export interface ColourScheme { id: string; name: string; brand: BrandColours; }
export const COLOUR_SCHEMES: ColourScheme[] = [
  { id: 'navy_gold', name: 'Navy & Gold', brand: { navy: '#0B2545', gold: '#C9A45C', cream: '#F8F5EF', text: '#1F2933' } },
  { id: 'charcoal_sand', name: 'Charcoal & Sand', brand: { navy: '#2B2B2B', gold: '#B08D57', cream: '#F2EEE6', text: '#2B2B2B' } },
  { id: 'coastal', name: 'Coastal', brand: { navy: '#14213D', gold: '#E9C46A', cream: '#F1FAEE', text: '#1D3557' } },
  { id: 'terracotta', name: 'Terracotta', brand: { navy: '#3D405B', gold: '#E07A5F', cream: '#F4F1DE', text: '#3D405B' } },
  { id: 'forest_blush', name: 'Forest & Blush', brand: { navy: '#2F4739', gold: '#C98B7A', cream: '#F6F1EC', text: '#2F4739' } },
  { id: 'monochrome', name: 'Monochrome', brand: { navy: '#1A1A1A', gold: '#7A7A7A', cream: '#F5F5F5', text: '#1A1A1A' } },
];
const HEX = /^#[0-9a-fA-F]{6}$/;
export function isBrandColours(v: any): v is BrandColours {
  return v && typeof v === 'object' && ['navy', 'gold', 'cream', 'text'].every((k) => HEX.test(v[k]));
}

// ── Templates GALLERY palette (Christian 2026-07-13) ──────────────────────────
// The Templates section shows every template rendered against the agency's most-expensive listings, in a
// sophisticated NEUTRAL palette with ONE accent that SHIFTS per tile — so the grid always looks designed
// regardless of an agency's own brand colours. GALLERY_NEUTRAL fills the structural roles (dark title / light
// bg / body grey); galleryAccent(i) is the shifting pop, fed as brand.gold AND pinned to the accent-carrying
// roles via colourOverrides so it reads on both dark- and light-background templates.
export const GALLERY_NEUTRAL: BrandColours = { navy: '#1F2933', gold: '#8A8F98', cream: '#F4F2ED', text: '#4A4E57' };
// Curated, muted, evenly-varied accents (not a raw HSL wheel — hand-picked to stay tasteful at any tile).
const GALLERY_ACCENTS = ['#C2653A', '#5C7A5A', '#4F7391', '#B0873C', '#8A5A78', '#3F7A75', '#A24A46', '#5B6BA0'];
export function galleryAccent(i: number): string {
  const n = GALLERY_ACCENTS.length;
  return GALLERY_ACCENTS[((i % n) + n) % n];
}
/** The colour_overrides that pin the shifting accent to the roles that actually render on every template. */
export function galleryAccentOverrides(hex: string): Record<string, string> {
  // accent = the designated pop role; badge.fill = the pill (a visible pop on light templates whose `accent`
  // role isn't drawn); badge.text = white so the pill label stays legible on the accent fill.
  return { accent: hex, 'badge.fill': hex, 'badge.text': '#FFFFFF' };
}

function manifestPathOf(id: string): string {
  return `${STUDIO_ROOT}/manifest/templates/${id}.editable.json`;
}
export function isKnownTemplate(id: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(id) && EDITABLE_TEMPLATE_IDS.includes(id) && fs.existsSync(manifestPathOf(id));
}

// human label from a slot id or a colour role ("cta_phone" -> "Phone", "feat_1" -> "Feature 1",
// "subtitle/body" -> "Body", "stat.value" -> "Stat value").
const LABELS: Record<string, string> = {
  title: 'Title', title_line1: 'Title line 1', title_line2: 'Title line 2', title_script: 'Script word',
  subtitle: 'Subtitle', body: 'Body text', brand: 'Agency name', handle: 'Social handle', address: 'Address',
  price_label: 'Price label', price_value: 'Price', description: 'Description', label: 'Label',
  features_header: 'Features header', cta_label: 'Call-to-action', cta_phone: 'Phone', cta_web: 'Website',
  cta_email: 'Email', cta_mail: 'Email', cta_web_label: 'Website label', cta_web_url: 'Website',
  agent_name: 'Agent name', agent_title: 'Agent title', stat_area: 'Area', stat_size: 'Area',
  stat_beds: 'Bedrooms', stat_baths: 'Bathrooms', stat_left: 'Stat (left)', stat_center: 'Stat (centre)',
  stat_right: 'Stat (right)', stat_line: 'Stats line', stat_pool: 'Pool', stat_garage: 'Garage',
  stat_kitchen: 'Kitchen', luxury: 'Eyebrow', type_script: 'Type (script)', cta_banner: 'Banner',
  badge_status: 'Status badge',
};
const ROLE_LABELS: Record<string, string> = {
  title: 'Title', 'subtitle/body': 'Body text', accent: 'Accent', 'badge.text': 'Badge text',
  'badge.fill': 'Badge fill', 'stat.value': 'Stat value', 'stat.label': 'Stat label', cta: 'Call-to-action',
  background: 'Background', divider: 'Divider', icon: 'Icon', overlay: 'Overlay',
};
function labelSlot(id: string): string {
  if (LABELS[id]) return LABELS[id];
  const m = id.match(/^(feat|feature)_(\d+)$/);
  if (m) return `Feature ${m[2]}`;
  return id.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Every NON-TEXT area that carries a colour role, with its box. Christian 2026-07-14: "i would like to be able
// to tap on something and then change color like that" — a list of swatch names ("Overlay", "Divider") is
// undecodable, so the editor needs a tap-target on the thing itself. Text slots already carry bbox+role.
function colourRegions(m: any): { role: string; bbox: number[] }[] {
  const out: { role: string; bbox: number[] }[] = [];
  for (const p of m.plate_rects ?? []) if (p.fill_role) out.push({ role: p.fill_role, bbox: p.bbox });
  if (m.adaptive_panel?.fill_role) out.push({ role: m.adaptive_panel.fill_role, bbox: m.adaptive_panel.area });
  if (m.dynamic_panel?.fill_role) {
    const d = m.dynamic_panel;
    const h = d.pad_top + d.header_h + d.max_rows * d.row_pitch + d.pad_bottom;
    out.push({ role: d.fill_role, bbox: [d.x0, d.top_base, d.x1, d.top_base + h] });
  }
  for (const s of m.text_slots ?? []) for (const ca of s.companion_art ?? []) if (ca.fill_role) out.push({ role: ca.fill_role, bbox: ca.bbox });
  return out;
}
/** The colour roles this template actually renders — so the editor never shows a swatch that does nothing. */
function usedRoles(m: any): Set<string> {
  // 'background' is only a REAL control on paint_background templates (the engine paints the page from the
  // palette). On the replicated Canva templates the ground is baked into the source raster — a Background
  // swatch there is a dead control (Christian hit exactly that), so it must not be offered.
  const s = new Set<string>(m.paint_background ? ['background'] : []);
  for (const t of m.text_slots ?? []) {
    if (t.role) s.add(t.role);
    if (t.pill?.role) s.add(t.pill.role);
    for (const ca of t.companion_art ?? []) if (ca.fill_role) s.add(ca.fill_role);
  }
  for (const p of m.plate_rects ?? []) if (p.fill_role) s.add(p.fill_role);
  if (m.adaptive_panel?.fill_role) s.add(m.adaptive_panel.fill_role);
  if (m.dynamic_panel?.fill_role) s.add(m.dynamic_panel.fill_role);
  if (m.overlay?.role) s.add(m.overlay.role);
  if (m.scrim?.role) s.add(m.scrim.role);
  return s;
}

export interface TemplateMeta {
  id: string;
  photo_count: number;
  palette_locked: boolean;
  // canvas dimensions (px) — the editor scales the design bboxes below onto the displayed preview.
  canvas: { width: number; height: number };
  // tappable non-text colour areas (role + box in canvas px)
  colour_regions: { role: string; bbox: number[] }[];
  editable_slots: {
    id: string; label: string; role: string; source: string; default_text: string;
    // the slot's design box [x0,y0,x1,y1] in canvas px + its anchoring — the editor overlays a tap-target here
    // and lets the user drag it (a position override) / resize it (a size override).
    bbox: number[]; align: string; valign: string; size: number | null; rotate: number;
  }[];
  colour_layers: { role: string; label: string; default: string; locked: boolean; used: boolean }[];
}

export function templateMeta(id: string): TemplateMeta {
  const m = loadEditableManifest(manifestPathOf(id));
  const photo_count = m.photo_slots?.length ?? (m.photo_token ? 1 : 0);
  const used = usedRoles(m);
  return {
    id,
    photo_count,
    palette_locked: !!m.palette_locked,
    canvas: { width: m.canvas.width, height: m.canvas.height },
    colour_regions: colourRegions(m),
    editable_slots: m.text_slots.map((s: any) => ({
      id: s.id, label: labelSlot(s.id), role: s.role, source: s.source, default_text: s.text,
      bbox: s.bbox, align: s.align ?? 'left', valign: s.valign ?? 'top', size: s.size ?? null, rotate: s.rotate ?? 0,
    })),
    // MANUAL mode (Christian 2026-07-13) exposes EVERY colour layer — background, text, all of it — each with a
    // wheel. The `locked` flag is informational (auto/brand-palette respects it; a manual pick bypasses it).
    colour_layers: Object.entries(m.colour_tokens)
      .map(([role, v]: any) => ({ role, label: ROLE_LABELS[role] || labelSlot(role), default: v.default, locked: !!v.locked, used: used.has(role) })),
  };
}

// The colour each role currently renders in: a locked token keeps its design default; an unlocked token takes
// the agency/brand palette if it sets that role, else its default. Used to pre-fill the manual wheels AND as
// the manual base (so a layer the agency doesn't touch keeps its correct colour).
function effectiveColours(m: any, brand: BrandColours): Record<string, string> {
  const pal = m.palette_locked ? {} : agencyPalette(m, brand);
  const out: Record<string, string> = {};
  for (const [role, v] of Object.entries<any>(m.colour_tokens)) {
    out[role] = v.locked ? v.default : ((pal as any)[role] ?? v.default);
  }
  return out;
}

export function catalogue(): TemplateMeta[] {
  return EDITABLE_TEMPLATE_IDS.filter(isKnownTemplate).map(templateMeta);
}

// ── DB-row → engine-input mappers ─────────────────────────────────────────────
export function mapPropertyRow(r: any): DeriveProperty {
  const feats = Array.isArray(r.features) ? r.features.map(String) : [];
  return {
    type: r.property_type || 'property',
    city: r.location_city || '',
    region: r.location_region || null,
    price: r.price == null ? null : Number(r.price),
    size: r.area_built_sqm ?? r.area_sqm ?? null,
    beds: r.bedrooms ?? null,
    baths: r.bathrooms ?? null,
    features: feats,
  };
}
// agency_branding row → { agency contact, brand colours }. Sensible fallbacks so a half-filled brand never crashes.
export function mapBranding(b: any): { agency: DeriveAgency; brand: BrandColours } {
  const web = String(b?.website_url || 'aivena.es').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    agency: {
      name: b?.brand_name || 'Your Agency',
      phone: b?.phone || b?.whatsapp_number || '',
      web,
      email: b?.sender_email || '',
      agent: b?.email_signature_name || '',
    },
    brand: {
      navy: b?.primary_color || '#1a2b4a',
      gold: b?.accent_color || '#c8a24b',
      cream: b?.background_color || '#f4f1ea',
      text: b?.text_color || '#333333',
    },
  };
}

// ── render with overrides ─────────────────────────────────────────────────────
export interface RenderOpts {
  templateId: string;
  property: DeriveProperty;
  agency: DeriveAgency;
  brand: BrandColours;
  photoBuffers: Buffer[];
  textOverrides?: Record<string, string>;   // slotId -> text (the user's edits win over the derived defaults)
  // AUTO mode: optional per-role fine-tune on top of the brand/scheme palette; respects per-token locks.
  colourOverrides?: Record<string, string>;
  // MANUAL mode (Christian 2026-07-13): the user sets EVERY layer's colour with a wheel — bypasses per-token
  // locks. Unset layers keep their correct current colour. Ignored on palette_locked templates (#10).
  manualColours?: Record<string, string>;
  // ── cache identity (optional) ───────────────────────────────────────────────
  // When agencyId is set, renderAndStore writes to a DETERMINISTIC, tenant-scoped key and REUSES an existing
  // object instead of re-rendering. This makes the templates gallery cheap on repeat loads and stops the
  // live-preview storage churn (identical edits dedupe). Absent → a random key (legacy behaviour).
  agencyId?: string;
  propertyId?: string;
  photoRefs?: string[];  // the ordered photo REFS (URLs/paths) — hashed as the photo identity (not the buffers)
  // Interactive-editor overrides (per slotId): move a text block (pos = canvas-px top-left) / resize it
  // (size = canvas-px font size). Passed to the engine and folded into the cache hash.
  positionOverrides?: Record<string, { x: number; y: number }>;
  sizeOverrides?: Record<string, number>;
  // per-photo framing: { [photoIndex]: { zoom, x, y } } — move/crop a photo inside its frame
  photoTransforms?: Record<number, { zoom?: number; x?: number; y?: number }>;
}

/** Render a finished PNG for an editable template — deriveSlots defaults, then the user's text/colour edits. */
export async function renderEditableTemplate(opts: RenderOpts): Promise<Buffer> {
  const m0 = loadEditableManifest(`manifest/templates/${opts.templateId}.editable.json`);
  const derived = deriveSlots(opts.property, opts.agency, opts.templateId);
  // text overrides win: wrap each as the {text} shape applyDerived expects
  const overrides: Record<string, { text: string }> = {};
  for (const [id, text] of Object.entries(opts.textOverrides || {})) {
    if (typeof text === 'string') overrides[id] = { text };
  }
  const m: any = applyDerived(m0, { ...derived, ...overrides });

  let palette: Record<string, string>;
  if (m.palette_locked) {
    palette = {}; // #10 — identity colours are baked/locked, no colour input applies
  } else if (opts.manualColours && Object.keys(opts.manualColours).length) {
    // MANUAL: base = each layer's current effective colour, then the user's wheel picks; unlock every token so
    // the picks apply even to normally-locked layers (background/divider/icon/overlay/…).
    const base = effectiveColours(m, opts.brand);
    for (const v of Object.values<any>(m.colour_tokens)) v.locked = false;
    palette = { ...base, ...opts.manualColours };
  } else {
    // AUTO / scheme (+ optional per-role fine-tune) — respects per-token locks via roleHex.
    palette = { ...agencyPalette(m, opts.brand), ...(opts.colourOverrides || {}) };
  }
  const photos = await pickPhotos(m, opts.photoBuffers, opts.templateId, opts.photoTransforms);
  const r = await renderEditable(m, palette, photos, { pos: opts.positionOverrides, size: opts.sizeOverrides });
  return r.png;
}

const OUT_BUCKET = 'generated-images';
const SIGNED_TTL = 60 * 60 * 24 * 365; // 1 year

// sorted-key JSON so a Record's key order never changes the hash.
function sortRec<T>(r?: Record<string, T>): Record<string, T> {
  if (!r) return {};
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
// The render output is a pure function of these inputs — hash them all so ANY change (facts, brand, edits,
// photos, move/resize) yields a new key, and identical inputs reuse the cached PNG.
function renderInputsHash(opts: RenderOpts): string {
  const canon = JSON.stringify({
    t: opts.templateId, p: opts.property, a: opts.agency, b: opts.brand,
    tx: sortRec(opts.textOverrides), co: sortRec(opts.colourOverrides), mc: sortRec(opts.manualColours),
    ph: opts.photoRefs ?? [], po: sortRec(opts.positionOverrides), so: sortRec(opts.sizeOverrides),
    pt: sortRec(opts.photoTransforms as unknown as Record<string, unknown> | undefined),
  });
  return createHash('sha256').update(canon).digest('hex').slice(0, 32);
}
function signedFor(key: string) {
  return supabaseAdmin.storage.from(OUT_BUCKET).createSignedUrl(key, SIGNED_TTL);
}

/**
 * Render + upload to generated-images + return a signed URL. With a cache identity (opts.agencyId), the key is
 * DETERMINISTIC: an existing object is reused (one signed-url round-trip instead of a full render), and a race
 * that already wrote the key is treated as a hit. Throws on genuine storage failure (caller maps to Law-2).
 */
export async function renderAndStore(opts: RenderOpts): Promise<{ image_url: string; storage_path: string }> {
  const deterministic = !!opts.agencyId;
  const key = deterministic
    ? `editable/${opts.agencyId}/${opts.propertyId || 'x'}/${opts.templateId}/${renderInputsHash(opts)}.png`
    : `editable/${randomUUID()}.png`;

  if (deterministic) {
    const hit = await signedFor(key);
    if (!hit.error && hit.data?.signedUrl) return { image_url: hit.data.signedUrl, storage_path: key };
  }

  const png = await renderEditableTemplate(opts);
  const up = await supabaseAdmin.storage.from(OUT_BUCKET).upload(key, png, { contentType: 'image/png', upsert: false });
  if (up.error) {
    // A concurrent render already wrote this exact deterministic key → treat as a cache hit, don't fail.
    if (deterministic) {
      const exists = await signedFor(key);
      if (!exists.error && exists.data?.signedUrl) return { image_url: exists.data.signedUrl, storage_path: key };
    }
    throw new Error(`studio-editable upload: ${up.error.message}`);
  }
  const signed = await signedFor(key);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`studio-editable sign: ${signed.error?.message}`);
  return { image_url: signed.data.signedUrl, storage_path: key };
}

/** The effective default text per slot + colour per layer, for pre-filling the editing form (no render). */
export function editableDefaults(templateId: string, property: DeriveProperty, agency: DeriveAgency, brand: BrandColours) {
  const meta = templateMeta(templateId);
  const derived = deriveSlots(property, agency, templateId);
  const m = loadEditableManifest(manifestPathOf(templateId));
  const eff = effectiveColours(m as any, brand); // correct current colour per layer (respects locks)
  return {
    ...meta,
    editable_slots: meta.editable_slots.map((s) => ({
      ...s,
      // the value the field is pre-filled with: derived fact-text if present, else the template's own copy
      value: derived[s.id]?.text ?? s.default_text,
    })),
    colour_layers: meta.colour_layers.map((cl) => ({
      ...cl,
      // the colour the wheel starts on = what the layer currently renders in
      value: eff[cl.role] ?? cl.default,
    })),
  };
}
