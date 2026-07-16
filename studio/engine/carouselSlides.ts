import { renderFreeform, DesignSpec } from "./renderFreeform";
import { textWidth } from "./renderEditable";
import { CarouselBrand } from "./renderCarousel";

// CAROUSEL SLIDE LIBRARY v2 (research-rebuilt 2026-07-16). Built on the carousel-effectiveness doctrine:
//  · slide 1 AND slide 2 are covers (Instagram re-serves unswiped carousels starting at slide 2 — Mosseri 10/2024)
//  · one idea per slide, 15-40 words, open-loop footer teasing the next slide (watch time = #1 ranking signal)
//  · recap slide before the CTA = the screenshot/save/forward unit (saves & sends are the reach levers)
//  · CTA slide leads with a KPI-matched action (save/send/DM keyword) — contact details demoted to the footer
//  · colour rhythm: navy cover → cream content → navy CTA; gold only for large accents/numerals (never body text)
//  · editorial "02 / 08" page marks at the muted tier (never dots, never top-right — Instagram's own pill lives there)
//  · 80px margins; type floor 28px; max 3 sizes per slide; no emoji, no drop shadows, no gradient text.
// The AI writes the words (plan), this library draws every pixel. Fonts: Libre Caslon Display + Jost.

const W = 1080, H = 1350;
const M = 80;                       // doctrine margin (covers IG's 3:4 grid crop + edge safety)
const SERIF = "Libre Caslon Display";
const SANS = "Jost";

export interface CarouselPlan {
  type: "tips" | "quote";
  eyebrow: string;                            // kicker above the cover hook
  hook_title: string;                         // cover headline — 5-8 words, loss/gap framed
  slide2_title: string;                       // second cover: self-qualification headline
  slide2_body: string;                        // who this is for / the stakes (standalone — never a continuation)
  tips: { title: string; body: string; teaser: string }[];  // tips type: teaser = open-loop line for the NEXT slide
  recap_title: string;                        // tips type: recap heading ("En 30 segundos")
  save_line: string;                          // recap: the save trigger ("Guárdalo para tu próxima visita")
  quote_parts: string[];                      // quote type: the quote VERBATIM, in readable chunks
  quote_hook: string;                         // quote type: cover = the most concrete quote fragment (verbatim subset)
  quote_context: string;                      // quote type slide 2: restates only what the quote itself says
  attribution: string;                        // quote type: who said it
  cta_heading: string;                        // CTA headline
  cta_action: string;                         // the KPI action line (save/send framing) — the real CTA
  cta_keyword: string;                        // DM keyword pill text ("Escríbenos: GUÍA")
  swipe_cue: string;                          // "Desliza" / "Swipe" in the post language
  caption: string;
  hashtags: string[];                         // HARD MAX 5 (Instagram cap since Dec 2025)
}

/** Measured word-wrap: freeform splits on \n only (and shrink-fits the widest line), so paragraphs
 *  must be broken into lines HERE, at the real rendered width, or long copy shrinks to nothing. */
