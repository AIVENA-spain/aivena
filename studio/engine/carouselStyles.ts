import { renderFreeform, DesignSpec } from "./renderFreeform";
import {
  CarouselPlan, renderPlannedCarousel, renderWideSliced, applyGrain, mix, wrap,
} from "./carouselSlides";
import { CarouselFacts, CarouselCopy, CarouselBrand, renderCarousel } from "./renderCarousel";

// CAROUSEL VISUAL STYLES (Christian-approved 2026-07-16: "i love them thats great ship those").
// Four research-backed skins over the SAME approved content structure (hook cover, standalone slide 2,
// value slides, recap save-unit, KPI CTA):
//   editorial  — the quiet v2 default (renderCarousel / renderPlannedCarousel)
//   horizonte  — seamless panorama listing (giant word + medallion cut by the swipe edge)
//   cartel     — Spanish feria poster: Anton stacks, one hollow word, gamma rotation, duotone photos
//   encalada   — refined Mediterranean: limewash/terracotta/olive, arch+porthole crops, tile band
//   sereno     — quiet luxury: shifting hairline frames, spine text, collector facts, ring seal
// Style laws from the research live here: grain per deck, no saturation boosts, one accent, one
// vernacular motif per slide, 150px top/bottom kill zones, folio + agency anchor on every slide.

export type CarouselStyle = "editorial" | "horizonte" | "cartel" | "encalada" | "sereno";

export const PLANNED_STYLES: Record<"tips" | "quote", CarouselStyle[]> = {
  tips: ["editorial", "cartel", "encalada", "sereno"],
  quote: ["editorial", "sereno", "encalada"],
};
export const LISTING_STYLES: CarouselStyle[] = ["editorial", "horizonte", "cartel", "encalada", "sereno"];

const W = 1080, H = 1350;
const FR = "Fraunces 115pt";
const CAS = "Libre Caslon Display";
const TERRA = "#c96a4a", OLIVE = "#5a6b4e", LIME = "#f4efe6";

// ── shared devices ────────────────────────────────────────────────────────────
function frame(b: [number, number, number, number], colour: string, w = 1.5, opacity?: number) {
  const [x0, y0, x1, y1] = b;
  const o = opacity !== undefined ? { opacity } : {};
  return [
    { type: "rect", bbox: [x0, y0, x1, y0 + w], fill: colour, ...o },
    { type: "rect", bbox: [x0, y1 - w, x1, y1], fill: colour, ...o },
    { type: "rect", bbox: [x0, y0, x0 + w, y1], fill: colour, ...o },
    { type: "rect", bbox: [x1 - w, y0, x1, y1], fill: colour, ...o },
  ];
}
function seal(cx: number, cy: number, r: number, ring: string, ground: string, initials: string) {
  const c = (rr: number, fill: string) => ({ type: "rect", bbox: [cx - rr, cy - rr, cx + rr, cy + rr], fill, radius: rr });
  return [
    c(r, ring), c(r - 2, ground), c(r - 12, ring), c(r - 14, ground),
    { type: "text", bbox: [cx - r, cy - 20, cx + r, cy + 20], content: initials, font: "Jost", size: 26, colour: ring, align: "center", tracking: 6, valign: "center" },
  ];
}
function band(agency: string, i: number, total: number, colour: string) {
  return [
    { type: "text", bbox: [80, 1272, 640, 1300], content: agency.toUpperCase(), font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 },
  ];
}
/** agency initials for the ring seal: first letters of up to 3 words */
function initials(agency: string): string {
  return agency.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]?.toUpperCase() ?? "").join("") || "···";
}
/** split a headline into N visually balanced stacked lines (cartel bills) */
function stack(text: string, n: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= n) return words;
  const per = Math.ceil(words.join(" ").length / n);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > per && lines.length < n - 1) { lines.push(line); line = w; }
    else line = line ? line + " " + w : w;
  }
  if (line) lines.push(line);
  return lines;
}
async function renderAll(specs: unknown[], photos: Buffer[], grain: number): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s as DesignSpec, { width: W, height: H }, photos), grain));
  return out;
}

