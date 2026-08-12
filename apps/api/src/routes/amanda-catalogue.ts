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
  bathroomsMin: number | null;
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
  description?: string | null;
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

// A BROWSE request — the visitor wants to SEE listings (cards), whatever else is
// on screen: "show me a few", "what else do you have", "some options", "similar
// properties", "more properties in X". Always wins over the current-listing chat.
const BROWSE_RE = /\b(show (me|us)|see) (a few|some|more|other|a couple|others?)\b|\ba few (more )?(propert|place|option|apartment|villa|flat|home)|\bsome (option|propert|place|apartment|villa|flat|home)|\b(any|some|more|other)thing else\b|\bwhat else\b|\bother (propert|option|place|listing|apartment|villa)|\bsimilar (propert|option|place|listing|one)|\bmore (propert|listing|option|place)|\bm(a|á)s (opciones|propiedades|pisos|casas)|\botras propiedades\b/i;

/** Pure: does this message ask to BROWSE listings (→ cards, breaks out of any
 *  current-listing conversation)? */
export function isBrowseRequest(message: string): boolean {
  return typeof message === 'string' && BROWSE_RE.test(message);
}

// A GENERAL / area question with no property in view — town/neighbourhood/lifestyle/
// market talk the warm agent should answer (web-researched), NOT funnel intro.
const GENERAL_Q_RE = /\b(areas?|neighbou?rhood|town|village|city|nearby|near\s?by|close to|walking distance|beach|beaches|school|schools|restaurant|restaurants|bars?|shops?|shopping|airport|golf|amenit|safe|safety|crime|quiet|lively|busy|nice place|good place|good area|best area|like living|live there|to live|whats it like|what is it like|worth|invest|expensive|cheap|affordable|weather|climate|community|expat|expats|commute|transport|market|prices? in|typical)\b/i;

/** True when the message reads like a genuine general/area question the agent should
 *  ANSWER (vs a short funnel token like "buy" or a location answer like "torrevieja").
 *  Requires either a question shape or an area keyword, and ≥3 words. */
export function isGeneralQuestion(message: string): boolean {
  if (typeof message !== 'string') return false;
  const m = message.trim();
  if (m.length < 5 || m.split(/\s+/).length < 3) return false;
  const questionShape = /\?\s*$/.test(m)
    || /^(is|are|was|were|whats|what'?s|what|how|where|which|why|do you|does|can you|could you|would you|should i|tell me|is there|are there)\b/i.test(m);
  return questionShape || GENERAL_Q_RE.test(m);
}

// ── Resolving a reference to one of SEVERAL shown cards (Christian, 2026-08-12) ──
// "the top one", "the first / second / last one", "the one in Cabo Roig" (typo-
// tolerant). The route re-runs the (deterministic) search to get the exact set on
// screen, then this maps the message to an index. Pure + unit-tested.
const _norm = (x: string): string =>
  x.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents (roigç→roigc)
    .replace(/[^a-z0-9]+/g, ' ').trim();
// Property words carry no location signal — excluded from phrase matching.
const GENERIC_TOKENS = new Set([
  'apartment','apartments','villa','villas','townhouse','townhouses','penthouse','bungalow',
  'house','houses','flat','flats','home','homes','property','properties','bedroom','bedrooms',
  'bathroom','bathrooms','communal','pool','garden','gardens','near','beach','with','sea','view',
  'views','gated','community','solarium','terrace','terraces','golf','private','semi','detached',
  'city','centre','center','interior','patio','character','amenities','apartamento','adosado','the','one',
]);

/** Does this message look like a reference to a shown listing (ordinal / "that one"
 *  / "the one in X")? Used to decide whether to attempt reference resolution. */
export function isReferenceFollowup(message: string): boolean {
  if (typeof message !== 'string') return false;
  return /\b(first|1st|second|2nd|third|3rd|top|middle|last|bottom|final)\b/i.test(message)
    // "that/this/the [adjective] one|villa|penthouse…" — an optional adjective lets
    // "the luxury villa" / "the townhouse one" count as references too.
    || /\b(that|this|the) (\w+\s+)?(one|propert|listing|apartment|villa|penthouse|atico|house|flat|townhouse|bungalow|chalet|duplex)/i.test(message)
    || /\bthe ones? (in|at|near|on|with)\b/i.test(message)
    || /\b(more about|tell me about)\b/i.test(message);
}

/** Collapse a property_type (or a type word in a message) to a canonical bucket, so
 *  "the townhouse one" matches an item whose type is "Townhouse"/"adosado", etc. */
function canonType(raw: string | null): string {
  const t = _norm(raw ?? '');
  if (/penthouse|atico/.test(t)) return 'penthouse';
  if (/townhouse|adosado|terraced/.test(t)) return 'townhouse';
  if (/bungalow/.test(t)) return 'bungalow';
  if (/duplex/.test(t)) return 'duplex';
  if (/chalet/.test(t)) return 'chalet';
  if (/villa|detached/.test(t)) return 'villa';
  if (/apartment|apartamento|flat|piso|studio/.test(t)) return 'apartment';
  return t;
}
/** The property TYPE a reference message asks for ("the townhouse one" → townhouse). */
function requestedType(message: string): string | null {
  const t = ` ${_norm(message)} `;
  if (/ penthouse | atico /.test(t)) return 'penthouse';
  if (/ townhouse | adosado /.test(t)) return 'townhouse';
  if (/ bungalow /.test(t)) return 'bungalow';
  if (/ duplex /.test(t)) return 'duplex';
  if (/ chalet /.test(t)) return 'chalet';
  if (/ villa /.test(t)) return 'villa';
  if (/ apartment | apartamento | flat | piso /.test(t)) return 'apartment';
  return null;
}

/** Map a reference message to an index into the shown items, or null if unclear.
 *  items are in the order shown (index 0 = top card). Resolution order: ordinal →
 *  distinctive location token → distinctive property TYPE. */
export function resolveReference(
  message: string,
  items: Array<{ title: string | null; city: string | null; type?: string | null }>,
): number | null {
  if (!Array.isArray(items) || items.length === 0 || typeof message !== 'string') return null;
  const n = ` ${_norm(message)} `;
  // Ordinals.
  if (/\b(last|bottom|final)\b/.test(n)) return items.length - 1;
  if (/\b(first|1st|top|number one)\b/.test(n)) return 0;
  if (/\b(second|2nd|middle)\b/.test(n) && items.length >= 2) return 1;
  if (/\b(third|3rd)\b/.test(n) && items.length >= 3) return 2;
  // Distinctive-location match: a token that appears in exactly ONE item's label.
  const tokensPerItem = items.map((it) =>
    new Set(_norm(`${it.title ?? ''} ${it.city ?? ''}`).split(' ').filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t))));
  const count = new Map<string, number>();
  for (const set of tokensPerItem) for (const t of set) count.set(t, (count.get(t) ?? 0) + 1);
  for (let i = 0; i < tokensPerItem.length; i++) {
    for (const t of tokensPerItem[i]) {
      if (count.get(t) === 1 && n.includes(t)) return i;   // distinctive + present in message
    }
  }
  // Distinctive property-TYPE match: "the townhouse one" resolves when exactly ONE
  // shown card is that type (type words are otherwise excluded from location matching).
  const want = requestedType(message);
  if (want) {
    const hits = items.map((it, i) => ({ i, t: canonType(it.type ?? null) })).filter((x) => x.t === want);
    if (hits.length === 1) return hits[0].i;
  }
  return null;
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
    bathroomsMin: collected.bathroomsMin ?? null,
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