export function wrap(text: string, font: string, size: number, maxW: number, weight?: string): string {
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

/** Blend two #rrggbb colours — the deterministic way to hit the 60% "meta" opacity tier for TEXT
 *  (the freeform text element has no opacity, so we mix the ink toward the ground instead). */
export function mix(ink: string, ground: string, inkShare: number): string {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [c(ink), c(ground)];
  return "#" + a.map((v, i) => Math.round(v * inkShare + b[i] * (1 - inkShare)).toString(16).padStart(2, "0")).join("");
}

/** The identical bottom band on every slide: agency (left) + editorial "02 / 08" page mark (right),
 *  both at the muted tier so they attribute without competing. Never top-right (Instagram's pill). */
function footerBand(agency: string, index: number, total: number, brand: CarouselBrand, ground: string, onDark: boolean) {
  const muted = mix(onDark ? "#f3efe6" : brand.navy, ground, 0.55);
  const mark = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  return [
    { type: "text" as const, bbox: [M, 1272, 700, 1300] as [number, number, number, number], content: agency.toUpperCase(), font: SANS, size: 17, colour: muted, align: "left" as const, weight: "500", tracking: 4 },
    { type: "text" as const, bbox: [700, 1272, W - M, 1300] as [number, number, number, number], content: mark, font: SANS, size: 17, colour: muted, align: "right" as const, tracking: 3 },
  ];
}

/** The 2026 swipe idiom: a hairline that bleeds off the right edge + a thin arrow. No badges. */
function swipeCue(cue: string, brand: CarouselBrand, y: number) {
  return [
    { type: "text" as const, bbox: [M, y, 560, y + 34] as [number, number, number, number], content: `${cue}  →`, font: SANS, size: 22, colour: brand.gold, align: "left" as const, weight: "500", tracking: 5 },
    { type: "rect" as const, bbox: [560, y + 15, W, y + 16.5] as [number, number, number, number], fill: brand.gold, opacity: 0.45 },
  ];
}

// ── TIPS / GUIDE type ─────────────────────────────────────────────────────────

/** S1 — navy cover. The hook is the only thing happening: kicker, giant serif headline, swipe cue. */
function tipsCover(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      // top-left identity only — top-right stays empty for Instagram's 1/N pill
      { type: "text", bbox: [M, 96, 700, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M, 300, W - M, 336], content: plan.eyebrow.toUpperCase(), font: SANS, size: 25, colour: brand.gold, align: "left", tracking: 7 },
      { type: "rect", bbox: [M, 380, M + 84, 384], fill: brand.gold },
      { type: "text", bbox: [M, 430, W - M, 1060], content: wrap(plan.hook_title, SERIF, 112, W - 2 * M), font: SERIF, size: 112, colour: brand.cream, align: "left", line_height: 126, valign: "center" },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 0, total, brand, brand.navy, true),
    ],
  });
}

/** S2 — the second cover (re-serve mechanic): self-qualification, standalone, cover-grade hierarchy. */
function tipsSlide2(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: plan.eyebrow.toUpperCase(), font: SANS, size: 21, colour: mix(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 340, M + 84, 344], fill: brand.gold },
      { type: "text", bbox: [M, 400, W - M, 800], content: wrap(plan.slide2_title, SERIF, 78, W - 2 * M), font: SERIF, size: 78, colour: brand.navy, align: "left", line_height: 92, valign: "center" },
      { type: "text", bbox: [M, 860, W - M, 1060], content: wrap(plan.slide2_body, SANS, 34, W - 2 * M), font: SANS, size: 34, colour: brand.text, align: "left", line_height: 52 },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 1, total, brand, brand.cream, false),
    ],
  });
}

/** Value slide — one idea: oversized gold numeral, heading, 15-40 word body, open-loop footer pill. */
function tipSlide(slideIndex: number, tipNumber: number, total: number, tip: { title: string; body: string; teaser: string }, agency: string, brand: CarouselBrand) {
  const elements: any[] = [
    { type: "text", bbox: [M, 70, 640, 340], content: String(tipNumber).padStart(2, "0"), font: SERIF, size: 250, colour: brand.gold, align: "left" },
    { type: "rect", bbox: [M, 400, M + 84, 404], fill: brand.gold },
    { type: "text", bbox: [M, 452, W - M, 660], content: wrap(tip.title, SERIF, 64, W - 2 * M), font: SERIF, size: 64, colour: brand.navy, align: "left", line_height: 76 },
    { type: "text", bbox: [M, 700, W - M, 1080], content: wrap(tip.body, SANS, 36, W - 2 * M), font: SANS, size: 36, colour: brand.text, align: "left", line_height: 56, valign: "center" },
  ];
  if (tip.teaser) {
    elements.push({
      type: "text", bbox: [M, 1150, 900, 1198], content: tip.teaser, font: SANS, size: 26,
      colour: brand.cream, align: "left", weight: "500", valign: "center",
      pill: { fill: brand.navy, pad_x: 28, pad_y: 14 },
    });
  }
  elements.push(...footerBand(agency, slideIndex, total, brand, brand.cream, false));
  return DesignSpec.parse({ background: brand.cream, elements });
}

