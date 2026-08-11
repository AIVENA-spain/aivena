/**
 * Amanda Phase B — PURE catalogue helpers (no DB / no network / no LLM).
 *
 * Turns the visitor's collected qualification + latest message into deterministic
 * search filters, detects a specific-listing reference and viewing intent, and
 * shapes verified DB rows into safe property cards + templated replies. The DB read
 * (amanda_search_properties, SECURITY DEFINER, is_test-gated, status='active' only)
 * and the route wire these together. Amanda NEVER generates prose about a property:
 * every card field is a verbatim column value; every sentence is fixed template copy.
 */

import type { Collected } from './amanda-flow';

export type SearchFilters = {
  ref: string | null;           // a specific listing reference (external_id / id), if asked
  q: string | null;             // free-text phrase ("the one in playa del cura") — title/city match
  location: string | null;
  propertyType: string | null;
  bedroomsMin: number | null;
  budgetMax: number | null;
  openToAdjacent: boolean;      // widen to adjacent zones (conservative default: false)
};

/** A row as returned by amanda_search_properties (safe public columns only). */
export type PropertyRow = {
  id: string;
  external_id: string | null;
  title: string | null;
  property_type: string | null;
  status: string | null;
  price: number | string | null;
  price_currency: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  area_sqm: number | string | null;
  location_city: string | null;
  location_region: string | null;
  source_url: string | null;
  images?: unknown;
  features?: unknown;
};

/** The safe card the widget renders (no agency_id / embedding / raw_payload / lat-lng). */
export type PropertyCard = {
  type: 'property';
  ref: string | null;
  title: string | null;
  propertyType: string | null;
  price: number | null;
  currency: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  locationCity: string | null;
  url: string | null;
  image: string | null;
  features: string[];
};

