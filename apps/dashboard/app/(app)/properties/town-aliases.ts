/**
 * Town → district/area aliases for Properties search (frontend-only, read-only).
 *
 * The catalog stores each listing's `location_city` as a specific area/district
 * (e.g. "La Mata"), not the parent municipality — so a search for a TOWN
 * ("Torrevieja") wouldn't match its districts stored under their own name. This
 * map expands a town query to also match its well-known districts.
 *
 * To EXPAND coverage later: add a town key (lowercase) with its district names
 * exactly as they appear in `location_city` (lowercase). Keep it to clear,
 * unambiguous districts — avoid generic names like "centro" that belong to many
 * towns. This is a small curated convenience list, NOT geo-normalization.
 */
export const TOWN_ALIASES: Record<string, string[]> = {
  torrevieja: [
    "la mata",
    "playa del cura",
    "los locos",
    "los balcones",
    "el chaparral",
    "aguas nuevas",
    "la torreta",
    "nueva torrevieja",
    "montemar",
  ],
  guardamar: ["el raso", "els secans", "la marina"],
  "guardamar del segura": ["el raso", "els secans", "la marina"],
  "orihuela costa": [
    "cabo roig",
    "playa flamenca",
    "villamartin",
    "la zenia",
    "los dolses",
    "punta prima",
    "campoamor",
    "las filipinas",
  ],
};

/**
 * Expand a raw search query into the lowercased terms to match against a
 * property's fields. Always includes the query itself; if the query names (or is
 * a ≥3-char prefix of) a known town, also includes that town's district aliases.
 * A non-town query (e.g. a person's name) expands to just itself — so it can't
 * accidentally surface unrelated listings.
 */
export function expandSearchTerms(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = new Set<string>([q]);
  if (q.length >= 3) {
    for (const [town, districts] of Object.entries(TOWN_ALIASES)) {
      if (town.startsWith(q) || q.includes(town)) {
        for (const d of districts) terms.add(d);
      }
    }
  }
  return [...terms];
}
