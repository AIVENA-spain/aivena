import { renderFreeform, DesignSpec } from "./renderFreeform";
import { textWidth } from "./renderEditable";
import { CarouselBrand } from "./renderCarousel";

// CAROUSEL SLIDE LIBRARY v1 (Christian-approved plan, 2026-07-16): deterministic, brand-themed slide
// layouts for the PLANNED carousel types (tips/advice, quote) — the AI writes the words (plan), this
// library draws every pixel. Fonts: Libre Caslon Display + Jost (always in the vault).

const W = 1080, H = 1350;
const SERIF = "Libre Caslon Display";
const SANS = "Jost";

export interface CarouselPlan {
  type: "tips" | "quote";
  eyebrow: string;
  hook_title: string;
  tips: { title: string; body: string }[];    // tips type (3..7)
  quote_parts: string[];                       // quote type (1..3 chunks)
  attribution: string;                         // quote type
  cta_heading: string;
  cta_sub: string;
  cta_button: string;
  swipe_cue: string;                           // "Desliza" / "Swipe" — in the post's language
  caption: string;
  hashtags: string[];
}

/** Measured word-wrap: freeform splits on \n only (and shrink-fits the widest line), so paragraphs
 *  must be broken into lines HERE, at the real rendered width, or long copy shrinks to nothing. */
function wrap(text: string, font: string, size: number, maxW: number, weight?: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? line + " " + w : w;
    if (line && textWidth(font, probe, size, weight) > maxW) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function dots(total: number, current: number, brand: CarouselBrand, y: number, onDark: boolean) {
  const gap = 26, r = 5;
  const x0 = W / 2 - ((total - 1) * gap) / 2;
  const base = onDark ? "#ffffff" : brand.navy;
  return Array.from({ length: total }, (_, i) => ({
    type: "rect" as const,
    bbox: [x0 + i * gap - r, y - r, x0 + i * gap + r, y + r] as [number, number, number, number],
    fill: i === current ? brand.gold : base,
    radius: r,
    opacity: i === current ? 1 : 0.45,
  }));
}

/** five gold circles — a drawn rating row that needs no star glyph in any font */
function starRow(brand: CarouselBrand, cx: number, y: number) {
  const gap = 46, r = 10;
  const x0 = cx - 2 * gap;
  return Array.from({ length: 5 }, (_, i) => ({
    type: "rect" as const,
    bbox: [x0 + i * gap - r, y - r, x0 + i * gap + r, y + r] as [number, number, number, number],
    fill: brand.gold, radius: r, // full radius on a square rect = a circle
  }));
}

function agencyFooter(agency: string, brand: CarouselBrand, onDark: boolean) {
  return {
    type: "text" as const, bbox: [64, 1272, 1016, 1300] as [number, number, number, number],
    content: agency.toUpperCase(), font: SANS, size: 17,
    colour: onDark ? "#f3efe6" : brand.navy, align: "center" as const, weight: "500", tracking: 4,
  };
}

// ── TIPS type ─────────────────────────────────────────────────────────────────

function tipsCover(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [64, 96, 1016, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [64, 176, 1016, 177.5], fill: brand.gold, opacity: 0.4 },
      // the hook block — eyebrow + rule + giant title, vertically centred as a group in the page middle
      { type: "text", bbox: [64, 300, 1016, 336], content: plan.eyebrow.toUpperCase(), font: SANS, size: 23, colour: brand.gold, align: "left", tracking: 6 },
      { type: "rect", bbox: [64, 376, 148, 380], fill: brand.gold },
      { type: "text", bbox: [64, 430, 1016, 1080], content: wrap(plan.hook_title, SERIF, 118, 952), font: SERIF, size: 118, colour: brand.cream, align: "left", line_height: 132, valign: "center" },
      { type: "rect", bbox: [64, 1148, 1016, 1149.5], fill: brand.gold, opacity: 0.4 },
      { type: "text", bbox: [64, 1180, 1016, 1216], content: `${plan.swipe_cue.toUpperCase()}  →`, font: SANS, size: 22, colour: brand.gold, align: "left", weight: "500", tracking: 5 },
      ...dots(total, 0, brand, 1312, true),
    ],
  });
}

function tipSlide(index: number, total: number, tip: { title: string; body: string }, agency: string, brand: CarouselBrand) {
  const num = String(index).padStart(2, "0");
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [64, 80, 620, 350], content: num, font: SERIF, size: 240, colour: brand.gold, align: "left" },
      { type: "rect", bbox: [64, 404, 148, 408], fill: brand.gold },
      { type: "text", bbox: [64, 456, 1016, 660], content: wrap(tip.title, SERIF, 66, 952), font: SERIF, size: 66, colour: brand.navy, align: "left", line_height: 78 },
      // the advice, centred in the remaining space so short and long bodies both sit balanced
      { type: "text", bbox: [64, 700, 1016, 1160], content: wrap(tip.body, SANS, 38, 952), font: SANS, size: 38, colour: brand.text, align: "left", line_height: 58, valign: "center" },
      agencyFooter(agency, brand, false),
      ...dots(total, index, brand, 1230, false),
    ],
  });
}

