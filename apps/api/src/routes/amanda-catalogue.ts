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
};

const REF_RE = /\b([A-Za-z][A-Za-z0-9]{1,5}-[A-Za-z0-9]{1,6})\b/;
const VIEWING_RE =
  /\b(viewing|book a (viewing|visit)|arrange a (viewing|visit)|schedule a (viewing|visit)|come and see|see it in person|visita|agendar (una )?visita|concertar (una )?visita|cita para ver)\b/i;

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
  };
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
      ? 'No tengo ahora mismo una propiedad activa que encaje con eso. Le paso sus criterios a un agente — ¿cuál es el mejor email o teléfono para contactarle?'
      : "I don't have an active listing matching that right now. I'll pass your criteria to an agent — what's the best email or phone to reach you?";
  }
  const more = truncated
    ? (es ? ' Hay más; un agente puede enviarle el resto.' : ' There are more — an agent can send you the rest.')
    : '';
  return es
    ? `Aquí tiene ${count} que encajan. Un agente puede darle más detalles o concertar una visita.${more}`
    : `Here ${count === 1 ? 'is 1 listing' : `are ${count} listings`} that match. An agent can tell you more or arrange a viewing.${more}`;
}

/** Templated reply for a specific-listing lookup. `found` false → defer to the team. */
export function specificReply(found: boolean, ref: string, lang?: string): string {
  const es = pick(lang) === 'es';
  if (!found) {
    return es
      ? `No encuentro una propiedad activa con la referencia ${ref}. Le paso su pregunta a un agente — ¿cuál es el mejor email o teléfono para contactarle?`
      : `I couldn't find an active listing with reference ${ref}. I'll pass your question to an agent — what's the best email or phone to reach you?`;
  }
  return es ? `Esto es lo que tengo sobre ${ref}:` : `Here's what I have on ${ref}:`;
}

/** Templated reply acknowledging a viewing REQUEST (captured for an agent — not booked). */
export function viewingReply(haveContact: boolean, lang?: string): string {
  const es = pick(lang) === 'es';
  if (haveContact) {
    return es
      ? 'Perfecto — paso su solicitud de visita a un agente, que confirmará la fecha con usted. No se agenda nada automáticamente.'
      : "Great — I'll pass your viewing request to an agent, who will confirm a time with you. Nothing is booked automatically.";
  }
  return es
    ? 'Con gusto — ¿cuál es el mejor email o teléfono para que un agente confirme la visita?'
    : "Happy to — what's the best email or phone for an agent to confirm the viewing?";
}
