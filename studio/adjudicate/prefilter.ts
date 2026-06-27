import fontkit from "fontkit";
import { RGBA } from "../src/lib/render";
import { LayerSpec } from "../resolver/types";
import { LibFont, abs } from "../resolver/fontLibrary";
import { VaultEntry } from "../vault/vaultTypes";
import { regionOf, relThreshold, detectLine, measureFeatures } from "../resolver/glyphMetrics";
import { Shortlisted } from "./types";

// Map a vault entry to a v1 LibFont so the visual matcher (resolveLayer) scores byte-identically to the
// frozen calibration. metrics are the v1 numbers under the vault's display names (see vaultTypes.ts).
export function vaultToLibFont(e: VaultEntry): LibFont {
  return {
    id: e.id, declared_family: e.family, label: e.display_name, file: e.file,
    category: e.category as any, weight: e.weight, style: e.style as any, license_ok: e.production_safe,
    verified_family: e.family,
    metrics: { capRatio: e.metrics.cap_height, xRatio: e.metrics.x_height, stemRatio: e.metrics.stem, contrast: e.metrics.contrast },
  };
}

export interface SourceCoarse { contrast: number; stemRatio: number; metricH: number; peak: number; inferred_category: "sans" | "serif"; }

// Measure the source layer's coarse metrics ONCE with the exact v1 method (adaptive threshold + line
// isolation for features mode). Used to band pre-filter candidates.
export function measureSourceCoarse(sourceImg: RGBA, layer: LayerSpec, ss: number, k: number): SourceCoarse | null {
  const b0 = layer.ref_glyph_bbox || layer.layer_bbox;
  const fullRegion = regionOf([b0[0] * ss, b0[1] * ss, b0[2] * ss, b0[3] * ss]);
  const srcT0 = relThreshold(sourceImg, fullRegion, k);
  const region = layer.match_mode === "metric" ? (detectLine(sourceImg, fullRegion, srcT0) || fullRegion) : fullRegion;
  const feat = measureFeatures(sourceImg, region, k);
  if (!feat) return null;
  return { contrast: feat.contrast, stemRatio: feat.stemRatio, metricH: feat.metricH, peak: feat.peak, inferred_category: feat.contrast < 1.35 ? "sans" : "serif" };
}

const _fkCache: Record<string, any> = {};
function openFk(file: string): any {
  if (!_fkCache[file]) _fkCache[file] = (fontkit as any).openSync(abs(file));
  return _fkCache[file];
}
function cmapCovers(entry: VaultEntry, required: string[]): boolean {
  const f = openFk(entry.file);
  for (const ch of required) if (!f.hasGlyphForCodePoint(ch.codePointAt(0)!)) return false;
  return true;
}

export interface PrefilterResult { shortlist: Shortlisted[]; log: string[]; source: SourceCoarse | null; }

// Stage-1 cheap pre-filter: PERMISSIVE. Drops only obviously-wrong fonts and caps the shortlist.
// Keep a font iff: category matches (skip if "any"); cmap covers the required characters; coarse metrics
// fall within GENEROUS bands of the source. Never drop a viable candidate (bands are wide; guard re-checks).
export function prefilter(
  sourceImg: RGBA, v1layer: LayerSpec, intakeCategories: VaultEntry["category"][] | "any",
  requiredChars: string[], activeEntries: VaultEntry[], ss: number, k: number,
  opts: { bandFactor?: number; cap?: number } = {},
): PrefilterResult {
  const bandFactor = opts.bandFactor ?? 3.0;
  const cap = opts.cap ?? 12;
  const log: string[] = [];
  const src = measureSourceCoarse(sourceImg, v1layer, ss, k);
  if (!src) { log.push(`[prefilter ${v1layer.layer_id}] source measurement failed`); return { shortlist: [], log, source: null }; }
  log.push(`[prefilter ${v1layer.layer_id}] source coarse: contrast=${src.contrast.toFixed(2)} stemRatio=${src.stemRatio.toFixed(3)} inferred=${src.inferred_category} band=${bandFactor}x`);

  const inBand = (cand: number, ref: number) => ref <= 0 || (cand >= ref / bandFactor && cand <= ref * bandFactor);
  const kept: Shortlisted[] = [];
  for (const e of activeEntries) {
    const catOk = intakeCategories === "any" || intakeCategories.includes(e.category);
    const covOk = cmapCovers(e, requiredChars);
    const cOk = inBand(e.metrics.contrast, src.contrast);
    const sOk = inBand(e.metrics.stem, src.stemRatio);
    const keep = catOk && covOk && cOk && sOk;
    log.push(`   ${keep ? "keep" : "drop"}  ${e.id.padEnd(22)} cat=${e.category}(${catOk?"y":"n"}) cmap=${covOk?"y":"n"} contrast=${e.metrics.contrast.toFixed(2)}(${cOk?"y":"n"}) stem=${e.metrics.stem.toFixed(3)}(${sOk?"y":"n"})`);
    if (keep) kept.push({ entry: e, lib: vaultToLibFont(e) });
  }
  // permissive cap: keep the closest-by-contrast if more than `cap` survive (never binds at current scale)
  if (kept.length > cap) {
    kept.sort((a, b) => Math.abs(a.entry.metrics.contrast - src.contrast) - Math.abs(b.entry.metrics.contrast - src.contrast));
    log.push(`   shortlist capped ${kept.length} -> ${cap}`);
    kept.length = cap;
  }
  return { shortlist: kept, log, source: src };
}

// required-character set for a layer: the layer text if known, else a basic-Latin sample; plus the
// language's accent set if a language tag is present.
export function requiredCharsFor(text: string | null, langAccents: string | null): string[] {
  const base = text && text.trim() ? text : "AEHRanoxgy";
  const set = new Set<string>();
  for (const ch of base) if (ch.trim()) set.add(ch);
  if (langAccents) for (const ch of langAccents) set.add(ch);
  return [...set];
}
