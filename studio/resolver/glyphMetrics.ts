import { renderNaturalPng, renderTemplatePng, pngToRGBA, RGBA } from "../src/lib/render";
import { lumaAt } from "../src/lib/ink";

export type Region = { x0: number; y0: number; x1: number; y1: number };
export function regionOf(a: number[]): Region { return { x0: a[0], y0: a[1], x1: a[2], y1: a[3] }; }

function clamp(r: Region, w: number, h: number): Region {
  return { x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(w - 1, Math.ceil(r.x1)), y1: Math.min(h - 1, Math.ceil(r.y1)) };
}
function isInk(img: RGBA, x: number, y: number, T: number): boolean {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
  const i = (y * img.width + x) * 4;
  return img.data[i + 3] > 0 && lumaAt(img.data, i) > T;
}
function median(xs: number[]): number { if (!xs.length) return 0; const a = [...xs].sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; }

export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number; count: number; }
export function inkBox(img: RGBA, reg: Region, T: number): Box | null {
  const r = clamp(reg, img.width, img.height);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (isInk(img, x, y, T)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; n++; }
  if (!n) return null;
  return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1, count: n };
}

// cap/x height robust to descenders: top = global min ink row; baseline = median per-column bottom.
export function metricHeight(img: RGBA, reg: Region, T: number): { height: number; top: number; baseline: number; left: number; right: number } | null {
  const full = inkBox(img, reg, T); if (!full) return null;
  const bottoms: number[] = [];
  for (let x = full.left; x <= full.right; x++) for (let y = reg.y1 | 0; y >= (reg.y0 | 0); y--) if (isInk(img, x, y, T)) { bottoms.push(y); break; }
  const baseline = median(bottoms);
  return { height: baseline - full.top, top: full.top, baseline, left: full.left, right: full.right };
}

// peak ink luma in a region (brightest stroke). A title dimmed by an overlay peaks well below 255.
export function peakLuma(img: RGBA, reg: Region): number {
  const r = clamp(reg, img.width, img.height);
  let mx = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const i = (y * img.width + x) * 4; if (img.data[i + 3] > 0) { const l = lumaAt(img.data, i); if (l > mx) mx = l; } }
  return mx;
}
// opacity/hairline-aware threshold: k * THIS image's own ink peak, so a dimmed source and a crisp
// candidate are measured at the same relative stroke extent (recovers hairlines a fixed cut drops).
export function relThreshold(img: RGBA, reg: Region, k = 0.5, floor = 40): number {
  return Math.max(floor, peakLuma(img, reg) * k);
}
// ink pixel count above a threshold in a region (used by the measurement self-check)
export function inkCount(img: RGBA, reg: Region, T: number): number {
  const r = clamp(reg, img.width, img.height); let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (isInk(img, x, y, T)) n++;
  return n;
}

export interface Features { metricH: number; stem: number; contrast: number; stemRatio: number; peak: number; threshold: number; ink_low: number; ink_high: number; }
// clean feature measurement on one already-isolated line/glyph region at supersample, adaptive threshold.
export function measureFeatures(img: RGBA, reg: Region, k = 0.5): Features | null {
  const peak = peakLuma(img, reg);
  if (peak < 1) return null;
  const T = Math.max(40, peak * k);
  const mh = metricHeight(img, reg, T);
  if (!mh || mh.height < 3) return null;
  const sm = strokeMetrics(img, regionOf([mh.left, mh.top, mh.right, mh.baseline]), T);
  return { metricH: mh.height, stem: sm.stem, contrast: sm.contrast, stemRatio: sm.stem / mh.height, peak, threshold: T, ink_low: inkCount(img, reg, peak * 0.35), ink_high: inkCount(img, reg, peak * 0.7) };
}

// isolate the first/densest single text line in a (possibly multi-line) region via horizontal projection
export function detectLine(img: RGBA, reg: Region, T: number): Region | null {
  const r = clamp(reg, img.width, img.height);
  const rowInk: number[] = [];
  let mx = 0;
  for (let y = r.y0; y <= r.y1; y++) { let c = 0; for (let x = r.x0; x <= r.x1; x++) if (isInk(img, x, y, T)) c++; rowInk.push(c); if (c > mx) mx = c; }
  if (mx === 0) return null;
  const thr = mx * 0.18;
  let top = -1, bottom = -1;
  for (let i = 0; i < rowInk.length; i++) {
    if (rowInk[i] >= thr) { if (top < 0) top = i; bottom = i; }
    else if (top >= 0 && i - bottom > 3 && bottom - top >= 5) break; // end of first line band
  }
  if (top < 0 || bottom - top < 5) return null;
  return { x0: r.x0, y0: r.y0 + top, x1: r.x1, y1: r.y0 + bottom };
}

// stroke metrics over a region: stem = median horizontal ink-run (≈ vertical-stroke thickness),
// horiz = median vertical ink-run (≈ horizontal-stroke thickness), contrast = stem/horiz.
export function strokeMetrics(img: RGBA, reg: Region, T: number): { stem: number; horiz: number; contrast: number } {
  const r = clamp(reg, img.width, img.height);
  const hRuns: number[] = [], vRuns: number[] = [];
  for (let y = r.y0; y <= r.y1; y++) { let run = 0; for (let x = r.x0; x <= r.x1; x++) { if (isInk(img, x, y, T)) run++; else { if (run) hRuns.push(run); run = 0; } } if (run) hRuns.push(run); }
  for (let x = r.x0; x <= r.x1; x++) { let run = 0; for (let y = r.y0; y <= r.y1; y++) { if (isInk(img, x, y, T)) run++; else { if (run) vRuns.push(run); run = 0; } } if (run) vRuns.push(run); }
  const stem = median(hRuns), horiz = median(vRuns);
  return { stem, horiz, contrast: horiz > 0 ? stem / horiz : 1 };
}

// ---- rendering ----
const PAD = 120;
export function stringSVG(family: string, text: string, size: number, scaleX = 1): { svg: string; W: number; H: number } {
  const W = Math.ceil(size * Math.max(8, text.length) * 1.2 + PAD * 2);
  const H = Math.ceil(size * 2.6 + PAD * 2);
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = `<g transform="translate(${PAD},${PAD + size}) scale(${scaleX},1)"><text x="0" y="0" font-family="${family}" font-size="${size}" fill="#ffffff">${esc}</text></g>`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/>${body}</svg>`, W, H };
}
export async function renderStringRGBA(family: string, text: string, size: number, scaleX = 1): Promise<RGBA> {
  const { svg } = stringSVG(family, text, size, scaleX);
  return pngToRGBA(renderNaturalPng(svg, "#000000"), true);
}
// §3.1 measurement render: suppress the dimming overlay (the film/photo raster) so the white text
// underneath is measured at full strength (recovers hairlines a film differentially erases). Global —
// applies to every template that layers a raster overlay over its type.
export async function renderSourcePng(svgPath: string, outWidth: number, suppressOverlay = false): Promise<RGBA> {
  const fs = await import("node:fs");
  let svg = fs.readFileSync(svgPath, "utf8");
  if (suppressOverlay) svg = svg.replace(/<image\b[^>]*\/>/g, "").replace(/<image\b[^>]*>[\s\S]*?<\/image>/g, "");
  return pngToRGBA(renderTemplatePng(svg, outWidth, "#000000"), true);
}
export async function loadPng(pngPath: string): Promise<RGBA> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(pngPath).flatten({ background: { r: 0, g: 0, b: 0 } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: data as Buffer, width: info.width, height: info.height };
}
