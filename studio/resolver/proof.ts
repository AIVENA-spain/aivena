import { RGBA } from "../src/lib/render";
import { inkBox, regionOf } from "./glyphMetrics";

async function sharpLib() { return (await import("sharp")).default; }
function asSharp(s: any, img: RGBA) { return s(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }); }

// red ink overlay of a candidate render, scaled to (W,H)
function redScaled(candImg: RGBA, candBox: { left: number; top: number; width: number; height: number }, W: number, H: number): Buffer {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) { const sy = candBox.top + Math.min(candBox.height - 1, Math.floor((y * candBox.height) / H));
    for (let x = 0; x < W; x++) { const sx = candBox.left + Math.min(candBox.width - 1, Math.floor((x * candBox.width) / W));
      const i = (sy * candImg.width + sx) * 4; const lum = 0.299 * candImg.data[i] + 0.587 * candImg.data[i + 1] + 0.114 * candImg.data[i + 2];
      const o = (y * W + x) * 4; if (candImg.data[i + 3] > 0 && lum > 60) { out[o] = 255; out[o + 1] = 40; out[o + 2] = 40; out[o + 3] = 175; } } }
  return out;
}

export async function makeOverlay(source: RGBA, box: { left: number; top: number; width: number; height: number }, candImg: RGBA, outPath: string): Promise<void> {
  const s = await sharpLib();
  const pad = 16;
  const cx = Math.max(0, box.left - pad), cy = Math.max(0, box.top - pad);
  const cw = Math.min(source.width - cx, box.width + 2 * pad), ch = Math.min(source.height - cy, box.height + 2 * pad);
  const srcCrop = await asSharp(s, source).extract({ left: cx, top: cy, width: cw, height: ch }).png().toBuffer();
  const cb = inkBox(candImg, regionOf([0, 0, candImg.width - 1, candImg.height - 1]), 60) || { left: 0, top: 0, width: candImg.width, height: candImg.height };
  const red = redScaled(candImg, cb, box.width, box.height);
  const redPng = await s(red, { raw: { width: box.width, height: box.height, channels: 4 } }).png().toBuffer();
  await s(srcCrop).composite([{ input: redPng, left: pad, top: pad }]).png().toFile(outPath);
}

export async function makeContactSheet(source: RGBA, box: { left: number; top: number; width: number; height: number }, top: { label: string; img: RGBA }[], outPath: string): Promise<void> {
  const s = await sharpLib();
  const rowH = Math.max(48, Math.min(110, box.height + 8));
  const W = 760, LBL = 26, GAP = 8;
  const rows = top.length + 1;
  const H = rows * (rowH + LBL) + GAP * (rows + 1) + 30;
  const comps: any[] = [];
  // NB: no full-canvas <rect> here — the base canvas already supplies the dark background; an opaque rect
  // composited on top would black out the crops.
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20" font-family="sans-serif" font-size="14" fill="#fff">resolver contact — SOURCE (top) vs top candidates at matched cap-height</text>`;
  // source row
  const cx = Math.max(0, box.left - 6), cy = Math.max(0, box.top - 6), cw = Math.min(source.width - cx, box.width + 12), chh = Math.min(source.height - cy, box.height + 12);
  const srcCrop = await asSharp(s, source).extract({ left: cx, top: cy, width: cw, height: chh }).resize({ height: rowH, width: W - 20, fit: "inside" }).png().toBuffer();
  let y = 30 + GAP;
  comps.push({ input: srcCrop, left: 10, top: y + LBL });
  svg += `<text x="10" y="${y + 18}" font-family="sans-serif" font-size="13" fill="#7CFC00">SOURCE</text>`;
  y += rowH + LBL + GAP;
  for (const t of top) {
    const cb = inkBox(t.img, regionOf([0, 0, t.img.width - 1, t.img.height - 1]), 60) || { left: 0, top: 0, width: t.img.width, height: t.img.height };
    const crop = await asSharp(s, t.img).extract({ left: cb.left, top: cb.top, width: cb.width, height: cb.height }).resize({ height: rowH, width: W - 20, fit: "inside" }).png().toBuffer();
    comps.push({ input: crop, left: 10, top: y + LBL });
    svg += `<text x="10" y="${y + 18}" font-family="sans-serif" font-size="13" fill="#d0d0d0">${t.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
    y += rowH + LBL + GAP;
  }
  svg += `</svg>`;
  await s({ create: { width: W, height: H, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } }).composite([...comps, { input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(outPath);
}
