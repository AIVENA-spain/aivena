import fs from "node:fs";
import path from "node:path";
import fontkit from "fontkit";
import { abs } from "../src/lib/paths";
import { renderTemplatePng, pngToRGBA, RGBA } from "../src/lib/render";

// FONT MATCH — quantitative font identification against the baked Canva glyphs.
// Target = a crop of the baked source render (the true letterforms). Each candidate TTF renders the same
// word; both ink masks are bbox-cropped, size-normalized, and scored by pixel IoU. The winner is the real
// face to seed (no faux-bold strokes, no artificial condensing).
// Usage: npx tsx engine/fontMatch.ts <targetPng> <x0,y0,x1,y1> <light|dark> <WORD> [outStrip]

type Mask = { w: number; h: number; on: Uint8Array };

function maskFrom(img: RGBA, box: [number, number, number, number], ink: "light" | "dark"): Mask {
  const [x0, y0, x1, y1] = box.map(Math.round) as any;
  let mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
  const isInk = (x: number, y: number) => {
    const i = (y * img.width + x) * 4;
    const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    return ink === "light" ? l > 165 : l < 100;
  };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (isInk(x, y)) { if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  const w = mxx - mnx + 1, h = mxy - mny + 1;
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) on[y * w + x] = isInk(mnx + x, mny + y) ? 1 : 0;
  return { w, h, on };
}

function resample(m: Mask, w: number, h: number): Mask {
  const on = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(m.w - 1, Math.round((x * m.w) / w)), sy = Math.min(m.h - 1, Math.round((y * m.h) / h));
    on[y * w + x] = m.on[sy * m.w + sx];
  }
  return { w, h, on };
}

function iou(a: Mask, b: Mask): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.on.length; i++) { const x = a.on[i], y = b.on[i]; if (x & y) inter++; if (x | y) uni++; }
  return uni ? inter / uni : 0;
}

export async function scoreCandidates(targetPng: string, box: [number, number, number, number], ink: "light" | "dark", word: string, candDir = "fonts/_cand"): Promise<{ name: string; family: string; score: number }[]> {
  const timg = await pngToRGBA(fs.readFileSync(abs(targetPng)), false);
  const target = maskFrom(timg, box, ink);
  // segment the target word into per-letter masks by column-gap projection
  const colInk: number[] = new Array(target.w).fill(0);
  for (let y = 0; y < target.h; y++) for (let x = 0; x < target.w; x++) if (target.on[y * target.w + x]) colInk[x]++;
  const segs: [number, number][] = []; let st = -1;
  for (let x = 0; x < target.w; x++) { const on = colInk[x] > 0; if (on && st < 0) st = x; if (!on && st >= 0) { if (x - st > 6) segs.push([st, x]); st = -1; } }
  if (st >= 0) segs.push([st, target.w]);
  const glyphSegs = new Map<string, Mask>();
  const letters0 = word.replace(/ /g, "").split("");
  segs.forEach(([a, b], i) => {
    if (i >= letters0.length) return;
    let mny = 1e9, mxy = -1;
    for (let y = 0; y < target.h; y++) for (let x = a; x < b; x++) if (target.on[y * target.w + x]) { if (y < mny) mny = y; if (y > mxy) mxy = y; }
    const w = b - a, h = mxy - mny + 1, on = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) on[y * w + x] = target.on[(mny + y) * target.w + (a + x)];
    if (!glyphSegs.has(letters0[i])) glyphSegs.set(letters0[i], { w, h, on });
  });
  const files = fs.readdirSync(abs(candDir)).filter((f) => f.endsWith(".ttf"));
  // candidates must live in fonts/ for resvg's fontDir — copy transiently
  const out: { name: string; family: string; score: number }[] = [];
  for (const f of files) {
    const tmp = abs(`fonts/__cand_${process.pid}_${f}`);
    fs.copyFileSync(abs(path.join(candDir, f)), tmp);
    try {
      const fk = (fontkit as any).openSync(tmp);
      // resvg's fontdb registers by TYPOGRAPHIC family (name 16) + weight class — address it the same way
      const fam = fk.name?.records?.preferredFamily?.en || fk.familyName;
      const wgt = fk["OS/2"]?.usWeightClass || 400;
      // per-glyph scoring: average IoU across letters removes letter-spacing noise
      const letters = [...new Set(word.split(""))].filter((c) => c !== " ");
      let sum = 0, n = 0;
      const timg2 = await pngToRGBA(fs.readFileSync(abs(targetPng)), false);
      for (const ch of letters) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect width="900" height="700" fill="#fff"/><text x="80" y="520" font-family="${fam}" font-weight="${wgt}" font-size="380" fill="#000">${ch}</text></svg>`;
        const cimg = await pngToRGBA(renderTemplatePng(svg, 900), false);
        const cm = maskFrom(cimg, [0, 0, 900, 700], "dark");
        const tSeg = glyphSegs.get(ch);
        if (!tSeg || cm.w < 2) continue;
        sum += iou(resample(cm, tSeg.w, tSeg.h), tSeg); n++;
      }
      out.push({ name: f.replace(".ttf", ""), family: `${fam} ${wgt}`, score: n ? +(sum / n).toFixed(4) : -1 });
    } catch (e: any) { out.push({ name: f, family: "?", score: -1 }); }
    fs.unlinkSync(tmp);
  }
  return out.sort((a, b) => b.score - a.score);
}

if (require.main === module) {
  (async () => {
    const [tp, boxS, ink, word] = process.argv.slice(2);
    const box = boxS.split(",").map(Number) as [number, number, number, number];
    const res = await scoreCandidates(tp, box, ink as any, word);
    for (const r of res) console.log(r.score.toFixed(4), r.name.padEnd(24), r.family);
  })().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
