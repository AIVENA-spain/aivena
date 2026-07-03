import fs from "node:fs";
import path from "node:path";
import { abs } from "../src/lib/paths";
import { renderEditable, loadEditableManifest, renderFilledSource, EditableManifest, Palette } from "./renderEditable";
import { runVisualQA, QACheck } from "./visualQA";
import { composeOne } from "../src/lib/compose";

// FINAL-OUTPUT PROOF: run REAL properties through the closest real/full engine path per promoted template
// (#4 → composeOne; #11/#1/#7 → renderEditable). ALL slot content is DERIVED GENERALLY from facts + agency
// (deriveSlots) — never hardcoded per property — and the same engine is proven across MULTIPLE property types
// (chalet / apartment / bungalow; 5 / 2 / 0 features; missing size) so the result is consistent for any listing.

const FIX = JSON.parse(fs.readFileSync(abs("facts/studio_demo_properties.json"), "utf8"));
export const AGENCY = FIX.agency;
export const PROPS: any[] = FIX.properties;
const SUPA = "https://atminvhrybxegpdtnnpl.supabase.co/storage/v1/object/public";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const priceStr = (p: number | null) => (p != null ? "€" + Number(p).toLocaleString("en-US") : null);
const lumaHex = (hex: string) => { const h = hex.replace("#", ""); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };
// split a multi-word name into two BALANCED lines (pick the word break that most evens the two line lengths) —
// e.g. "Mediterráneo Costa Homes" -> "Mediterráneo" / "Costa Homes", not "Mediterráneo Costa" / "Homes".
function splitTwoLines(s: string): string {
  const w = s.trim().split(/\s+/); if (w.length < 2) return s;
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(" ").length, b = w.slice(i).join(" ").length; if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; } }
  return w.slice(0, best).join(" ") + "\n" + w.slice(best).join(" ");
}

// GENERAL feature list for #7: beds, baths, then the property's own top real features. Empty rows are hidden
// (a 0-feature property shows only beds+baths). Works for any property_type / feature set — no cherry-picking.
function featureRows(p: any): string[] {
  const rows: string[] = [];
  if (p.beds != null) rows.push(plural(p.beds, "Bedroom"));
  if (p.baths != null) rows.push(plural(p.baths, "Bathroom"));
  for (const f of p.features || []) { if (rows.length >= 5) break; rows.push(String(f)); }
  while (rows.length < 5) rows.push("");
  return rows.slice(0, 5);
}

// GENERAL slot derivation: pure function of (property facts, agency) — the single place property data maps to
// template slots, consistently for every property. No per-property strings.
function deriveSlots(p: any, agency: any, templateId: string): Record<string, { text: string }> {
  const typeCap = cap(p.type);
  const loc = [p.city, p.region].filter(Boolean).join(", ");
  const price = priceStr(p.price);
  const brand2 = splitTwoLines(agency.name);
  const T = (text: string) => ({ text });
  if (templateId === "11") return { brand: T(brand2), title: T(`${typeCap} in\n${p.city}`.toUpperCase()), address: T(loc) };
  if (templateId === "1") return {
    stat_left: T(plural(p.beds, "Bedroom").toUpperCase()),
    stat_center: T(p.size ? `${p.size} M²` : "LIVING ROOM"),
    stat_right: T(plural(p.baths, "Bathroom").toUpperCase()),
    contact: T(`${agency.phone}   ·   ${agency.web}`),
  };
  if (templateId === "7") {
    const bodyLine2 = [price, p.size ? `${p.size} m² built` : null].filter(Boolean).join("  ·  ");
    const out: Record<string, { text: string }> = {
      brand: T(brand2), title: T(`${typeCap} in\n${p.city}`),
      body: T([loc, bodyLine2].filter(Boolean).join("\n")),
      cta_phone: T(agency.phone), cta_web: T(agency.web),
    };
    featureRows(p).forEach((r, i) => (out[`feat_${i + 1}`] = T(r)));
    return out;
  }
  if (templateId === "5") return {
    title: T(`${typeCap} in\n${p.city}`),
    price_label: T(price ? "PRICE:" : ""), price_value: T(price || ""),
    stat_area: T(p.size ? `${p.size} M²` : ""),
    stat_beds: T(plural(p.beds, "Bedroom").toUpperCase()),
    stat_baths: T(plural(p.baths, "Bathroom").toUpperCase()),
    cta_web: T(agency.web),
  };
  if (templateId === "14") return {
    stat_area: T(p.size ? `${p.size} M²` : ""),
    stat_beds: T(plural(p.beds, "Bedroom").toUpperCase()),
    stat_baths: T(plural(p.baths, "Bathroom").toUpperCase()),
    contact_addr: T(loc), contact_phone: T(agency.phone), contact_web: T(agency.web),
    brand: T(splitTwoLines(agency.name)),
  };
  if (templateId === "3") return {
    title: T(`LUXURY\n${typeCap}`),
    body: T(`This ${p.type} in ${p.city} offers everything you need\nfor a stylish, comfortable, and convenient lifestyle.`),
    stat_area: T(p.size ? `${p.size} M²` : ""),
    stat_beds: T(plural(p.beds, "Bedroom").toUpperCase()),
    stat_baths: T(plural(p.baths, "Bathroom").toUpperCase()),
    cta_web: T(agency.web),
  };
  if (templateId === "6") return {
    handle: T(`@${agency.web.replace(/^www\./, "").replace(/\.[a-z.]+$/, "")}`),
    // no invented open-house date — the agency schedules it; show an honest, actionable booking CTA + phone
    date: T("BOOK A VIEWING"), time: T(agency.phone),
  };
  return {};
}