const REF_RE = /\b([A-Za-z][A-Za-z0-9]{1,5}-[A-Za-z0-9]{1,6})\b/;
// "the one in playa del cura" / "that villa near la mata" → a title/city phrase the
// zone tables may not know. Captured verbatim (trimmed) for a title ILIKE match.
const PHRASE_RE = /\b(?:the ones?|that (?:property|listing|one|apartment|villa|house|flat))\s+(?:in|at|near|on|with)\s+([a-zA-Z\u00c0-\u017f][a-zA-Z\u00c0-\u017f' -]{2,40})/i;

/** Extract a free-text referring phrase for title/city matching ("playa del cura"). */
export function parseSearchPhrase(message: string): string | null {
  if (typeof message !== 'string') return null;
  const m = message.match(PHRASE_RE);
  if (!m) return null;
  // Trim trailing filler that often follows the place phrase.
  const q = m[1].replace(/\s+(and|please|thanks?|que|por favor)\b.*$/i, '').trim();
  return q.length >= 3 ? q : null;
}
const VIEWING_RE =
  /\b(viewing|book a (viewing|visit)|arrange a (viewing|visit)|schedule a (viewing|visit)|(would like|like|want|love) to (view|visit)|can (i|we) (view|visit)|visit (the|it|your|on|this)|come and see|see it in person|visita|agendar (una )?visita|concertar (una )?visita|cita para ver)\b/i;

/** Extract a specific listing reference from a free-text message (external_id-style). */
export function parseListingRef(message: string): string | null {
  if (typeof message !== 'string') return null;
  const m = message.match(REF_RE);
  if (!m) return null;
  const ref = m[1].toUpperCase();
  // Property references always contain a digit — this rejects ordinary hyphenated
  // words ("well-known", "follow-up") so they aren't mistaken for a listing ref.
  return /\d/.test(ref) ? ref : null;
}

/** Does the visitor want to arrange a viewing? (Captured as a request, never booked.) */
export function wantsViewing(message: string): boolean {
  return typeof message === 'string' && VIEWING_RE.test(message);
}

/** Deterministic search filters from the merged qualification + this message. */
export function buildSearchFilters(collected: Collected, message: string): SearchFilters {
  return {
    ref: parseListingRef(message),
    q: parseSearchPhrase(message),
    location: collected.location?.trim() || null,
    propertyType: collected.propertyType?.trim() || null,
    bedroomsMin: collected.bedroomsMin ?? null,
    budgetMax: collected.budgetMax ?? null,
    openToAdjacent: false,
  };
}

const toNum = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Shape a verified DB row into a safe card. `image` is a pre-vetted own-bucket URL
 *  (the route derives it via usablePhotos) or null — no other image is ever shown. */
export function toPropertyCard(row: PropertyRow, image: string | null): PropertyCard {
  return {
    type: 'property',
    ref: row.external_id ?? null,
    title: row.title ?? null,
    propertyType: row.property_type ?? null,
    price: toNum(row.price),
    currency: row.price_currency ?? 'EUR',
    bedrooms: row.bedrooms ?? null,
    bathrooms: row.bathrooms ?? null,
    areaSqm: toNum(row.area_sqm),
    locationCity: row.location_city ?? null,
    url: row.source_url ?? null,
    image: image ?? null,
    features: humanizeFeatures(row.features),
  };
}

/** Agency-entered feature tags, humanized verbatim ("communal_pool" → "communal
 *  pool") — never invented, capped at 6. */
export function humanizeFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .slice(0, 6)
    .map((f) => f.replace(/_/g, ' ').trim().toLowerCase());
}

// Follow-ups about the listing just shown ("the property", "its features", "is
// there a link", "can I see it online") — resolved via the session's lastRef.
const FOLLOWUP_RE = /\b((the|that|this) (propert\w*|one|listing|apartment|villa|house|flat)|tell me more|more (about|info|information|details?|pictures?|photos?)|about (it|this|that)|fea\w*tur\w*|amenit\w*|link|url|website|see (it|this|that) online|its price|how (big|large)|cu(e|é)ntame m(a|á)s|m(a|á)s (info\w*|detalles))\b/i;
export function isFollowUpAboutLast(message: string): boolean {
  return typeof message === 'string' && FOLLOWUP_RE.test(message);
}

/** A real "let me tell you about it" answer for ONE known listing — every value is
 *  a verbatim card field composed into a template sentence. Never free-form, never
 *  invented; missing fields are simply omitted. */
export function listingDetailReply(card: PropertyCard, lang?: string): string {
  const es = pick(lang) === 'es';
  const bits: string[] = [];
  if (card.bedrooms != null) bits.push(es ? `${card.bedrooms} dormitorio${card.bedrooms === 1 ? '' : 's'}` : `${card.bedrooms} bedroom${card.bedrooms === 1 ? '' : 's'}`);
  if (card.bathrooms != null) bits.push(es ? `${card.bathrooms} baño${card.bathrooms === 1 ? '' : 's'}` : `${card.bathrooms} bathroom${card.bathrooms === 1 ? '' : 's'}`);
  if (card.areaSqm != null) bits.push(`${card.areaSqm} m²`);
  if (card.price != null) bits.push(`€${Math.round(card.price).toLocaleString(es ? 'es-ES' : 'en-GB')}`);
  const facts = bits.join(', ');
  const name = card.title || card.ref || (es ? 'esta propiedad' : 'this property');
  const feat = card.features.length > 0
    ? (es ? ` Características: ${card.features.join(', ')}.` : ` Features: ${card.features.join(', ')}.`)
    : '';
  // Skip the "in {city}" suffix when the title already names the city.
  const cityInTitle = card.locationCity && (card.title ?? '').toLowerCase().includes(card.locationCity.toLowerCase());
  const where = card.locationCity && !cityInTitle ? (es ? ` en ${card.locationCity}` : ` in ${card.locationCity}`) : '';
  return es
    ? `${name}${where} — ${facts}.${feat} Toque «Ver detalles» en la ficha para ver el anuncio completo con fotos. ¿Quiere organizar una visita?`
    : `${name}${where} — ${facts}.${feat} Tap 'View details' on the card to see the full listing with photos. Would you like to arrange a viewing?`;
}

/** Cap enforced everywhere: never show more than 3 cards in one answer. */
export const MAX_CARDS = 3;

type Lang = 'en' | 'es';
const pick = (lang?: string): Lang => (lang === 'es' ? 'es' : 'en');

/**
 * Templated reply for a search answer — NEVER free-form. `count` is how many active
 * listings matched (already capped); `truncated` = more existed than shown.
 */
export function searchReply(count: number, truncated: boolean, lang?: string): string {
  const es = pick(lang) === 'es';
  if (count === 0) {
    return es
      ? 'Ahora mismo no tengo una propiedad activa que encaje con eso. Si quiere, déjeme su WhatsApp o email y el equipo estará atento por usted.'
      : "I don't have an active listing matching that just now. If you'd like, leave your WhatsApp number or email and the team will keep an eye out for you.";
  }
  const more = truncated
    ? (es ? ' Hay más; el equipo puede enviarle el resto.' : ' There are more — the team can send you the rest.')
    : '';
  return es
    ? `Aquí tiene ${count} que encajan. Pregúnteme por cualquiera de ellas, o pida una visita cuando quiera.${more}`
    : count === 1
      ? `Here's a listing that matches. Ask me anything about it, or say the word if you'd like a viewing.${more}`
      : `Here are ${count} listings that match. Ask me about any of them, or say the word if you'd like a viewing.${more}`;
}

/** Templated reply for a specific-listing lookup. `found` false → defer to the team. */
export function specificReply(found: boolean, ref: string, lang?: string): string {
  const es = pick(lang) === 'es';
  if (!found) {
    return es
      ? `No encuentro una propiedad activa con la referencia ${ref}. Si quiere, déjeme su WhatsApp o email y el equipo lo comprobará.`
      : `I can't see an active listing with reference ${ref}. If you'd like, leave your WhatsApp number or email and the team will double-check for you.`;
  }
  return es ? `Esto es lo que tengo sobre ${ref}:` : `Here's what I have on ${ref}:`;
}

/** Templated reply acknowledging a viewing REQUEST (captured for an agent — not booked). */
export function viewingReply(haveContact: boolean, lang?: string): string {
  const es = pick(lang) === 'es';
  if (haveContact) {
    return es
      ? 'Perfecto — paso su solicitud de visita al equipo, que confirmará la fecha con usted. No se agenda nada automáticamente.'
      : "Great — I'll pass your viewing request to the team, and they'll confirm a time with you. Nothing is booked automatically.";
  }
  return es
    ? 'Con gusto — ¿cuál es el mejor email o teléfono para que un agente confirme la visita?'
    : "Happy to — what's the best email or phone for an agent to confirm the viewing?";
}