// ── QUOTE type ────────────────────────────────────────────────────────────────

function quoteCover(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [64, 96, 1016, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [64, 176, 1016, 177.5], fill: brand.gold, opacity: 0.4 },
      { type: "text", bbox: [340, 280, 740, 560], content: "“", font: SERIF, size: 340, colour: brand.gold, align: "center" },
      { type: "text", bbox: [90, 560, 990, 900], content: wrap(plan.hook_title, SERIF, 86, 900), font: SERIF, size: 86, colour: brand.cream, align: "center", line_height: 100, valign: "center" },
      ...starRow(brand, W / 2, 980),
      { type: "rect", bbox: [64, 1148, 1016, 1149.5], fill: brand.gold, opacity: 0.4 },
      { type: "text", bbox: [64, 1180, 1016, 1216], content: `${plan.swipe_cue.toUpperCase()}  →`, font: SANS, size: 22, colour: brand.gold, align: "left", weight: "500", tracking: 5 },
      ...dots(total, 0, brand, 1312, true),
    ],
  });
}

function quoteSlide(index: number, total: number, part: string, attribution: string, isLast: boolean, agency: string, brand: CarouselBrand) {
  const elements: any[] = [
    { type: "text", bbox: [80, 110, 360, 320], content: "“", font: SERIF, size: 240, colour: brand.gold, align: "left" },
    // the quote, centred in the reading zone so every chunk length sits balanced
    { type: "text", bbox: [90, 340, 990, 980], content: wrap(part, SERIF, 60, 900), font: SERIF, size: 60, colour: brand.navy, align: "left", line_height: 82, valign: "center" },
  ];
  if (isLast && attribution) {
    elements.push({ type: "rect", bbox: [90, 1046, 154, 1049], fill: brand.gold });
    elements.push({ type: "text", bbox: [90, 1076, 990, 1118], content: attribution, font: SANS, size: 29, colour: brand.text, align: "left", tracking: 1 });
  }
  elements.push(agencyFooter(agency, brand, false));
  elements.push(...dots(total, index, brand, 1230, false));
  return DesignSpec.parse({ background: brand.cream, elements });
}

// ── CTA (shared) ──────────────────────────────────────────────────────────────

function ctaSlide(plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [64, 96, 1016, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [64, 176, 1016, 177.5], fill: brand.gold, opacity: 0.4 },
      { type: "rect", bbox: [64, 276, 148, 280], fill: brand.gold },
      { type: "text", bbox: [64, 330, 1016, 680], content: wrap(plan.cta_heading, SERIF, 96, 952), font: SERIF, size: 96, colour: brand.cream, align: "left", line_height: 110, valign: "center" },
      { type: "text", bbox: [64, 720, 1016, 880], content: wrap(plan.cta_sub, SANS, 34, 952), font: SANS, size: 34, colour: brand.cream, align: "left", line_height: 50 },
      {
        type: "text", bbox: [64, 940, 640, 1000], content: plan.cta_button.toUpperCase(), font: SANS, size: 25,
        colour: brand.navy, align: "left", weight: "600", tracking: 4, valign: "center",
        pill: { fill: brand.gold, pad_x: 40, pad_y: 20 },
      },
      { type: "rect", bbox: [64, 1120, 1016, 1121.5], fill: brand.gold, opacity: 0.4 },
      { type: "text", bbox: [64, 1156, 1016, 1190], content: contact, font: SANS, size: 23, colour: brand.cream, align: "left", tracking: 2 },
      ...dots(total, total - 1, brand, 1312, true),
    ],
  });
}

/** Render a PLANNED carousel (tips or quote): cover → content slides → CTA. Deterministic, seconds. */
export async function renderPlannedCarousel(
  plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand,
): Promise<Buffer[]> {
  const canvas = { width: W, height: H };
  const specs: any[] = [];
  if (plan.type === "tips") {
    const total = plan.tips.length + 2;
    specs.push(tipsCover(plan, agency, brand, total));
    plan.tips.forEach((tip, i) => specs.push(tipSlide(i + 1, total, tip, agency, brand)));
    specs.push(ctaSlide(plan, agency, contact, brand, total));
  } else {
    const total = plan.quote_parts.length + 2;
    specs.push(quoteCover(plan, agency, brand, total));
    plan.quote_parts.forEach((part, i) =>
      specs.push(quoteSlide(i + 1, total, part, plan.attribution, i === plan.quote_parts.length - 1, agency, brand)));
    specs.push(ctaSlide(plan, agency, contact, brand, total));
  }
  const out: Buffer[] = [];
  for (const spec of specs) out.push(await renderFreeform(spec, canvas, []));
  return out;
}