// contrast-aware agency brand palette (navy on light, cream/gold on dark). Structural roles keep template defaults.
function agencyPalette(m: EditableManifest): Palette {
  const dark = lumaHex(m.colour_tokens["background"]?.default || "#ffffff") < 128;
  return dark
    ? { title: AGENCY.cream, "subtitle/body": AGENCY.cream, accent: AGENCY.gold, "stat.value": AGENCY.gold, "stat.label": AGENCY.cream, "badge.text": AGENCY.gold }
    : { title: AGENCY.navy, "subtitle/body": AGENCY.text, accent: AGENCY.gold, "badge.text": AGENCY.navy, "stat.label": AGENCY.navy, "stat.value": AGENCY.text };
}

function applyDerived(m: EditableManifest, derived: Record<string, { text: string }>): EditableManifest {
  const c: EditableManifest = JSON.parse(JSON.stringify(m));
  for (const s of c.text_slots) { const o = derived[s.id]; if (o) s.text = o.text; }
  return c;
}

const jpgUri = (f: string) => "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64");
export async function ensureImages(p: any): Promise<string[]> {
  const dir = abs(`out/realprop/${p.id}`); fs.mkdirSync(dir, { recursive: true });
  const local: string[] = [];
  for (let i = 0; i < p.images.length; i++) {
    const f = path.join(dir, `img${i}.jpg`);
    if (!fs.existsSync(f)) { const r = await fetch(`${SUPA}/${p.images[i]}`); if (!r.ok) throw new Error(`img ${p.images[i]} -> ${r.status}`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
    local.push(f);
  }
  return local;
}

export async function renderEditableFor(p: any, templateId: string, imgs: string[]) {
  const m = applyDerived(loadEditableManifest(`manifest/templates/${templateId}.editable.json`), deriveSlots(p, AGENCY, templateId));
  let photos: string | Record<string, string>;
  if (m.photo_slots && m.photo_slots.length > 1) { const map: Record<string, string> = {}; m.photo_slots.forEach((s, i) => (map[s.token] = jpgUri(imgs[i % imgs.length]))); photos = map; }
  else photos = jpgUri(imgs[templateId === "1" ? Math.min(1, imgs.length - 1) : 0]);
  const r = await renderEditable(m, agencyPalette(m), photos);
  const qa = await runVisualQA(m, r);
  return { png: r.png, m, r, qa };
}

async function render4For(p: any, imgs: string[]): Promise<{ png: Buffer; mode: string; ok: boolean; failures: string[] }> {
  const relImg = path.relative(abs("."), imgs[0]); // portable (relative to studio root), not a machine path
  const facts = { id: p.id, property_type: p.type, location: { city: p.city, province: p.region, country: "Spain" }, price: { amount: p.price, currency: "EUR", period: null }, size: { built_sqm: p.size, plot_sqm: null }, bedrooms: p.beds, bathrooms: p.baths, image: relImg, features: p.features, selling_points: [] };
  fs.writeFileSync(abs(`facts/${p.id}.json`), JSON.stringify(facts, null, 2) + "\n");
  const base = JSON.parse(fs.readFileSync(abs("manifest/templates/04_luxury_apartment.editable.json"), "utf8"));
  base.locked_layers = base.locked_layers.map((l: any) => (l.id === "hero" ? { ...l, asset: imgs[0] } : l));
  const variant = `out/realprop/${p.id}/04.manifest.json`; fs.writeFileSync(abs(variant), JSON.stringify(base, null, 2));
  let mode: "fact_safe" | "source_faithful" = "fact_safe";
  let res = await composeOne({ template: "04", lang: "en", palette: "agency_medcosta", mode, factsId: p.id, manifestPath: variant, nameBase: `final_${p.id}`, outDir: abs(`out/realprop/${p.id}`) });
  if (!res.ok) { mode = "source_faithful"; res = await composeOne({ template: "04", lang: "en", palette: "agency_medcosta", mode, factsId: p.id, manifestPath: variant, nameBase: `final_${p.id}`, outDir: abs(`out/realprop/${p.id}`) }); }
  return { png: fs.readFileSync(res.paths.png), mode, ok: res.ok, failures: res.qa?.failures || [] };
}

async function labelBar(sharp: any, w: number, text: string, h = 34, fsz = 15) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#111"/><text x="10" y="${h / 2 + fsz / 3}" font-family="sans-serif" font-size="${fsz}" fill="#fff">${text}</text></svg>`);
}

async function main() {
  const sharp = (await import("sharp")).default;
  const report: any = { properties: PROPS.map((p) => p.id), agency: AGENCY.name, per_property: {}, qa_all_pass: true };
  const primary = PROPS[0];

  // ---- primary property: all four templates + a 4-up contact sheet ----
  const imgsByProp: Record<string, string[]> = {};
  for (const p of PROPS) imgsByProp[p.id] = await ensureImages(p);

  const finals: { id: string; png: Buffer; engine: string }[] = [];
  const four = await render4For(primary, imgsByProp[primary.id]);
  fs.writeFileSync(abs(`out/realprop/${primary.id}/final_4.png`), four.png);
  finals.push({ id: "4", png: four.png, engine: "composeOne" });
  report.per_property[primary.id] = { four: { mode: four.mode, ok: four.ok, failures: four.failures } };

  for (const id of ["11", "1", "7"]) {
    const { png, qa } = await renderEditableFor(primary, id, imgsByProp[primary.id]);
    fs.writeFileSync(abs(`out/realprop/${primary.id}/final_${id}.png`), png);
    finals.push({ id, png, engine: "renderEditable" });
    report.per_property[primary.id][id] = { qa: qa.ok, fails: qa.checks.filter((c) => !c.ok) };
    if (!qa.ok) report.qa_all_pass = false;
  }

  // primary 2x2 contact sheet
  {
    const order = ["4", "11", "1", "7"].map((id) => finals.find((f) => f.id === id)!);
    const cw = 420, gap = 16, cols = 2;
    const scaled = await Promise.all(order.map((c) => sharp(c.png).resize({ width: cw }).png().toBuffer()));
    const ch = (await sharp(scaled[0]).metadata()).height || 525;
    const W = cols * cw + (cols + 1) * gap, H = 40 + 2 * (ch + 30 + gap);
    const comps: any[] = [{ input: await labelBar(sharp, W, `${primary.type} in ${primary.city} — ${AGENCY.name} · all four templates`, 40, 16), left: 0, top: 0 }];
    for (let i = 0; i < scaled.length; i++) { const r = Math.floor(i / cols), col = i % cols; const x = gap + col * (cw + gap), y = 40 + gap + r * (ch + 30 + gap); comps.push({ input: await labelBar(sharp, cw, `#${order[i].id}  ${order[i].engine}`, 30, 14), left: x, top: y }, { input: scaled[i], left: x, top: y + 30 }); }
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } }).composite(comps).png().toFile(abs(`out/realprop/${primary.id}/contact_sheet.png`));
  }

  // ---- CROSS-TYPE CONSISTENCY: the three FIXED templates (#11/#1/#7) across all property types ----
  const grid: Record<string, Record<string, Buffer>> = { "11": {}, "1": {}, "7": {} };
  for (const p of PROPS) for (const id of ["11", "1", "7"]) {
    const { png, qa } = await renderEditableFor(p, id, imgsByProp[p.id]);
    grid[id][p.id] = png;
    fs.writeFileSync(abs(`out/realprop/${p.id}/final_${id}.png`), png); // save every property's render for inspection
    if (p.id !== primary.id) { (report.per_property[p.id] ||= {})[id] = { qa: qa.ok, fails: qa.checks.filter((c) => !c.ok) }; if (!qa.ok) report.qa_all_pass = false; }
  }
  {
    const cw = 300, gap = 14;
    const rowsT = ["11", "1", "7"];
    const cells: Record<string, Buffer> = {};
    for (const id of rowsT) for (const p of PROPS) cells[`${id}_${p.id}`] = await sharp(grid[id][p.id]).resize({ width: cw }).png().toBuffer();
    const ch = (await sharp(cells[`11_${PROPS[0].id}`]).metadata()).height || 375;
    const cols = PROPS.length;
    const W = cols * cw + (cols + 1) * gap, H = 40 + rowsT.length * (ch + 28 + gap) + gap;
    const comps: any[] = [{ input: await labelBar(sharp, W, `CROSS-TYPE CONSISTENCY — same engine, ${PROPS.map((p) => `${p.type} (${p.features.length} feat)`).join(" · ")}`, 40, 15), left: 0, top: 0 }];
    for (let ri = 0; ri < rowsT.length; ri++) for (let ci = 0; ci < cols; ci++) {
      const p = PROPS[ci]; const x = gap + ci * (cw + gap), y = 40 + gap + ri * (ch + 28 + gap);
      comps.push({ input: await labelBar(sharp, cw, `#${rowsT[ri]} · ${p.type}, ${p.city}`, 28, 13), left: x, top: y }, { input: cells[`${rowsT[ri]}_${p.id}`], left: x, top: y + 28 });
    }
    await sharp({ create: { width: W, height: H, channels: 4, background: { r: 24, g: 24, b: 24, alpha: 1 } } }).composite(comps).png().toFile(abs(`out/realprop/consistency_sheet.png`));
  }

  // #7 side-by-side + recolour for the primary (kept from the rebuild proof)
  {
    const m = applyDerived(loadEditableManifest(`manifest/templates/7.editable.json`), deriveSlots(primary, AGENCY, "7"));
    const photoMap: Record<string, string> = {}; m.photo_slots!.forEach((s, i) => (photoMap[s.token] = jpgUri(imgsByProp[primary.id][i % imgsByProp[primary.id].length])));
    const A = await renderEditable(m, agencyPalette(m), photoMap);
    const ref = renderFilledSource(m, photoMap);
    const side = async (l: Buffer, r: Buffer, h: number, ll: string, rl: string, out: string) => {
      const la = await sharp(l).resize({ height: h }).png().toBuffer(), lb = await sharp(r).resize({ height: h }).png().toBuffer();
      const wa = (await sharp(la).metadata()).width || h, wb = (await sharp(lb).metadata()).width || h; const W = wa + wb + 30;
      await sharp({ create: { width: W, height: h + 46, channels: 4, background: { r: 17, g: 17, b: 17, alpha: 1 } } }).composite([{ input: la, left: 10, top: 40 }, { input: lb, left: wa + 20, top: 40 }, { input: await labelBar(sharp, W, `${ll}        |        ${rl}`, 40, 15), left: 0, top: 0 }]).png().toFile(abs(`out/realprop/${primary.id}/${out}`));
    };
    await side(ref, A.png, 920, "ORIGINAL Canva look (real photos)", "EDITABLE render (real facts + agency brand)", "sevenside_side_by_side.png");
    const ALT: Palette = { title: "#1F7A6B", "subtitle/body": "#333333", accent: "#B5651D", "badge.text": "#1F7A6B", "stat.label": "#1F7A6B", "stat.value": "#333333" };
    const B = await renderEditable(m, ALT, photoMap);
    await side(A.png, B.png, 700, "agency brand (navy/gold)", "alternate palette (teal/amber)", "seven_recolour.png");
  }

  fs.writeFileSync(abs(`out/realprop/final_report.json`), JSON.stringify(report, null, 2) + "\n");
  console.log("== real-property final renders (general derivation, multi-type) ==");
  console.log(`  primary #4: composeOne ${four.mode} ok=${four.ok} ${four.failures.length ? "FAILS " + four.failures.join(";") : ""}`);
  for (const p of PROPS) for (const id of ["11", "1", "7"]) { const q = report.per_property[p.id]?.[id]; if (q) console.log(`  ${p.id} (${p.type}, ${p.features.length}feat) #${id}: visualQA ${q.qa ? "PASS" : "FAIL " + q.fails.map((c: QACheck) => `${c.slot || ""}:${c.name}`).join("; ")}`); }
  console.log(`  QA all pass: ${report.qa_all_pass}`);
  console.log(`  -> out/realprop/${primary.id}/{final_*.png, contact_sheet.png}  +  out/realprop/consistency_sheet.png`);
  if (!report.qa_all_pass) process.exit(1);
}

if (require.main === module) main().catch((e) => { console.error("ERROR:", e.stack || e.message); process.exit(1); });
