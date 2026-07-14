// ── Kyero XML v3 → AIVENA property, the pure part ─────────────────────────────
//
// Deliberately dependency-free: no imports, no Deno/Node APIs, no I/O. It takes the plain object
// that fast-xml-parser produces and returns normalised rows. That is what makes it testable — the
// XML fetch/parse and the database writes stay in index.ts, which cannot be unit-tested.
//
// WHY THIS EXISTS (read before changing anything here)
// property-sync had never once run against a real feed. Its normaliser carried three defects that a
// real Kyero feed exposes immediately. All three are fixed here and pinned by kyero.test.ts against
// real Kyero-format fixtures:
//
//   1. BUILT vs PLOT WERE COLLAPSED.  `area_sqm: num(surf.built) ?? num(surf.plot)` meant that a
//      listing with no built size silently stored its PLOT size in the generic area column — which
//      the Studio then prints as "N m² built". A 3000 m² plot advertised as a 3000 m² house is a
//      misrepresentation, not a cosmetic bug. Kyero keeps them cleanly separate
//      (<surface_area><built/><plot/></surface_area>), so the conflation was entirely ours.
//      Now: built and plot land in their own columns, and the generic area_sqm is BUILT ONLY, never
//      plot. If built is unknown, area_sqm is null — an honest gap beats a wrong number.
//
//   2. TWELVE LANGUAGES WERE THROWN AWAY.  `desc` carries one node per language (13 in Kyero's own
//      sample, 33 in the OpenEstate fixture). The old `txt()` picked `en ?? es ?? first` and dropped
//      the rest — in a product that sells itself on speaking 13 languages. Now every language is
//      kept in `descriptions`, with `description` still exposing the preferred one.
//
//   3. "0" MEANT ZERO.  The import spec (V3.8) says of surface area: "Empty, missing tags or 0 if
//      unknown". Storing 0 m² as a real measurement is a lie; it is now null.
//
// FORMAT FACTS worth not re-learning (from the V3.8 import spec + kyeroV3.0.xsd, fetched 2026-07-14):
//   - Root element is <root>, not <kyero>. <kyero><feed_version> is a header block inside it.
//   - propertyType is xs:all → ELEMENT ORDER IS NOT GUARANTEED. Always read by name, never position.
//   - There is NO property title in v3. A headline must be derived from facts (see deriveTitle).
//   - <agent> is optional and absent from Kyero's own sample; never require it.
//   - <images> holds at most 50 <image>, each with a required id attribute and an optional url.
//   - Every field except id/ref is effectively optional in the wild. Assume nothing is present.

/** The parsed <property> node, as fast-xml-parser emits it. Everything is optional in practice. */
export type KyeroProperty = Record<string, unknown>;

export interface NormProp {
  external_id: string;
  title: string;
  /** Preferred-language description, for the existing single-text `description` column. */
  description: string | null;
  /** EVERY language the feed supplied, keyed by ISO code. Nothing is discarded. */
  descriptions: Record<string, string>;
  property_type: string | null;
  price: number | null;
  price_currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  /** Generic/headline area. BUILT only — never plot. Null when built is unknown. */
  area_sqm: number | null;
  area_built_sqm: number | null;
  area_plot_sqm: number | null;
  location_city: string | null;
  location_region: string | null;
  location_country: string | null;
  lat: number | null;
  lng: number | null;
  images: string[];
  features: string[];
  source_url: string | null;
  raw: unknown;
}

/** Kyero permits at most 50 images per property (kyeroV3.0.xsd imagesType maxOccurs="50"). */
export const MAX_IMAGES = 50;

export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Coerce a scalar (or a {#text} / multilingual node) to trimmed text. For multilingual nodes this
 * returns the PREFERRED language only — use langMap() when you want them all.
 */
export function txt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) { const s = String(o["#text"]).trim(); return s || null; }
    const pref = o["en"] ?? o["es"] ?? Object.values(o)[0];
    if (pref === undefined || pref === null) return null;
    const s = String(pref).trim();
    return s || null;
  }
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Every language of a multilingual node (<desc>, <url>), keyed by ISO code. Attribute keys (@_*) and
 * the fast-xml-parser #text key are skipped, as are empty strings. Returns {} for a plain scalar or
 * a missing node, so callers never branch on shape.
 */
