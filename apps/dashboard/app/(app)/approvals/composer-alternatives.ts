import type { Match } from "@/lib/api/types";

/**
 * Composer "insert alternatives" — turns REAL matched properties (the same
 * `get_lead_matches` rows the rail renders) into a plain-text block the operator
 * can drop into a reply draft. Honesty rules (Packet-2 lane):
 *   - Only real property FACTS: title · price · type · beds/baths · city · reference · link.
 *   - NO invented "why it matches" reasons, no similarity scores, no ranking spin.
 *   - Returns "" when there is nothing real to insert — the caller shows an honest
 *     "no matches yet" note rather than inserting an empty or fabricated block.
 * The block is a drafting aid the operator always reviews/edits before sending;
 * scaffold words (header/units) come from the operator's UI language.
 */
export type AlternativeLabels = {
  /** Lead-in line, e.g. "Properties that may suit them:" */
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
