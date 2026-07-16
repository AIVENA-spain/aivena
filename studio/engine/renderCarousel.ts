import { renderFreeform, DesignSpec } from "./renderFreeform";
import { wrap, chrome } from "./carouselSlides";

// LISTING CAROUSEL v2 (research-rebuilt 2026-07-16): a swipeable property tour built from the listing's
// real photos and canonical facts. Doctrine applied:
//  · the cover is a hook over the hero photo, never a bare photo or spec sheet — the benefit stops the scroll
//  · one fact per photo slide (a single feature pill), front-loaded on slide 2 (attention decays after slide 3)
//  · a mid-deck lifestyle line sells the town, not just the house
//  · a facts-strip slide (big numerals, real data only — missing facts stay hidden) before the CTA
//  · the CTA leads with a DM keyword + save line; contact is a demoted footer strip
//  · editorial "02 / 07" page marks (muted, bottom band) — no dot rows; top-right stays empty for IG's pill
// Facts are canonical strings passed by the server, so nothing can be invented; rendering takes seconds.
// HONEST SCOPE: produces the slide IMAGES to post — no Instagram publishing/scheduling.

export interface CarouselFacts {
  title: string;            // "Villa in Altea"
  location: string;         // "ALTEA · ALICANTE"
  price: string;            // "€695,000" ("" when unknown → hidden)
  specs: string;            // "3 BED · 3 BATH · 214 M²" ("" → hidden)
  beds: string;             // "3" ("" → hidden)   — the facts-strip numerals
  baths: string;            // "3"
  area: string;             // "214 m²"
  agency: string;           // agency display name
  contact: string;          // "aivena.es · +34 600 999 066"
  features: string[];       // up to 6 real feature strings — one pill per photo slide
}

export interface CarouselCopy {
  hook: string;             // cover overlay benefit line ("" → falls back to title treatment)
  lifestyle_line: string;   // mid-deck town line ("" → slide skipped)
  cta_action: string;       // save/send action line
  cta_keyword: string;      // DM keyword pill ("Escríbenos: VISITA")
}

export interface CarouselBrand { navy: string; gold: string; cream: string; text: string; }

const W = 1080, H = 1350;
const M = 80;
const SERIF = "Libre Caslon Display";
const SANS = "Jost";
const INK = "#f3efe6";

function mixHex(ink: string, ground: string, inkShare: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(ink), c(ground)];
  return "#" + a.map((v, i) => Math.round(v * inkShare + b[i] * (1 - inkShare)).toString(16).padStart(2, "0")).join("");
}

/** Identical muted bottom band on every slide: agency left, "02 / 07" page mark right. */
function footerBand(agency: string, location: string, index: number, total: number, onDark: boolean, ground: string, navy: string) {
  const muted = onDark ? INK : mixHex(navy, ground, 0.55);
  const mark = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  return [
    { type: "text" as const, bbox: [M, 1272, 640, 1300] as [number, number, number, number], content: agency.toUpperCase(), font: SANS, size: 17, colour: muted, align: "left" as const, weight: "500", tracking: 4 },
    { type: "text" as const, bbox: [640, 1272, W - M, 1300] as [number, number, number, number], content: mark, font: SANS, size: 17, colour: muted, align: "right" as const, tracking: 3 },
  ];
}

/** S1 — hero photo + scrim + the HOOK (benefit line), location kicker, price. Never a bare photo. */
function coverSpec(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, total: number) {
  const hook = copy.hook || facts.title;
  const elements: any[] = [
    { type: "photo", photo: 0, bbox: [0, 0, W, H] },
    { type: "scrim", bbox: [0, 0, W, 240], colour: "#0a0c10", direction: "down" },
    // a deep double scrim: the hook block must pass contrast against bright water/sky photos
    { type: "scrim", bbox: [0, H * 0.34, W, H], colour: "#0a0c10", direction: "up" },
    { type: "scrim", bbox: [0, H * 0.55, W, H], colour: "#0a0c10", direction: "up" },
    // top-left identity only — top-right stays empty for Instagram's 1/N pill
    { type: "text", bbox: [M, 96, 640, 130], content: facts.agency.toUpperCase(), font: SANS, size: 21, colour: INK, align: "left", weight: "500", tracking: 5 },
    { type: "text", bbox: [M, 856, W - M, 888], content: facts.location, font: SANS, size: 22, colour: brand.gold, align: "left", tracking: 6 },
    { type: "text", bbox: [M, 908, W - M, 1130], content: wrap(hook, SERIF, 84, W - 2 * M), font: SERIF, size: 84, colour: INK, align: "left", line_height: 98 },
  ];
  const y = 1150;
  if (facts.price) {
    elements.push({ type: "text", bbox: [M, y, 700, y + 70], content: facts.price, font: SERIF, size: 58, colour: brand.gold, align: "left" });
  }
  elements.push({ type: "rect", bbox: [760, y + 32, W, y + 33.5], fill: brand.gold, opacity: 0.5 });
  elements.push({ type: "text", bbox: [760, y - 4, W - M, y + 28], content: "→", font: SANS, size: 34, colour: INK, align: "right" });
  elements.push(...footerBand(facts.agency, facts.location, 0, total, true, "#0a0c10", brand.navy));
  return DesignSpec.parse({ background: "#0a0c10", elements });
}