// ═══ CARTEL — planned (tips) ══════════════════════════════════════════════════
function cartelPlanned(plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand): unknown[] {
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const total = plan.tips.length + 4;
  const rule = (y: number, colour: string) => ({ type: "rect", bbox: [200, y, 880, y + 2], fill: colour });
  const specs: unknown[] = [];

  // cover: giant ¿ + hook stacked, middle line hollow
  const lines = stack(plan.hook_title.toUpperCase(), 3);
  const coverEls: any[] = [{ type: "text", bbox: [60, 100, 420, 520], content: "¿", font: FR, size: 380, colour: GOLD }];
  const ys = [470, 640, 880];
  const sizes = [96, 140, 62];
  lines.forEach((ln, i) => {
    coverEls.push({
      type: "text", bbox: [80, ys[i] ?? 880, 1000, (ys[i] ?? 880) + (sizes[i] ?? 62) + 40], content: ln,
      font: "Anton", size: sizes[i] ?? 62, colour: i === 2 ? GOLD : CREAM, align: "center",
      ...(i === 1 ? { hollow: true, stroke_width: 3 } : {}),
    });
    if (i < 2) coverEls.push(rule((ys[i + 1] ?? 880) - 24, GOLD));
  });
  coverEls.push({ type: "text", bbox: [80, 1050, 1000, 1082], content: plan.eyebrow.toUpperCase(), font: "Archivo", size: 20, colour: mix(CREAM, NAVY, 0.7), align: "center", tracking: 4 });
  coverEls.push(...band(agency, 1, total, mix("#f3efe6", NAVY, 0.6)));
  specs.push(DesignSpec.parse({ background: NAVY, elements: coverEls }));

  // slide 2: terracotta gamma turn
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      { type: "text", bbox: [80, 260, 1000, 560], content: wrap(plan.slide2_title.toUpperCase(), "Anton", 100, 900), font: "Anton", size: 100, colour: LIME, align: "center", line_height: 114, valign: "center" },
      rule(640, LIME),
      { type: "text", bbox: [140, 700, 940, 900], content: wrap(plan.slide2_body, "Archivo", 32, 780), font: "Archivo", size: 32, colour: LIME, align: "center", line_height: 48 },
      { type: "text", bbox: [80, 1050, 1000, 1082], content: `SIGUE · Nº 1 DE ${plan.tips.length}`, font: "Archivo", size: 20, colour: LIME, align: "center", tracking: 4 },
      ...band(agency, 2, total, mix(LIME, TERRA, 0.75)),
    ],
  }));

  // value slides: giant numeral, gamma rotation of grounds
  const gammas = [
    { bg: CREAM, num: mix(GOLD, CREAM, 0.85), head: NAVY, bodyC: "#333333", kick: TERRA, ruleC: TERRA },
    { bg: NAVY, num: mix(GOLD, NAVY, 0.45), head: CREAM, bodyC: CREAM, kick: GOLD, ruleC: GOLD },
    { bg: TERRA, num: mix(LIME, TERRA, 0.35), head: LIME, bodyC: LIME, kick: LIME, ruleC: LIME },
  ];
  plan.tips.forEach((tip, i) => {
    const g = gammas[i % 3];
    specs.push(DesignSpec.parse({
      background: g.bg,
      elements: [
        { type: "text", bbox: [200, -120, 1080, 900], content: String(i + 1), font: "Anton", size: 900, colour: g.num, align: "center" },
        { type: "text", bbox: [80, 96, 600, 128], content: `Nº ${i + 1} DE ${plan.tips.length}`, font: "Archivo", size: 20, colour: g.kick, align: "left", tracking: 5 },
        { type: "text", bbox: [80, 800, 1000, 930], content: wrap(tip.title.toUpperCase(), "Anton", 58, 920), font: "Anton", size: 58, colour: g.head, align: "left", line_height: 70 },
        { type: "rect", bbox: [80, 966, 760, 968], fill: g.ruleC },
        { type: "text", bbox: [80, 996, 1000, 1160], content: wrap(tip.body, "Archivo", 32, 920), font: "Archivo", size: 32, colour: g.bodyC, align: "left", line_height: 48 },
        ...band(agency, i + 3, total, mix(g.head, g.bg, 0.55)),
      ],
    }));
  });

  // recap: the bill
  const rowH = Math.min(152, 800 / plan.tips.length);
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 175], content: wrap(plan.recap_title.toUpperCase(), "Anton", 60, 920), font: "Anton", size: 60, colour: NAVY, align: "center" },
      { type: "text", bbox: [80, 205, 1000, 235], content: plan.eyebrow.toUpperCase(), font: "Archivo", size: 20, colour: TERRA, align: "center", tracking: 5 },
      ...plan.tips.flatMap((tip, i) => {
        const y = 300 + i * rowH;
        return [
          { type: "text", bbox: [80, y, 200, y + rowH - 40], content: String(i + 1), font: FR, size: Math.min(72, rowH - 60), colour: brand.gold, align: "center", valign: "center" },
          { type: "text", bbox: [220, y, 1000, y + rowH - 40], content: wrap(tip.title.toUpperCase(), "Anton", 42, 780), font: "Anton", size: 42, colour: NAVY, align: "left", line_height: 50, valign: "center" },
          { type: "rect", bbox: [80, y + rowH - 30, 1000, y + rowH - 28], fill: mix(NAVY, CREAM, 0.25) },
        ];
      }),
      { type: "text", bbox: [230, 1130, 850, 1186], content: plan.save_line.toUpperCase(), font: "Archivo", size: 23, colour: CREAM, align: "center", weight: "500", tracking: 2, valign: "center", pill: { fill: NAVY, pad_x: 34, pad_y: 16 } },
      ...band(agency, total - 1, total, mix(NAVY, CREAM, 0.55)),
    ],
  }));

  // CTA on gold
  specs.push(DesignSpec.parse({
    background: brand.gold,
    elements: [
      { type: "text", bbox: [80, 220, 1000, 500], content: wrap(plan.cta_heading.toUpperCase(), "Anton", 110, 920), font: "Anton", size: 110, colour: NAVY, align: "center", line_height: 124, valign: "center" },
      { type: "rect", bbox: [340, 560, 740, 563], fill: NAVY },
      { type: "text", bbox: [140, 620, 940, 760], content: wrap(plan.cta_action, "Archivo", 32, 780), font: "Archivo", size: 32, colour: NAVY, align: "center", line_height: 46 },
      { type: "text", bbox: [280, 830, 800, 894], content: plan.cta_keyword.toUpperCase(), font: "Archivo", size: 26, colour: brand.gold, align: "center", weight: "500", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 44, pad_y: 20 } },
      { type: "text", bbox: [80, 990, 1000, 1040], content: "→ → →", font: "Anton", size: 44, colour: NAVY, align: "center", tracking: 30 },
      { type: "text", bbox: [80, 1110, 1000, 1140], content: contact.toUpperCase(), font: "Archivo", size: 20, colour: NAVY, align: "center", tracking: 3 },
      ...band(agency, total, total, mix(NAVY, brand.gold, 0.8)),
    ],
  }));
  return specs;
}

