import type { Match } from "@/lib/api/types";

/**
 * Composer "insert alternatives" — turns REAL matched properties (the same
 * `get_lead_matches` rows the rail renders) into a plain-text block the operator
 * can drop into a reply draft. Honesty rules (Packet-2 lane):
 *   - Only real property FACTS: title · price · type · beds/baths · city · reference · link.
 *   - NO invented "why it matches" reasons, no similarity scores, no ranking spin.
 *   - Returns "" when there is nothing real to insert — the caller shows an honest
 *     "no matches yet" note rather than inserting an empty or fabricated block.
 * The block is a drafting aid the operator always reviews/edits before sending.
 * The header is buyer-FACING (it goes into the client's message) so it is rendered
 * in the CLIENT's language via `altHeaderForLanguage`, not the operator's UI.
 */
export type AlternativeLabels = {
  /** Client-facing lead-in line, in the buyer's language (see altHeaderForLanguage). */
  header: string;
  /** Reference-number prefix, e.g. "Ref". */
  ref: string;
  priceOnRequest: string;
  bed: string;
  bath: string;
  studio: string;
};

/** Default number of properties inserted (matches the rail's featured + 2 shape). */
export const DEFAULT_ALTERNATIVES = 3;

// Maps a lead's detected language (a NAME like "norwegian", or already a code
// like "no") to one of the dashboard's supported locale codes.
const LANGUAGE_TO_LOCALE: Record<string, string> = {
  english: "en", spanish: "es", german: "de", french: "fr", italian: "it",
  dutch: "nl", portuguese: "pt", polish: "pl", russian: "ru", danish: "da",
  swedish: "sv", finnish: "fi", norwegian: "no",
  en: "en", es: "es", de: "de", fr: "fr", it: "it", nl: "nl", pt: "pt",
  pl: "pl", ru: "ru", da: "da", sv: "sv", fi: "fi", no: "no", nb: "no", nn: "no",
};

// Buyer-FACING header, per locale. This line is inserted into the reply the agent
// sends to the client, so it must read in the CLIENT's language and address them
// directly ("you") — never the operator's dashboard language, and never third
// person ("them"). Kept here rather than in the operator i18n namespace precisely
// because it is buyer-facing content and the client bundle only carries the
// operator's active locale (so another locale can't be looked up at runtime).
const ALT_HEADER_BY_LOCALE: Record<string, string> = {
  en: "A few options that may suit you:",
  es: "Algunas opciones que pueden encajarle:",
  de: "Einige Optionen, die zu Ihnen passen könnten:",
  fr: "Quelques biens susceptibles de vous convenir :",
  it: "Alcune opzioni che potrebbero fare al caso suo:",
  nl: "Enkele opties die bij u kunnen passen:",
  pt: "Algumas opções que podem ser do seu interesse:",
  da: "Nogle muligheder, der kan passe til dig:",
  no: "Noen alternativer som kan passe for deg:",
  sv: "Några alternativ som kan passa dig:",
  fi: "Muutama vaihtoehto, joka voisi sopia sinulle:",
  pl: "Kilka opcji, które mogą Panu/Pani odpowiadać:",
  ru: "Несколько вариантов, которые могут вам подойти:",
};

/**
 * The client-language header for the inserted block. Falls back to English for an
 * unknown / unsupported buyer language (the agent always edits before sending).
 */
export function altHeaderForLanguage(language: string | null | undefined): string {
  const key = (language ?? "").trim().toLowerCase();
  const locale = LANGUAGE_TO_LOCALE[key] ?? "en";
  return ALT_HEADER_BY_LOCALE[locale] ?? ALT_HEADER_BY_LOCALE.en;
}

// The three formatters below intentionally mirror the pure helpers in
// app/(app)/matches/_shared.tsx. They are re-implemented here (not imported) so
// this module stays dependency-free and unit-testable under the repo's aliasless
// vitest config — the same reason other pure modules here avoid `@/` value imports.
function fmtPrice(
  price: number | string | null,
  currency: string | null,
  priceOnRequest: string,
): string {
  if (price == null) return priceOnRequest;
  const sym = !currency || currency.toUpperCase() === "EUR" ? "€" : currency;
  const num = typeof price === "number" ? price : Number(price);
  const shown = Number.isFinite(num) ? num.toLocaleString("en-GB") : String(price);
  return `${sym}${shown}`;
}

function fmtBedsBaths(
  beds: number | null,
  baths: number | null,
  labels: { bed: string; bath: string; studio: string },
): string {
  if (beds === 0) return labels.studio;
  const parts: string[] = [];
  if (beds != null) parts.push(`${beds} ${labels.bed}`);
  if (baths != null) parts.push(`${baths} ${labels.bath}`);
  return parts.join(" · ");
}

function typeLabel(t: string | null): string {
  if (!t) return "";
  return t
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Build the insertable text block from real matches. Empty string when there is
 * nothing to insert (no matches, or limit <= 0). Never fabricates a property.
 */
export function buildAlternativesBlock(
  matches: Match[],
  labels: AlternativeLabels,
  limit: number = DEFAULT_ALTERNATIVES,
): string {
  const items = matches.slice(0, Math.max(0, limit));
  if (items.length === 0) return "";

  const blocks = items.map((m, i) => {
    const meta = [
      fmtPrice(m.price, m.price_currency, labels.priceOnRequest),
      typeLabel(m.property_type),
      fmtBedsBaths(m.bedrooms, m.bathrooms, labels),
      m.location_city,
      m.external_id ? `${labels.ref} ${m.external_id}` : null,
    ].filter((x): x is string => typeof x === "string" && x.trim().length > 0);

    const lines = [`${i + 1}. ${m.title}`];
    if (meta.length > 0) lines.push(`   ${meta.join(" · ")}`);
    if (m.source_url && m.source_url.trim().length > 0) {
      lines.push(`   ${m.source_url.trim()}`);
    }
    return lines.join("\n");
  });

  return `${labels.header}\n\n${blocks.join("\n\n")}`;
}

/**
 * Append the alternatives block to whatever is already in the draft, separated by
 * a blank line. Returns the draft unchanged when there is nothing to insert.
 */
export function appendAlternatives(currentDraft: string, block: string): string {
  if (!block) return currentDraft;
  const base = currentDraft.replace(/\s+$/, "");
  return base.length > 0 ? `${base}\n\n${block}` : block;
}
