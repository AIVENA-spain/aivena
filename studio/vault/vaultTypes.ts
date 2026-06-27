import { z } from "zod";

// ---- Font Vault (Stage 1) ----
// A local, approved font library with rich metadata, built ONLY from font files already present in
// studio/fonts (no downloads). `family` is read from the font name table (fontkit.familyName, which
// resolves the typographic-family name / nameID 16 with fallback to nameID 1) — never inferred from the
// filename. `display_name` is the human label (e.g. the name-table family "LCText400" -> "Libre Caslon Text").
//
// metrics carry the EXACT v1 resolver numbers under the dispatch's display names, so vault-backed scoring
// is byte-identical to the frozen v1 calibration. The bijection used by the adjudicator is:
//   cap_height <-> v1 capRatio,  x_height <-> v1 xRatio,  stem <-> v1 stemRatio,  contrast <-> v1 contrast.
// avg_width is descriptive only (advance-width/em) and is NOT used by scoring.

export const VaultCategory = z.enum(["serif", "sans", "display", "script", "mono"]);
export const VaultStatus = z.enum(["active", "seed_only", "rejected"]);

export const VaultMetrics = z.object({
  cap_height: z.number(), // = v1 capRatio (cap height / metric ref em)
  x_height: z.number(),   // = v1 xRatio (x-height / cap height)
  avg_width: z.number(),  // descriptive: mean lowercase advance width / em (not used by scoring)
  contrast: z.number(),   // = v1 contrast (stem/horizontal stroke ratio)
  stem: z.number(),       // = v1 stemRatio (stem / cap height)
});
export type VaultMetrics = z.infer<typeof VaultMetrics>;

export const VaultCharacters = z.object({
  latin_basic: z.boolean(),
  latin_ext_a: z.boolean(),
  covers: z.array(z.string()),
});

export const VaultEntry = z.object({
  id: z.string(),
  file: z.string(),
  family: z.string(),         // name-table family (fontkit.familyName) — also the render name resvg resolves
  display_name: z.string(),   // human-friendly label for reports
  weight: z.number().int().min(100).max(900),
  style: z.enum(["normal", "italic"]),
  category: VaultCategory,
  license: z.string(),        // recorded; "unverified" when not confirmed
  source: z.string(),
  production_safe: z.boolean(),
  status: VaultStatus,
  status_reason: z.string().nullable(),
  languages: z.array(z.string()),
  characters: VaultCharacters,
  metrics: VaultMetrics,
});
export type VaultEntry = z.infer<typeof VaultEntry>;

export const VaultFile = z.object({
  vault_version: z.string(),
  generated_by: z.string(),
  languages_tested: z.array(z.string()),
  fonts: z.array(VaultEntry).min(1),
});
export type VaultFile = z.infer<typeof VaultFile>;

// Target languages whose required character sets are tested against each font's cmap. A language is
// "covered" only if EVERY required code point has a glyph.
export const LANG_ORDER = ["en", "es", "de", "fr", "nl", "no"] as const;
export type Lang = (typeof LANG_ORDER)[number];

// Required code points per language (accents/diacritics + the basic Latin letters every language needs).
// EN needs only basic Latin; the rest add their accent set (upper + lower where used).
const BASIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const REQUIRED_CHARS: Record<Lang, string> = {
  en: BASIC,
  es: BASIC + "ñÑáéíóúüÁÉÍÓÚÜ¿¡",
  de: BASIC + "äöüÄÖÜß",
  fr: BASIC + "àâçéèêëîïôûùüÿœæÀÂÇÉÈÊËÎÏÔÛÙÜŸŒÆ",
  nl: BASIC + "ëéïöüáàè",
  no: BASIC + "æøåÆØÅ",
};

// The extended-character probe set surfaced into characters.covers (deduped, order-stable).
export const EXT_PROBE = ["ñ", "ä", "ö", "ü", "ß", "å", "ø", "æ", "ç", "é", "è", "ê", "ë", "ï", "î", "ô", "û", "ù", "œ", "Œ", "ÿ", "á", "í", "ó", "ú", "¿", "¡"];

// Latin Extended-A presence probe (œ/Œ live in Latin Extended-A; the rest of our accents are Latin-1 Sup).
export const LATIN_EXT_A_PROBE = ["œ", "Œ"];
