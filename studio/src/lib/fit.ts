import { openFont, advanceWidth, ascentPx } from "./fonts";
import { segmentWords, glyphCoverage } from "./i18n";

function descentPx(font: any, size: number): number {
  return (Math.abs(font.descent) * size) / font.unitsPerEm;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FitChoice {
  size: number; scaleX: number; tracking: number; line_spacing?: number;
  lines: string[]; variant?: string; box: number[]; score: number; breakdown: any;
}
export interface FitResult { ok: boolean; reason?: string; chosen?: FitChoice; rejected: any[]; }

// ---- TITLE: fit given 1-2 lines into the title safe area by size + condense (scaleX) ----
export function fitTitle(manifest: any, slot: any, lines: string[], lang: string): FitResult {
  const font = openFont(manifest, slot.font);
  const safe = manifest.safe_areas[slot.safe_area];
  const safeW = safe[2] - safe[0], safeH = safe[3] - safe[1];
  const sMin = slot.font_size.min, sMax = slot.font_size.max;
  const sxMin = slot.scaleX?.min ?? 1, sxMax = slot.scaleX?.max ?? 1;
  const gapRatio = ((slot.line_gap_ratio?.min ?? 0.9) + (slot.line_gap_ratio?.max ?? 0.9)) / 2;
  const rejected: any[] = [];

  // glyph coverage hard gate
  const cov = glyphCoverage(manifest, slot.font, lines.join(""));
  if (!cov.ok) return { ok: false, reason: `glyph_coverage: font ${slot.font} missing [${cov.missing.join("")}] for "${lines.join(" ")}"`, rejected };

  for (let size = sMax; size >= sMin; size -= 1) {
    const widest = Math.max(...lines.map((l) => advanceWidth(font, l, size, 0)));
    const sxNeeded = safeW / widest;
    if (sxNeeded < sxMin) { rejected.push({ size, why: "too wide even at min scaleX", sxNeeded: r2(sxNeeded) }); continue; }
    const scaleX = clamp(Math.min(sxNeeded, sxMax), sxMin, sxMax);
    const gap = size * gapRatio;
    const blockH = (lines.length - 1) * gap + ascentPx(font, size) + descentPx(font, size);
    if (blockH > safeH) { rejected.push({ size, why: "too tall", blockH: r2(blockH), safeH }); continue; }
    // score: prefer big size + scaleX near 1 + width fill
    const widthFill = (widest * scaleX) / safeW;
    const breakdown = {
      shrink: r2(((sMax - size) / (sMax - sMin)) * 30),
      condense: r2((1 - scaleX) * 40),
      underfill: r2((1 - widthFill) * 15),
    };
    const score = r2(100 - breakdown.shrink - breakdown.condense - breakdown.underfill);
    return { ok: true, chosen: { size: r2(size), scaleX: r2(scaleX), tracking: 0, lines, box: safe, score, breakdown }, rejected };
  }
  return { ok: false, reason: `title does not fit safe area within size[${sMin},${sMax}] / scaleX[${sxMin},${sxMax}]`, rejected };
}

function greedyWrap(font: any, words: string[], size: number, tracking: number, maxW: number): string[] {
  const lines: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const test = [...cur, w];
    if (cur.length === 0 || advanceWidth(font, test.join(" "), size, tracking) <= maxW) cur = test;
    else { lines.push(cur.join(" ")); cur = [w]; }
  }
  if (cur.length) lines.push(cur.join(" "));
  return lines;
}
function widowFix(lines: string[]): string[] {
  if (lines.length < 2) return lines;
  const last = lines[lines.length - 1], prev = lines[lines.length - 2];
  if (last.split(" ").length === 1 && prev.split(" ").length > 1) {
    const pw = prev.split(" ");
    const moved = pw.pop()!;
    return [...lines.slice(0, -2), pw.join(" "), moved + " " + last];
  }
  return lines;
}

// ---- BODY: choose richest variant that fits PREMIUM; wrap + size + scoring; fail-closed ----
export function fitBody(manifest: any, slot: any, variants: Record<string, string>, lang: string, locale: string, noWidow = false): FitResult {
  const font = openFont(manifest, slot.font);
  const safe = manifest.safe_areas[slot.safe_area];
  const [bx, , bw] = slot.box;
  const sMin = slot.font_size.min, sMax = slot.font_size.max;
  const order: string[] = slot.fallback_variants || ["long", "medium", "short", "ultra_short"];
  const richness: Record<string, number> = { long: 10, medium: 6, short: 2, ultra_short: 0 };
  const rejected: any[] = [];
  const candidates: FitChoice[] = [];

  for (const variant of order) {
    const text = variants[variant];
    if (text == null) continue;
    const cov = glyphCoverage(manifest, slot.font, text);
    if (!cov.ok) { rejected.push({ variant, why: "glyph_coverage", missing: cov.missing }); continue; }
    const words = segmentWords(locale, text);
    let best: FitChoice | null = null;
    for (let size = sMax; size >= sMin; size -= 1) {
      const lineSpacing = clamp(Math.round(size * 1.29), slot.line_spacing.min, slot.line_spacing.max);
      let lines = greedyWrap(font, words, size, 0, bw);
      if (slot.qa_checks?.includes("no_orphan") && !noWidow) lines = widowFix(lines);
      if (lines.length > slot.max_lines) continue;
      const widths = lines.map((l) => advanceWidth(font, l, size, 0));
      if (Math.max(...widths) > bw + 0.5) continue;
      const topBaseline = slot.baseline_last - (lines.length - 1) * lineSpacing;
      const topY = topBaseline - ascentPx(font, size);
      const bottomY = slot.baseline_last + descentPx(font, size);
      if (topY < safe[1] - 0.5 || bottomY > safe[3] + 0.5) continue;
      const lastWords = lines[lines.length - 1].split(" ").length;
      const orphan = lines.length > 1 && lastWords === 1;
      const breakdown = {
        shrink: r2(((sMax - size) / (sMax - sMin)) * 28),
        balance: r2((stdev(widths) / bw) * 100 * 0.6),
        orphan: orphan ? 20 : 0,
        lines_penalty: r2((lines.length / slot.max_lines) * 4),
        richness_bonus: richness[variant] ?? 0,
      };
      const score = r2(100 - breakdown.shrink - breakdown.balance - breakdown.orphan - breakdown.lines_penalty + breakdown.richness_bonus);
      best = { size: r2(size), scaleX: 1, tracking: 0, line_spacing: lineSpacing, lines, variant, box: slot.box, score, breakdown };
      break; // largest size that fits for this variant
    }
    if (best) { candidates.push(best); }
    else rejected.push({ variant, why: "does not fit at any size within limits" });
  }

  if (candidates.length === 0) {
    return { ok: false, reason: `body: no variant fits the box at any size [${sMin},${sMax}] within ${slot.max_lines} lines (overflow)`, rejected };
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates[0];
  // reject any orphan-only outcome if the winner still orphans (hard fail-closed)
  if (chosen.breakdown.orphan > 0) {
    return { ok: false, reason: `body: best layout still has a one-word orphan line (variant ${chosen.variant})`, rejected: [...rejected, ...candidates] };
  }
  return { ok: true, chosen, rejected: [...rejected, ...candidates.slice(1)] };
}