// ═══ ENCALADA — planned (tips + quote) ════════════════════════════════════════
function encaladaPlanned(plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand): unknown[] {
  const NAVY = brand.navy;
  const inkMuted = mix(NAVY, LIME, 0.55);
  const tiles = (y: number) => Array.from({ length: 18 }, (_, i) => ({
    type: "rect", bbox: [80 + i * 52, y, 80 + i * 52 + 26, y + 26], fill: i % 2 ? TERRA : OLIVE, opacity: 0.85, radius: 3,
  }));
  const isQuote = plan.type === "quote";
  const n = isQuote ? plan.quote_parts.length : plan.tips.length;
  const total = n + (isQuote ? 3 : 4);
  const specs: unknown[] = [];

  // cover: pure type on limewash, sun mark, tile band as the single motif
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "text", bbox: [80, 180, 1000, 214], content: plan.eyebrow.toUpperCase(), font: "Questrial", size: 22, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [90, 300, 990, 900], content: wrap(isQuote ? `“${plan.quote_hook}”` : plan.hook_title, FR, 92, 880), font: FR, size: 92, colour: NAVY, align: "center", line_height: 110, valign: "center" },
      ...(isQuote && plan.attribution ? [{ type: "text", bbox: [80, 950, 1000, 990], content: plan.attribution, font: "Questrial", size: 26, colour: inkMuted, align: "center", tracking: 1 }] : []),
      { type: "text", bbox: [500, 990, 580, 1080], content: "*", font: FR, size: 110, colour: brand.gold, align: "center" },
      ...tiles(1150),
      ...band(agency, 1, total, inkMuted),
    ],
  }));

  // slide 2: standalone context on terracotta
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      { type: "rect", bbox: [80, 300, 164, 304], fill: LIME },
      { type: "text", bbox: [80, 360, 1000, 760], content: wrap(plan.slide2_title, FR, 74, 920), font: FR, size: 74, colour: LIME, align: "left", line_height: 90, valign: "center" },
      { type: "text", bbox: [80, 820, 1000, 1040], content: wrap(isQuote ? plan.quote_context : plan.slide2_body, "Jost", 33, 920), font: "Jost", size: 33, colour: LIME, align: "left", line_height: 50 },
      ...band(agency, 2, total, mix(LIME, TERRA, 0.75)),
    ],
  }));

  if (isQuote) {
    plan.quote_parts.forEach((part, i) => {
      specs.push(DesignSpec.parse({
        background: LIME,
        elements: [
          { type: "text", bbox: [70, 110, 380, 310], content: "“", font: FR, size: 230, colour: TERRA, align: "left" },
          { type: "text", bbox: [90, 340, 990, 980], content: wrap(part, FR, 60, 900), font: FR, size: 60, colour: NAVY, align: "left", line_height: 82, valign: "center" },
          ...(i === plan.quote_parts.length - 1 && plan.attribution ? [
            { type: "rect", bbox: [90, 1046, 154, 1049], fill: OLIVE },
            { type: "text", bbox: [90, 1076, 990, 1118], content: plan.attribution, font: "Questrial", size: 28, colour: inkMuted, align: "left", tracking: 1 },
          ] : []),
          ...band(agency, i + 3, total, inkMuted),
        ],
      }));
    });
  } else {
    // value slides: Fraunces numeral + olive rules, limewash/terracotta alternation
    plan.tips.forEach((tip, i) => {
      const dark = i % 2 === 1;
      const bg = dark ? TERRA : LIME, head = dark ? LIME : NAVY, bodyC = dark ? LIME : "#333333";
      specs.push(DesignSpec.parse({
        background: bg,
        elements: [
          { type: "text", bbox: [80, 80, 620, 350], content: String(i + 1).padStart(2, "0"), font: FR, size: 240, colour: dark ? mix(LIME, TERRA, 0.4) : brand.gold, align: "left" },
          { type: "rect", bbox: [80, 404, 164, 408], fill: dark ? LIME : OLIVE },
          { type: "text", bbox: [80, 456, 1000, 660], content: wrap(tip.title, FR, 62, 920), font: FR, size: 62, colour: head, align: "left", line_height: 76 },
          { type: "text", bbox: [80, 700, 1000, 1080], content: wrap(tip.body, "Jost", 35, 920), font: "Jost", size: 35, colour: bodyC, align: "left", line_height: 54, valign: "center" },
          ...(tip.teaser ? [{ type: "text", bbox: [80, 1130, 900, 1178], content: tip.teaser, font: "Jost", size: 25, colour: dark ? TERRA : LIME, align: "left", weight: "500", valign: "center", pill: { fill: dark ? LIME : OLIVE, pad_x: 26, pad_y: 13 } }] : []),
          ...band(agency, i + 3, total, dark ? mix(LIME, TERRA, 0.75) : inkMuted),
        ],
      }));
    });
    // recap: LA FICHA list
    const rowH = Math.min(150, 760 / plan.tips.length);
    specs.push(DesignSpec.parse({
      background: LIME,
      elements: [
        { type: "text", bbox: [80, 120, 1000, 154], content: plan.eyebrow.toUpperCase(), font: "Questrial", size: 21, colour: TERRA, align: "center", tracking: 7 },
        { type: "text", bbox: [80, 190, 1000, 300], content: wrap(plan.recap_title, FR, 64, 920), font: FR, size: 64, colour: NAVY, align: "center" },
        ...plan.tips.flatMap((tip, i) => {
          const y = 380 + i * rowH;
          return [
            { type: "text", bbox: [100, y, 210, y + rowH - 44], content: String(i + 1).padStart(2, "0"), font: FR, size: 44, colour: brand.gold, align: "left", valign: "center" },
            { type: "text", bbox: [230, y, 980, y + rowH - 44], content: wrap(tip.title, "Jost", 31, 750, "500"), font: "Jost", size: 31, colour: NAVY, align: "left", weight: "500", line_height: 38, valign: "center" },
            { type: "rect", bbox: [230, y + rowH - 36, 980, y + rowH - 34.5], fill: mix(OLIVE, LIME, 0.5) },
          ];
        }),
        { type: "text", bbox: [230, 1140, 850, 1192], content: plan.save_line, font: "Jost", size: 26, colour: LIME, align: "center", weight: "500", valign: "center", pill: { fill: OLIVE, pad_x: 34, pad_y: 15 } },
        ...band(agency, total - 1, total, inkMuted),
      ],
    }));
  }

  // CTA: terracotta + seal
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      ...seal(540, 340, 100, LIME, TERRA, initials(agency)),
      { type: "text", bbox: [110, 520, 970, 730], content: wrap(plan.cta_heading, FR, 72, 860), font: FR, size: 72, colour: LIME, align: "center", line_height: 88, valign: "center" },
      { type: "text", bbox: [140, 780, 940, 900], content: wrap(plan.cta_action, "Jost", 30, 780), font: "Jost", size: 30, colour: LIME, align: "center", line_height: 44 },
      { type: "text", bbox: [290, 960, 790, 1020], content: plan.cta_keyword.toUpperCase(), font: "Jost", size: 25, colour: TERRA, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: LIME, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [110, 1100, 970, 1130], content: contact, font: "Jost", size: 21, colour: mix(LIME, TERRA, 0.8), align: "center", tracking: 2 },
      ...band(agency, total, total, mix(LIME, TERRA, 0.75)),
    ],
  }));
  return specs;
}

