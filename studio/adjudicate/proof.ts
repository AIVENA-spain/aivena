import path from "node:path";
import { RGBA } from "../src/lib/render";
import { inkBox, regionOf } from "../resolver/glyphMetrics";
import { makeOverlay, makeContactSheet } from "../resolver/proof";
import { LayerOutcome } from "./types";

async function sharpLib() { return (await import("sharp")).default; }

// red overlay raster of a candidate render, scaled into (tw,th)
function redScaledTo(candImg: RGBA, cb: { left: number; top: number; width: number; height: number }, tw: number, th: number): Buffer {
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = cb.top + Math.min(cb.height - 1, Math.floor((y * cb.height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = cb.left + Math.min(cb.width - 1, Math.floor((x * cb.width) / tw));
      const i = (sy * candImg.width + sx) * 4;
      const lum = 0.299 * candImg.data[i] + 0.587 * candImg.data[i + 1] + 0.114 * candImg.data[i + 2];
      const o = (y * tw + x) * 4;
      if (candImg.data[i + 3] > 0 && lum > 60) { out[o] = 255; out[o + 1] = 50; out[o + 2] = 50; out[o + 3] = 200; }
    }
  }
  return out;
}

function renderFor(o: LayerOutcome, family: string): RGBA | null {
  const r = o.renders.find((x) => (x.font.label || x.font.verified_family) === family);
  return r ? r.img : (o.renders[0]?.img ?? null);
}

// per-layer overlay (source crop vs selected/top render) + contact (source vs top-3 candidates)
export async function perLayerProof(sourceImg: RGBA, o: LayerOutcome, outDir: string): Promise<{ overlay: string; contact: string }> {
  const overlay = path.join(outDir, `${o.id}.overlay.png`);
  const contact = path.join(outDir, `${o.id}.contact.png`);
  const topImg = renderFor(o, o.rank1_font);
  if (o.srcBox && topImg) await makeOverlay(sourceImg, o.srcBox, topImg, overlay);
  const top3 = o.candidates.slice(0, 3).map((c) => ({ label: `${c.font}  score=${c.score}${c.font === o.rank1_font ? "  <= rank1" : ""}`, img: renderFor(o, c.font)! })).filter((t) => t.img);
  if (o.srcBox && top3.length) await makeContactSheet(sourceImg, o.srcBox, top3, contact);
  return { overlay: `${o.id}.overlay.png`, contact: `${o.id}.contact.png` };
}

// full-template proof: left = source.png; right = source with each editable layer's SELECTED font drawn
// in red at its manifest bbox (needs_seed layers use the top candidate, captioned). Proof-grade composite,
// NOT the production composition engine (Stage 3).
export async function beforeAfter(
  sourceRefPath: string, canvas: { width: number; height: number }, outcomes: LayerOutcome[], outPath: string,
): Promise<string> {
  const s = await sharpLib();
  const W = 420;
  const base = s(sourceRefPath).resize({ width: W });
  const meta = await base.metadata();
  const H = meta.height || Math.round((W * canvas.height) / canvas.width);
  const scale = W / canvas.width;
  const left = await s(sourceRefPath).resize({ width: W }).png().toBuffer();

  // right panel: resized source + red font overlays at each layer bbox
  const rightOverlays: any[] = [];
  for (const o of outcomes) {
    const img = renderFor(o, o.rank1_font);
    if (!img || !o.bbox) continue;
    const [bx0, by0, bx1, by1] = o.bbox;
    const tw = Math.max(1, Math.round((bx1 - bx0) * scale));
    const th = Math.max(1, Math.round((by1 - by0) * scale));
    const cb = inkBox(img, regionOf([0, 0, img.width - 1, img.height - 1]), 60) || { left: 0, top: 0, width: img.width, height: img.height };
    const red = redScaledTo(img, cb, tw, th);
    const redPng = await s(red, { raw: { width: tw, height: th, channels: 4 } }).png().toBuffer();
    rightOverlays.push({ input: redPng, left: Math.round(bx0 * scale), top: Math.round(by0 * scale) });
  }
  const right = await s(left).composite(rightOverlays).png().toBuffer();

  // assemble two panels + header + legend
  const headerH = 34, legendLineH = 22, legendH = legendLineH * (outcomes.length + 1) + 10;
  const gap = 16, pad = 10;
  const finalW = pad + W + gap + W + pad;
  const finalH = headerH + H + 8 + legendH + pad;
  let svg = `<svg width="${finalW}" height="${finalH}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<text x="${pad}" y="22" font-family="sans-serif" font-size="15" fill="#fff">SOURCE (original)</text>`;
  svg += `<text x="${pad + W + gap}" y="22" font-family="sans-serif" font-size="15" fill="#fff">ADJUDICATED — chosen fonts (red) at measured bboxes</text>`;
  let ly = headerH + H + 8 + 16;
  svg += `<text x="${pad}" y="${ly}" font-family="sans-serif" font-size="13" fill="#9aa">proof-grade overlay, not the production compositor:</text>`;
  for (const o of outcomes) {
    ly += legendLineH;
    const col = o.label === "needs_seed" ? "#ff6b6b" : o.label === "visual_substitute" ? "#ffd166" : "#7CFC00";
    const sel = o.selected_font || `${o.rank1_font} (top candidate)`;
    svg += `<text x="${pad}" y="${ly}" font-family="sans-serif" font-size="13" fill="${col}">${o.id} -> ${sel}  [${o.label}]${o.downgraded_by_guard ? "  (guard-downgraded)" : ""}</text>`;
  }
  svg += `</svg>`;

  await s({ create: { width: finalW, height: finalH, channels: 4, background: { r: 18, g: 18, b: 18, alpha: 1 } } })
    .composite([
      { input: left, left: pad, top: headerH },
      { input: right, left: pad + W + gap, top: headerH },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ]).png().toFile(outPath);
  return path.basename(outPath);
}
