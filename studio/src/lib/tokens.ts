import fs from "node:fs";
import { abs } from "./paths";

export function loadPalette(name: string): any {
  const p = abs(`palettes/${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`Palette not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function resolveToken(palette: any, manifest: any, token: string): { hex: string; opacity: number } {
  const t = palette.tokens?.[token];
  if (t) return { hex: t.hex, opacity: t.opacity ?? 1 };
  const d = manifest.colour_tokens?.[token];
  if (d) return { hex: d.default, opacity: 1 };
  throw new Error(`Unknown colour token '${token}'`);
}

export function isLockedToken(palette: any, manifest: any, token: string): boolean {
  if (manifest.colour_tokens?.[token]?.locked) return true;
  return (palette.locked_tokens || []).includes(token);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function srgbToLin(c: number): number {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
export function relLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const L1 = relLuminance(...a), L2 = relLuminance(...b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