// "Is it modern? Does it have a pool? Which way does it face?" — a question about
// the CONDITION/ATTRIBUTES of the listing under discussion.
const LISTING_Q_RE = /\b(is|does|has|was|are|did|will|would) (it|this|that|the (propert\w*|apartment|villa|house|flat|one))\b/i;
export function isListingQuestion(message: string): boolean {
  return typeof message === 'string' && LISTING_Q_RE.test(message);
}

// Topic → feature-tag keywords: what the agency's own tags can genuinely answer.
const TOPIC_KEYWORDS: Array<[RegExp, RegExp]> = [
  [/modern|renovat|refurbish|reform|condition|new|old|dated/i, /refurbish|renovat|reform|new build|modern|character/i],
  [/facing|orientation|sun|sunny|light/i, /facing|orientation|sunny/i],
  [/pool|swim/i, /pool/i],
  [/garden|outdoor|terrace|balcon|yard/i, /garden|terrace|balcon|patio/i],
  [/parking|garage|car/i, /parking|garage/i],
  [/lift|elevator/i, /lift|elevator/i],
  [/beach|sea|coast/i, /beach|sea|front ?line/i],
  [/golf/i, /golf/i],
  [/furnish/i, /furnish/i],
  [/gated|secure|security/i, /gated|security/i],
  [/quiet|noise|noisy/i, /quiet/i],
  [/rent|rental|invest/i, /rental/i],
  [/centre|center|central|amenities|shops|walk/i, /centre|central|amenities|walking/i],
];

/** What the listing's own tags say about the visitor's question — verbatim matches
 *  only, or null when the data genuinely doesn't cover it (never guess). */
export function featuresAnswering(question: string, features: string[]): string[] | null {
  const hits = new Set<string>();
  for (const [qRe, fRe] of TOPIC_KEYWORDS) {
    if (qRe.test(question)) for (const f of features) if (fRe.test(f)) hits.add(f);
  }
  return hits.size > 0 ? [...hits] : null;
}

/** Warm, honest answer to a condition question: what the listing SAYS, or an honest
 *  "it doesn't say — the team will know". Never a guess, never a brush-off. */
export function listingConditionReply(matched: string[] | null, lang?: string): string {
  const es = pick(lang) === 'es';
  if (matched && matched.length > 0) {
    return es
      ? `Buena pregunta — según el anuncio: ${matched.join(', ')}. Más allá de lo publicado no quiero adivinar, pero el equipo se lo puede confirmar encantado. ¿Quiere que les pregunte?`
      : `Good question — according to the listing: ${matched.join(', ')}. Beyond what's published I don't want to guess, but the team can happily confirm the details. Want me to ask them for you?`;
  }
  return es
    ? `Buena pregunta — el anuncio no lo especifica y prefiero no adivinar. El equipo lo sabrá seguro; déjeme su WhatsApp o email y le responden.`
    : `Good question — the listing doesn't say, and I'd rather not guess. The team will know for sure though — leave me your WhatsApp number or email and they'll get back to you.`;
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
