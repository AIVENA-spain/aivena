import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderEditable, loadEditableManifest, renderFilledSource, EditableManifest, Palette } from "./renderEditable";
import { composeOne } from "../src/lib/compose";

// FINAL-OUTPUT PROOF: run one REAL property through the closest real/full engine path for every promoted
// editable template (#4 via composeOne; #11/#1/#7 via renderEditable — the actual editable renderer, not the
// assertion-only proof harness). Real facts + real agency brand + real photos only; NO invented facts.

// ---- REAL DATA (read-only from Supabase: public.properties + public.agency_branding, demo pilot agency) ----
const PROP = {
  id: "IC-28746",
  title: "Chalet in San Javier",
  type: "chalet",
  city: "San Javier", region: "Alicante",
  price: 285000, currency: "EUR",
  beds: 2, baths: 2, built_sqm: 90,
  features: ["Furnished", "Private Pool", "Air Conditioning", "Terrace", "Solarium"],
  photoFiles: ["41682", "41683", "41684", "41685"].map((n) => `out/realprop/${"IC-28746"}/${n}.jpg`),
};
const AGENCY = {
  name: "Mediterráneo Costa Homes",
  phone: "+34 600 999 066",
  web: "aivena.es",
  navy: "#0B2545", gold: "#C9A45C", cream: "#F8F5EF", text: "#1F2933",
};

const OUT = abs(`out/realprop/${PROP.id}`);
const jpgUri = (p: string) => "data:image/jpeg;base64," + fs.readFileSync(abs(p)).toString("base64");
const lumaHex = (hex: string) => { const h = hex.replace("#", ""); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };

// per-slot real-data overrides: text + optional geometry so real (longer) values stay legible.
type Ov = { text: string; size?: number; line_height?: number; bbox?: [number, number, number, number]; align?: "left" | "center" | "right"; weight?: string };
const MAP: Record<string, Record<string, Ov>> = {
  // #11 Property Listing (light): brand + property title + real address; eyebrow kept as template copy.
  "11": {
    brand: { text: "Mediterráneo\nCosta Homes", size: 30, line_height: 34, bbox: [104, 120, 520, 190] },
    title: { text: "CHALET IN\nSAN JAVIER" },
    address: { text: `${PROP.city}, ${PROP.region}` },
  },
  // #1 Open House (dark): real bed/size/bath stats + real agency contact; OPEN HOUSE + SCHEDULE A CALL kept.
  "1": {
    stat_left: { text: "2 BEDROOMS" },
    stat_center: { text: "90 M²" },
    stat_right: { text: "2 BATHROOMS" },
    contact: { text: `${AGENCY.phone}   ·   ${AGENCY.web}` },
  },
  // #7 Discover Your Dream (multi-photo, light): brand + property title + factual body + real feature rows +
  // real agency contact. Feature ICONS are baked (bed/bath/kitchen/sofa/garage) — text is real & editable.
  "7": {
    brand: { text: "Mediterráneo\nCosta Homes" },
    title: { text: "Chalet in\nSan Javier" },
    body: { text: `${PROP.city}, ${PROP.region}\n€285,000  ·  90 m² built` },
    feat_1: { text: "2 Bedrooms" },
    feat_2: { text: "2 Bathrooms" },
    feat_3: { text: "Furnished" },
    feat_4: { text: "Air Conditioning" },
    feat_5: { text: "Parking Space" },
    cta_phone: { text: AGENCY.phone },
    cta_web: { text: AGENCY.web },
  },
};

// contrast-aware agency brand palette: navy brand text on light templates, cream/gold on dark. Structural
// roles (cta on a baked dark bar, background/overlay) are left at the template default for legibility.
function agencyPalette(m: EditableManifest): Palette {
  const dark = lumaHex(m.colour_tokens["background"]?.default || "#ffffff") < 128;
  return dark
    ? { title: AGENCY.cream, "subtitle/body": AGENCY.cream, accent: AGENCY.gold, "stat.value": AGENCY.gold, "stat.label": AGENCY.cream, "badge.text": AGENCY.gold }
    : { title: AGENCY.navy, "subtitle/body": AGENCY.text, accent: AGENCY.gold, "badge.text": AGENCY.navy, "stat.label": AGENCY.navy, "stat.value": AGENCY.text };
}

