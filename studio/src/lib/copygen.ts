import { loadLang, plural, formatNumber, formatPrice } from "./i18n";

// Provider boundary — production swaps these for Haiku / DeepL behind the SAME signatures.
// Everything downstream (fit engine, QA gates) consumes only the returned strings.
export interface CopyProvider {
  bodyVariants(facts: any, lang: string): Record<string, string>;
}
export interface TranslateProvider {
  titleType(facts: any, lang: string): string;
  titleAdjective(adj: string, lang: string): string;
  statWord(kind: "bedroom" | "bathroom", n: number, lang: string): string;
}

export const PROVIDER_LABEL = "deterministic_lexicon_proof";
export const PROVIDER_BANNER = "PROOF INFRASTRUCTURE — repeatable/testable copy, NOT final production wording. Production plugs Haiku/DeepL behind the same CopyProvider/TranslateProvider contract.";

const NBSP = " ";
const SQM = "m²"; // m²

function fill(tpl: string, vars: Record<string, any>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export class LocalDeterministic implements CopyProvider, TranslateProvider {
  readonly label = PROVIDER_LABEL;

  bodyVariants(facts: any, lang: string): Record<string, string> {
    const L = loadLang(lang);
    const beds = facts.bedrooms, baths = facts.bathrooms;
    const vars = {
      type: L.body_type[facts.property_type] || facts.property_type,
      city: facts.location?.city || "",
      size: `${formatNumber(L.locale, facts.size.built_sqm)}${NBSP}${SQM}`,
      beds, baths,
      bedroom: plural(beds, L.body_bedroom),
      bathroom: plural(baths, L.body_bathroom),
    };
    const out: Record<string, string> = {};
    for (const k of ["long", "medium", "short", "ultra_short"]) out[k] = fill(L.body[k], vars);
    return out;
  }

  titleType(facts: any, lang: string): string {
    const L = loadLang(lang);
    return L.title_type[facts.property_type] || facts.property_type;
  }
  titleAdjective(adj: string, lang: string): string {
    const L = loadLang(lang);
    return L.title_adjective[adj] || adj;
  }
  statWord(kind: "bedroom" | "bathroom", n: number, lang: string): string {
    const L = loadLang(lang);
    return plural(n, kind === "bedroom" ? L.stat_bedroom : L.stat_bathroom);
  }
}

// Stat value strings (exact facts; numerals never invented).
export function statValue(slot: any, facts: any, lang: string, provider: TranslateProvider): { text: string; value: any } | null {
  const L = loadLang(lang);
  if (slot.id === "stat_area") {
    const v = facts?.size?.built_sqm;
    if (v == null) return null;
    return { text: `${formatNumber(L.locale, v)} ${L.stat_unit_area}`, value: v };
  }
  if (slot.id === "stat_beds") {
    const v = facts?.bedrooms;
    if (v == null) return null;
    return { text: `${formatNumber(L.locale, v)} ${provider.statWord("bedroom", v, lang)}`, value: v };
  }
  if (slot.id === "stat_baths") {
    const v = facts?.bathrooms;
    if (v == null) return null;
    return { text: `${formatNumber(L.locale, v)} ${provider.statWord("bathroom", v, lang)}`, value: v };
  }
  if (slot.id === "price") {
    const amt = facts?.price?.amount;
    if (amt == null) return null; // missing => caller omits + flags
    return { text: formatPrice(L.locale, amt, facts.price.currency || "EUR"), value: amt };
  }
  return null;
}