/** Recap — the screenshot/save/forward unit: every point on one branded slide + the save trigger. */
function recapSlide(plan: CarouselPlan, slideIndex: number, total: number, agency: string, brand: CarouselBrand) {
  const n = plan.tips.length;
  const listTop = 380, listBottom = 1080;
  const rowH = Math.min(110, (listBottom - listTop) / n);
  const rows: any[] = [];
  plan.tips.forEach((tip, i) => {
    const y = listTop + i * rowH;
    rows.push({ type: "text", bbox: [M, y, M + 90, y + rowH], content: String(i + 1).padStart(2, "0"), font: SERIF, size: 44, colour: brand.gold, align: "left", valign: "center" });
    rows.push({ type: "text", bbox: [M + 110, y, W - M, y + rowH], content: wrap(tip.title, SANS, 32, W - M - (M + 110), "500"), font: SANS, size: 32, colour: brand.navy, align: "left", weight: "500", line_height: 40, valign: "center" });
    if (i < n - 1) rows.push({ type: "rect", bbox: [M + 110, y + rowH, W - M, y + rowH + 1], fill: mix(brand.navy, brand.cream, 0.18) });
  });
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: plan.eyebrow.toUpperCase(), font: SANS, size: 21, colour: mix(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M, 200, W - M, 320], content: wrap(plan.recap_title, SERIF, 68, W - 2 * M), font: SERIF, size: 68, colour: brand.navy, align: "left", line_height: 80 },
      ...rows,
      {
        type: "text", bbox: [M, 1140, 940, 1192], content: plan.save_line, font: SANS, size: 27,
        colour: brand.navy, align: "left", weight: "500", valign: "center",
        pill: { fill: brand.gold, pad_x: 30, pad_y: 15 },
      },
      ...footerBand(agency, slideIndex, total, brand, brand.cream, false),
    ],
  });
}

// ── QUOTE / CASE-STUDY type ───────────────────────────────────────────────────

/** S1 — the cover is the most concrete VERBATIM fragment + the client's name. Never a "Testimonial" label. */
function quoteCover(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [M - 10, 210, 420, 420], content: "“", font: SERIF, size: 280, colour: brand.gold, align: "left" },
      { type: "text", bbox: [M, 440, W - M, 960], content: wrap(plan.quote_hook, SERIF, 88, W - 2 * M), font: SERIF, size: 88, colour: brand.cream, align: "left", line_height: 104, valign: "center" },
      { type: "rect", bbox: [M, 1020, M + 64, 1023], fill: brand.gold },
      { type: "text", bbox: [M, 1046, W - M, 1084], content: plan.attribution, font: SANS, size: 27, colour: brand.cream, align: "left", tracking: 1 },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 0, total, brand, brand.navy, true),
    ],
  });
}

/** S2 — standalone context: who they were / what they wanted, only restating the quote's own content. */
function quoteSlide2(plan: CarouselPlan, agency: string, brand: CarouselBrand, total: number) {
  return DesignSpec.parse({
    background: brand.cream,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: plan.eyebrow.toUpperCase(), font: SANS, size: 21, colour: mix(brand.navy, brand.cream, 0.6), align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 340, M + 84, 344], fill: brand.gold },
      { type: "text", bbox: [M, 400, W - M, 780], content: wrap(plan.slide2_title, SERIF, 76, W - 2 * M), font: SERIF, size: 76, colour: brand.navy, align: "left", line_height: 90, valign: "center" },
      { type: "text", bbox: [M, 840, W - M, 1060], content: wrap(plan.quote_context, SANS, 34, W - 2 * M), font: SANS, size: 34, colour: brand.text, align: "left", line_height: 52 },
      ...swipeCue(plan.swipe_cue.toUpperCase(), brand, 1160),
      ...footerBand(agency, 1, total, brand, brand.cream, false),
    ],
  });
}

