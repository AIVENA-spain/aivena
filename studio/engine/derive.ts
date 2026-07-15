import { EditableManifest, Palette, textWidth } from "./renderEditable";

// GENERAL slot derivation + brand palette — the single place property facts + agency data map to template
// slots, consistently for EVERY property (no per-property strings). Extracted from finalRender.ts so BOTH the
// dev harness AND the production render route (apps/api) import the exact same logic. Pure + side-effect-free
// (no fs, no fixtures, no network) so it is safe to import in a server request path.

// ---- property / agency shapes the derivation consumes ----
export interface DeriveProperty {
  type: string; city: string; region?: string | null;
  price?: number | null; size?: number | null; beds?: number | null; baths?: number | null;
  features?: string[];
}
export interface DeriveAgency {
  name: string; phone: string; web: string; email?: string; agent?: string;
}
// brand colours the palette maps onto template roles (contrast-aware). Prod passes the agency's own
// agency_branding colours; the dev harness passes its Mediterráneo fixture.
export interface BrandColours { navy: string; gold: string; cream: string; text: string; }

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Spanish place-name casing: feed data arrives naively title-cased ("Guardamar Del Segura") — particles are
// lowercase mid-name in correct Spanish ("Guardamar del Segura"). First word always keeps its capital.
const ES_PARTICLES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "da", "do", "das", "dos"]);
const esPlace = (s: string) => s ? s.trim().split(/\s+/).map((w, i) => (i > 0 && ES_PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(" ") : s;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const priceStr = (p: number | null | undefined) => (p != null ? "€" + Number(p).toLocaleString("en-US") : null);
const lumaHex = (hex: string) => { const h = hex.replace("#", ""); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.299 * r + 0.587 * g + 0.114 * b; };
// split a multi-word name into two BALANCED lines (pick the word break that most evens the two line lengths) —
// e.g. "Mediterráneo Costa Homes" -> "Mediterráneo" / "Costa Homes", not "Mediterráneo Costa" / "Homes".
function splitTwoLines(s: string): string {
  const w = s.trim().split(/\s+/); if (w.length < 2) return s;
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(" ").length, b = w.slice(i).join(" ").length; if (Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; } }
  return w.slice(0, best).join(" ") + "\n" + w.slice(best).join(" ");
}

// choose the title line-split (2 or 3 lines) that renders LARGEST in the given zone: fewer lines get a
// design-scale boost but long lines hit the width cap — pick whichever wins. Balanced word wrapping per count.
function bestTitleSplit(text: string, font: string, weight: string, zoneW: number, baseSize: number, designLines: number): string {
  const words = text.trim().split(/\s+/);
  const wrapTo = (n: number): string[] => {
    if (n >= words.length) return words.slice();
    const lines: string[] = []; let start = 0;
    for (let i = 0; i < n; i++) { const take = Math.round(((i + 1) * words.length) / n) - start; lines.push(words.slice(start, start + take).join(" ")); start += take; }
    return lines.filter(Boolean);
  };
  let best = text, bestSize = 0;
  for (const n of [2, 3]) {
    if (n > words.length) continue;
    const lines = wrapTo(n);
    const scaled = baseSize * (designLines / lines.length);
    const widest = Math.max(...lines.map((l) => textWidth(font, l, scaled, weight)));
    const finalSize = widest > zoneW ? scaled * (zoneW / widest) : scaled;
    if (finalSize > bestSize) { bestSize = finalSize; best = lines.join("\n"); }
  }
  return best;
}

// GENERAL feature list for #7: beds, baths, then the property's own top real features. Empty rows are hidden
// (a 0-feature property shows only beds+baths). Works for any property_type / feature set — no cherry-picking.
function featureRows(p: DeriveProperty): string[] {
  const rows: string[] = [];
  if (p.beds != null) rows.push(plural(p.beds, "Bedroom"));
  if (p.baths != null) rows.push(plural(p.baths, "Bathroom"));
  for (const f of p.features || []) { if (rows.length >= 5) break; rows.push(String(f)); }
  while (rows.length < 5) rows.push("");
  return rows.slice(0, 5);
}

// GENERAL slot derivation: pure function of (property facts, agency) — the single place property data maps to
// template slots, consistently for every property. No per-property strings.
export function deriveSlots(p: DeriveProperty, agency: DeriveAgency, templateId: string): Record<string, { text: string }> {
  const typeCap = cap(p.type);
  const city = esPlace(p.city);
  const loc = [city, p.region].filter(Boolean).join(", ");
  const price = priceStr(p.price);
  const brand2 = splitTwoLines(agency.name);
  const T = (text: string) => ({ text });
  if (templateId === "30") {
    // "Collector's Card" (CC-authored 2-photo design, 2026-07-15): gallery-catalogue facts —
    // masthead, natural-case display title, tracked-caps location, gold price, one specs line.
    // Missing facts vanish (empty slot = nothing drawn), never invented.
    const specs = [
      p.beds != null ? `${p.beds} BED` : null,
      p.baths != null ? `${p.baths} BATH` : null,
      p.size != null ? `${p.size} M²` : null,
    ].filter(Boolean).join(" · ");
    return {
      brand: T(agency.name.toUpperCase()),
      title: T(`${typeCap} in ${city}`),
      address: T([city, p.region].filter(Boolean).join(" · ").toUpperCase()),
      price_value: T(price ?? ""),
      stat_line: T(specs),
      cta_web: T(agency.web),
      cta_phone: T(agency.phone),
    };
  }
  if (templateId === "31") {
    // "La Entrada" (CC-authored 2-photo #2): dark botanical, centred ceremony — every line on the axis.
    const specs = [
      p.beds != null ? `${p.beds} BED` : null,
      p.baths != null ? `${p.baths} BATH` : null,
      p.size != null ? `${p.size} M²` : null,
    ].filter(Boolean).join(" · ");
    return {
      brand: T(agency.name.toUpperCase()),
      address: T([city, p.region].filter(Boolean).join(" · ").toUpperCase()),
      title: T(`${typeCap} in ${city}`),
      price_value: T(price ?? ""),
      stat_line: T(specs),
      cta_web: T([agency.web, agency.phone].filter(Boolean).join(" · ")),
    };
  }
  if (templateId === "32") {
    // "Riviera" (CC-authored 2-photo #3): poster — shouting title, medallion price, one facts line.
    const specs = [
      city.toUpperCase() || null,
      p.beds != null ? `${p.beds} BED` : null,
      p.baths != null ? `${p.baths} BATH` : null,
      p.size != null ? `${p.size} M²` : null,
    ].filter(Boolean).join(" · ");
    return {
      title: T(`${typeCap} in ${city}`.toUpperCase()),
      price_value: T(price ?? ""),
      stat_line: T(specs),
      brand: T(agency.name),
    };
  }
  if (templateId === "11") return { brand: T(brand2), title: T(`${typeCap} in\n${city}`.toUpperCase()), address: T(loc) };
  if (templateId === "1") {
    // template style: spelled-out numbers, stacked 2-line caps ("TWO / BEDROOMS")
    const W = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
    const nw = (n: number) => W[n] ?? String(n);
    return {
      stat_left: T(`${nw(p.beds!)}\nBEDROOM${p.beds === 1 ? "" : "S"}`),
      stat_center: T(p.size ? `${p.size} M²` : "LIVING\nROOM"),
      stat_right: T(`${nw(p.baths!)}\nBATHROOM${p.baths === 1 ? "" : "S"}`),
      cta_phone: T(agency.phone), cta_web: T(agency.web),
    };
  }
  if (templateId === "7") {
    // body stays the template's own marketing copy (editable) — matches the Canva layout exactly
    const out: Record<string, { text: string }> = {
      brand: T(brand2), title: T(bestTitleSplit(`${typeCap} in ${city}`, "Poppins", "700", 531, 85, 3)),
      cta_phone: T(agency.phone), cta_web: T(agency.web),
    };
    featureRows(p).forEach((r, i) => (out[`feat_${i + 1}`] = T(r)));
    return out;
  }
  // #5/#14/#6 replicate their sources' typographic conventions: plain-digit "M2" (baked style), uppercase site.
  if (templateId === "5") return {
    title: T(`${typeCap} in\n${city}`),
    price_label: T(price ? "PRICE:" : ""), price_value: T(price || ""),
    stat_area: T(p.size ? `${p.size} M2` : ""),
    stat_beds: T(p.beds != null ? plural(p.beds, "Bedroom").toUpperCase() : ""),
    stat_baths: T(p.baths != null ? plural(p.baths, "Bathroom").toUpperCase() : ""),
    cta_web: T(agency.web.toUpperCase()),
  };
  if (templateId === "14") return {
    stat_area: T(p.size ? `${p.size} M2` : ""),
    stat_beds: T(p.beds != null ? plural(p.beds, "Bedroom").toUpperCase() : ""),
    stat_baths: T(p.baths != null ? plural(p.baths, "Bathroom").toUpperCase() : ""),
    contact_addr: T(loc), contact_phone: T(agency.phone), contact_web: T(agency.web),
    brand: T(splitTwoLines(agency.name)),
  };
  if (templateId === "3") return {
    luxury: T("LUXURY"), type_script: T(typeCap),
    subtitle: T(`This brand-new ${p.type} in ${city} is now available\nand offers everything you need for a stylish,\ncomfortable, and convenient lifestyle.`.toUpperCase()),
    stat_area: T(p.size ? `${p.size} M²` : ""),
    stat_beds: T(p.beds != null ? plural(p.beds, "Bedroom").toUpperCase() : ""),
    stat_baths: T(p.baths != null ? plural(p.baths, "Bathroom").toUpperCase() : ""),
    cta_web: T(agency.web),
  };
  // batch-3 (Christian 2026-07-07): #24-#29 — all text editable; facts real, missing facts hide their slot+art.
  const hasFeat = (kw: string) => (p.features || []).some((f: string) => f.toLowerCase().includes(kw));
  const handleLower = "@" + agency.web.replace(/^www\./, "").replace(/\.[a-z.]+$/, "").toLowerCase();
  // batch-4 (Christian 2026-07-08): #2/#8/#21/#22 from the canonical Drive sources.
  if (templateId === "2") return {
    cta_phone: T(agency.phone), cta_email: T(agency.email || ""),
  };
  if (templateId === "8") return {}; // single editable label stays template copy
  if (templateId === "21") return {
    agent_name: T(String(agency.agent || agency.name).toUpperCase()),
    handle: T(handleLower), address: T(loc), cta_phone: T(agency.phone),
  };
  if (templateId === "22") return {
    stat_size: T(p.size ? `${p.size} M2` : ""),
    stat_beds: T(p.beds != null ? plural(p.beds, "Bedroom").toUpperCase() : ""),
    stat_baths: T(p.baths != null ? plural(p.baths, "Bathroom").toUpperCase() : ""),
    handle: T(handleLower), address: T(loc), cta_phone: T(agency.phone),
  };
  if (templateId === "24") return {
    stat_line: T([
      p.beds != null ? plural(p.beds, "bedroom").toLowerCase() : "",
      p.baths != null ? plural(p.baths, "bathroom").toLowerCase() : "",
      ((p.features || [])[0] || "").toString(),
    ].filter(Boolean).join(" | ")),
    address: T(loc),
  };
  if (templateId === "25") return {
    stat_beds: T(p.beds != null ? plural(p.beds, "Bedroom").toUpperCase() : ""),
    stat_baths: T(p.baths != null ? plural(p.baths, "Bathroom").toUpperCase() : ""),
    address: T(loc.toUpperCase()),
  };
  if (templateId === "26") return { cta_email: T(agency.web) };
  if (templateId === "27") {
    const f = (p.features || []).slice(0, 3);
    return {
      feature_1: T(f[0] || ""), feature_2: T(f[1] || ""), feature_3: T(f[2] || ""),
      cta_web_url: T("www." + agency.web.replace(/^www\./, "")),
    };
  }
  if (templateId === "28") return {
    title: T(`MODERN\n${p.type.toUpperCase()}`),
    stat_pool: T(hasFeat("pool") ? "1" : ""),
    stat_beds: T(p.beds != null ? String(p.beds) : ""),
    stat_baths: T(p.baths != null ? String(p.baths) : ""),
    stat_garage: T(hasFeat("garage") || hasFeat("parking") ? "1" : ""),
    stat_kitchen: T(hasFeat("kitchen") ? "1" : ""),
    cta_mail: T(agency.email || ""), cta_phone: T(agency.phone),
    cta_web: T("www." + agency.web.replace(/^www\./, "")),
  };
  if (templateId === "10") {
    // description = real facts (beds + type) in the template's sentence frame; beds missing -> degrade honestly.
    const sentence = p.beds != null ? `A modern ${p.beds}-bedroom ${p.type} with designer furniture` : `A modern ${p.type} with designer furniture`;
    const words = sentence.split(" ");
    const lines: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (textWidth("Poppins", t, 31, "500") > 360 && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return { price_value: T(price || ""), description: T(lines.join("\n")) };
  }
  if (templateId === "6") return {
    // handle follows the source's caps convention; title = TWO real slots (the source sets its two title lines
    // at different sizes — per-line slots keep each line's design size/baseline and decouple their auto-fits)
    handle: T(`@${agency.web.replace(/^www\./, "").replace(/\.[a-z.]+$/, "")}`.toUpperCase()),
    title_line1: T(`${typeCap} in`),
    title_line2: T(city),
    // subtitle kept as the template's generic marketing copy (4 lines, matching the source) — editable, not a fact
    stat_area: T(p.size ? `${p.size} M2` : ""),
    stat_beds: T(p.beds != null ? plural(p.beds, "Bedroom").toUpperCase() : ""),
    stat_baths: T(p.baths != null ? plural(p.baths, "Bathroom").toUpperCase() : ""),
  };
  return {};
}

// contrast-aware agency brand palette (navy on light, cream/gold on dark). Structural roles keep template
// defaults. brand = the agency's own colours (prod: agency_branding; harness: the fixture). palette_locked
// templates ignore this entirely (the caller passes {} for those).
export function agencyPalette(m: EditableManifest, brand: BrandColours): Palette {
  const dark = lumaHex(m.colour_tokens["background"]?.default || "#ffffff") < 128;
  return dark
    ? { title: brand.cream, "subtitle/body": brand.cream, accent: brand.gold, "stat.value": brand.gold, "stat.label": brand.cream, "badge.text": brand.gold }
    : { title: brand.navy, "subtitle/body": brand.text, accent: brand.gold, "badge.text": brand.navy, "stat.label": brand.navy, "stat.value": brand.text };
}

// inject the derived slot text into a copy of the manifest (never mutates the original).
export function applyDerived(m: EditableManifest, derived: Record<string, { text: string }>): EditableManifest {
  const c: EditableManifest = JSON.parse(JSON.stringify(m));
  for (const s of c.text_slots) { const o = derived[s.id]; if (o) s.text = o.text; }
  return c;
}
