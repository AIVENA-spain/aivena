import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
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

export const EDITABLE_TEMPLATE_IDS = ['1', '2', '3', '5', '6', '7', '8', '10', '11', '14', '21', '22', '24', '25', '26', '27', '28'];

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

export interface TemplateMeta {
  id: string;
  photo_count: number;
  palette_locked: boolean;
  editable_slots: { id: string; label: string; role: string; source: string; default_text: string }[];
  colour_layers: { role: string; label: string; default: string; locked: boolean }[];
}

export function templateMeta(id: string): TemplateMeta {
  const m = loadEditableManifest(manifestPathOf(id));
  const photo_count = m.photo_slots?.length ?? (m.photo_token ? 1 : 0);
  return {
    id,
    photo_count,
    palette_locked: !!m.palette_locked,
    editable_slots: m.text_slots.map((s: any) => ({
      id: s.id, label: labelSlot(s.id), role: s.role, source: s.source, default_text: s.text,
    })),
    colour_layers: Object.entries(m.colour_tokens)
      .filter(([, v]: any) => !v.locked)
      .map(([role, v]: any) => ({ role, label: ROLE_LABELS[role] || labelSlot(role), default: v.default, locked: !!v.locked })),
  };
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
  colourOverrides?: Record<string, string>; // role -> hex (the colour wheel; ignored on palette_locked templates)
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
  const m = applyDerived(m0, { ...derived, ...overrides });
  const palette = m.palette_locked
    ? {}
    : { ...agencyPalette(m, opts.brand), ...(opts.colourOverrides || {}) };
  const photos = await pickPhotos(m, opts.photoBuffers, opts.templateId);
  const r = await renderEditable(m, palette, photos);
  return r.png;
}

const OUT_BUCKET = 'generated-images';
const SIGNED_TTL = 60 * 60 * 24 * 365; // 1 year

/** Render + upload to generated-images + return a signed URL. Throws on storage failure (caller maps to Law-2). */
export async function renderAndStore(opts: RenderOpts): Promise<{ image_url: string; storage_path: string }> {
  const png = await renderEditableTemplate(opts);
  const key = `editable/${randomUUID()}.png`;
  const up = await supabaseAdmin.storage.from(OUT_BUCKET).upload(key, png, { contentType: 'image/png', upsert: false });
  if (up.error) throw new Error(`studio-editable upload: ${up.error.message}`);
  const signed = await supabaseAdmin.storage.from(OUT_BUCKET).createSignedUrl(key, SIGNED_TTL);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`studio-editable sign: ${signed.error?.message}`);
  return { image_url: signed.data.signedUrl, storage_path: key };
}

/** The effective default text per slot + colour per layer, for pre-filling the editing form (no render). */
export function editableDefaults(templateId: string, property: DeriveProperty, agency: DeriveAgency, brand: BrandColours) {
  const meta = templateMeta(templateId);
  const derived = deriveSlots(property, agency, templateId);
  const m = loadEditableManifest(manifestPathOf(templateId));
  const pal = meta.palette_locked ? {} : agencyPalette(m as any, brand);
  return {
    ...meta,
    editable_slots: meta.editable_slots.map((s) => ({
      ...s,
      // the value the field is pre-filled with: derived fact-text if present, else the template's own copy
      value: derived[s.id]?.text ?? s.default_text,
    })),
    colour_layers: meta.colour_layers.map((cl) => ({
      ...cl,
      // the effective colour the layer currently renders in (agency palette if it sets this role, else default)
      value: (pal as any)[cl.role] ?? cl.default,
    })),
  };
}