// ═══ SERENO — planned (tips + quote) ══════════════════════════════════════════
function serenoPlanned(plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand): unknown[] {
  const NAVY = brand.navy, GOLD = brand.gold;
  const warm = "#f5f1e8";
  const inkMuted = mix(NAVY, warm, 0.55);
  const isQuote = plan.type === "quote";
  const n = isQuote ? plan.quote_parts.length : plan.tips.length;
  const total = n + (isQuote ? 3 : 4);
  const spine = (i: number) => ({ type: "text", bbox: [980, 400, 1050, 950], content: `${agency.toUpperCase()} · Nº ${String(i).padStart(2, "0")} · MMXXVI`, font: "Glacial Indifference", size: 18, colour: inkMuted, tracking: 5, rotate: 90, align: "center" });
  const folioLine = (i: number, colour: string) => ({ type: "text", bbox: [96, 1240, 940, 1270], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")} · ${agency.toUpperCase()}`, font: "Jost", size: 16, colour, align: "left", tracking: 3 });
  const specs: unknown[] = [];

  // cover
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
      { type: "text", bbox: [96, 96, 700, 128], content: agency.toUpperCase(), font: "Jost", size: 19, colour: inkMuted, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [96, 300, 900, 334], content: plan.eyebrow.toUpperCase(), font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
      { type: "text", bbox: [96, 380, 920, 1020], content: wrap(isQuote ? `“${plan.quote_hook}”` : plan.hook_title, FR, 92, 800), font: FR, size: 92, colour: NAVY, align: "left", line_height: 110, valign: "center" },
      ...(isQuote && plan.attribution ? [{ type: "text", bbox: [96, 1080, 920, 1120], content: plan.attribution, font: "Glacial Indifference", size: 24, colour: inkMuted, align: "left", tracking: 2 }] : []),
      spine(1), folioLine(1, inkMuted),
    ],
  }));

  // slide 2 — plate context
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      { type: "text", bbox: [96, 96, 700, 128], content: plan.eyebrow.toUpperCase(), font: "Glacial Indifference", size: 19, colour: GOLD, align: "left", tracking: 6 },
      { type: "rect", bbox: [96, 380, 240, 381.5], fill: NAVY, opacity: 0.4 },
      { type: "text", bbox: [96, 430, 940, 830], content: wrap(plan.slide2_title, FR, 72, 840), font: FR, size: 72, colour: NAVY, align: "left", line_height: 88, valign: "center" },
      { type: "text", bbox: [96, 890, 940, 1090], content: wrap(isQuote ? plan.quote_context : plan.slide2_body, "Jost", 32, 840), font: "Jost", size: 32, colour: mix(NAVY, warm, 0.8), align: "left", line_height: 50 },
      spine(2), folioLine(2, inkMuted),
    ],
  }));

  if (isQuote) {
    plan.quote_parts.forEach((part, i) => {
      specs.push(DesignSpec.parse({
        background: warm,
        elements: [
          ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
          { type: "text", bbox: [80, 110, 380, 300], content: "“", font: FR, size: 220, colour: GOLD, align: "left" },
          { type: "text", bbox: [96, 340, 940, 980], content: wrap(part, FR, 58, 830), font: FR, size: 58, colour: NAVY, align: "left", line_height: 80, valign: "center" },
          ...(i === plan.quote_parts.length - 1 && plan.attribution ? [
            { type: "rect", bbox: [96, 1046, 160, 1048], fill: GOLD },
            { type: "text", bbox: [96, 1076, 940, 1116], content: plan.attribution, font: "Glacial Indifference", size: 24, colour: inkMuted, align: "left", tracking: 2 },
          ] : []),
          folioLine(i + 3, inkMuted),
        ],
      }));
    });
  } else {
    // value slides: LOT-style numerals + plate captions
    plan.tips.forEach((tip, i) => {
      specs.push(DesignSpec.parse({
        background: warm,
        elements: [
          { type: "text", bbox: [96, 110, 800, 140], content: `Nº ${i + 1} · ${plan.eyebrow.toUpperCase()}`, font: "Glacial Indifference", size: 19, colour: inkMuted, align: "left", tracking: 5 },
          { type: "text", bbox: [96, 170, 700, 400], content: String(i + 1).padStart(2, "0"), font: FR, size: 190, colour: GOLD, align: "left" },
          { type: "rect", bbox: [96, 440, 240, 441.5], fill: NAVY, opacity: 0.4 },
          { type: "text", bbox: [96, 490, 940, 700], content: wrap(tip.title, FR, 60, 840), font: FR, size: 60, colour: NAVY, align: "left", line_height: 74 },
          { type: "text", bbox: [96, 740, 940, 1100], content: wrap(tip.body, "Jost", 34, 840), font: "Jost", size: 34, colour: mix(NAVY, warm, 0.8), align: "left", line_height: 54, valign: "center" },
          ...(tip.teaser ? [{ type: "text", bbox: [96, 1140, 900, 1186], content: tip.teaser.toUpperCase(), font: "Glacial Indifference", size: 19, colour: inkMuted, align: "left", tracking: 4 }] : []),
          spine(i + 3), folioLine(i + 3, inkMuted),
        ],
      }));
    });
    // recap: stacked light numerals
    const rowH = Math.min(150, 780 / plan.tips.length);
    specs.push(DesignSpec.parse({
      background: warm,
      elements: [
        ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
        { type: "text", bbox: [96, 110, 940, 142], content: `${plan.recap_title.toUpperCase()}`, font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
        ...plan.tips.flatMap((tip, i) => {
          const y = 220 + i * rowH;
          return [
            { type: "text", bbox: [96, y, 220, y + rowH - 40], content: String(i + 1).padStart(2, "0"), font: FR, size: 52, colour: NAVY, align: "left", valign: "center" },
            { type: "text", bbox: [250, y, 940, y + rowH - 40], content: wrap(tip.title, "Jost", 30, 690, "500"), font: "Jost", size: 30, colour: mix(NAVY, warm, 0.85), align: "left", weight: "500", line_height: 38, valign: "center" },
            { type: "rect", bbox: [96, y + rowH - 30, 940, y + rowH - 29], fill: NAVY, opacity: 0.2 },
          ];
        }),
        { type: "text", bbox: [96, 1130, 940, 1190], content: plan.save_line + ".", font: FR, size: 34, colour: NAVY, align: "left", italic: true },
        folioLine(total - 1, inkMuted),
      ],
    }));
  }

  // CTA colophon
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...seal(540, 400, 110, GOLD, NAVY, initials(agency)),
      { type: "text", bbox: [140, 610, 940, 800], content: wrap(plan.cta_heading, FR, 62, 800), font: FR, size: 62, colour: brand.cream, align: "center", line_height: 78, valign: "center" },
      { type: "text", bbox: [180, 850, 900, 950], content: wrap(plan.cta_action, "Jost", 28, 720), font: "Jost", size: 28, colour: mix("#f3efe6", NAVY, 0.85), align: "center", line_height: 42 },
      { type: "text", bbox: [300, 1000, 780, 1058], content: plan.cta_keyword.toUpperCase(), font: "Glacial Indifference", size: 24, colour: NAVY, align: "center", weight: "500", tracking: 4, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [140, 1120, 940, 1150], content: contact, font: "Jost", size: 20, colour: mix("#f3efe6", NAVY, 0.65), align: "center", tracking: 2 },
      { type: "text", bbox: [96, 1240, 984, 1270], content: `Nº ${String(total).padStart(2, "0")} — ${String(total).padStart(2, "0")} · ${agency.toUpperCase()} · MMXXVI`, font: "Jost", size: 16, colour: mix("#f3efe6", NAVY, 0.6), align: "center", tracking: 3 },
    ],
  }));
  return specs;
}

