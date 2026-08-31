import fs from "node:fs";
import { renderEditable, loadEditableManifest, pickPhotos } from "./renderEditable";
import { deriveSlots, agencyPalette, applyDerived, BrandColours } from "./derive";
import { ensureImages, AGENCY, PROPS } from "./finalRender";

const IDS = ['2','6','7','8','10','24','25','26','27','28','30','31','32','33','34','35','36','37','38','40','41','43','44','45','46','47','48','49','50','52','54','55'];
const GALLERY_NEUTRAL: BrandColours = { navy: '#1F2933', gold: '#8A8F98', cream: '#F4F2ED', text: '#4A4E57' };
const ACC = ['#C2653A','#5C7A5A','#4F7391','#B0873C','#8A5A78','#3F7A75','#A24A46','#5B6BA0'];

async function main() {
  const p = PROPS[0];
  const imgs = await ensureImages(p);
  const rows: any[] = [];
  let total = 0;
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const t0 = Date.now();
    try {
      const mPath = `manifest/templates/${id}.editable.json`;
      const m0: any = loadEditableManifest(mPath);
      const m: any = applyDerived(m0, deriveSlots(p, AGENCY, id));
      const photos = await pickPhotos(m, imgs, id);
      const hex = ACC[i % ACC.length];
      const palette = m.palette_locked ? {} : { ...agencyPalette(m, { ...GALLERY_NEUTRAL, gold: hex }), accent: hex, 'badge.fill': hex, 'badge.text': '#FFFFFF' };
      const r = await renderEditable(m, palette, photos);
      const ms = Date.now() - t0;
      total += ms;
      let svgBytes = 0;
      try { svgBytes = fs.statSync(`${__dirname}/../${m0.source_svg}`).size; } catch {}
      rows.push({ id, ms, png_bytes: (r.png as Buffer).length, canvas: `${m0.canvas?.width || m0.width}x${m0.canvas?.height || m0.height}`, photos: m0.photo_slots?.length ?? m0.photos?.length ?? null, source_svg: m0.source_svg, svg_bytes: svgBytes });
      console.log(`#${id}\t${ms}ms\t${((r.png as Buffer).length/1024).toFixed(0)}KB\tsvg=${(svgBytes/1024).toFixed(0)}KB`);
    } catch (e: any) {
      console.log(`#${id}\tFAILED ${e.message}`);
      rows.push({ id, error: e.message });
    }
  }
  const ok = rows.filter((r) => r.ms);
  ok.sort((a,b)=>a.ms-b.ms);
  console.log(`\nrendered ${ok.length}/${IDS.length}; total ${total}ms; mean ${(total/ok.length).toFixed(0)}ms; median ${ok[Math.floor(ok.length/2)].ms}ms; min ${ok[0].ms}ms; max ${ok[ok.length-1].ms}ms`);
  console.log(`mean png ${(ok.reduce((a,b)=>a+b.png_bytes,0)/ok.length/1024).toFixed(0)}KB; total png ${(ok.reduce((a,b)=>a+b.png_bytes,0)/1024/1024).toFixed(1)}MB`);
  fs.writeFileSync("/private/tmp/claude-501/-Users-christianscholte-aivena/bc34a68b-7bfe-45ec-b811-54bffbb9d30b/scratchpad/perf.json", JSON.stringify(rows, null, 2));
}
main();
