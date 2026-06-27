import fs from "node:fs";
import path from "node:path";
import fontkit from "fontkit";
import { abs } from "../src/lib/paths";
import { renderStringRGBA, inkBox, regionOf } from "../resolver/glyphMetrics";

// Q9 acceptance (item 5): ES/DE/NO multilingual title spot-check renders accents correctly in the new #4
// title font (Libre Caslon Display). Definitive coverage via fontkit cmap + a real resvg render per string.
const FAMILY = "Libre Caslon Display";
const FILE = "fonts/LibreCaslonDisplay-Regular.ttf";
const SAMPLES: Record<string, string> = {
  es: "Ático Señorío — Á É Í Ó Ú Ñ",
  de: "Luxuriöse Größe — Ä Ö Ü ß Ÿ",   // Ÿ is the glyph Prata lacked
  no: "Sjøutsikt Bolig — Æ Ø Å æ ø å",
};

async function main() {
  const font = (fontkit as any).openSync(abs(FILE));
  const sharp = (await import("sharp")).default;
  const rows: any[] = [];
  const crops: Buffer[] = [];
  let allOk = true;

  for (const lang of Object.keys(SAMPLES)) {
    const s = SAMPLES[lang];
    const chars = [...s].filter((c) => c.trim() && c !== "—" && c !== "-");
    const missing = chars.filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!));
    const img = await renderStringRGBA(FAMILY, s, 120, 1);
    const ink = inkBox(img, regionOf([0, 0, img.width - 1, img.height - 1]), 60);
    const renders = !!ink && ink.count > 100;
    const ok = missing.length === 0 && renders;
    allOk = allOk && ok;
    rows.push({ lang, sample: s, missing_glyphs: missing, renders_ink: renders, ok });
    if (ink) {
      const crop = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
        .extract({ left: ink.left, top: ink.top, width: ink.width, height: ink.height })
        .resize({ width: 820, height: 90, fit: "inside" }).png().toBuffer();
      crops.push(crop);
    }
  }

  // contact sheet of the three rendered accented titles
  const outDir = abs("out/engine"); fs.mkdirSync(outDir, { recursive: true });
  const W = 900, rowH = 120, H = rowH * crops.length + 40;
  const comps: any[] = []; let y = 30;
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="20" font-family="sans-serif" font-size="14" fill="#fff">#4 title multilingual spot-check — Libre Caslon Display (Q9)</text>`;
  for (let i = 0; i < crops.length; i++) {
    comps.push({ input: crops[i], left: 12, top: y });
    svg += `<text x="${W - 60}" y="${y + 50}" font-family="sans-serif" font-size="12" fill="#7CFC00">${Object.keys(SAMPLES)[i]}</text>`;
    y += rowH;
  }
  svg += `</svg>`;
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 18, g: 18, b: 18, alpha: 1 } } })
    .composite([...comps, { input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(path.join(outDir, "multilingual_title_spotcheck.png"));

  fs.writeFileSync(path.join(outDir, "multilingual_title_spotcheck.json"), JSON.stringify({ font: FAMILY, file: FILE, all_ok: allOk, rows }, null, 2) + "\n");

  console.log("== Q9 multilingual title spot-check (Libre Caslon Display) ==");
  for (const r of rows) console.log(`  ${r.lang}: ${r.ok ? "OK " : "FAIL"} renders=${r.renders_ink ? "y" : "n"} missing=[${r.missing_glyphs.join(" ") || "none"}]  "${r.sample}"`);
  console.log(`\n  ${allOk ? "MULTILINGUAL SPOT-CHECK: PASS (all es/de/no accents incl. Ÿ render)" : "MULTILINGUAL SPOT-CHECK: FAIL"}`);
  console.log(`  wrote out/engine/multilingual_title_spotcheck.{png,json}`);
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