function applyMap(m: EditableManifest, ov: Record<string, Ov>): EditableManifest {
  const c: EditableManifest = JSON.parse(JSON.stringify(m));
  for (const s of c.text_slots) {
    const o = ov[s.id]; if (!o) continue;
    s.text = o.text;
    if (o.size !== undefined) (s as any).size = o.size;
    if (o.line_height !== undefined) (s as any).line_height = o.line_height;
    if (o.bbox) s.bbox = o.bbox;
    if (o.align) s.align = o.align;
    if (o.weight) (s as any).weight = o.weight;
  }
  return c;
}

async function label(sharp: any, w: number, text: string, h = 40, fs2 = 18) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#111"/><text x="12" y="${h / 2 + fs2 / 3}" font-family="sans-serif" font-size="${fs2}" fill="#fff">${text}</text></svg>`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // real photos come from the property's PUBLIC storage bucket — fetch any that aren't cached locally (out/ is
  // gitignored, so a clean checkout re-downloads them). These are the real listing's own photos.
  const IMG_BASE = "https://atminvhrybxegpdtnnpl.supabase.co/storage/v1/object/public/property-images/montinmo/IC-28746";
  for (const n of ["41682", "41683", "41684", "41685"]) {
    const f = abs(`out/realprop/${PROP.id}/${n}.jpg`);
    if (!fs.existsSync(f)) { const resp = await fetch(`${IMG_BASE}/${n}_w_xl.jpg`); fs.writeFileSync(f, Buffer.from(await resp.arrayBuffer())); }
  }
  const sharp = (await import("sharp")).default;
  const report: any = { property: PROP.id, agency: AGENCY.name, engine_paths: {}, editable_text: {}, renders: {} };

  // ---- #11 / #1 / #7 via renderEditable (real editable renderer) ----
  const finals: { id: string; label: string; png: Buffer }[] = [];
  for (const id of ["11", "1", "7"]) {
    const base = loadEditableManifest(`manifest/templates/${id}.editable.json`);
    const m = applyMap(base, MAP[id]);
    const pal = agencyPalette(m);
    let photos: string | Record<string, string>;
    if (m.photo_slots && m.photo_slots.length > 1) {
      const map: Record<string, string> = {};
      m.photo_slots.forEach((p, i) => (map[p.token] = jpgUri(PROP.photoFiles[i % PROP.photoFiles.length])));
      photos = map;
    } else {
      photos = jpgUri(PROP.photoFiles[id === "1" ? 1 : 0]);
    }
    const r = await renderEditable(m, pal, photos);
    fs.writeFileSync(path.join(OUT, `final_${id}.png`), r.png);
    finals.push({ id, label: `#${id}`, png: r.png });
    report.engine_paths[id] = "renderEditable (editable renderer)";
    report.renders[id] = `final_${id}.png`;
    // editability: every slot -> a data-editable <text>; capture the rendered text per slot
    const slotTexts = m.text_slots.map((s) => ({ id: s.id, role: s.role, source: s.source, text: s.text, editable: new RegExp(`data-slot-id="${s.id}"[^>]*data-editable="true"`).test(r.svg) }));
    report.editable_text[id] = { count: r.editableTextCount, slots: slotTexts, all_editable: slotTexts.every((s) => s.editable), photos_filled: r.photosFilled };
  }

  // ---- #7 extras: original-vs-editable side-by-side + agency-vs-alt recolour ----
  {
    const base = loadEditableManifest(`manifest/templates/7.editable.json`);
    const m = applyMap(base, MAP["7"]);
    const photoMap: Record<string, string> = {};
    m.photo_slots!.forEach((p, i) => (photoMap[p.token] = jpgUri(PROP.photoFiles[i % PROP.photoFiles.length])));
    const A = await renderEditable(m, agencyPalette(m), photoMap);
    const ref = renderFilledSource(m, photoMap);
    const side = async (l: Buffer, r: Buffer, h: number, ll: string, rl: string, out: string) => {
      const la = await sharp(l).resize({ height: h }).png().toBuffer(), lb = await sharp(r).resize({ height: h }).png().toBuffer();
      const wa = (await sharp(la).metadata()).width || h, wb = (await sharp(lb).metadata()).width || h;
      const W = wa + wb + 30;
      await sharp({ create: { width: W, height: h + 46, channels: 4, background: { r: 17, g: 17, b: 17, alpha: 1 } } })
        .composite([{ input: la, left: 10, top: 40 }, { input: lb, left: wa + 20, top: 40 }, { input: await label(sharp, W, ll + "        |        " + rl), left: 0, top: 0 }]).png().toFile(path.join(OUT, out));
    };
    await side(ref, A.png, 920, "ORIGINAL Canva look (real photos)", "EDITABLE render (real facts + agency brand)", "sevenside_side_by_side.png");
    // recolour: agency navy/gold vs an alternate palette (teal/amber) — proves the wheel still moves on real data
    const ALT: Palette = { title: "#1F7A6B", "subtitle/body": "#333333", accent: "#B5651D", "badge.text": "#1F7A6B", "stat.label": "#1F7A6B", "stat.value": "#333333" };
    const B = await renderEditable(m, ALT, photoMap);
    await side(A.png, B.png, 700, "agency brand (navy/gold)", "alternate palette (teal/amber)", "seven_recolour.png");
    report.renders["7_side_by_side"] = "sevenside_side_by_side.png";
    report.renders["7_recolour"] = "seven_recolour.png";
  }

  // ---- #4 via composeOne (real Phase-2 fact-driven engine) ----
  {
    const base = JSON.parse(fs.readFileSync(abs("manifest/templates/04_luxury_apartment.editable.json"), "utf8"));
    base.locked_layers = base.locked_layers.map((l: any) => l.id === "hero" ? { ...l, asset: PROP.photoFiles[0] } : l);
    const variantPath = `out/realprop/${PROP.id}/04.manifest.json`;
    fs.writeFileSync(abs(variantPath), JSON.stringify(base, null, 2));
    let mode: "source_faithful" | "fact_safe" = "fact_safe";
    let res = await composeOne({ template: "04", lang: "en", palette: "agency_medcosta", mode, factsId: PROP.id, manifestPath: variantPath, nameBase: `final_${PROP.id}`, outDir: OUT });
    if (!res.ok) { mode = "source_faithful"; res = await composeOne({ template: "04", lang: "en", palette: "agency_medcosta", mode, factsId: PROP.id, manifestPath: variantPath, nameBase: `final_${PROP.id}`, outDir: OUT }); }
    const png4 = fs.readFileSync(res.paths.png);
    fs.writeFileSync(path.join(OUT, "final_4.png"), png4);
    finals.unshift({ id: "4", label: "#4", png: png4 });
    report.engine_paths["4"] = `composeOne (Phase-2 engine, mode=${mode}, ok=${res.ok})`;
    report.renders["4"] = "final_4.png";
    report.four_qa = { ok: res.ok, mode, failures: res.qa?.failures || [], factuality: res.qa?.factuality?.status };
  }

  // ---- contact / review sheet: all four finals in a 2x2 grid with labels ----
  {
    const order = ["4", "11", "1", "7"];
    const cells = order.map((id) => finals.find((f) => f.id === id)!).filter(Boolean);
    const cw = 420, gap = 16, cols = 2;
    const scaled = await Promise.all(cells.map((c) => sharp(c.png).resize({ width: cw }).png().toBuffer()));
    const ch = (await sharp(scaled[0]).metadata()).height || 525;
    const rows = Math.ceil(scaled.length / cols);
    const W = cols * cw + (cols + 1) * gap, H = rows * (ch + 34) + (rows + 1) * gap + 40;
    const comps: any[] = [{ input: await label(sharp, W, `AIVENA Studio — real-property final renders · ${PROP.title} · ${AGENCY.name}`, 40, 17), left: 0, top: 0 }];
    for (let i = 0; i < scaled.length; i++) {
      const r = Math.floor(i / cols), col = i % cols;
      const x = gap + col * (cw + gap), y = 40 + gap + r * (ch + 34 + gap);
      comps.push({ input: await label(sharp, cw, `#${cells[i].id}  ${report.engine_paths[cells[i].id].split(" ")[0]}`, 30, 15), left: x, top: y });
      comps.push({ input: scaled[i], left: x, top: y + 30 });
    }
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } }).composite(comps).png().toFile(path.join(OUT, "contact_sheet.png"));
    report.renders["contact_sheet"] = "contact_sheet.png";
  }

  fs.writeFileSync(path.join(OUT, "final_report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("== real-property final renders ==");
  for (const id of ["4", "11", "1", "7"]) console.log(`  #${id}: ${report.engine_paths[id]}  -> ${report.renders[id]}`);
  for (const id of ["11", "1", "7"]) { const e = report.editable_text[id]; console.log(`  #${id} editable: ${e.count} <text>, all_editable=${e.all_editable}, photos=${e.photos_filled}`); }
  console.log(`  #4 QA: ${JSON.stringify(report.four_qa)}`);
  console.log(`  -> ${path.relative(abs("."), OUT)}/{contact_sheet.png, final_*.png, sevenside_side_by_side.png, seven_recolour.png}`);
}

main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