/** PLANNED carousels (tips/quote) in a chosen style. 'editorial' = the approved v2 default. */
export async function renderPlannedStyled(
  style: CarouselStyle, plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand,
): Promise<Buffer[]> {
  if (style === "cartel" && plan.type === "tips") return renderAll(cartelPlanned(plan, agency, contact, brand), [], 0.05);
  if (style === "encalada") return renderAll(encaladaPlanned(plan, agency, contact, brand), [], 0.045);
  if (style === "sereno") return renderAll(serenoPlanned(plan, agency, contact, brand), [], 0.035);
  return renderPlannedCarousel(plan, agency, contact, brand);
}

// ═══ LISTING styles ═══════════════════════════════════════════════════════════

async function horizonteListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photos: Buffer[]): Promise<Buffer[]> {
  const sharp = (await import("sharp")).default;
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const meta = await sharp(photos[0]).metadata();
  const slices = (meta.width ?? 0) >= 3240 ? 3 : (meta.width ?? 0) >= 2160 ? 2 : 0;
  if (!slices) {
    // eligibility gate: not wide enough for a seamless run → the approved editorial listing
    return renderCarousel(facts, brand, photos, copy);
  }
  const PW = slices * W;
  const town = (facts.location.split("·")[0] ?? "").trim() || facts.title;
  const mutedCream = mix("#f3efe6", NAVY, 0.55);
  const total = slices + Math.max(0, Math.min(2, photos.length - 1)) + 2;

  const wordSize = Math.min(470, Math.floor((PW - 800) / Math.max(3, town.length) / 0.62));
  const els: any[] = [
    { type: "photo", photo: 0, bbox: [0, 0, PW, H], zoom: 1, x: 0.5, y: 0.62, tint: TERRA, tint_opacity: 0.08 },
    { type: "scrim", bbox: [0, 0, PW, 250], colour: "#0a0c10", direction: "down" },
    { type: "scrim", bbox: [0, 480, PW, H], colour: "#0a0c10" },
    { type: "scrim", bbox: [0, 850, PW, H], colour: "#0a0c10" },
    { type: "rect", bbox: [0, 838, PW, 840], fill: GOLD, opacity: 0.6 },
    { type: "text", bbox: [200, 520, PW * 0.74, 920], content: town.toUpperCase(), font: FR, size: wordSize, colour: "#f3efe6" },
    { type: "text", bbox: [80, 96, 1000, 130], content: facts.agency.toUpperCase(), font: "Jost", size: 21, colour: "#f3efe6", align: "left", weight: "500", tracking: 5 },
    { type: "text", bbox: [80, 950, 1000, 986], content: facts.location, font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 },
    { type: "text", bbox: [80, 1010, 1000, 1180], content: wrap(copy.hook || facts.title, CAS, 62, 900), font: CAS, size: 62, colour: "#f3efe6", align: "left", line_height: 76 },
  ];
  if (slices >= 2) {
    els.push({ type: "text", bbox: [1160, 96, 2080, 130], content: facts.location, font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 5 });
    els.push({ type: "text", bbox: [1160, 1010, 2080, 1160], content: wrap(copy.lifestyle_line || facts.title, CAS, 58, 900), font: CAS, size: 58, colour: "#f3efe6", align: "left", line_height: 72 });
  }
  const seamX = (slices - 1) * W + W; // the last seam... medallion sits at the final seam when 3 slices, else edge device skipped
  if (slices === 3) {
    els.push({ type: "rect", bbox: [2160 - 130, 470, 2160 + 130, 730], fill: GOLD, radius: 130 });
    els.push({ type: "text", bbox: [2160 - 130, 550, 2160 + 130, 660], content: "€", font: FR, size: 90, colour: NAVY, align: "center" });
    if (facts.price) els.push({ type: "text", bbox: [2330, 520, 3000, 590], content: facts.price, font: CAS, size: 56, colour: GOLD, align: "left" });
    if (facts.specs) els.push({ type: "text", bbox: [2330, 610, 3100, 642], content: facts.specs, font: "Jost", size: 21, colour: "#f3efe6", align: "left", tracking: 4 });
    els.push({ type: "text", bbox: [2240, 96, 3160, 130], content: facts.agency.toUpperCase(), font: "Jost", size: 21, colour: "#f3efe6", align: "left", weight: "500", tracking: 5 });
    els.push({ type: "text", bbox: [2240, 1080, 3160, 1150], content: "Sigue →", font: CAS, size: 44, colour: GOLD, align: "left" });
  } else if (facts.price) {
    els.push({ type: "text", bbox: [1160, 520, 2000, 600], content: facts.price, font: CAS, size: 60, colour: GOLD, align: "left" });
  }
  for (let s = 0; s < slices; s++) {
    els.push({ type: "text", bbox: [s * W + 700, 1272, s * W + 1000, 1300], content: `Nº ${String(s + 1).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour: mutedCream, align: "right", tracking: 3 });
  }
  void seamX;
  const pano = await renderWideSliced(DesignSpec.parse({ background: NAVY, elements: els }), slices, photos);

  // discrete: up to 2 matted interior slides, then spec plate + CTA
  const specs: unknown[] = [];
  const interior = photos.slice(1, 3);
  interior.forEach((_, k) => {
    const idx = slices + k + 1;
    const feature = facts.features[k] ?? "";
    specs.push(DesignSpec.parse({
      background: CREAM,
      elements: [
        { type: "photo", photo: k + 1, bbox: [80, 150, 1000, 830], tint: TERRA, tint_opacity: 0.08 },
        ...frame([64, 134, 1016, 846], NAVY, 1.5, 0.5),
        { type: "text", bbox: [80, 900, 1000, 932], content: (feature || facts.location).toUpperCase(), font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "left", tracking: 5 },
        { type: "text", bbox: [80, 960, 1000, 1090], content: wrap(k === 0 ? (copy.lifestyle_line || facts.title) : facts.title, CAS, 50, 920), font: CAS, size: 50, colour: NAVY, align: "left", line_height: 64 },
        ...(facts.specs ? [
          { type: "rect", bbox: [80, 1130, 1000, 1131.5], fill: GOLD, opacity: 0.5 },
          { type: "text", bbox: [80, 1156, 1000, 1188], content: facts.specs, font: "Jost", size: 20, colour: NAVY, align: "left", tracking: 3 },
        ] : []),
        { type: "text", bbox: [80, 1272, 640, 1300], content: facts.agency.toUpperCase(), font: "Jost", size: 17, colour: mix(NAVY, CREAM, 0.55), align: "left", weight: "500", tracking: 4 },
        { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(idx).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour: mix(NAVY, CREAM, 0.55), align: "right", tracking: 3 },
      ],
    }));
  });

  // spec plate
  const rows: [string, string][] = [];
  if (facts.price) rows.push(["PRECIO", facts.price]);
  if (facts.area) rows.push(["SUPERFICIE", facts.area]);
  if (facts.beds) rows.push(["DORMITORIOS", facts.beds]);
  if (facts.baths) rows.push(["BAÑOS", facts.baths]);
  if (facts.features[0]) rows.push(["EXTRAS", facts.features.slice(0, 2).join(" · ")]);
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 96, 1000, 130], content: facts.agency.toUpperCase(), font: "Jost", size: 21, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [80, 210, 1000, 330], content: wrap(facts.title, FR, 80, 920), font: FR, size: 80, colour: CREAM, align: "left" },
      ...rows.flatMap(([k, v], i) => {
        const y = 420 + i * Math.min(132, 640 / rows.length);
        const rh = Math.min(132, 640 / rows.length);
        return [
          { type: "text", bbox: [80, y, 460, y + 34], content: k, font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 5 },
          { type: "text", bbox: [460, y - 14, 1000, y + 50], content: v, font: CAS, size: 44, colour: CREAM, align: "right" },
          { type: "rect", bbox: [80, y + rh - 48, 1000, y + rh - 47], fill: GOLD, opacity: 0.3 },
        ];
      }),
      { type: "text", bbox: [80, 1140, 940, 1190], content: "Guarda esta ficha para tu visita", font: "Jost", size: 26, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 14 } },
      { type: "text", bbox: [80, 1272, 640, 1300], content: facts.agency.toUpperCase(), font: "Jost", size: 17, colour: mix("#f3efe6", NAVY, 0.6), align: "left", weight: "500", tracking: 4 },
      { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(total - 1).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour: mix("#f3efe6", NAVY, 0.6), align: "right", tracking: 3 },
    ],
  }));

  // CTA
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 96, 1000, 130], content: facts.agency.toUpperCase(), font: "Jost", size: 21, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      ...seal(540, 400, 110, GOLD, NAVY, initials(facts.agency)),
      { type: "text", bbox: [110, 610, 970, 790], content: wrap(copy.cta_action || "Guarda este anuncio para tu próxima visita.", "Jost", 34, 860, "500"), font: "Jost", size: 34, colour: CREAM, align: "center", weight: "500", line_height: 50, valign: "center" },
      { type: "text", bbox: [320, 880, 760, 940], content: (copy.cta_keyword || "ESCRÍBENOS: VISITA").toUpperCase(), font: "Jost", size: 25, colour: NAVY, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [110, 1040, 970, 1070], content: facts.contact, font: "Jost", size: 21, colour: mix("#f3efe6", NAVY, 0.65), align: "center", tracking: 2 },
      { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(total).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour: mix("#f3efe6", NAVY, 0.6), align: "right", tracking: 3 },
    ],
  }));

  const discrete: Buffer[] = [];
  for (const s of specs) discrete.push(await renderFreeform(s as DesignSpec, { width: W, height: H }, photos));
  const all = [...pano, ...discrete];
  const out: Buffer[] = [];
  for (const b of all) out.push(await applyGrain(b, 0.045));
  return out;
}

function cartelListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number): unknown[] {
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const total = Math.min(9, photoCount) + 2;
  const specs: unknown[] = [];
  const rule = (y: number, colour: string) => ({ type: "rect", bbox: [200, y, 880, y + 2], fill: colour });

  // cover: pure-type bill of the property
  const town = (facts.location.split("·")[0] ?? "").trim().toUpperCase();
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 200, 1000, 260], content: facts.location, font: "Archivo", size: 26, colour: GOLD, align: "center", tracking: 6 },
      rule(300, GOLD),
      { type: "text", bbox: [80, 350, 1000, 560], content: wrap(town || facts.title.toUpperCase(), "Anton", 170, 920), font: "Anton", size: 170, colour: CREAM, align: "center", line_height: 184 },
      rule(620, GOLD),
      { type: "text", bbox: [80, 660, 1000, 760], content: wrap((copy.hook || facts.title).toUpperCase(), "Anton", 54, 920), font: "Anton", size: 54, colour: GOLD, align: "center", line_height: 66 },
      ...(facts.price ? [{ type: "text", bbox: [80, 830, 1000, 990], content: facts.price, font: "Anton", size: 130, colour: CREAM, align: "center", hollow: true, stroke_width: 3 }] : []),
      { type: "text", bbox: [80, 1050, 1000, 1082], content: (facts.specs || facts.location).toUpperCase(), font: "Archivo", size: 20, colour: mix(CREAM, NAVY, 0.7), align: "center", tracking: 4 },
      ...band(facts.agency, 1, total, mix("#f3efe6", NAVY, 0.6)),
    ],
  }));

  // one duotone photo slide per photo, alternating headline colours
  for (let i = 0; i < Math.min(9, photoCount); i++) {
    const line = facts.features[i] ?? (i === 0 ? facts.specs : facts.location);
    specs.push(DesignSpec.parse({
      background: NAVY,
      elements: [
        { type: "photo", photo: i, bbox: [0, 0, W, H], tint: "#3a5f94", tint_mode: "duotone" },
        { type: "scrim", bbox: [0, 0, W, 260], colour: "#0d1b2e", direction: "down" },
        { type: "scrim", bbox: [0, 760, W, H], colour: "#0d1b2e" },
        { type: "text", bbox: [80, 96, 700, 128], content: facts.location, font: "Archivo", size: 20, colour: GOLD, align: "left", tracking: 5 },
        { type: "text", bbox: [80, 900, 1000, 1090], content: wrap((line || "").toUpperCase(), "Anton", 84, 920), font: "Anton", size: 84, colour: CREAM, align: "left", line_height: 98 },
        ...band(facts.agency, i + 2, total, mix("#f3efe6", NAVY, 0.7)),
      ],
    }));
  }

  // CTA on gold with giant price
  specs.push(DesignSpec.parse({
    background: GOLD,
    elements: [
      ...(facts.price ? [{ type: "text", bbox: [80, 180, 1000, 480], content: facts.price, font: "Anton", size: 200, colour: NAVY, align: "center" }] : [
        { type: "text", bbox: [80, 220, 1000, 440], content: wrap(facts.title.toUpperCase(), "Anton", 120, 920), font: "Anton", size: 120, colour: NAVY, align: "center", line_height: 134 },
      ]),
      { type: "rect", bbox: [340, 540, 740, 543], fill: NAVY },
      { type: "text", bbox: [140, 600, 940, 720], content: wrap(copy.cta_action || "Guarda este anuncio para tu visita.", "Archivo", 32, 780), font: "Archivo", size: 32, colour: NAVY, align: "center", line_height: 46 },
      { type: "text", bbox: [280, 800, 800, 864], content: (copy.cta_keyword || "ESCRÍBENOS: VISITA").toUpperCase(), font: "Archivo", size: 26, colour: GOLD, align: "center", weight: "500", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 44, pad_y: 20 } },
      { type: "text", bbox: [80, 960, 1000, 1010], content: "→ → →", font: "Anton", size: 44, colour: NAVY, align: "center", tracking: 30 },
      { type: "text", bbox: [80, 1090, 1000, 1120], content: facts.contact.toUpperCase(), font: "Archivo", size: 20, colour: NAVY, align: "center", tracking: 3 },
      ...band(facts.agency, total, total, mix(NAVY, GOLD, 0.8)),
    ],
  }));
  return specs;
}

function encaladaListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number): unknown[] {
  const NAVY = brand.navy;
  const inkMuted = mix(NAVY, LIME, 0.55);
  const total = Math.min(4, photoCount) + 2;
  const specs: unknown[] = [];
  const tiles = (y: number) => Array.from({ length: 18 }, (_, i) => ({
    type: "rect", bbox: [80 + i * 52, y, 80 + i * 52 + 26, y + 26], fill: i % 2 ? TERRA : OLIVE, opacity: 0.85, radius: 3,
  }));

  // cover: arch-cropped hero
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "photo", photo: 0, bbox: [190, 130, 890, 800], tint: TERRA, tint_opacity: 0.1 },
      { type: "punch", bbox: [190, 130, 890, 800], fill: LIME, shape: "arch", outline: { colour: TERRA, width: 1.5, offset: 14 } },
      { type: "text", bbox: [80, 880, 1000, 912], content: facts.location, font: "Questrial", size: 22, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [100, 950, 980, 1140], content: wrap(copy.hook || facts.title, FR, 60, 860), font: FR, size: 60, colour: NAVY, align: "center", line_height: 76 },
      { type: "text", bbox: [500, 1160, 580, 1240], content: "*", font: FR, size: 110, colour: brand.gold, align: "center" },
      ...band(facts.agency, 1, total, inkMuted),
    ],
  }));

  // photo slides: porthole (slide 2) then matted plates
  for (let i = 1; i < Math.min(4, photoCount); i++) {
    const feature = facts.features[i - 1] ?? "";
    if (i === 1) {
      specs.push(DesignSpec.parse({
        background: LIME,
        elements: [
          { type: "photo", photo: i, bbox: [300, 120, 780, 600], tint: TERRA, tint_opacity: 0.1 },
          { type: "punch", bbox: [300, 120, 780, 600], fill: LIME, shape: "circle", outline: { colour: OLIVE, width: 1.5, offset: 12 } },
          { type: "text", bbox: [80, 680, 1000, 712], content: (feature || "EL DETALLE").toUpperCase(), font: "Questrial", size: 21, colour: OLIVE, align: "center", tracking: 7 },
          { type: "text", bbox: [110, 760, 970, 980], content: wrap(copy.lifestyle_line || facts.title, FR, 56, 860), font: FR, size: 56, colour: NAVY, align: "center", line_height: 72, valign: "center" },
          ...tiles(1150),
          ...band(facts.agency, i + 1, total, inkMuted),
        ],
      }));
    } else {
      specs.push(DesignSpec.parse({
        background: LIME,
        elements: [
          { type: "photo", photo: i, bbox: [80, 120, 730, 850], tint: TERRA, tint_opacity: 0.1 },
          ...frame([94, 134, 716, 836], LIME, 1.5, 0.9),
          { type: "text", bbox: [770, 300, 1010, 700], content: `${facts.location} · MMXXVI`, font: "Questrial", size: 20, colour: inkMuted, tracking: 5, rotate: 90, align: "center" },
          { type: "text", bbox: [80, 920, 640, 950], content: (feature || facts.location).toUpperCase(), font: "Questrial", size: 20, colour: TERRA, align: "left", tracking: 6 },
          { type: "rect", bbox: [80, 968, 250, 969.5], fill: OLIVE },
          { type: "text", bbox: [80, 990, 1000, 1120], content: wrap(facts.title, FR, 50, 920), font: FR, size: 50, colour: NAVY, align: "left", line_height: 66 },
          ...band(facts.agency, i + 1, total, inkMuted),
        ],
      }));
    }
  }

  // LA FICHA
  const kpi: [string, string][] = [];
  if (facts.price) kpi.push(["PRECIO", facts.price]);
  if (facts.area) kpi.push(["SUPERFICIE", facts.area]);
  if (facts.beds) kpi.push(["DORMITORIOS", facts.beds]);
  if (facts.baths) kpi.push(["BAÑOS", facts.baths]);
  const rowH = Math.min(150, 620 / Math.max(1, kpi.length));
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "text", bbox: [80, 130, 1000, 170], content: "LA FICHA", font: "Questrial", size: 22, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [80, 210, 1000, 330], content: wrap(facts.title, FR, 76, 920), font: FR, size: 76, colour: NAVY, align: "center" },
      ...kpi.flatMap(([k, v], i) => {
        const y = 440 + i * rowH;
        return [
          { type: "text", bbox: [120, y, 520, y + 34], content: k, font: "Questrial", size: 22, colour: OLIVE, align: "left", tracking: 5 },
          { type: "text", bbox: [520, y - 20, 960, y + 56], content: v, font: FR, size: 52, colour: NAVY, align: "right" },
          { type: "rect", bbox: [120, y + rowH - 56, 960, y + rowH - 54.5], fill: mix(OLIVE, LIME, 0.5) },
        ];
      }),
      { type: "text", bbox: [230, 1120, 850, 1176], content: "Guárdala para tu próxima visita", font: "Jost", size: 26, colour: LIME, align: "center", weight: "500", valign: "center", pill: { fill: OLIVE, pad_x: 34, pad_y: 16 } },
      ...band(facts.agency, total - 1, total, inkMuted),
    ],
  }));

  // CTA terracotta
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      ...seal(540, 360, 100, LIME, TERRA, initials(facts.agency)),
      { type: "text", bbox: [110, 540, 970, 740], content: wrap(copy.cta_action || "¿Te ves aquí este verano?", FR, 64, 860), font: FR, size: 64, colour: LIME, align: "center", line_height: 80, valign: "center" },
      { type: "text", bbox: [310, 860, 770, 920], content: (copy.cta_keyword || "ESCRÍBENOS: VISITA").toUpperCase(), font: "Jost", size: 25, colour: TERRA, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: LIME, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [110, 1020, 970, 1050], content: facts.contact, font: "Jost", size: 21, colour: mix(LIME, TERRA, 0.8), align: "center", tracking: 2 },
      ...band(facts.agency, total, total, mix(LIME, TERRA, 0.75)),
    ],
  }));
  return specs;
}

function serenoListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number): unknown[] {
  const NAVY = brand.navy, GOLD = brand.gold;
  const warm = "#f5f1e8";
  const inkMuted = mix(NAVY, warm, 0.55);
  const total = Math.min(3, photoCount) + 2;
  const folioLine = (i: number, colour: string) => ({ type: "text", bbox: [96, 1240, 940, 1270], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")} · ${facts.agency.toUpperCase()}`, font: "Jost", size: 16, colour, align: "left", tracking: 3 });
  const specs: unknown[] = [];

  // cover
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
      { type: "photo", photo: 0, bbox: [560, 140, 960, 640], tint: TERRA, tint_opacity: 0.06 },
      ...frame([546, 126, 974, 654], NAVY, 1.5, 0.8),
      { type: "text", bbox: [96, 96, 520, 128], content: facts.agency.toUpperCase(), font: "Jost", size: 19, colour: inkMuted, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [96, 760, 520, 792], content: facts.location, font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
      { type: "text", bbox: [96, 830, 900, 1100], content: wrap(copy.hook || facts.title, FR, 88, 800), font: FR, size: 88, colour: NAVY, align: "left", line_height: 106, valign: "center" },
      { type: "text", bbox: [980, 400, 1050, 950], content: `${facts.location} · MMXXVI`, font: "Glacial Indifference", size: 19, colour: inkMuted, tracking: 5, rotate: 90, align: "center" },
      folioLine(1, inkMuted),
    ],
  }));

  // photo slides: window frame, then full-bleed hush
  for (let i = 1; i < Math.min(3, photoCount); i++) {
    const feature = (facts.features[i - 1] ?? facts.location).toUpperCase();
    if (i === 1) {
      specs.push(DesignSpec.parse({
        background: warm,
        elements: [
          { type: "photo", photo: i, bbox: [140, 140, 940, 940], tint: TERRA, tint_opacity: 0.06 },
          ...frame([80, 400, 620, 1060], GOLD, 1.5),
          { type: "text", bbox: [96, 1010, 640, 1042], content: feature, font: "Glacial Indifference", size: 20, colour: GOLD, align: "left", tracking: 7 },
          { type: "rect", bbox: [96, 1058, 240, 1059.5], fill: NAVY, opacity: 0.4 },
          { type: "text", bbox: [96, 1080, 980, 1180], content: wrap(copy.lifestyle_line || facts.title, FR, 48, 860), font: FR, size: 48, colour: NAVY, align: "left" },
          folioLine(i + 1, inkMuted),
        ],
      }));
    } else {
      specs.push(DesignSpec.parse({
        background: "#0a0c10",
        elements: [
          { type: "photo", photo: i, bbox: [0, 0, W, H], tint: TERRA, tint_opacity: 0.06 },
          { type: "scrim", bbox: [0, 1000, W, H], colour: "#0a0c10" },
          { type: "text", bbox: [96, 1120, 980, 1152], content: feature, font: "Glacial Indifference", size: 21, colour: "#f3efe6", align: "left", tracking: 6 },
          { type: "rect", bbox: [96, 1176, 320, 1177.5], fill: GOLD, opacity: 0.7 },
          folioLine(i + 1, mix("#f3efe6", "#0a0c10", 0.6)),
        ],
      }));
    }
  }

  // collector facts
  const lots: [string, string][] = [];
  if (facts.price) lots.push(["PRECIO", facts.price]);
  if (facts.area) lots.push(["SUPERFICIE", facts.area]);
  if (facts.beds) lots.push(["DORMITORIOS", facts.beds]);
  if (facts.baths) lots.push(["BAÑOS", facts.baths]);
  const rowH = Math.min(210, 860 / Math.max(1, lots.length));
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
      { type: "text", bbox: [96, 110, 980, 142], content: `LA FICHA · ${facts.title.toUpperCase()}`, font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
      ...lots.flatMap(([k, v], i) => {
        const y = 240 + i * rowH;
        return [
          { type: "text", bbox: [96, y, 700, y + 30], content: `LOTE Nº ${i + 1} · ${k}`, font: "Glacial Indifference", size: 19, colour: inkMuted, align: "left", tracking: 5 },
          { type: "text", bbox: [96, y + 40, 980, y + Math.min(160, rowH - 40)], content: v, font: FR, size: Math.min(92, rowH - 90), colour: NAVY, align: "left" },
          { type: "rect", bbox: [96, y + rowH - 36, 980, y + rowH - 35], fill: NAVY, opacity: 0.25 },
        ];
      }),
      { type: "text", bbox: [96, 1150, 940, 1200], content: "Guarda la ficha — vuelve a ella con calma.", font: FR, size: 34, colour: NAVY, align: "left", italic: true },
      folioLine(total - 1, inkMuted),
    ],
  }));

  // colophon CTA
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...seal(540, 430, 110, GOLD, NAVY, initials(facts.agency)),
      { type: "text", bbox: [140, 640, 940, 790], content: wrap(copy.cta_action || "Para verla, una palabra basta.", FR, 54, 800), font: FR, size: 54, colour: brand.cream, align: "center", line_height: 70, valign: "center" },
      { type: "text", bbox: [320, 870, 760, 930], content: (copy.cta_keyword || "ESCRÍBENOS: VISITA").toUpperCase(), font: "Glacial Indifference", size: 24, colour: NAVY, align: "center", weight: "500", tracking: 4, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [140, 1020, 940, 1050], content: facts.contact, font: "Jost", size: 20, colour: mix("#f3efe6", NAVY, 0.65), align: "center", tracking: 2 },
      { type: "text", bbox: [96, 1240, 984, 1270], content: `Nº ${String(total).padStart(2, "0")} — ${String(total).padStart(2, "0")} · ${facts.agency.toUpperCase()} · MMXXVI`, font: "Jost", size: 16, colour: mix("#f3efe6", NAVY, 0.6), align: "center", tracking: 3 },
    ],
  }));
  return specs;
}

/** LISTING carousel in a chosen style. 'editorial' = the approved v2 default; horizonte falls back to it
 *  automatically when the hero photo is too narrow for a seamless run. */
export async function renderListingStyled(
  style: CarouselStyle, facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photos: Buffer[],
): Promise<Buffer[]> {
  if (style === "horizonte") return horizonteListing(facts, copy, brand, photos);
  if (style === "cartel") return renderAll(cartelListing(facts, copy, brand, photos.length), photos, 0.05);
  if (style === "encalada") return renderAll(encaladaListing(facts, copy, brand, photos.length), photos, 0.045);
  if (style === "sereno") return renderAll(serenoListing(facts, copy, brand, photos.length), photos, 0.035);
  return renderCarousel(facts, brand, photos, copy);
}