/** The client's words, verbatim, large serif — attribution repeats on the last part. */
function quoteSlide(slideIndex: number, total: number, part: string, attribution: string, isLast: boolean, agency: string, brand: CarouselBrand) {
  const elements: any[] = [
    { type: "text", bbox: [M - 10, 100, 380, 300], content: "“", font: SERIF, size: 230, colour: brand.gold, align: "left" },
    { type: "text", bbox: [M + 10, 330, W - M, 1000], content: wrap(part, SERIF, 62, W - 2 * M - 10), font: SERIF, size: 62, colour: brand.navy, align: "left", line_height: 84, valign: "center" },
  ];
  if (isLast && attribution) {
    elements.push({ type: "rect", bbox: [M + 10, 1060, M + 74, 1063], fill: brand.gold });
    elements.push({ type: "text", bbox: [M + 10, 1088, W - M, 1128], content: attribution, font: SANS, size: 29, colour: mix(brand.navy, brand.cream, 0.75), align: "left", tracking: 1 });
  }
  elements.push(...footerBand(agency, slideIndex, total, brand, brand.cream, false));
  return DesignSpec.parse({ background: brand.cream, elements });
}

// ── CTA (shared) — leads with the KPI action; contact is a demoted footer strip ──

function ctaSlide(plan: CarouselPlan, slideIndex: number, total: number, agency: string, contact: string, brand: CarouselBrand) {
  const mutedCream = mix("#f3efe6", brand.navy, 0.65);
  return DesignSpec.parse({
    background: brand.navy,
    elements: [
      { type: "text", bbox: [M, 96, 700, 130], content: agency.toUpperCase(), font: SANS, size: 21, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
      { type: "rect", bbox: [M, 300, M + 84, 304], fill: brand.gold },
      { type: "text", bbox: [M, 356, W - M, 700], content: wrap(plan.cta_heading, SERIF, 92, W - 2 * M), font: SERIF, size: 92, colour: brand.cream, align: "left", line_height: 106, valign: "center" },
      // the real CTA: the save/send action line, largest text after the heading
      { type: "text", bbox: [M, 760, W - M, 920], content: wrap(plan.cta_action, SANS, 36, W - 2 * M, "500"), font: SANS, size: 36, colour: brand.cream, align: "left", weight: "500", line_height: 54 },
      // the DM keyword as the single button
      {
        type: "text", bbox: [M, 980, 720, 1040], content: plan.cta_keyword.toUpperCase(), font: SANS, size: 25,
        colour: brand.navy, align: "left", weight: "600", tracking: 3, valign: "center",
        pill: { fill: brand.gold, pad_x: 40, pad_y: 20 },
      },
      // contact demoted to a muted footer strip
      { type: "rect", bbox: [M, 1140, W - M, 1141.5], fill: brand.gold, opacity: 0.35 },
      { type: "text", bbox: [M, 1172, W - M, 1206], content: contact, font: SANS, size: 22, colour: mutedCream, align: "left", tracking: 2 },
      ...footerBand(agency, slideIndex, total, brand, brand.navy, true),
    ],
  });
}

/** Render a PLANNED carousel. Tips: cover → second cover → one slide per tip → recap → CTA.
 *  Quote: cover (verbatim fragment) → context → quote parts → CTA. Deterministic, seconds. */
export async function renderPlannedCarousel(
  plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand,
): Promise<Buffer[]> {
  const canvas = { width: W, height: H };
  const specs: any[] = [];
  if (plan.type === "tips") {
    const total = plan.tips.length + 4;      // cover + slide2 + tips + recap + CTA
    specs.push(tipsCover(plan, agency, brand, total));
    specs.push(tipsSlide2(plan, agency, brand, total));
    plan.tips.forEach((tip, i) => specs.push(tipSlide(i + 2, i + 1, total, tip, agency, brand)));
    specs.push(recapSlide(plan, plan.tips.length + 2, total, agency, brand));
    specs.push(ctaSlide(plan, total - 1, total, agency, contact, brand));
  } else {
    const total = plan.quote_parts.length + 3;  // cover + context + parts + CTA
    specs.push(quoteCover(plan, agency, brand, total));
    specs.push(quoteSlide2(plan, agency, brand, total));
    plan.quote_parts.forEach((part, i) =>
      specs.push(quoteSlide(i + 2, total, part, plan.attribution, i === plan.quote_parts.length - 1, agency, brand)));
    specs.push(ctaSlide(plan, total - 1, total, agency, contact, brand));
  }
  const out: Buffer[] = [];
  for (const spec of specs) out.push(await renderFreeform(spec, canvas, []));
  return out;
}
