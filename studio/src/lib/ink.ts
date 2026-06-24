import type { RGBA } from "./render";

export interface Region { x0: number; y0: number; x1: number; y1: number; }
export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number; count: number; }

export function lumaAt(d: Buffer, idx: number): number {
  return 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
}

export function regionFromArray(a: number[]): Region {
  return { x0: a[0], y0: a[1], x1: a[2], y1: a[3] };
}

function clampRegion(r: Region, w: number, h: number): Region {
  return {
    x0: Math.max(0, Math.floor(r.x0)),
    y0: Math.max(0, Math.floor(r.y0)),
    x1: Math.min(w - 1, Math.ceil(r.x1)),
    y1: Math.min(h - 1, Math.ceil(r.y1)),
  };
}

function isInk(img: RGBA, x: number, y: number, T: number): boolean {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
  const idx = (y * img.width + x) * 4;
  return img.data[idx + 3] > 0 && lumaAt(img.data, idx) > T;
}

export function inkBox(img: RGBA, reg: Region, T: number): Box | null {
  const r = clampRegion(reg, img.width, img.height);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  for (let y = r.y0; y <= r.y1; y++) {
    const row = y * img.width * 4;
    for (let x = r.x0; x <= r.x1; x++) {
      const idx = row + x * 4;
      if (img.data[idx + 3] > 0 && lumaAt(img.data, idx) > T) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1, count };
}

function colInk(img: RGBA, r: Region, T: number): number[] {
  const cols = new Array(r.x1 - r.x0 + 1).fill(0);
  for (let y = r.y0; y <= r.y1; y++) {
    const row = y * img.width * 4;
    for (let x = r.x0; x <= r.x1; x++) {
      const idx = row + x * 4;
      if (img.data[idx + 3] > 0 && lumaAt(img.data, idx) > T) cols[x - r.x0]++;
    }
  }
  return cols;
}

// [c0,c1] x-range of the leftmost glyph cluster (a horizontal gap > gapPx ends the glyph).
export function firstGlyphX(img: RGBA, reg: Region, T: number, gapPx = 5): [number, number] | null {
  const r = clampRegion(reg, img.width, img.height);
  const cols = colInk(img, r, T);
  let c0 = -1;
  for (let i = 0; i < cols.length; i++) if (cols[i] > 0) { c0 = i; break; }
  if (c0 < 0) return null;
  let c1 = c0, gap = 0;
  for (let i = c0; i < cols.length; i++) {
    if (cols[i] > 0) { c1 = i; gap = 0; }
    else { gap++; if (gap > gapPx) break; }
  }
  return [r.x0 + c0, r.x0 + c1];
}

export interface TitleMetrics {
  ink_left: number; cap_top: number; baseline: number; cap_height: number; width: number; right: number;
  left: number; top: number; bottom: number;
}

// Title (mixed-case) word measurement, robust to descenders ('y','p') and a small neighbour-line
// intrusion. The measure_region must already isolate this line in Y (caps tallest -> top = cap apex;
// baseline = MEDIAN per-column bottom, so a minority of descender columns cannot move it).
export function measureTitleWord(img: RGBA, reg: Region, T: number): TitleMetrics | null {
  const r = clampRegion(reg, img.width, img.height);
  const full = inkBox(img, r, T);
  if (!full) return null;
  const cap_top = full.top; // global highest ink = the cap apex (caps are the tallest glyphs in the word)
  const bottoms: number[] = [];
  for (let x = full.left; x <= full.right; x++) {
    for (let y = r.y1; y >= r.y0; y--) {
      const idx = (y * img.width + x) * 4;
      if (img.data[idx + 3] > 0 && lumaAt(img.data, idx) > T) { bottoms.push(y); break; }
    }
  }
  if (bottoms.length === 0) return null;
  bottoms.sort((a, b) => a - b);
  const baseline = bottoms[Math.floor(bottoms.length / 2)]; // median bottom = the baseline (descenders are a minority)
  const band = inkBox(img, { x0: r.x0, y0: cap_top, x1: r.x1, y1: baseline }, T);
  if (!band) return null;
  const ink_left = band.left;
  const right = band.right;
  const width = right - ink_left + 1;
  const cap_height = baseline - cap_top;
  return { ink_left, cap_top, baseline, cap_height, width, right, left: ink_left, top: cap_top, bottom: baseline };
}

export interface ColourOpacity { r: number; g: number; b: number; opacity: number; n: number; }

export function colourOpacity(img: RGBA, reg: Region, T: number): ColourOpacity | null {
  const r = clampRegion(reg, img.width, img.height);
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  let lumaSum = 0, n = 0;
  for (let y = r.y0; y <= r.y1; y++) {
    const row = y * img.width * 4;
    for (let x = r.x0; x <= r.x1; x++) {
      const idx = row + x * 4;
      const l = lumaAt(img.data, idx);
      if (img.data[idx + 3] > 0 && l > T) { rs.push(img.data[idx]); gs.push(img.data[idx + 1]); bs.push(img.data[idx + 2]); lumaSum += l; n++; }
    }
  }
  if (n === 0) return null;
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
  return { r: med(rs), g: med(gs), b: med(bs), opacity: lumaSum / n / 255, n };
}

// Stroke-thickness proxy: median horizontal ink-run length in a region (content-independent-ish).
export function medianRunLength(img: RGBA, reg: Region, T: number): number | null {
  const r = clampRegion(reg, img.width, img.height);
  const runs: number[] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    const row = y * img.width * 4;
    let run = 0;
    for (let x = r.x0; x <= r.x1; x++) {
      const idx = row + x * 4;
      const ink = img.data[idx + 3] > 0 && lumaAt(img.data, idx) > T;
      if (ink) run++;
      else { if (run > 0) runs.push(run); run = 0; }
    }
    if (run > 0) runs.push(run);
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)];
}

