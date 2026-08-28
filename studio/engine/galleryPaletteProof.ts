import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { renderEditable, loadEditableManifest, pickPhotos } from "./renderEditable";
import { deriveSlots, agencyPalette, applyDerived, BrandColours } from "./derive";
import { ensureImages, AGENCY, PROPS } from "./finalRender";

// PROOF: render every editable template in the GALLERY scheme — a NEUTRAL base with ONE accent that SHIFTS per
// tile — so I can eyeball that the grid looks designed (Christian's "neutral colors with changing the tone of
// pop"). Mirrors studio-editable.ts GALLERY_NEUTRAL / galleryAccent / galleryAccentOverrides EXACTLY.

const EDITABLE_TEMPLATE_IDS = ['1','2','3','5','6','7','8','10','11','14','21','22','24','25','26','27','28'];
const GALLERY_NEUTRAL: BrandColours = { navy: '#1F2933', gold: '#8A8F98', cream: '#F4F2ED', text: '#4A4E57' };
const GALLERY_ACCENTS = ['#C2653A','#5C7A5A','#4F7391','#B0873C','#8A5A78','#3F7A75','#A24A46','#5B6BA0'];
const accent = (i: number) => GALLERY_ACCENTS[((i % GALLERY_ACCENTS.length) + GALLERY_ACCENTS.length) % GALLERY_ACCENTS.length];
const accentOverrides = (hex: string) => ({ accent: hex, 'badge.fill': hex, 'badge.text': '#FFFFFF' });

async function renderGalleryTile(p: any, templateId: string, imgs: string[], i: number) {
  const m: any = applyDerived(loadEditableManifest(`manifest/templates/${templateId}.editable.json`), deriveSlots(p, AGENCY, templateId));
  const photos = await pickPhotos(m, imgs, templateId);
  const hex = accent(i);
  const palette = m.palette_locked ? {} : { ...agencyPalette(m, { ...GALLERY_NEUTRAL, gold: hex }), ...accentOverrides(hex) };
  const r = await renderEditable(m, palette, photos);
  return r.png as Buffer;
}

async function labelBar(sharp: any, w: number, text: string, h = 30, fsz = 14) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#111"/><text x="10" y="${h / 2 + fsz / 3}" font-family="sans-serif" font-size="${fsz}" fill="#fff">${text.replace(/&/g, "&amp;")}</text></svg>`);
}

async function main() {
  const sharp = (await import("sharp")).default;
  const primary = PROPS[0];
  const imgs = await ensureImages(primary);

  const tiles: { id: string; png: Buffer }[] = [];
  for (let i = 0; i < EDITABLE_TEMPLATE_IDS.length; i++) {
    const id = EDITABLE_TEMPLATE_IDS[i];
    try {
      const png = await renderGalleryTile(primary, id, imgs, i);
      tiles.push({ id, png });
      console.log(`  #${id} accent ${accent(i)} ok`);
    } catch (e: any) {
      console.log(`  #${id} FAILED: ${e.message}`);
    }
  }

  // contact sheet: 4 columns
  const cw = 300, gap = 14, cols = 4;
  const scaled = await Promise.all(tiles.map((t) => sharp(t.png).resize({ width: cw }).png().toBuffer()));
  const heights = await Promise.all(scaled.map(async (b) => (await sharp(b).metadata()).height || 375));
  const rows = Math.ceil(tiles.length / cols);
  const rowH: number[] = [];
  for (let r = 0; r < rows; r++) { let h = 0; for (let c = 0; c < cols; c++) { const idx = r * cols + c; if (idx < heights.length) h = Math.max(h, heights[idx]); } rowH.push(h); }
  const W = cols * cw + (cols + 1) * gap;
  const H = 40 + rowH.reduce((a, b) => a + b + 26 + gap, 0) + gap;
  const comps: any[] = [{ input: await labelBar(sharp, W, `GALLERY palette proof — ${primary.type} in ${primary.city} — neutral + shifting accent (${tiles.length} templates)`, 40, 15), left: 0, top: 0 }];
  let y = 40 + gap;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c; if (idx >= tiles.length) continue;
      const x = gap + c * (cw + gap);
      comps.push({ input: await labelBar(sharp, cw, `#${tiles[idx].id}  ${accent(idx)}`, 26, 13), left: x, top: y }, { input: scaled[idx], left: x, top: y + 26 });
    }
    y += rowH[r] + 26 + gap;
  }
  const out = abs(`out/gallery_palette_proof.png`);
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } }).composite(comps).png().toFile(out);
  console.log(`\n-> ${out}`);
}

main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