export function langMap(v: unknown): Record<string, string> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith("@_") || k === "#text") continue;
    if (raw === null || typeof raw === "object") continue;
    const s = String(raw).trim();
    if (s) out[k] = s;
  }
  return out;
}

export function num(v: unknown): number | null {
  const s = txt(v);
  if (s === null) return null;
  const n = Number(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function intOrNull(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/**
 * Surface area in m². The V3.8 spec: "Empty, missing tags or 0 if unknown" — so 0 (and anything
 * negative) is an absence, not a measurement. Storing 0 m² as fact would be a lie.
 */
export function area(v: unknown): number | null {
  const n = num(v);
  if (n === null || n <= 0) return null;
  return n;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Kyero v3 has no title element at all, so a headline must be derived from facts. Kept deliberately
 * plain: type + town, falling back to the agency's own reference. Never invented adjectives.
 *
 * Both type AND town are title-cased: real feeds supply lowercase towns (the OpenEstate fixture says
 * `<town>almunecar</town>`), and since this derived string IS the listing headline everywhere —
 * property cards, matches, Studio posts — "Villa in almunecar" would ship to buyers. Only the
 * display string is normalised; `location_city` keeps the feed's own casing, because matching and
 * zone lookups key off it.
 */
export function deriveTitle(type: string | null, town: string | null, ref: string | null, externalId: string): string {
  const derived = (type || town)
    ? [type ? titleCase(type) : null, town ? `in ${titleCase(town)}` : null].filter(Boolean).join(" ")
    : null;
  return derived ?? ref ?? `Property ${externalId}`;
}

export function normalizeKyero(p: KyeroProperty): NormProp | null {
  const external_id = txt(p["id"]) ?? txt(p["ref"]);
  if (!external_id) return null; // cannot key a row without a stable id

  const type = txt(p["type"]);
  const town = txt(p["town"]);

  const loc = (p["location"] ?? {}) as Record<string, unknown>;
  const surf = (p["surface_area"] ?? {}) as Record<string, unknown>;

  // FIX 1 — built and plot stay apart. area_sqm is the BUILT size or nothing; a plot size must never
  // masquerade as the headline area (the Studio renders area_sqm as "N m² built").
  const area_built_sqm = area(surf["built"]);
  const area_plot_sqm = area(surf["plot"]);

  const imgsNode = (p["images"] ?? {}) as Record<string, unknown>;
  const images = asArray<Record<string, unknown>>(imgsNode["image"] as never)
    .map((im) => txt((im as Record<string, unknown>)?.["url"] ?? im))
    .filter((u): u is string => !!u)
    .slice(0, MAX_IMAGES);

  const featNode = (p["features"] ?? {}) as Record<string, unknown>;
  const features = asArray<unknown>(featNode["feature"] as never)
    .map((f) => txt(f)).filter((f): f is string => !!f);

  // FIX 2 — keep every language, not just one.
  const descriptions = langMap(p["desc"]);

  return {
    external_id,
    title: deriveTitle(type, town, txt(p["ref"]), external_id),
    description: txt(p["desc"]),
    descriptions,
    property_type: type,
    price: num(p["price"]),
    price_currency: (txt(p["currency"]) ?? "EUR").toUpperCase().slice(0, 3),
    bedrooms: intOrNull(p["beds"]),
    bathrooms: intOrNull(p["baths"]),
    area_sqm: area_built_sqm,
    area_built_sqm,
    area_plot_sqm,
    location_city: town,
    location_region: txt(p["province"]),
    location_country: txt(p["country"]) ?? "Spain",
    lat: num(loc["latitude"]),
    lng: num(loc["longitude"]),
    images,
    features,
    source_url: txt(p["url"]),
    raw: p,
  };
}

/**
 * Normalise a whole parsed feed document. Reads strictly by element name (propertyType is xs:all, so
 * order means nothing) and tolerates <root> being absent. Properties without a usable id are skipped
 * rather than failing the run — one malformed listing must not cost an agency its whole sync.
 */
export function normalizeFeed(doc: unknown): NormProp[] {
  const d = (doc ?? {}) as Record<string, unknown>;
  const root = (d["root"] ?? d) as Record<string, unknown>;
  const out: NormProp[] = [];
  for (const p of asArray<KyeroProperty>(root?.["property"] as never)) {
    const n = normalizeKyero(p);
    if (n) out.push(n);
  }
  return out;
}