// Full-image diff over two same-size renders: % of pixels whose luma differs by > lumaDelta.
export function fullImageDiffPct(a: RGBA, b: RGBA, lumaDelta: number): number {
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  let diff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
      if (Math.abs(lumaAt(a.data, ia) - lumaAt(b.data, ib)) > lumaDelta) diff++;
    }
  }
  return (diff / (w * h)) * 100;
}

// Tolerance-band crop mismatch %, source vs rebuild, aligned by ink-box top-left.
// A pixel counts as matched if the other image has ink within Chebyshev radius R. This tolerates
// sub-pixel/hairline stroke misregistration (high-contrast display fonts like Prata have 1-3px strokes,
// so a perfect-looking rebuild would otherwise score ~50% under a strict XOR) while still failing hard
// when letters are genuinely shifted (loose spacing, wrong weight) by more than R.
export function cropMismatchPct(src: RGBA, reb: RGBA, srcBox: Box, rebBox: Box, T: number, R = 2): number {
  const w = Math.max(srcBox.width, rebBox.width);
  const h = Math.max(srcBox.height, rebBox.height);
  const sMask = new Uint8Array(w * h), rMask = new Uint8Array(w * h);
  let sInk = 0, rInk = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isInk(src, srcBox.left + x, srcBox.top + y, T)) { sMask[y * w + x] = 1; sInk++; }
      if (isInk(reb, rebBox.left + x, rebBox.top + y, T)) { rMask[y * w + x] = 1; rInk++; }
    }
  }
  if (sInk + rInk === 0) return 100; // fail-closed: no ink at all is not a match
  const near = (mask: Uint8Array, x: number, y: number): boolean => {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) return true;
    }
    return false;
  };
  let unmatched = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sMask[y * w + x] && !near(rMask, x, y)) unmatched++;
      if (rMask[y * w + x] && !near(sMask, x, y)) unmatched++;
    }
  }
  return (unmatched / (sInk + rInk)) * 100;
}