/** Photo slide — one photo, ONE fact: a single feature pill. Standalone on slide 2 by design. */
function photoSpec(photoIndex: number, slideIndex: number, feature: string | null, facts: CarouselFacts, brand: CarouselBrand, total: number) {
  const elements: any[] = [
    { type: "photo", photo: photoIndex, bbox: [0, 0, W, H] },
    { type: "scrim", bbox: [0, H - 320, W, H], colour: "#0a0c10", direction: "up" },
  ];
  if (feature) {
    elements.push({
      type: "text", bbox: [M, 1140, 880, 1196], content: feature, font: SANS, size: 27,
      colour: "#111418", align: "left", weight: "500", valign: "center",
      pill: { fill: INK, pad_x: 30, pad_y: 15 },
    });
  }
  elements.push(...footerBand(facts.agency, facts.location, slideIndex, total, true, "#0a0c10", brand.navy));
  return DesignSpec.parse({ background: "#0a0c10", elements });
}

/** Mid-deck lifestyle slide — sells the town, not the house. Skipped when the AI line is absent. */
function lifestyleSpec(slideIndex: number, copy: CarouselCopy, facts: CarouselFacts, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: facts.location, font: SANS, size: 21, colour: mixHex(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 420, M + 84, 424], fill: brand.gold },
      { type: "text", bbox: [M, 480, W - M, 980], content: wrap(copy.lifestyle_line, SERIF, 72, W - 2 * M), font: SERIF, size: 72, colour: brand.navy, align: "left", line_height: 92, valign: "center" },
      ...footerBand(facts.agency, facts.location, slideIndex, total, false, brand.cream, brand.navy),
    ],
  });
}

