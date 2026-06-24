import fs from "node:fs";
import { abs } from "./paths";
import { openFont } from "./fonts";

export function loadLang(lang: string): any {
  const p = abs(`i18n/${lang}.json`);
  if (!fs.existsSync(p)) throw new Error(`Language pack not found: ${lang}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function plural(n: number, forms: { one?: string; other?: string }): string {
  return n === 1 ? forms.one ?? forms.other ?? "" : forms.other ?? forms.one ?? "";
}

export function formatNumber(locale: string, n: number): string {
  return new Intl.NumberFormat(locale).format(n);
}
export function formatSizeBody(locale: string, sqm: number): string {
  // non-breaking space so "55 m²" never wraps
  return `${formatNumber(locale, sqm)} m²`;
}
export function formatSizeStat(locale: string, sqm: number, unit: string): string {
  return `${formatNumber(locale, sqm)} ${unit}`;
}
export function formatPrice(locale: string, amount: number, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

// Locale-aware segmentation into wrap units. Breaks only on the regular space (U+0020);
// non-breaking space (U+00A0) and punctuation stay glued to their word. Uses Intl.Segmenter
// (not a flat .split(" ")) so this generalises to locale word boundaries.
export function segmentWords(locale: string, text: string): string[] {
  const seg = new (Intl as any).Segmenter(locale, { granularity: "word" });
  const words: string[] = [];
  let cur = "";
  for (const s of seg.segment(text)) {
    const p = s.segment;
    if (p === " ") { if (cur) { words.push(cur); cur = ""; } }
    else cur += p;
  }
  if (cur) words.push(cur);
  return words;
}

export function glyphCoverage(manifest: any, fontKey: string, text: string): { ok: boolean; missing: string[] } {
  const f: any = openFont(manifest, fontKey);
  const missing = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 32 || cp === 10 || cp === 0x00a0) continue;
    if (!f.hasGlyphForCodePoint(cp)) missing.add(ch);
  }
  return { ok: missing.size === 0, missing: [...missing] };
}
