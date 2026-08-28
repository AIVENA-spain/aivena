import fs from "node:fs";
import { abs } from "../src/lib/paths";
import { renderEditable, loadEditableManifest } from "./renderEditable";
import { deriveSlots, agencyPalette, applyDerived } from "./derive";
import { ensureImages, AGENCY, PROPS } from "./finalRender";
import { pickPhotos } from "./renderEditable";

// PROOF: the engine honours interactive-editor MOVE (position override) + RESIZE (size override).
async function main() {
  const sharp = (await import("sharp")).default;
  const p = PROPS[0];
  const imgs = await ensureImages(p);
  const id = "5"; // dark luxury card with title/price/stats

  const m0 = applyDerived(loadEditableManifest(`manifest/templates/${id}.editable.json`), deriveSlots(p, AGENCY, id));
  const palette = agencyPalette(m0, AGENCY.brand ?? { navy: "#1F2933", gold: "#C2653A", cream: "#F4F2ED", text: "#4A4E57" });
  const photos = await pickPhotos(m0, imgs, id);

  const base = await renderEditable(m0, palette, photos);
  console.log(`canvas ${base.width}x${base.height}`);
  console.log("slots:", base.layout.map((l) => `${l.id} bbox=[${l.bbox.map((n) => Math.round(n)).join(",")}] size=${l.size}`).join("\n       "));

  // pick a title-ish slot + a price/stat slot from the layout
  const titleSlot = base.layout.find((l) => /title|line1|luxury|type/.test(l.id)) || base.layout[0];
  const otherSlot = base.layout.find((l) => /price|value|stat/.test(l.id) && l.id !== titleSlot.id) || base.layout[1];

  const pos: Record<string, { x: number; y: number }> = {};
  pos[titleSlot.id] = { x: titleSlot.bbox[0] + 90, y: titleSlot.bbox[1] + 160 }; // move down + right
  const size: Record<string, number> = {};
  size[otherSlot.id] = Math.round(otherSlot.size * 1.7); // enlarge

  const edited = await renderEditable(m0, palette, photos, { pos, size });
  console.log(`MOVED ${titleSlot.id} → (${Math.round(pos[titleSlot.id].x)},${Math.round(pos[titleSlot.id].y)}); RESIZED ${otherSlot.id} ${otherSlot.size}→${size[otherSlot.id]}`);

  // verify the layout reflects the move + resize
  const el = edited.layout.find((l) => l.id === titleSlot.id)!;
  const er = edited.layout.find((l) => l.id === otherSlot.id)!;
  console.log(`after: ${titleSlot.id} bbox=[${el.bbox.map((n) => Math.round(n)).join(",")}]  ${otherSlot.id} size=${er.size}`);

  const A = await sharp(base.png).resize({ width: 420 }).png().toBuffer();
  const B = await sharp(edited.png).resize({ width: 420 }).png().toBuffer();
  const h = (await sharp(A).metadata()).height || 525;
  const bar = (t: string) => Buffer.from(`<svg width="420" height="30" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="30" fill="#111"/><text x="10" y="20" font-family="sans-serif" font-size="14" fill="#fff">${t}</text></svg>`);
  const out = abs("out/move_resize_proof.png");
  await sharp({ create: { width: 420 * 2 + 30, height: h + 40, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } })
    .composite([
      { input: bar("ORIGINAL"), left: 0, top: 0 }, { input: A, left: 0, top: 34 },
      { input: bar(`MOVED ${titleSlot.id} + RESIZED ${otherSlot.id}`), left: 450, top: 0 }, { input: B, left: 450, top: 34 },
    ]).png().toFile(out);
  console.log("-> " + out);
}
main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