/** Facts strip — the numbers, big and honest: beds/baths/m² as large numerals, price. Missing → hidden. */
function factsSpec(slideIndex: number, facts: CarouselFacts, brand: CarouselBrand, total: number, lang = "es") {
  const T = chrome(lang);
  const cells: { label: string; value: string }[] = [];
  if (facts.beds) cells.push({ label: T.bed, value: facts.beds });
  if (facts.baths) cells.push({ label: T.bath, value: facts.baths });
  if (facts.area) cells.push({ label: T.sqm, value: facts.area.replace(/\s*m²$/i, "") });
  const elements: any[] = [
    { type: "text", bbox: [M, 96, 700, 130], content: facts.agency.toUpperCase(), font: SANS, size: 21, colour: mixHex(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
    { type: "text", bbox: [M, 250, W - M, 282], content: facts.location, font: SANS, size: 22, colour: brand.gold, align: "left", tracking: 6 },
    { type: "text", bbox: [M, 320, W - M, 470], content: facts.title, font: SERIF, size: 72, colour: brand.navy, align: "left", line_height: 84 },
  ];
  if (cells.length) {
    const cellW = (W - 2 * M) / cells.length;
    cells.forEach((cell, i) => {
      const x = M + i * cellW;
      elements.push({ type: "text", bbox: [x, 560, x + cellW - 20, 700], content: cell.value, font: SERIF, size: 110, colour: brand.navy, align: "left" });
      elements.push({ type: "text", bbox: [x, 716, x + cellW - 20, 748], content: cell.label, font: SANS, size: 22, colour: mixHex(brand.navy, brand.cream, 0.6), align: "left", tracking: 5 });
      if (i > 0) elements.push({ type: "rect", bbox: [x - 28, 570, x - 26.5, 740], fill: brand.gold, opacity: 0.5 });
    });
  }
  if (facts.price) {
    elements.push({ type: "rect", bbox: [M, 850, W - M, 851.5], fill: brand.gold, opacity: 0.4 });
    elements.push({ type: "text", bbox: [M, 900, W - M, 1030], content: facts.price, font: SERIF, size: 104, colour: brand.gold, align: "left" });
  }
  elements.push(...footerBand(facts.agency, facts.location, slideIndex, total, false, brand.cream, brand.navy));
  return DesignSpec.parse({ background: brand.cream, elements });
}

/** CTA — DM keyword leads, save line supports, contact demoted to the muted footer strip. */
function ctaSpec(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, total: number, lang = "es") {
  const T = chrome(lang);
  const action = copy.cta_action || T.save_cta;
  const keyword = copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`;
  const mutedCream = mixHex(INK, brand.navy, 0.65);
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: facts.agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M, 250, W - M, 282], content: facts.location, font: SANS, size: 21, colour: brand.gold, align: "left", tracking: 6 },
      { type: "rect", bbox: [M, 330, M + 84, 334], fill: brand.gold },
      { type: "text", bbox: [M, 386, W - M, 640], content: facts.title, font: SERIF, size: 88, colour: brand.cream, align: "left", line_height: 102, valign: "center" },
      ...(facts.price ? [{ type: "text", bbox: [M, 690, W - M, 800], content: facts.price, font: SERIF, size: 84, colour: brand.gold, align: "left" }] : []),
      { type: "text", bbox: [M, 850, W - M, 960], content: action, font: SANS, size: 34, colour: brand.cream, align: "left", weight: "500", line_height: 50 },
      {
        type: "text", bbox: [M, 1000, 760, 1060], content: keyword.toUpperCase(), font: SANS, size: 25,
        colour: brand.navy, align: "left", weight: "600", tracking: 3, valign: "center",
        pill: { fill: brand.gold, pad_x: 40, pad_y: 20 },
      },
      { type: "rect", bbox: [M, 1140, W - M, 1141.5], fill: brand.gold, opacity: 0.35 },
      { type: "text", bbox: [M, 1172, W - M, 1206], content: facts.contact, font: SANS, size: 22, colour: mutedCream, align: "left", tracking: 2 },
      ...footerBand(facts.agency, facts.location, total - 1, total, true, brand.navy, brand.navy),
    ],
  });
}

/**
 * Render the full listing tour: hook cover (photo 0) → photo slides (one feature pill each, specs pill
 * first) → mid-deck lifestyle slide (when copy provides one) → facts strip → CTA.
 * photos.length must be 2..9.
 */
export async function renderCarousel(
  facts: CarouselFacts, brand: CarouselBrand, photos: Buffer[], copy?: Partial<CarouselCopy>, lang = "es",
): Promise<Buffer[]> {
  if (photos.length < 2 || photos.length > 9) throw new Error("carousel needs 2-9 photos");
  const c: CarouselCopy = { hook: "", lifestyle_line: "", cta_action: "", cta_keyword: "", ...copy };

  // slide plan: photos 1..n-1 carry one fact each — the specs line first (front-loaded), then features
  const pills: (string | null)[] = [];
  const feats = facts.features.filter(Boolean);
  for (let i = 1; i < photos.length; i++) {
    if (i === 1 && facts.specs) pills.push(facts.specs);
    else pills.push(feats.shift() ?? null);
  }
  const midAt = photos.length >= 4 && c.lifestyle_line ? Math.ceil(photos.length / 2) : -1; // after roughly half the photos
  const total = 1 + (photos.length - 1) + (midAt >= 0 ? 1 : 0) + 1 + 1;                    // cover + photos + mid? + facts + CTA

  const specs: DesignSpec[] = [coverSpec(facts, c, brand, total)];
  let slideIndex = 1;
  for (let i = 1; i < photos.length; i++) {
    specs.push(photoSpec(i, slideIndex++, pills[i - 1], facts, brand, total));
    if (i === midAt) specs.push(lifestyleSpec(slideIndex++, c, facts, brand, total));
  }
  specs.push(factsSpec(slideIndex++, facts, brand, total, lang));
  specs.push(ctaSpec(facts, c, brand, total, lang));

  const slides: Buffer[] = [];
  for (const spec of specs) slides.push(await renderFreeform(spec, { width: W, height: H }, photos));
  return slides;
}
