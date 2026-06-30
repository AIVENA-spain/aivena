import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderEditable, loadEditableManifest, Palette } from "./renderEditable";

// #11 proof: render the editable manifest with two palettes (A default, B recoloured) over a REAL photo, and
// assert (1) text stays editable in the SVG, (2) colour roles recolour independently even when they share a
// default hex, (3) the photo slot fills, (4) the render is non-empty. First-proof grade.
const fillOf = (svg: string, slot: string): string | null => { const m = svg.match(new RegExp(`data-slot-id="${slot}"[^>]*fill="([^"]+)"`)); return m ? m[1] : null; };

async function main() {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const add = (n: string, ok: boolean, d = "") => checks.push({ name: n, ok, detail: d });
  const m = loadEditableManifest("manifest/templates/11.editable.json");
  const outDir = abs("out/engine/11/proof"); fs.mkdirSync(outDir, { recursive: true });

  const photo = "data:image/jpeg;base64," + fs.readFileSync(abs("assets/04/photo_test.jpg")).toString("base64");
  const paletteA: Palette = {}; // defaults (title + cta both #000000)
  const paletteB: Palette = { title: "#0B2545", cta: "#C9A45C", eyebrow: "#C9A45C", accent: "#C9A45C" }; // navy title, gold cta/eyebrow

  const A = await renderEditable(m, paletteA, photo);
  const B = await renderEditable(m, paletteB, photo);
  fs.writeFileSync(path.join(outDir, "editable_A_default.svg"), A.svg); fs.writeFileSync(path.join(outDir, "editable_A_default.png"), A.png);
  fs.writeFileSync(path.join(outDir, "editable_B_recoloured.svg"), B.svg); fs.writeFileSync(path.join(outDir, "editable_B_recoloured.png"), B.png);

  // 1) editable text in the SVG (real <text>, not outlined paths)
  add("text stays editable (data-editable <text> present)", A.editableTextCount >= 4 && /<text[^>]*data-editable="true"/.test(A.svg), `${A.editableTextCount} editable <text> elements`);
  // 2) photo slot filled (no @@PHOTO token remains; the embedded image data is present)
  add("photo slot fills (no @@PHOTO token remains)", !/@@PHOTO\d+@@/.test(A.svg) && A.svg.includes("data:image/png"), "");
  // 3) recolour roles independently — title & cta share default #000000 but recolour separately in B
  const aTitle = fillOf(A.svg, "title"), aAddr = fillOf(A.svg, "address");
  const bTitle = fillOf(B.svg, "title"), bAddr = fillOf(B.svg, "address");
  add("default palette: title & address both #000000", (aTitle || "").toLowerCase() === "#000000" && (aAddr || "").toLowerCase() === "#000000", `title=${aTitle} address=${aAddr}`);
  add("recoloured palette: title=navy, address=gold (independent)", bTitle === "#0B2545" && bAddr === "#C9A45C", `title=${bTitle} address=${bAddr}`);
  add("same-default roles recolour to DIFFERENT hexes (separate tokens)", bTitle !== bAddr && aTitle === aAddr, "");
  // 4) renders non-empty + differ
  add("both renders non-empty", A.png.length > 1000 && B.png.length > 1000);
  add("recolour changes the render bytes", !A.png.equals(B.png));

  // side-by-side contact (A | B)
  try {
    const sharp = (await import("sharp")).default;
    const half = 380;
    const la = await sharp(A.png).resize(half).png().toBuffer(), lb = await sharp(B.png).resize(half).png().toBuffer();
    const h = (await sharp(la).metadata()).height || 475;
    let svg = `<svg width="${half * 2 + 30}" height="${h + 30}" xmlns="http://www.w3.org/2000/svg"><text x="10" y="18" font-family="sans-serif" font-size="13" fill="#fff">A: default palette</text><text x="${half + 20}" y="18" font-family="sans-serif" font-size="13" fill="#fff">B: title=navy, cta=gold (same #000 defaults, recoloured independently)</text></svg>`;
    await sharp({ create: { width: half * 2 + 30, height: h + 30, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
      .composite([{ input: la, left: 10, top: 25 }, { input: lb, left: half + 20, top: 25 }, { input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(path.join(outDir, "recolour_A_vs_B.png"));
  } catch (e: any) { console.log("  (contact skipped: " + e.message + ")"); }

  const ok = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(outDir, "proof.json"), JSON.stringify({ template_id: "11", checks, paletteA, paletteB }, null, 2) + "\n");
  console.log("== #11 editable + recolour proof ==");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  console.log(`\n  #11 PROOF: ${ok ? "PASS" : "FAIL"}  -> out/engine/11/proof/{editable_A_default.png,editable_B_recoloured.png,recolour_A_vs_B.png}`);
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
