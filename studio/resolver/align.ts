import { RGBA } from "../src/lib/render";
import { lumaAt } from "../src/lib/ink";

export interface Mask { d: Uint8Array; w: number; h: number; }

export function toMask(img: RGBA, box: { left: number; top: number; width: number; height: number }, T: number): Mask {
  const d = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const sx = box.left + x, sy = box.top + y;
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
    const i = (sy * img.width + sx) * 4;
    if (img.data[i + 3] > 0 && lumaAt(img.data, i) > T) d[y * box.width + x] = 1;
  }
  return { d, w: box.width, h: box.height };
}

// nearest-neighbour resample of a mask to W x H (normalises size so shape can be compared)
export function scaleMask(m: Mask, W: number, H: number): Mask {
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const sy = Math.min(m.h - 1, Math.floor((y * m.h) / H)); for (let x = 0; x < W; x++) { const sx = Math.min(m.w - 1, Math.floor((x * m.w) / W)); d[y * W + x] = m.d[sy * m.w + sx]; } }
  return { d, w: W, h: H };
}

// best IoU of two equal-size masks over a small dx,dy shift (translation tolerance)
export function iouShift(a: Mask, b: Mask, maxShift: number): { iou: number; xorUnion: number; dx: number; dy: number } {
  let best = { iou: 0, xorUnion: 1, dx: 0, dy: 0 };
  for (let dy = -maxShift; dy <= maxShift; dy += 2) for (let dx = -maxShift; dx <= maxShift; dx += 2) {
    let inter = 0, uni = 0;
    for (let y = 0; y < a.h; y++) { const by = y + dy; if (by < 0 || by >= b.h) { for (let x = 0; x < a.w; x++) if (a.d[y * a.w + x]) uni++; continue; }
      for (let x = 0; x < a.w; x++) { const av = a.d[y * a.w + x]; const bx = x + dx; const bv = bx >= 0 && bx < b.w ? b.d[by * b.w + bx] : 0; if (av || bv) uni++; if (av && bv) inter++; } }
    const iou = uni ? inter / uni : 0;
    if (iou > best.iou) best = { iou, xorUnion: uni ? 1 - inter / uni : 1, dx, dy };
  }
  return best;
}

export function maskCount(m: Mask): number { let n = 0; for (let i = 0; i < m.d.length; i++) n += m.d[i]; return n; }
