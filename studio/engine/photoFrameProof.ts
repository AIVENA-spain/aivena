import { abs } from "../src/lib/paths";
import { renderEditable, loadEditableManifest, pickPhotos } from "./renderEditable";
import { deriveSlots, agencyPalette, applyDerived } from "./derive";
import { ensureImages, AGENCY, PROPS } from "./finalRender";

// PROOF: the engine honours per-photo MOVE/CROP (zoom + x/y) inside the frame.
async function main() {
  const sharp = (await import("sharp")).default;
  const p = PROPS[0];
  const imgs = await ensureImages(p);
  const id = "7"; // 4-photo template — framing differences are obvious

  const m: any = applyDerived(loadEditableManifest(`manifest/templates/${id}.editable.json`), deriveSlots(p, AGENCY, id));
  const palette = agencyPalette(m, AGENCY.brand ?? { navy: "#1F2933", gold: "#C2653A", cream: "#F4F2ED", text: "#4A4E57" });

  const base = await renderEditable(m, palette, await pickPhotos(m, imgs, id));
  // zoom into photo 0 and pan it right/down; leave the rest automatic
  const framed = await renderEditable(m, palette, await pickPhotos(m, imgs, id, { 0: { zoom: 2.2, x: 0.85, y: 0.8 } }));

  const A = await sharp(base.png).resize({ width: 420 }).png().toBuffer();
  const B = await sharp(framed.png).resize({ width: 420 }).png().toBuffer();
  const h = (await sharp(A).metadata()).height || 525;
  const bar = (t: string) => Buffer.from(`<svg width="420" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="30" fill="#111"/><text x="10" y="20" font-family="sans-serif" font-size="14" fill="#fff">${t}</text></svg>`);
  const out = abs("out/photo_frame_proof.png");
  await sharp({ create: { width: 870, height: h + 40, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } })
    .composite([
      { input: bar("AUTOMATIC framing"), left: 0, top: 0 }, { input: A, left: 0, top: 34 },
      { input: bar("photo 1 MOVED + ZOOMED (2.2x)"), left: 450, top: 0 }, { input: B, left: 450, top: 34 },
    ]).png().toFile(out);
  console.log("-> " + out);
}
main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
