import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderEditable, renderFilledSource, loadEditableManifest, EditableManifest, Palette } from "./renderEditable";

// Generic editable + recolour proof for ANY template manifest. Renders default vs a palette that gives each
// distinct role a DISTINCT test colour, and asserts: text stays editable, photo fills, every slot recolours
// to its role's colour, and roles that share a default hex recolour INDEPENDENTLY (separate tokens).
const WHEEL = ["#0B2545", "#C9A45C", "#1F7A6B", "#9B2226", "#3A5A40", "#5E548E", "#B5651D"]; // navy/gold/teal/crimson/green/purple/amber
const fillOf = (svg: string, slot: string): string | null => { const m = svg.match(new RegExp(`data-slot-id="${slot}"[^>]*fill="([^"]+)"`)); return m ? m[1] : null; };

export async function proveEditable(manifestPath: string, demoPhoto?: string): Promise<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[]; outDir: string }> {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const add = (n: string, ok: boolean, d = "") => checks.push({ name: n, ok, detail: d });
  const m: EditableManifest = loadEditableManifest(manifestPath);
  const outDir = abs(`out/engine/${m.template_id}/proof`); fs.mkdirSync(outDir, { recursive: true });
  const realPhoto = demoPhoto || ("data:image/jpeg;base64," + fs.readFileSync(abs("assets/04/photo_test.jpg")).toString("base64"));

  // photos: REAL images in every slot for the visual proof — hero = full photo, thumbnails = distinct crops of
  // the real photo (so each of the N slots shows a real, distinct image).
  const sharp0 = (await import("sharp")).default;
  const raw = fs.readFileSync(abs("assets/04/photo_test.jpg"));
  const meta = await sharp0(raw).metadata();
  const PW = meta.width || 1200, PH = meta.height || 1200;
  const crop = async (l: number, t: number, wd: number, ht: number) => "data:image/jpeg;base64," + (await sharp0(raw).extract({ left: l, top: t, width: wd, height: ht }).jpeg().toBuffer()).toString("base64");
  const cw = Math.floor(PW / 3), ch = Math.floor(PH / 2);
  const thumbCrops = [await crop(0, 0, cw, ch), await crop(cw, ch, cw, ch), await crop(2 * cw, 0, cw, ch)];
  let photos: string | Record<string, string> = realPhoto;
  const expectPhotos = m.photo_slots?.length ?? (m.photo_token ? 1 : 0);
  if (m.photo_slots && m.photo_slots.length > 1) {
    const map: Record<string, string> = {};
    for (let i = 0; i < m.photo_slots.length; i++) map[m.photo_slots[i].token] = i === 0 ? realPhoto : thumbCrops[(i - 1) % thumbCrops.length];
    photos = map;
  }

  // assign each distinct role used by a slot a distinct test colour
  const roles = [...new Set(m.text_slots.map((s) => s.role))];
  const paletteB: Palette = {}; roles.forEach((r, i) => (paletteB[r] = WHEEL[i % WHEEL.length]));

  const A = await renderEditable(m, {}, photos);
  const B = await renderEditable(m, paletteB, photos);
  fs.writeFileSync(path.join(outDir, "editable_A_default.svg"), A.svg); fs.writeFileSync(path.join(outDir, "editable_A_default.png"), A.png);
  fs.writeFileSync(path.join(outDir, "editable_B_recoloured.svg"), B.svg); fs.writeFileSync(path.join(outDir, "editable_B_recoloured.png"), B.png);

  add("text stays editable (data-editable <text>)", A.editableTextCount >= m.text_slots.length && /<text[^>]*data-editable="true"/.test(A.svg), `${A.editableTextCount} editable <text>`);
  add(`all ${expectPhotos} photo slot(s) fill (no @@PHOTO token; image embedded)`, A.photosFilled === expectPhotos && !/@@PHOTO\d+@@/.test(A.svg) && A.svg.includes("data:image"), `filled ${A.photosFilled}/${expectPhotos}`);

  // every slot recolours to its role's assigned colour
  let recolourOk = true, detail: string[] = [];
  for (const s of m.text_slots) {
    const want = paletteB[s.role];
    const got = fillOf(B.svg, s.id);
    const def = fillOf(A.svg, s.id);
    if ((got || "").toLowerCase() !== want.toLowerCase()) { recolourOk = false; detail.push(`${s.id}:${got}!=${want}`); }
  }
  add("every slot recolours to its role colour", recolourOk, detail.join(" "));

  // independence: at least two slots with the SAME default hex end up DIFFERENT after recolour
  const byDefault: Record<string, string[]> = {};
  for (const s of m.text_slots) { const d = (fillOf(A.svg, s.id) || "").toLowerCase(); (byDefault[d] ||= []).push(s.id); }
  let independenceProven = false, indDetail = "";
  for (const d of Object.keys(byDefault)) {
    const ids = byDefault[d]; if (ids.length < 2) continue;
    const bcols = new Set(ids.map((id) => (fillOf(B.svg, id) || "").toLowerCase()));
    if (bcols.size > 1) { independenceProven = true; indDetail = `default ${d} -> ${[...bcols].join(", ")} (${ids.join(",")})`; break; }
  }
  add("same-default roles recolour INDEPENDENTLY", independenceProven, indDetail);
  add("renders differ (recolour changed pixels)", !A.png.equals(B.png));

  // recolour contact (A default | B recoloured) + full-size ORIGINAL vs EDITABLE side-by-side
  try {
    const sharp = (await import("sharp")).default;
    const label = (w: number, l: string, r: string) => Buffer.from(`<svg width="${w}" height="26" xmlns="http://www.w3.org/2000/svg"><text x="10" y="18" font-family="sans-serif" font-size="14" fill="#fff">${l}</text><text x="${w / 2 + 10}" y="18" font-family="sans-serif" font-size="14" fill="#fff">${r}</text></svg>`);
    const side = async (leftPng: Buffer, rightPng: Buffer, h: number, l: string, r: string, out: string) => {
      const la = await sharp(leftPng).resize({ height: h }).png().toBuffer(), lb = await sharp(rightPng).resize({ height: h }).png().toBuffer();
      const wa = (await sharp(la).metadata()).width || h, wb = (await sharp(lb).metadata()).width || h;
      const W = wa + wb + 30, H = h + 30;
      await sharp({ create: { width: W, height: H, channels: 4, background: { r: 22, g: 22, b: 22, alpha: 1 } } })
        .composite([{ input: la, left: 10, top: 26 }, { input: lb, left: wa + 20, top: 26 }, { input: label(W, l, r), left: 0, top: 0 }]).png().toFile(path.join(outDir, out));
    };
    await side(A.png, B.png, 460, "A: default palette", "B: per-role recolour (independent)", "recolour_A_vs_B.png");
    // ORIGINAL (source + same real photos) vs EDITABLE output, full-size comparable scale
    const ref = renderFilledSource(m, photos);
    await side(ref, A.png, 900, "ORIGINAL (Canva template)", "EDITABLE render (this engine)", "side_by_side_original_vs_editable.png");
  } catch (e: any) { console.log("  (contact skipped: " + e.message + ")"); }

  const ok = checks.every((c) => c.ok);
  fs.writeFileSync(path.join(outDir, "proof.json"), JSON.stringify({ template_id: m.template_id, roles, paletteB, checks }, null, 2) + "\n");
  return { ok, checks, outDir };
}

if (require.main === module) {
  (async () => {
    const mp = process.argv[2] || "manifest/templates/1.editable.json";
    const { ok, checks, outDir } = await proveEditable(mp);
    console.log(`== editable + recolour proof (${mp}) ==`);
    for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
    console.log(`\n  PROOF: ${ok ? "PASS" : "FAIL"}  -> ${path.relative(abs("."), outDir)}/recolour_A_vs_B.png`);
    if (!ok) process.exit(1);
  })().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
