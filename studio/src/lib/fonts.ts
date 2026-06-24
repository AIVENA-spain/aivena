import fs from "node:fs";
import fontkit from "fontkit";
import { abs } from "./paths";

const fileCache = new Map<string, any>();
const familyCache = new Map<string, string>();

export function fontFile(manifest: any, fontKey: string): string {
  const rel = manifest?.fonts?.[fontKey];
  if (!rel) throw new Error(`Font key '${fontKey}' not declared in manifest.fonts`);
  const p = abs(rel);
  if (!fs.existsSync(p)) throw new Error(`Font file missing for '${fontKey}': ${p}`);
  return p;
}

export function openFont(manifest: any, fontKey: string): any {
  const p = fontFile(manifest, fontKey);
  if (!fileCache.has(p)) {
    try {
      fileCache.set(p, (fontkit as any).openSync(p));
    } catch (e: any) {
      throw new Error(`Unreadable font '${fontKey}' (${p}): ${e.message}`);
    }
  }
  return fileCache.get(p);
}

// resvg matches by the font's actual family name (e.g. LibreCaslonText resolves to "LCText400").
export function fontFamily(manifest: any, fontKey: string): string {
  const p = fontFile(manifest, fontKey);
  if (!familyCache.has(p)) familyCache.set(p, openFont(manifest, fontKey).familyName);
  return familyCache.get(p)!;
}

// Advance width (px) of a string at a size + per-letter tracking, computed from font metrics (no render).
export function advanceWidth(font: any, text: string, size: number, trackingPx = 0): number {
  const run = font.layout(text);
  let units = 0;
  for (const g of run.glyphs) units += g.advanceWidth;
  let px = (units * size) / font.unitsPerEm;
  if (text.length > 1) px += trackingPx * (text.length - 1);
  return px;
}

// Touching width (px): sum of per-glyph ink bbox widths at a size (spaces contribute ~0).
export function touchingWidth(font: any, text: string, size: number): number {
  const run = font.layout(text);
  let units = 0;
  for (const g of run.glyphs) {
    const bb = g.bbox;
    if (bb) units += Math.max(0, bb.maxX - bb.minX);
  }
  return (units * size) / font.unitsPerEm;
}

export function ascentPx(font: any, size: number): number {
  return (font.ascent * size) / font.unitsPerEm;
}
