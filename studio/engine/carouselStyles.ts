import { renderFreeform, DesignSpec } from "./renderFreeform";
import { textWidth } from "./renderEditable";
import {
  CarouselPlan, renderPlannedCarousel, renderWideSliced, applyGrain, mix, wrap, chrome,
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

export type CarouselStyle =
  | "vibra"
  | "editorial" | "horizonte" | "cartel" | "encalada" | "sereno"
  | "plano" | "portada" | "recorte" | "marea"
  | "cuarteto" | "brisa" | "riviera" | "ventana"
  | "bodegon" | "litoral" | "tinta" | "salitre"
  | "papel" | "arcilla" | "acuarela" | "bordado";

export const PLANNED_STYLES: Record<"tips" | "quote", CarouselStyle[]> = {
  tips: [
    "editorial", "cartel", "encalada", "sereno",
    // AI-imagery styles (Christian-approved 2026-07-17) — 3-image families from the seeded library
    "bodegon", "litoral", "tinta", "salitre", "papel", "arcilla", "acuarela", "bordado",
  ],
  quote: ["editorial", "sereno", "encalada"],
};
export const LISTING_STYLES: CarouselStyle[] = [
  "vibra", "editorial", "horizonte", "cartel", "encalada", "sereno",
  "plano", "portada", "recorte", "marea",
  "cuarteto", "brisa", "riviera", "ventana",
];

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
function cartelPlanned(plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand, lang = "es"): unknown[] {
  const T = chrome(lang);
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
      { type: "text", bbox: [80, 1050, 1000, 1082], content: `${T.follow.toUpperCase()} · 01 / ${String(plan.tips.length).padStart(2, '0')}`, font: "Archivo", size: 20, colour: LIME, align: "center", tracking: 4 },
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
  style: CarouselStyle, plan: CarouselPlan, agency: string, contact: string, brand: CarouselBrand, lang = "es",
): Promise<Buffer[]> {
  if (style === "cartel" && plan.type === "tips") return renderAll(cartelPlanned(plan, agency, contact, brand, lang), [], 0.05);
  if (style === "encalada") return renderAll(encaladaPlanned(plan, agency, contact, brand), [], 0.045);
  if (style === "sereno") return renderAll(serenoPlanned(plan, agency, contact, brand), [], 0.035);
  return renderPlannedCarousel(plan, agency, contact, brand);
}

// ═══ LISTING styles ═══════════════════════════════════════════════════════════

async function horizonteListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photos: Buffer[], lang = "es"): Promise<Buffer[]> {
  const T = chrome(lang);
  const sharp = (await import("sharp")).default;
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const meta = await sharp(photos[0]).metadata();
  const slices = (meta.width ?? 0) >= 3240 ? 3 : (meta.width ?? 0) >= 2160 ? 2 : 0;
  if (!slices) {
    // eligibility gate: not wide enough for a seamless run → the approved editorial listing
    return renderCarousel(facts, brand, photos, copy, lang);
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
    els.push({ type: "text", bbox: [2240, 1080, 3160, 1150], content: `${T.follow} →`, font: CAS, size: 44, colour: GOLD, align: "left" });
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
  if (facts.price) rows.push([T.price, facts.price]);
  if (facts.area) rows.push([T.area, facts.area]);
  if (facts.beds) rows.push([T.bedrooms, facts.beds]);
  if (facts.baths) rows.push([T.bathrooms, facts.baths]);
  if (facts.features[0]) rows.push([T.extras, facts.features.slice(0, 2).join(" · ")]);
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
      { type: "text", bbox: [80, 1140, 940, 1190], content: T.save_sheet, font: "Jost", size: 26, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 14 } },
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
      { type: "text", bbox: [110, 610, 970, 790], content: wrap(copy.cta_action || T.save_cta, "Jost", 34, 860, "500"), font: "Jost", size: 34, colour: CREAM, align: "center", weight: "500", line_height: 50, valign: "center" },
      { type: "text", bbox: [320, 880, 760, 940], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 25, colour: NAVY, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
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

function cartelListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
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
      { type: "text", bbox: [140, 600, 940, 720], content: wrap(copy.cta_action || T.save_cta, "Archivo", 32, 780), font: "Archivo", size: 32, colour: NAVY, align: "center", line_height: 46 },
      { type: "text", bbox: [280, 800, 800, 864], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Archivo", size: 26, colour: GOLD, align: "center", weight: "500", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 44, pad_y: 20 } },
      { type: "text", bbox: [80, 960, 1000, 1010], content: "→ → →", font: "Anton", size: 44, colour: NAVY, align: "center", tracking: 30 },
      { type: "text", bbox: [80, 1090, 1000, 1120], content: facts.contact.toUpperCase(), font: "Archivo", size: 20, colour: NAVY, align: "center", tracking: 3 },
      ...band(facts.agency, total, total, mix(NAVY, GOLD, 0.8)),
    ],
  }));
  return specs;
}

function encaladaListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
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
          { type: "text", bbox: [80, 680, 1000, 712], content: (feature || T.the_detail).toUpperCase(), font: "Questrial", size: 21, colour: OLIVE, align: "center", tracking: 7 },
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
  if (facts.price) kpi.push([T.price, facts.price]);
  if (facts.area) kpi.push([T.area, facts.area]);
  if (facts.beds) kpi.push([T.bedrooms, facts.beds]);
  if (facts.baths) kpi.push([T.bathrooms, facts.baths]);
  const rowH = Math.min(150, 620 / Math.max(1, kpi.length));
  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "text", bbox: [80, 130, 1000, 170], content: T.the_sheet, font: "Questrial", size: 22, colour: TERRA, align: "center", tracking: 7 },
      { type: "text", bbox: [80, 210, 1000, 330], content: wrap(facts.title, FR, 76, 920), font: FR, size: 76, colour: NAVY, align: "center" },
      ...kpi.flatMap(([k, v], i) => {
        const y = 440 + i * rowH;
        return [
          { type: "text", bbox: [120, y, 520, y + 34], content: k, font: "Questrial", size: 22, colour: OLIVE, align: "left", tracking: 5 },
          { type: "text", bbox: [520, y - 20, 960, y + 56], content: v, font: FR, size: 52, colour: NAVY, align: "right" },
          { type: "rect", bbox: [120, y + rowH - 56, 960, y + rowH - 54.5], fill: mix(OLIVE, LIME, 0.5) },
        ];
      }),
      { type: "text", bbox: [230, 1120, 850, 1176], content: T.save_sheet, font: "Jost", size: 26, colour: LIME, align: "center", weight: "500", valign: "center", pill: { fill: OLIVE, pad_x: 34, pad_y: 16 } },
      ...band(facts.agency, total - 1, total, inkMuted),
    ],
  }));

  // CTA terracotta
  specs.push(DesignSpec.parse({
    background: TERRA,
    elements: [
      ...seal(540, 360, 100, LIME, TERRA, initials(facts.agency)),
      { type: "text", bbox: [110, 540, 970, 740], content: wrap(copy.cta_action || T.save_cta, FR, 64, 860), font: FR, size: 64, colour: LIME, align: "center", line_height: 80, valign: "center" },
      { type: "text", bbox: [310, 860, 770, 920], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 25, colour: TERRA, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: LIME, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [110, 1020, 970, 1050], content: facts.contact, font: "Jost", size: 21, colour: mix(LIME, TERRA, 0.8), align: "center", tracking: 2 },
      ...band(facts.agency, total, total, mix(LIME, TERRA, 0.75)),
    ],
  }));
  return specs;
}

function serenoListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
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
  if (facts.price) lots.push([T.price, facts.price]);
  if (facts.area) lots.push([T.area, facts.area]);
  if (facts.beds) lots.push([T.bedrooms, facts.beds]);
  if (facts.baths) lots.push([T.bathrooms, facts.baths]);
  const rowH = Math.min(210, 860 / Math.max(1, lots.length));
  specs.push(DesignSpec.parse({
    background: warm,
    elements: [
      ...frame([40, 40, 1040, 1310], NAVY, 1.5, 0.35),
      { type: "text", bbox: [96, 110, 980, 142], content: `${T.the_sheet} · ${facts.title.toUpperCase()}`, font: "Glacial Indifference", size: 21, colour: GOLD, align: "left", tracking: 7 },
      ...lots.flatMap(([k, v], i) => {
        const y = 240 + i * rowH;
        return [
          { type: "text", bbox: [96, y, 700, y + 30], content: `${T.lot} ${i + 1} · ${k}`, font: "Glacial Indifference", size: 19, colour: inkMuted, align: "left", tracking: 5 },
          { type: "text", bbox: [96, y + 40, 980, y + Math.min(160, rowH - 40)], content: v, font: FR, size: Math.min(92, rowH - 90), colour: NAVY, align: "left" },
          { type: "rect", bbox: [96, y + rowH - 36, 980, y + rowH - 35], fill: NAVY, opacity: 0.25 },
        ];
      }),
      { type: "text", bbox: [96, 1150, 940, 1200], content: T.save_calm, font: FR, size: 34, colour: NAVY, align: "left", italic: true },
      folioLine(total - 1, inkMuted),
    ],
  }));

  // colophon CTA
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...seal(540, 430, 110, GOLD, NAVY, initials(facts.agency)),
      { type: "text", bbox: [140, 640, 940, 790], content: wrap(copy.cta_action || T.save_cta, FR, 54, 800), font: FR, size: 54, colour: brand.cream, align: "center", line_height: 70, valign: "center" },
      { type: "text", bbox: [320, 870, 760, 930], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Glacial Indifference", size: 24, colour: NAVY, align: "center", weight: "500", tracking: 4, valign: "center", pill: { fill: GOLD, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [140, 1020, 940, 1050], content: facts.contact, font: "Jost", size: 20, colour: mix("#f3efe6", NAVY, 0.65), align: "center", tracking: 2 },
      { type: "text", bbox: [96, 1240, 984, 1270], content: `Nº ${String(total).padStart(2, "0")} — ${String(total).padStart(2, "0")} · ${facts.agency.toUpperCase()} · MMXXVI`, font: "Jost", size: 16, colour: mix("#f3efe6", NAVY, 0.6), align: "center", tracking: 3 },
    ],
  }));
  return specs;
}

// ═══ PLANO — annotated blueprint (approved round 2) ═══════════════════════════
function planoCallout(x: number, y: number, w: number, text: string, colour: string, toX: number, toY: number, paper?: string) {
  const hairline = Math.abs(toY - y) > Math.abs(toX - x)
    ? { type: "rect", bbox: [Math.min(x + w / 2, toX), Math.min(y, toY), Math.min(x + w / 2, toX) + 1, Math.max(y, toY)], fill: colour, opacity: 0.7 }
    : { type: "rect", bbox: [Math.min(x, toX), Math.min(y + 20, toY), Math.max(x, toX), Math.min(y + 20, toY) + 1], fill: colour, opacity: 0.7 };
  return [
    hairline,
    ...(paper ? [{ type: "rect", bbox: [x, y, x + w, y + 42], fill: paper, opacity: 0.82 }] : []),
    ...frame([x, y, x + w, y + 42], colour, 1),
    { type: "text", bbox: [x + 12, y, x + w - 12, y + 42], content: text, font: "Archivo", size: 17, colour, align: "left", tracking: 3, valign: "center" },
  ];
}
function planoListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const specimen = photoCount >= 3;
  const total = 3 + (specimen ? 1 : 0) + 1;
  const [town, region] = facts.location.split("·").map((s) => s.trim());
  const numeral = facts.area ? facts.area.replace(/\s*m²/i, "") : facts.beds || "1";
  const numeralLabel = facts.area ? (copy.hook || facts.title) : facts.title;
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...frame([40, 40, 1040, 1310], GOLD, 1, 0.4),
      { type: "text", bbox: [70, 250, 1010, 900], content: numeral, font: FR, size: Math.min(560, 1500 / Math.max(2, numeral.length)), colour: CREAM, align: "center", valign: "center" },
      { type: "text", bbox: [80, 850, 1000, 910], content: wrap(numeralLabel.toUpperCase(), "Anton", 52, 900), font: "Anton", size: 52, colour: GOLD, align: "center", line_height: 62 },
      ...(town ? planoCallout(90, 150, 300, town.toUpperCase(), GOLD, 240, 320) : []),
      ...(region ? planoCallout(700, 150, 290, region.toUpperCase(), GOLD, 840, 320) : []),
      ...(facts.beds ? planoCallout(90, 1000, 300, `${facts.beds} ${T.bedrooms}`, GOLD, 240, 900) : []),
      ...(facts.baths ? planoCallout(660, 1000, 330, `${facts.baths} ${T.bathrooms}`, GOLD, 800, 900) : []),
      ...Array.from({ length: 21 }, (_, i) => ({ type: "rect", bbox: [90 + i * 45, 940, 91.5 + i * 45, i % 5 === 0 ? 962 : 952], fill: GOLD, opacity: 0.7 })),
      { type: "text", bbox: [80, 1090, 1000, 1130], content: [facts.title, facts.price].filter(Boolean).join(" · ").toUpperCase(), font: "Archivo", size: 22, colour: CREAM, align: "center", tracking: 5 },
      ...band(facts.agency, 1, total, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: LIME,
    elements: [
      { type: "photo", photo: 0, bbox: [90, 160, 990, 1010], tint: NAVY, tint_opacity: 0.1 },
      ...frame([90, 160, 990, 1010], NAVY, 1.5),
      ...Array.from({ length: 19 }, (_, i) => ({ type: "rect", bbox: [90 + i * 47.4, 1022, 91.5 + i * 47.4, i % 5 === 0 ? 1046 : 1036], fill: NAVY, opacity: 0.7 })),
      ...Array.from({ length: 17 }, (_, i) => ({ type: "rect", bbox: [66, 160 + i * 50, 76, 161.5 + i * 50], fill: NAVY, opacity: 0.7 })),
      ...(facts.features[0] ? planoCallout(130, 210, 340, `① ${facts.features[0].toUpperCase()}`.slice(0, 30), NAVY, 380, 700, LIME) : []),
      ...(facts.features[1] ? planoCallout(600, 320, 350, `② ${facts.features[1].toUpperCase()}`.slice(0, 30), NAVY, 800, 620, LIME) : []),
      { type: "text", bbox: [1004, 400, 1064, 900], content: `${facts.location} · ${facts.agency.toUpperCase()}`, font: "Archivo", size: 16, colour: mix(NAVY, LIME, 0.6), tracking: 4, rotate: 90, align: "center" },
      { type: "text", bbox: [90, 1080, 990, 1190], content: wrap(copy.lifestyle_line || facts.title, FR, 54, 900), font: FR, size: 54, colour: NAVY, align: "left", line_height: 68 },
      ...band(facts.agency, 2, total, mix(NAVY, LIME, 0.55)),
    ],
  }));

  if (specimen) {
    specs.push(DesignSpec.parse({
      background: LIME,
      elements: [
        { type: "text", bbox: [80, 110, 1000, 145], content: `${T.the_detail} · 01 02 03`, font: "Archivo", size: 20, colour: TERRA, align: "left", tracking: 6 },
        ...[0, 1, 2].map((i) => ({ type: "photo", photo: i, bbox: [110 + i * 300, 240, 370 + i * 300, 500], tint: NAVY, tint_opacity: 0.08 })),
        ...[0, 1, 2].map((i) => ({ type: "punch", bbox: [110 + i * 300, 240, 370 + i * 300, 500], fill: LIME, shape: "circle", outline: { colour: NAVY, width: 1, offset: 8 } })),
        ...[0, 1, 2].flatMap((i) => [
          { type: "text", bbox: [110 + i * 300, 540, 370 + i * 300, 580], content: `0${i + 1}`, font: FR, size: 36, colour: brand.gold, align: "center" },
          { type: "rect", bbox: [140 + i * 300, 600, 340 + i * 300, 601], fill: mix(NAVY, LIME, 0.4) },
        ]),
        { type: "text", bbox: [80, 680, 1000, 880], content: wrap(copy.hook || facts.title, FR, 68, 920), font: FR, size: 68, colour: NAVY, align: "left", line_height: 84 },
        { type: "text", bbox: [80, 940, 1000, 1100], content: wrap(facts.features.slice(0, 3).join(" · ") || facts.location, "Jost", 30, 920), font: "Jost", size: 30, colour: mix(NAVY, LIME, 0.85), align: "left", line_height: 46 },
        ...band(facts.agency, 3, total, mix(NAVY, LIME, 0.55)),
      ],
    }));
  }

  const rows: [string, string][] = [];
  if (facts.price) rows.push([T.price, facts.price]);
  if (facts.area) rows.push([T.area, facts.area]);
  if (facts.beds) rows.push([T.bedrooms, facts.beds]);
  if (facts.baths) rows.push([T.bathrooms, facts.baths]);
  if (facts.features[0]) rows.push([T.extras, facts.features.slice(0, 2).join(" · ")]);
  const rowH = Math.min(150, 800 / Math.max(1, rows.length));
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...frame([40, 40, 1040, 1310], GOLD, 1, 0.4),
      { type: "text", bbox: [90, 110, 990, 145], content: `${T.the_sheet} · ${facts.title.toUpperCase()}`, font: "Archivo", size: 20, colour: GOLD, align: "left", tracking: 6 },
      ...rows.flatMap(([k, v], i) => {
        const y = 230 + i * rowH;
        return [
          { type: "text", bbox: [90, y, 460, y + 40], content: `${String(i + 1).padStart(2, "0")} · ${k}`, font: "Archivo", size: 20, colour: mix(CREAM, NAVY, 0.65), align: "left", tracking: 4, valign: "center" },
          { type: "text", bbox: [460, y - 24, 990, y + 64], content: v, font: FR, size: 50, colour: CREAM, align: "right" },
          { type: "rect", bbox: [90, y + rowH - 56, 990, y + rowH - 55], fill: GOLD, opacity: 0.3 },
        ];
      }),
      { type: "text", bbox: [90, 1160, 940, 1206], content: T.save_sheet.toUpperCase(), font: "Archivo", size: 20, colour: NAVY, align: "left", tracking: 2, valign: "center", pill: { fill: GOLD, pad_x: 28, pad_y: 14, radius: 4 } },
      ...band(facts.agency, total - 1, total, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      ...seal(540, 350, 100, GOLD, NAVY, initials(facts.agency)),
      ...frame([160, 540, 920, 780], GOLD, 1.5),
      { type: "text", bbox: [200, 590, 880, 680], content: wrap((copy.cta_action || T.save_cta), "Anton", 52, 640), font: "Anton", size: 52, colour: CREAM, align: "center", line_height: 62, valign: "center" },
      { type: "text", bbox: [200, 690, 880, 740], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Archivo", size: 24, colour: GOLD, align: "center", tracking: 5 },
      ...Array.from({ length: 5 }, (_, i) => ({ type: "rect", bbox: [500 + i * 18, 830, 501.5 + i * 18, 860], fill: GOLD, opacity: 1 - i * 0.18 })),
      { type: "text", bbox: [140, 920, 940, 950], content: facts.contact, font: "Jost", size: 21, colour: mix(CREAM, NAVY, 0.65), align: "center", tracking: 2 },
      ...band(facts.agency, total, total, mix(CREAM, NAVY, 0.6)),
    ],
  }));
  return specs;
}

// ═══ PORTADA — the magazine issue (approved round 2) ══════════════════════════
function portadaListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const total = 4 + (photoCount >= 3 ? 1 : 0);
  const town = (facts.location.split("·")[0] ?? "").trim().toUpperCase() || "COSTA";
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: "#0a0c10",
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], tint: TERRA, tint_opacity: 0.1 },
      { type: "scrim", bbox: [0, 0, W, 560], colour: "#0a0c10", direction: "down" },
      { type: "scrim", bbox: [0, 0, W, 420], colour: "#0a0c10", direction: "down" },
      { type: "scrim", bbox: [0, 820, W, H], colour: "#0a0c10" },
      { type: "text", bbox: [60, 90, 1020, 330], content: town, font: "Anton", size: Math.min(250, 1900 / Math.max(4, town.length)), colour: CREAM, align: "center", valign: "center" },
      { type: "text", bbox: [80, 350, 640, 384], content: facts.agency.toUpperCase(), font: "Jost", size: 20, colour: GOLD, align: "left", tracking: 5 },
      { type: "text", bbox: [640, 350, 1000, 384], content: facts.location, font: "Jost", size: 20, colour: CREAM, align: "right", tracking: 4 },
      { type: "text", bbox: [80, 880, 1000, 918], content: T.on_cover, font: "Jost", size: 20, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 940, 1000, 1120], content: wrap(copy.hook || facts.title, FR, 62, 920), font: FR, size: 62, colour: CREAM, align: "left", line_height: 78 },
      { type: "text", bbox: [80, 1160, 760, 1195], content: (facts.specs || facts.location), font: "Jost", size: 21, colour: mix(CREAM, "#0a0c10", 0.75), align: "left", tracking: 1 },
      ...(facts.price ? [
        { type: "rect", bbox: [860, 430, 1030, 600], fill: GOLD, radius: 85, rotate: 12 },
        { type: "text", bbox: [860, 480, 1030, 530], content: facts.price, font: "Jost", size: 26, colour: NAVY, align: "center", weight: "600", rotate: 12 },
        { type: "text", bbox: [860, 528, 1030, 560], content: (facts.area || facts.title).toUpperCase().slice(0, 16), font: "Jost", size: 15, colour: NAVY, align: "center", tracking: 2, rotate: 12 },
      ] : []),
      ...Array.from({ length: 24 }, (_, i) => ({ type: "rect", bbox: [850 + i * 6, 1240, 850 + i * 6 + (i % 3 === 0 ? 3 : 1.5), 1296], fill: CREAM })),
      { type: "text", bbox: [80, 1256, 640, 1284], content: facts.agency.toUpperCase(), font: "Jost", size: 17, colour: mix(CREAM, "#0a0c10", 0.7), align: "left", weight: "500", tracking: 4 },
    ],
  }));

  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [80, 100, 1000, 134], content: `${town} · ${T.on_cover} · P.02`, font: "Jost", size: 18, colour: mix(NAVY, CREAM, 0.55), align: "left", tracking: 5 },
      { type: "rect", bbox: [80, 158, 1000, 160], fill: NAVY },
      { type: "text", bbox: [80, 210, 1000, 420], content: wrap(copy.lifestyle_line || facts.title, FR, 80, 900), font: FR, size: 80, colour: NAVY, align: "left", line_height: 96 },
      { type: "photo", photo: Math.min(1, photoCount - 1), bbox: [560, 460, 1000, 1030], tint: TERRA, tint_opacity: 0.08 },
      ...frame([560, 460, 1000, 1030], NAVY, 1),
      ...facts.features.slice(0, 4).flatMap((feat, i) => {
        const y = 500 + i * 130;
        return [
          { type: "text", bbox: [80, y, 130, y + 50], content: String(i + 1).padStart(2, "0"), font: FR, size: 34, colour: GOLD, align: "left", valign: "center" },
          { type: "text", bbox: [140, y, 530, y + 90], content: wrap(feat, "Jost", 27, 380), font: "Jost", size: 27, colour: "#333333", align: "left", line_height: 38, valign: "center" },
        ];
      }),
      { type: "rect", bbox: [80, 1080, 1000, 1081], fill: mix(NAVY, CREAM, 0.3) },
      { type: "text", bbox: [80, 1100, 1000, 1135], content: `${T.follow.toUpperCase()} →`, font: "Jost", size: 19, colour: TERRA, align: "right", tracking: 4 },
      ...band(facts.agency, 2, total, mix(NAVY, CREAM, 0.55)),
    ],
  }));

  if (photoCount >= 3) {
    specs.push(DesignSpec.parse({
      background: "#0a0c10",
      elements: [
        { type: "photo", photo: 2, bbox: [0, 0, W, H], tint: TERRA, tint_opacity: 0.08 },
        { type: "scrim", bbox: [0, 700, W, H], colour: "#0a0c10" },
        { type: "text", bbox: [80, 96, 700, 128], content: `${town} · P.03`, font: "Jost", size: 18, colour: CREAM, align: "left", tracking: 5 },
        { type: "text", bbox: [70, 850, 320, 1050], content: "“", font: FR, size: 200, colour: GOLD, align: "left" },
        { type: "text", bbox: [80, 1010, 1000, 1180], content: wrap(copy.lifestyle_line || copy.hook || facts.title, FR, 58, 920), font: FR, size: 58, colour: CREAM, align: "left", line_height: 74 },
        ...band(facts.agency, 3, total, mix(CREAM, "#0a0c10", 0.7)),
      ],
    }));
  }

  const toc: [string, string][] = [];
  if (facts.price) toc.push([T.price, facts.price]);
  if (facts.area) toc.push([T.area, facts.area]);
  if (facts.beds) toc.push([T.bedrooms, facts.beds]);
  if (facts.baths) toc.push([T.bathrooms, facts.baths]);
  if (facts.features[0]) toc.push([T.extras, facts.features.slice(0, 2).join(" · ")]);
  const tocH = Math.min(150, 820 / Math.max(1, toc.length));
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 160], content: T.in_this_issue, font: "Anton", size: 46, colour: GOLD, align: "left" },
      { type: "rect", bbox: [80, 190, 1000, 192], fill: GOLD, opacity: 0.5 },
      ...toc.flatMap(([k, v], i) => {
        const y = 260 + i * tocH;
        return [
          { type: "text", bbox: [80, y, 200, y + 60], content: String(i + 1).padStart(2, "0"), font: FR, size: 42, colour: GOLD, align: "left", valign: "center" },
          { type: "text", bbox: [220, y, 620, y + 60], content: k, font: "Jost", size: 23, colour: mix(CREAM, NAVY, 0.7), align: "left", tracking: 4, valign: "center" },
          { type: "text", bbox: [520, y - 10, 1000, y + 70], content: v, font: FR, size: 44, colour: CREAM, align: "right", valign: "center" },
          { type: "rect", bbox: [80, y + tocH - 50, 1000, y + tocH - 49], fill: mix(CREAM, NAVY, 0.25) },
        ];
      }),
      { type: "text", bbox: [80, 1120, 940, 1170], content: T.save_sheet, font: "Jost", size: 25, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 14 } },
      ...band(facts.agency, total - 1, total, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "rect", bbox: [80, 120, 1000, 122], fill: NAVY },
      { type: "text", bbox: [80, 180, 1000, 430], content: wrap(copy.cta_action || T.save_cta, FR, 76, 900), font: FR, size: 76, colour: NAVY, align: "left", line_height: 92, valign: "center" },
      ...seal(540, 640, 100, TERRA, CREAM, initials(facts.agency)),
      { type: "text", bbox: [300, 860, 780, 920], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 24, colour: CREAM, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [140, 1000, 940, 1030], content: facts.contact, font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "center", tracking: 2 },
      ...band(facts.agency, total, total, mix(NAVY, CREAM, 0.55)),
    ],
  }));
  return specs;
}

// ═══ RECORTE — the structured scrapbook (approved round 2) ════════════════════
function recorteListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const paper = "#f1ece1", ink = "#2b2f36";
  const total = 4;
  const tape = (x: number, y: number, deg: number) => ({ type: "rect", bbox: [x, y, x + 150, y + 44], fill: "#e8e0cd", opacity: 0.85, rotate: deg });
  const card = (photo: number, b: [number, number, number, number], deg: number) => [
    { type: "rect", bbox: [b[0] - 18, b[1] - 18, b[2] + 18, b[3] + 60], fill: "#ffffff", rotate: deg },
    { type: "photo", photo, bbox: b, rotate: deg, tint: TERRA, tint_opacity: 0.1 },
  ];
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      ...card(0, [110, 170, 610, 590], -3),
      ...card(Math.min(1, photoCount - 1), [480, 420, 950, 810], 2),
      tape(180, 130, -8), tape(820, 390, 6),
      { type: "text", bbox: [80, 900, 1000, 940], content: facts.location, font: "Special Elite", size: 26, colour: TERRA, align: "left" },
      { type: "text", bbox: [80, 960, 1000, 1130], content: wrap(copy.hook || facts.title, FR, 62, 920), font: FR, size: 62, colour: ink, align: "left", line_height: 78 },
      { type: "text", bbox: [700, 1140, 1000, 1210], content: T.found, font: "Damion", size: 54, colour: TERRA, align: "center", rotate: -5 },
      ...band(facts.agency, 1, total, mix(ink, paper, 0.55)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      ...card(Math.min(2, photoCount - 1), [120, 140, 960, 850], -2),
      tape(160, 100, -10), tape(800, 110, 7),
      { type: "rect", bbox: [200, 900, 880, 990], fill: "#ffffff", rotate: 1.5 },
      { type: "text", bbox: [220, 920, 860, 975], content: (facts.features[0] || facts.location).slice(0, 44), font: "Special Elite", size: 28, colour: ink, align: "center", rotate: 1.5 },
      tape(480, 870, -6),
      { type: "text", bbox: [80, 1060, 1000, 1180], content: wrap(copy.lifestyle_line || facts.title, "Jost", 32, 900), font: "Jost", size: 32, colour: mix(ink, paper, 0.85), align: "center", line_height: 48 },
      ...band(facts.agency, 2, total, mix(ink, paper, 0.55)),
    ],
  }));

  const notes: [string, string][] = [];
  if (facts.price) notes.push([T.price, facts.price]);
  if (facts.area) notes.push([T.area, facts.area]);
  if (facts.beds) notes.push([T.bedrooms, facts.beds]);
  if (facts.baths) notes.push([T.bathrooms, facts.baths]);
  const spots: [number, number, number][] = [[90, 220, -2], [560, 200, 2], [120, 560, 1.5], [580, 580, -2.5]];
  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 150], content: facts.title.toUpperCase(), font: "Special Elite", size: 28, colour: TERRA, align: "center" },
      ...notes.slice(0, 4).flatMap(([k, v], i) => {
        const [x, y, deg] = spots[i];
        return [
          { type: "rect", bbox: [x, y, x + 420, y + 250], fill: "#ffffff", rotate: deg },
          tape(x + 130, y - 22, deg > 0 ? -7 : 7),
          { type: "text", bbox: [x + 30, y + 44, x + 390, y + 80], content: k, font: "Special Elite", size: 22, colour: mix(ink, "#ffffff", 0.6), align: "left", rotate: deg },
          { type: "text", bbox: [x + 30, y + 96, x + 390, y + 210], content: v, font: FR, size: Math.min(74, 700 / Math.max(4, v.length)), colour: ink, align: "left", rotate: deg, valign: "center" },
        ];
      }),
      { type: "text", bbox: [80, 920, 1000, 1060], content: wrap(copy.lifestyle_line || facts.location, FR, 56, 900), font: FR, size: 56, colour: ink, align: "center", line_height: 72 },
      ...band(facts.agency, 3, total, mix(ink, paper, 0.55)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: paper,
    elements: [
      { type: "rect", bbox: [140, 260, 940, 850], fill: "#ffffff", rotate: -1.5 },
      tape(240, 220, -9), tape(700, 230, 8),
      { type: "text", bbox: [200, 340, 880, 420], content: T.note_for_you, font: "Special Elite", size: 30, colour: TERRA, align: "center", rotate: -1.5 },
      { type: "text", bbox: [200, 440, 880, 640], content: wrap(copy.cta_action || T.save_cta, FR, 52, 640), font: FR, size: 52, colour: ink, align: "center", line_height: 68, rotate: -1.5, valign: "center" },
      { type: "text", bbox: [310, 690, 770, 748], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 24, colour: paper, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: ink, pad_x: 38, pad_y: 18 }, rotate: -1.5 },
      { type: "text", bbox: [140, 950, 940, 1000], content: T.save_sheet, font: "Jost", size: 28, colour: mix(ink, paper, 0.85), align: "center" },
      { type: "text", bbox: [140, 1060, 940, 1090], content: facts.contact, font: "Jost", size: 21, colour: mix(ink, paper, 0.6), align: "center", tracking: 2 },
      ...band(facts.agency, 4, total, mix(ink, paper, 0.55)),
    ],
  }));
  return specs;
}

// ═══ MAREA — the type wall (approved round 2) ═════════════════════════════════
function mareaListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const total = 4;
  const town = (facts.location.split("·")[0] ?? "").trim().toUpperCase() || facts.title.toUpperCase();
  const hookLines = (copy.hook || facts.title).toUpperCase().split(" ");
  const l1 = hookLines.slice(0, Math.ceil(hookLines.length / 2)).join(" ");
  const l2 = hookLines.slice(Math.ceil(hookLines.length / 2)).join(" ");
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], tint: "#2b4a75", tint_mode: "duotone" },
      { type: "scrim", bbox: [0, 0, W, 300], colour: "#101c2e", direction: "down" },
      { type: "scrim", bbox: [0, 500, W, H], colour: "#101c2e" },
      { type: "text", bbox: [80, 96, 700, 128], content: facts.agency.toUpperCase(), font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [-30, 320, 1110, 620], content: town, font: "Anton", size: Math.min(260, 1900 / Math.max(4, town.length)), colour: CREAM, align: "center", hollow: true, stroke_width: 3.5, valign: "center" },
      { type: "rect", bbox: [-100, 880, 1180, 960], fill: GOLD, rotate: -4 },
      { type: "text", bbox: [40, 892, 1040, 948], content: [facts.location, facts.price].filter(Boolean).join(" · "), font: "Anton", size: 42, colour: NAVY, align: "center", rotate: -4 },
      { type: "text", bbox: [80, 1080, 1000, 1140], content: wrap(`${copy.hook || facts.title}. ${T.swipe}.`, FR, 36, 900), font: FR, size: 36, colour: CREAM, align: "center", italic: true, line_height: 48 },
      ...band(facts.agency, 1, total, mix(CREAM, NAVY, 0.7)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "text", bbox: [-30, 200, 1110, 480], content: wrap(l1, "Anton", 190, 1000), font: "Anton", size: 190, colour: mix(GOLD, NAVY, 0.5), align: "center", line_height: 204, valign: "center" },
      { type: "text", bbox: [-30, 500, 1110, 820], content: wrap(l2 || town, "Anton", 190, 1000), font: "Anton", size: 190, colour: CREAM, align: "center", line_height: 204, valign: "center" },
      { type: "rect", bbox: [200, 900, 880, 903], fill: GOLD },
      { type: "text", bbox: [140, 950, 940, 1090], content: wrap(copy.lifestyle_line || facts.specs || facts.location, "Jost", 30, 780), font: "Jost", size: 30, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 46 },
      ...band(facts.agency, 2, total, mix(CREAM, NAVY, 0.6)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: "#101c2e",
    elements: [
      { type: "photo", photo: Math.min(1, photoCount - 1), bbox: [0, 0, W, 900], tint: "#2b4a75", tint_mode: "duotone" },
      { type: "scrim", bbox: [0, 620, W, 900], colour: "#101c2e" },
      ...(facts.price ? [{ type: "text", bbox: [-40, 860, 1120, 1140], content: facts.price, font: "Anton", size: Math.min(230, 2000 / Math.max(6, facts.price.length)), colour: GOLD, align: "center", valign: "center" }] : [
        { type: "text", bbox: [-40, 880, 1120, 1120], content: town, font: "Anton", size: 200, colour: GOLD, align: "center", valign: "center" },
      ]),
      { type: "text", bbox: [80, 1150, 1000, 1190], content: (facts.specs || facts.location), font: "Jost", size: 22, colour: CREAM, align: "center", tracking: 5 },
      ...band(facts.agency, 3, total, mix(CREAM, "#101c2e", 0.65)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: GOLD,
    elements: [
      { type: "text", bbox: [-30, 200, 1110, 560], content: wrap((copy.cta_keyword ? copy.cta_keyword.split(":")[1]?.trim() || town : town).toUpperCase(), "Anton", 230, 1000), font: "Anton", size: 230, colour: NAVY, align: "center", valign: "center" },
      { type: "rect", bbox: [-100, 700, 1180, 790], fill: NAVY, rotate: -4 },
      { type: "text", bbox: [40, 718, 1040, 778], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Anton", size: 46, colour: GOLD, align: "center", rotate: -4, tracking: 4 },
      { type: "text", bbox: [140, 900, 940, 1000], content: wrap(copy.cta_action || T.save_cta, "Jost", 30, 780), font: "Jost", size: 30, colour: NAVY, align: "center", line_height: 44 },
      { type: "text", bbox: [140, 1090, 940, 1120], content: facts.contact, font: "Jost", size: 21, colour: NAVY, align: "center", tracking: 2 },
      ...band(facts.agency, 4, total, mix(NAVY, GOLD, 0.8)),
    ],
  }));
  return specs;
}

// ═══ CUARTETO — the sentence woven between photo bands (catalogue #32, approved round 3) ═══════
function cuartetoListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const CREAM = "#f3efe6", INK = "#23272f", TERRACO = "#b5502e";
  const inner = (b: [number, number, number, number]) => frame([b[0] + 22, b[1] + 22, b[2] - 22, b[3] - 22], "#ffffff", 1.5, 0.85);
  const muted = mix(INK, CREAM, 0.55);
  const words = facts.title.trim().split(/\s+/);
  const lastWord = words.length > 1 ? words.pop()! : (facts.location.split("·")[0] ?? facts.title).trim();
  const firstPart = words.join(" ") || facts.title;
  const total = 5;
  const fit = (t: string, max: number) => Math.min(max, Math.floor((1080 - 120) / Math.max(3, t.length) / 0.48));
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [70, 76, 700, 108], content: facts.agency.toUpperCase(), font: "Jost", size: 19, colour: muted, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [700, 76, 1010, 108], content: facts.location, font: "Jost", size: 19, colour: TERRACO, align: "right", tracking: 4 },
      { type: "text", bbox: [60, 150, 1020, 420], content: firstPart, font: CAS, size: fit(firstPart, 250), colour: INK, align: "left", valign: "center" },
      { type: "photo", photo: 0, bbox: [0, 470, 1080, 1160], tint: TERRACO, tint_opacity: 0.06 },
      ...inner([0, 470, 1080, 1160]),
      { type: "text", bbox: [700, 1150, 1180, 1280], content: "…", font: CAS, size: 170, colour: TERRACO, align: "right" },
      ...band(facts.agency, 1, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "photo", photo: Math.min(1, photoCount - 1), bbox: [0, 90, 1080, 780], tint: TERRACO, tint_opacity: 0.06 },
      ...inner([0, 90, 1080, 780]),
      { type: "text", bbox: [60, 820, 1020, 1120], content: lastWord, font: CAS, size: fit(lastWord, 270), colour: TERRACO, align: "right", valign: "center" },
      ...(facts.specs ? [{ type: "text", bbox: [60, 1150, 1020, 1190], content: facts.specs, font: "Jost", size: 21, colour: mix(INK, CREAM, 0.7), align: "left", tracking: 5 }] : []),
      ...band(facts.agency, 2, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "photo", photo: Math.min(2, photoCount - 1), bbox: [0, 80, 1080, 520], tint: TERRACO, tint_opacity: 0.06 },
      ...inner([0, 80, 1080, 520]),
      { type: "text", bbox: [60, 560, 1020, 800], content: facts.price || facts.location, font: CAS, size: facts.price ? fit(facts.price, 190) : 110, colour: INK, align: "left", valign: "center" },
      { type: "photo", photo: 0, bbox: [0, 850, 1080, 1230], zoom: 1.6, x: 0.5, y: 0.7, tint: TERRACO, tint_opacity: 0.06 },
      ...inner([0, 850, 1080, 1230]),
      ...band(facts.agency, 3, total, muted),
    ],
  }));

  const kpi: [string, string][] = [];
  if (facts.price) kpi.push([T.price, facts.price]);
  if (facts.area) kpi.push([T.area, facts.area]);
  if (facts.beds) kpi.push([T.bedrooms, facts.beds]);
  if (facts.baths) kpi.push([T.bathrooms, facts.baths]);
  const rowH = Math.min(170, 700 / Math.max(1, kpi.length));
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [60, 100, 1020, 300], content: T.the_sheet.charAt(0) + T.the_sheet.slice(1).toLowerCase(), font: CAS, size: 130, colour: INK, align: "left" },
      ...kpi.flatMap(([k, v], i) => {
        const y = 380 + i * rowH;
        return [
          { type: "text", bbox: [70, y, 520, y + 34], content: k, font: "Jost", size: 21, colour: TERRACO, align: "left", tracking: 5 },
          { type: "text", bbox: [420, y - 30, 1010, y + 70], content: v, font: CAS, size: 72, colour: INK, align: "right" },
          { type: "rect", bbox: [70, y + rowH - 66, 1010, y + rowH - 64.5], fill: mix(INK, CREAM, 0.25) },
        ];
      }),
      { type: "text", bbox: [70, 1120, 940, 1176], content: T.save_sheet, font: "Jost", size: 26, colour: CREAM, align: "left", weight: "500", valign: "center", pill: { fill: TERRACO, pad_x: 32, pad_y: 15 } },
      ...band(facts.agency, 4, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: INK,
    elements: [
      { type: "text", bbox: [60, 200, 1020, 620], content: wrap(copy.cta_action || T.save_cta, CAS, 110, 940), font: CAS, size: 110, colour: CREAM, align: "left", line_height: 128, valign: "center" },
      { type: "rect", bbox: [70, 700, 400, 703], fill: TERRACO },
      { type: "text", bbox: [70, 920, 660, 980], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 25, colour: INK, align: "left", weight: "600", tracking: 3, valign: "center", pill: { fill: TERRACO, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [70, 1080, 1010, 1110], content: facts.contact, font: "Jost", size: 21, colour: mix(CREAM, INK, 0.6), align: "left", tracking: 2 },
      ...band(facts.agency, 5, total, mix(CREAM, INK, 0.6)),
    ],
  }));
  return specs;
}

// ═══ BRISA — editorial line-work (catalogue #25, approved round 3) ═════════════
function brisaListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const PAPER = "#f0ead9", INK = "#23272f", TERRACO = "#c4644a", AZUL = "#2456c4", GOLDY = "#d9a13b";
  const muted = mix(INK, PAPER, 0.6);
  const total = 4;
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "doodle", bbox: [-60, -60, 300, 300], kind: "rings", colour: INK, accent: TERRACO, stroke_width: 2 },
      { type: "photo", photo: 0, bbox: [150, 105, 1035, 840], tint: TERRACO, tint_opacity: 0.06 },
      ...frame([150, 105, 1035, 840], INK, 2),
      { type: "doodle", bbox: [60, 760, 640, 880], kind: "wave", colour: INK, accent: TERRACO, stroke_width: 2.5 },
      { type: "doodle", bbox: [990, 60, 1050, 120], kind: "plus", colour: AZUL, stroke_width: 3 },
      { type: "doodle", bbox: [30, 920, 80, 970], kind: "plus", colour: GOLDY, stroke_width: 3 },
      { type: "text", bbox: [30, 330, 62, 830], content: `${facts.agency.toUpperCase()} — ${facts.location}`, font: "Jost", size: 19, colour: mix(INK, PAPER, 0.65), tracking: 5, rotate: -90, align: "center" },
      { type: "rect", bbox: [80, 878, Math.min(940, 120 + textWidth(CAS, facts.title, 58)), 972], fill: TERRACO, radius: 18, rotate: -1 },
      { type: "text", bbox: [100, 892, Math.min(920, 100 + textWidth(CAS, facts.title, 58)), 958], content: facts.title, font: CAS, size: 58, colour: PAPER, align: "center", valign: "center" },
      { type: "text", bbox: [100, 1000, 700, 1032], content: facts.location, font: "Jost", size: 21, colour: TERRACO, align: "left", tracking: 6 },
      ...(facts.specs ? [{ type: "text", bbox: [100, 1060, 1000, 1110], content: facts.specs, font: "Jost", size: 24, colour: INK, align: "left", tracking: 3 }] : []),
      ...(facts.price ? [{ type: "text", bbox: [560, 1090, 1000, 1180], content: facts.price, font: CAS, size: 74, colour: TERRACO, align: "right" }] : []),
      { type: "rect", bbox: [80, 1215, 1000, 1217], fill: INK },
      { type: "doodle", bbox: [80, 1226, 240, 1262], kind: "dots_row", colour: INK },
      { type: "doodle", bbox: [930, 1150, 990, 1210], kind: "sparkle", colour: TERRACO, stroke_width: 2.5 },
      ...band(facts.agency, 1, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "doodle", bbox: [880, -70, 1160, 210], kind: "rings", colour: TERRACO, accent: AZUL, stroke_width: 2 },
      { type: "photo", photo: Math.min(1, photoCount - 1), bbox: [45, 120, 930, 855], tint: TERRACO, tint_opacity: 0.06 },
      ...frame([45, 120, 930, 855], INK, 2),
      { type: "doodle", bbox: [430, 790, 1010, 905], kind: "wave", colour: INK, accent: AZUL, stroke_width: 2.5 },
      { type: "text", bbox: [80, 950, 700, 982], content: (facts.features[0] || T.the_detail).toUpperCase(), font: "Jost", size: 21, colour: AZUL, align: "left", tracking: 7 },
      { type: "text", bbox: [80, 1010, 1000, 1170], content: wrap(copy.lifestyle_line || facts.title, CAS, 68, 900), font: CAS, size: 68, colour: INK, align: "left", line_height: 84 },
      { type: "doodle", bbox: [880, 1000, 950, 1070], kind: "sparkle", colour: GOLDY, stroke_width: 2.5 },
      { type: "doodle", bbox: [-40, 1080, 220, 1340], kind: "arc", colour: AZUL, accent: TERRACO, stroke_width: 2.5 },
      ...band(facts.agency, 2, total, muted),
    ],
  }));

  const kpi: [string, string, string][] = [];
  if (facts.price) kpi.push([T.price, facts.price, TERRACO]);
  if (facts.area) kpi.push([T.area, facts.area, AZUL]);
  if (facts.beds) kpi.push([T.bedrooms, facts.beds, GOLDY]);
  if (facts.baths) kpi.push([T.bathrooms, facts.baths, TERRACO]);
  const rowH = Math.min(190, 760 / Math.max(1, kpi.length));
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 260], content: T.the_sheet.charAt(0) + T.the_sheet.slice(1).toLowerCase(), font: CAS, size: 110, colour: INK, align: "left" },
      { type: "doodle", bbox: [700, 90, 780, 170], kind: "sparkle", colour: TERRACO, stroke_width: 3 },
      ...kpi.flatMap(([k, v, c], i) => {
        const y = 340 + i * rowH;
        const vw = textWidth(CAS, v, 80);
        return [
          { type: "rect", bbox: [980 - vw - 44, y - 18, 1006, y + 96], fill: c, radius: 16, opacity: 0.28, rotate: i % 2 ? 1 : -1 },
          { type: "text", bbox: [80, y + 8, 420, y + 42], content: k, font: "Jost", size: 21, colour: mix(INK, PAPER, 0.7), align: "left", tracking: 5 },
          { type: "text", bbox: [440, y - 24, 980, y + 84], content: v, font: CAS, size: 80, colour: INK, align: "right" },
        ];
      }),
      { type: "doodle", bbox: [80, 1130, 240, 1166], kind: "dots_row", colour: INK },
      { type: "text", bbox: [300, 1108, 1000, 1164], content: T.save_sheet, font: "Jost", size: 25, colour: PAPER, align: "center", weight: "500", valign: "center", pill: { fill: INK, pad_x: 34, pad_y: 15 } },
      ...band(facts.agency, 3, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "doodle", bbox: [-80, -80, 340, 340], kind: "rings", colour: AZUL, accent: TERRACO, stroke_width: 2 },
      { type: "doodle", bbox: [850, 120, 1040, 250], kind: "birds", colour: INK, stroke_width: 3 },
      { type: "text", bbox: [80, 360, 1000, 720], content: wrap(copy.cta_action || T.save_cta, CAS, 110, 900), font: CAS, size: 110, colour: INK, align: "left", line_height: 130, valign: "center" },
      { type: "text", bbox: [80, 950, 660, 1010], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 25, colour: PAPER, align: "left", weight: "600", tracking: 3, valign: "center", pill: { fill: AZUL, pad_x: 40, pad_y: 20 } },
      { type: "doodle", bbox: [700, 940, 1020, 1050], kind: "wave", colour: INK, accent: TERRACO, stroke_width: 2.5 },
      { type: "text", bbox: [80, 1090, 1010, 1120], content: facts.contact, font: "Jost", size: 21, colour: muted, align: "left", tracking: 2 },
      ...band(facts.agency, 4, total, muted),
    ],
  }));
  return specs;
}

// ═══ RIVIERA — the diagonal poster (catalogue #10, approved round 3) ═══════════
function rivieraListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const OFF = "#f4f2ec", INK = "#101114", AZUL = "#2456c4";
  const total = 4;
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: OFF,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 660] },
      { type: "photo", photo: Math.min(1, photoCount - 1), bbox: [0, 640, 1080, 1120] },
      { type: "rect", bbox: [-200, 600, 1280, 690], fill: OFF, rotate: -7 },
      { type: "text", bbox: [70, 640, 500, 690], content: T.on_cover, font: "Jost", size: 24, colour: AZUL, align: "left", weight: "600", tracking: 6, rotate: -7 },
      ...(facts.price ? [
        { type: "rect", bbox: [720, 540, 1010, 660], fill: AZUL, radius: 60, rotate: -7 },
        { type: "text", bbox: [720, 575, 1010, 630], content: facts.price, font: "Jost", size: 40, colour: OFF, align: "center", weight: "600", rotate: -7 },
      ] : []),
      { type: "rect", bbox: [0, 1120, 1080, 1350], fill: OFF },
      { type: "rect", bbox: [70, 1128, 200, 1136], fill: AZUL },
      { type: "text", bbox: [66, 1150, 1014, 1260], content: wrap(facts.title.toUpperCase(), "Anton", 96, 948), font: "Anton", size: 96, colour: INK, align: "left", line_height: 108 },
      ...band(facts.agency, 1, total, mix(INK, OFF, 0.6)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: OFF,
    elements: [
      { type: "text", bbox: [70, 90, 1010, 190], content: wrap((copy.hook || facts.location).toUpperCase(), "Anton", 84, 940), font: "Anton", size: 84, colour: INK, align: "left", line_height: 96 },
      { type: "text", bbox: [70, 210, 1010, 250], content: (facts.features[0] || facts.location).toUpperCase(), font: "Jost", size: 22, colour: AZUL, align: "left", tracking: 5, weight: "600" },
      { type: "photo", photo: Math.min(2, photoCount - 1), bbox: [0, 300, 1080, 1140] },
      { type: "rect", bbox: [-200, 1080, 1280, 1170], fill: OFF, rotate: 7 },
      ...(facts.area ? [
        { type: "rect", bbox: [700, 1010, 1010, 1120], fill: AZUL, radius: 56, rotate: 7 },
        { type: "text", bbox: [700, 1042, 1010, 1094], content: facts.area.toUpperCase(), font: "Jost", size: 38, colour: OFF, align: "center", weight: "600", rotate: 7 },
      ] : []),
      ...(facts.specs ? [{ type: "text", bbox: [70, 1190, 1010, 1240], content: facts.specs, font: "Jost", size: 24, colour: INK, align: "left", tracking: 4 }] : []),
      ...band(facts.agency, 2, total, mix(INK, OFF, 0.6)),
    ],
  }));

  const kpi: [string, string][] = [];
  if (facts.price) kpi.push([T.price, facts.price]);
  if (facts.area) kpi.push([T.area, facts.area.toUpperCase()]);
  if (facts.beds) kpi.push([T.bedrooms, facts.beds]);
  if (facts.baths) kpi.push([T.bathrooms, facts.baths]);
  const rowH = Math.min(190, 740 / Math.max(1, kpi.length));
  specs.push(DesignSpec.parse({
    background: INK,
    elements: [
      { type: "rect", bbox: [-200, 130, 1280, 220], fill: AZUL, rotate: -7 },
      { type: "text", bbox: [70, 150, 1010, 205], content: T.the_sheet, font: "Anton", size: 52, colour: OFF, align: "center", rotate: -7 },
      ...kpi.flatMap(([k, v], i) => {
        const y = 340 + i * rowH;
        return [
          { type: "text", bbox: [80, y, 520, y + 40], content: k, font: "Jost", size: 22, colour: mix(OFF, INK, 0.6), align: "left", tracking: 5, valign: "center" },
          { type: "text", bbox: [420, y - 40, 1000, y + 90], content: v, font: "Anton", size: 96, colour: OFF, align: "right" },
          { type: "rect", bbox: [80, y + rowH - 62, 1000, y + rowH - 60], fill: AZUL, opacity: 0.6 },
        ];
      }),
      { type: "text", bbox: [230, 1130, 850, 1186], content: T.save_sheet.toUpperCase(), font: "Jost", size: 23, colour: INK, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: OFF, pad_x: 36, pad_y: 16 } },
      ...band(facts.agency, 3, total, mix(OFF, INK, 0.6)),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: AZUL,
    elements: [
      { type: "text", bbox: [70, 220, 1010, 520], content: wrap((copy.cta_action || T.save_cta).toUpperCase(), "Anton", 110, 940), font: "Anton", size: 110, colour: OFF, align: "left", line_height: 126, valign: "center" },
      { type: "rect", bbox: [-200, 620, 1280, 710], fill: OFF, rotate: -7 },
      { type: "text", bbox: [70, 655, 1010, 700], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Anton", size: 46, colour: AZUL, align: "center", rotate: -7, tracking: 3 },
      { type: "text", bbox: [70, 1050, 1010, 1080], content: facts.contact.toUpperCase(), font: "Jost", size: 20, colour: mix(OFF, AZUL, 0.85), align: "left", tracking: 3 },
      ...band(facts.agency, 4, total, mix(OFF, AZUL, 0.85)),
    ],
  }));
  return specs;
}

// ═══ VENTANA — the illustrated window + the cat (catalogue #13, approved round 3) ═══
function ventanaListing(facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photoCount: number, lang = "es"): unknown[] {
  const T = chrome(lang);
  const PAPER = "#f0ecdf", INK = "#2b2b26", OLIVEV = "#6d7a55", TERRACO = "#c05f3c", DARK = "#33352c";
  const muted = mix(INK, PAPER, 0.55);
  const total = 4;
  const shutters = (x0: number, x1: number, y0: number, y1: number) => {
    const els: unknown[] = [{ type: "rect", bbox: [x0, y0, x1, y1], fill: OLIVEV, radius: 6 }];
    const n = Math.floor((y1 - y0 - 40) / 34);
    for (let i = 0; i < n; i++) (els as any[]).push({ type: "rect", bbox: [x0 + 16, y0 + 26 + i * 34, x1 - 16, y0 + 26 + i * 34 + 14], fill: mix(INK, OLIVEV, 0.35), radius: 7 });
    return els as any[];
  };
  const specs: unknown[] = [];

  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "text", bbox: [80, 84, 1000, 118], content: facts.agency.toUpperCase(), font: "Jost", size: 21, colour: INK, align: "center", weight: "500", tracking: 6 },
      { type: "doodle", bbox: [90, 150, 230, 250], kind: "birds", colour: INK, stroke_width: 3 },
      { type: "photo", photo: 0, bbox: [240, 170, 840, 810], tint: TERRACO, tint_opacity: 0.06 },
      { type: "punch", bbox: [240, 170, 840, 810], fill: PAPER, shape: "arch", outline: { colour: DARK, width: 5, offset: 2 } },
      ...frame([240, 470, 840, 810], DARK, 5),
      { type: "rect", bbox: [536, 200, 544, 810], fill: DARK },
      { type: "rect", bbox: [240, 620, 840, 627], fill: DARK },
      ...shutters(120, 236, 460, 860),
      ...shutters(844, 960, 460, 860),
      { type: "rect", bbox: [100, 856, 980, 900], fill: mix("#ffffff", PAPER, 0.7), radius: 8 },
      { type: "doodle", bbox: [230, 742, 330, 862], kind: "pot_plant", colour: TERRACO, accent: OLIVEV },
      { type: "doodle", bbox: [700, 738, 820, 866], kind: "cat", colour: INK },
      { type: "text", bbox: [80, 950, 1000, 982], content: facts.location, font: "Jost", size: 21, colour: TERRACO, align: "center", tracking: 7 },
      { type: "text", bbox: [120, 1010, 960, 1120], content: wrap(facts.title, CAS, 88, 840), font: CAS, size: 88, colour: INK, align: "center" },
      ...(facts.price ? [{ type: "text", bbox: [120, 1140, 960, 1220], content: facts.price, font: CAS, size: 64, colour: TERRACO, align: "center" }] : []),
      ...band(facts.agency, 1, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "photo", photo: Math.min(1, photoCount - 1), bbox: [290, 140, 790, 640], tint: TERRACO, tint_opacity: 0.06 },
      { type: "punch", bbox: [290, 140, 790, 640], fill: PAPER, shape: "circle", outline: { colour: DARK, width: 5, offset: 2 } },
      ...frame([290, 388, 790, 392], DARK, 4),
      { type: "rect", bbox: [536, 140, 544, 640], fill: DARK },
      { type: "doodle", bbox: [770, 560, 890, 690], kind: "cat", colour: INK },
      { type: "doodle", bbox: [180, 590, 270, 700], kind: "pot_plant", colour: TERRACO, accent: OLIVEV },
      { type: "rect", bbox: [160, 686, 920, 720], fill: mix("#ffffff", PAPER, 0.7), radius: 8 },
      { type: "text", bbox: [80, 790, 1000, 822], content: (facts.features[0] || T.the_detail).toUpperCase(), font: "Jost", size: 21, colour: OLIVEV, align: "center", tracking: 7 },
      { type: "text", bbox: [110, 860, 970, 1060], content: wrap(copy.lifestyle_line || facts.title, CAS, 70, 860), font: CAS, size: 70, colour: INK, align: "center", line_height: 86, valign: "center" },
      ...(facts.specs ? [{ type: "text", bbox: [80, 1100, 1000, 1140], content: facts.specs, font: "Jost", size: 22, colour: mix(INK, PAPER, 0.7), align: "center", tracking: 5 }] : []),
      ...band(facts.agency, 2, total, muted),
    ],
  }));

  const kpi: [string, string][] = [];
  if (facts.price) kpi.push([T.price, facts.price]);
  if (facts.area) kpi.push([T.sqm, facts.area.replace(/\s*m²/i, "")]);
  if (facts.beds) kpi.push([T.bed, facts.beds]);
  if (facts.baths) kpi.push([T.bath, facts.baths]);
  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 150], content: T.the_sheet, font: "Jost", size: 21, colour: TERRACO, align: "center", tracking: 6 },
      ...kpi.slice(0, 4).flatMap(([k, v], i) => {
        const x = 110 + (i % 2) * 460, y = 230 + Math.floor(i / 2) * 420;
        return [
          { type: "rect", bbox: [x, y, x + 400, y + 330], fill: mix("#ffffff", PAPER, 0.6), radius: 10 },
          ...frame([x + 14, y + 14, x + 386, y + 316], DARK, 4),
          { type: "rect", bbox: [x + 14, y + 190, x + 386, y + 197], fill: DARK },
          { type: "rect", bbox: [x + 196, y + 197, x + 204, y + 316], fill: DARK },
          { type: "text", bbox: [x + 30, y + 30, x + 370, y + 180], content: v, font: CAS, size: Math.min(72, 640 / Math.max(3, v.length)), colour: INK, align: "center", valign: "center" },
          { type: "rect", bbox: [x - 6, y + 330, x + 406, y + 344], fill: mix("#ffffff", PAPER, 0.75), radius: 4 },
          { type: "text", bbox: [x + 30, y + 356, x + 370, y + 392], content: k, font: "Jost", size: 22, colour: OLIVEV, align: "center", tracking: 5 },
        ];
      }),
      { type: "rect", bbox: [400, 1208, 680, 1220], fill: mix("#ffffff", PAPER, 0.75), radius: 4 },
      { type: "doodle", bbox: [480, 1084, 600, 1214], kind: "cat", colour: INK },
      ...band(facts.agency, 3, total, muted),
    ],
  }));

  specs.push(DesignSpec.parse({
    background: PAPER,
    elements: [
      ...shutters(80, 330, 180, 900),
      ...shutters(750, 1000, 180, 900),
      { type: "text", bbox: [340, 300, 740, 340], content: facts.location, font: "Jost", size: 20, colour: TERRACO, align: "center", tracking: 6 },
      { type: "text", bbox: [340, 380, 740, 660], content: wrap(copy.cta_action || T.save_cta, CAS, 78, 380), font: CAS, size: 78, colour: INK, align: "center", line_height: 96, valign: "center" },
      { type: "text", bbox: [355, 720, 725, 776], content: (copy.cta_keyword || `${T.write_us}: ${T.visit_kw}`).toUpperCase(), font: "Jost", size: 22, colour: PAPER, align: "center", weight: "600", tracking: 2, valign: "center", pill: { fill: TERRACO, pad_x: 30, pad_y: 16 } },
      { type: "rect", bbox: [60, 896, 1020, 936], fill: mix("#ffffff", PAPER, 0.7), radius: 8 },
      { type: "doodle", bbox: [620, 780, 740, 906], kind: "cat", colour: INK },
      { type: "doodle", bbox: [330, 800, 420, 910], kind: "pot_plant", colour: TERRACO, accent: OLIVEV },
      { type: "text", bbox: [80, 1000, 1000, 1100], content: wrap(T.save_sheet, "Jost", 30, 840), font: "Jost", size: 30, colour: mix(INK, PAPER, 0.85), align: "center", line_height: 44 },
      { type: "text", bbox: [80, 1150, 1000, 1180], content: facts.contact, font: "Jost", size: 21, colour: muted, align: "center", tracking: 2 },
      ...band(facts.agency, 4, total, muted),
    ],
  }));
  return specs;
}

// ═══ VIBRA — the story listing (Christian 2026-07-17): vision-written line per photo, rotating
// creative layouts (full-bleed / framed plate / arch crop), one generated vibe-artwork interstitial
// matched to the property, human captions. The tips engine's creativity, aimed at real photos.
export interface VibraDetail { photo: number; box: number[]; line: string; score: number }
export interface VibraStory {
  hook: string; photo_lines: string[]; cta_action: string; cta_keyword: string;
  details?: VibraDetail[];
}
/** crop params from a 0-1 detail box: zoom into the region, centred on it */
function boxCrop(box: number[]): { zoom: number; x: number; y: number } {
  const [x, y, w, h] = box;
  const zoom = Math.min(3.2, Math.max(1.4, 1 / Math.max(0.18, Math.max(w, h))));
  return { zoom, x: Math.min(1, Math.max(0, x + w / 2)), y: Math.min(1, Math.max(0, y + h / 2)) };
}
export function vibraListing(
  facts: CarouselFacts, story: VibraStory, brand: CarouselBrand, photoCount: number,
  hasArt: boolean, lang = "es", palettes: { accent: string; ground: string }[] = [],
): unknown[] {
  const pal = (i: number) => palettes[i] ?? { accent: brand.gold, ground: brand.cream };
  const details = (story.details ?? []).filter((d) => d.score >= 0.7 && d.photo < photoCount).slice(0, 2);
  const coldOpen = details.length >= 1;
  const T = chrome(lang);
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const muted = mix(NAVY, CREAM, 0.55);
  const artIdx = photoCount;                       // the artwork buffer rides AFTER the photos
  const artAfter = Math.min(2, photoCount - 1);    // vibe artwork lands after the 2nd photo slide
  const total = (coldOpen ? details.length + 1 : 1) + (photoCount - 1) + (hasArt ? 1 : 0) + 2;
  const aiTag = (_colour: string) => ({ type: "text", bbox: [0, 0, 8, 8], content: "", font: "Jost", size: 14, colour: "#000000" });  // disclosure tag disabled (Christian 2026-07-17)
  const specs: unknown[] = [];
  let no = 1;

  // LA MIRADA — cold open on the most evocative DETAILS, then the wide reveal lands as the payoff
  if (coldOpen) {
    details.forEach((d) => {
      const c = boxCrop(d.box);
      specs.push(DesignSpec.parse({
        background: "#0a0c10",
        elements: [
          { type: "photo", photo: d.photo, bbox: [0, 0, 1080, 1350], zoom: c.zoom, x: c.x, y: c.y, tint: TERRA, tint_opacity: 0.05 },
          { type: "scrim", bbox: [0, 980, 1080, 1350], colour: NAVY },
          { type: "scrim", bbox: [0, 1140, 1080, 1350], colour: NAVY },
          { type: "text", bbox: [80, 96, 640, 126], content: facts.agency.toUpperCase(), font: "Jost", size: 18, colour: mix(CREAM, NAVY, 0.85), align: "left", weight: "500", tracking: 5 },
          { type: "text", bbox: [80, 1160, 1000, 1250], content: wrap(d.line, FR, 46, 920), font: FR, size: 46, colour: "#f6f1e7", align: "left", line_height: 60, italic: true },
          ...band(facts.agency, no, total, mix(CREAM, NAVY, 0.7)),
        ],
      }));
      no++;
    });
  }

  // COVER / THE REVEAL — best photo + vision hook + price
  specs.push(DesignSpec.parse({
    background: "#0a0c10",
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 1350], tint: TERRA, tint_opacity: 0.06 },
      { type: "scrim", bbox: [0, 0, 1080, 250], colour: NAVY, direction: "down" },
      { type: "scrim", bbox: [0, 620, 1080, 1350], colour: NAVY },
      { type: "scrim", bbox: [0, 900, 1080, 1350], colour: NAVY },
      { type: "text", bbox: [80, 96, 700, 128], content: facts.agency.toUpperCase(), font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 },
      { type: "text", bbox: [80, 890, 1000, 922], content: facts.location, font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 940, 1000, 1150], content: wrap(story.hook, FR, 84, 920), font: FR, size: 84, colour: "#f6f1e7", align: "left", line_height: 98 },
      ...(facts.price ? [{ type: "text", bbox: [80, 1170, 700, 1236], content: facts.price, font: CAS, size: 54, colour: GOLD, align: "left" }] : []),
      ...band(facts.agency, no, total, mix(CREAM, NAVY, 0.7)),
    ],
  }));
  no++;

  // PHOTO SLIDES — three rotating treatments, each carrying its vision line
  for (let i = 1; i < photoCount; i++) {
    const line = story.photo_lines[i] ?? story.photo_lines[0] ?? facts.title;
    const v = (i - 1) % 3;
    if (v === 0) {
      specs.push(DesignSpec.parse({
        background: "#0a0c10",
        elements: [
          { type: "photo", photo: i, bbox: [0, 0, 1080, 1350], tint: TERRA, tint_opacity: 0.06 },
          { type: "scrim", bbox: [0, 900, 1080, 1350], colour: NAVY },
          { type: "scrim", bbox: [0, 1080, 1080, 1350], colour: NAVY },
          { type: "text", bbox: [80, 1090, 1000, 1230], content: wrap(line, FR, 52, 920), font: FR, size: 52, colour: "#f6f1e7", align: "left", line_height: 66 },
          ...band(facts.agency, no, total, mix(CREAM, NAVY, 0.7)),
        ],
      }));
    } else if (v === 1) {
      // framed plate on the PHOTO's own palette; hosts the LOUPE when a detail lives in this photo
      const pp = pal(i);
      const det = details.find((d) => d.photo === i);
      const loupe: any[] = [];
      if (det) {
        const c = boxCrop(det.box);
        loupe.push({ type: "photo", photo: i, bbox: [700, 620, 990, 910], zoom: Math.min(4, c.zoom * 1.4), x: c.x, y: c.y });
        loupe.push({ type: "punch", bbox: [700, 620, 990, 910], fill: pp.ground, shape: "circle", outline: { colour: pp.accent, width: 2.5, offset: 4 } });
        loupe.push({ type: "rect", bbox: [666, 596, 716, 646], fill: pp.accent, radius: 3, rotate: 45, opacity: 0.9 });
      }
      specs.push(DesignSpec.parse({
        background: pp.ground,
        elements: [
          { type: "photo", photo: i, bbox: [80, 120, 1000, 860], tint: TERRA, tint_opacity: 0.05 },
          ...frame([64, 104, 1016, 876], pp.accent, 1.5, 0.7),
          ...loupe,
          { type: "text", bbox: [80, 930, 1000, 962], content: facts.location, font: "Jost", size: 20, colour: pp.accent, align: "left", tracking: 5 },
          { type: "text", bbox: [80, 990, 1000, 1170], content: wrap(det?.line ?? line, FR, 54, 920), font: FR, size: 54, colour: NAVY, align: "left", line_height: 68 },
          ...band(facts.agency, no, total, muted),
        ],
      }));
    } else {
      const pp = pal(i);
      specs.push(DesignSpec.parse({
        background: pp.ground,
        elements: [
          { type: "photo", photo: i, bbox: [190, 110, 890, 780], tint: TERRA, tint_opacity: 0.06 },
          { type: "punch", bbox: [190, 110, 890, 780], fill: pp.ground, shape: "arch", outline: { colour: pp.accent, width: 1.5, offset: 12 } },
          { type: "text", bbox: [100, 860, 980, 1060], content: wrap(line, FR, 56, 860), font: FR, size: 56, colour: NAVY, align: "center", line_height: 72, valign: "center" },
          ...band(facts.agency, no, total, mix(NAVY, pp.ground, 0.55)),
        ],
      }));
    }
    no++;
    if (hasArt && i === artAfter) {
      // the VIBE — generated artwork matched to the property, clearly artwork, tagged
      specs.push(DesignSpec.parse({
        background: NAVY,
        elements: [
          { type: "photo", photo: artIdx, bbox: [0, 0, 1080, 1350] },
          { type: "scrim", bbox: [0, 940, 1080, 1350], colour: NAVY },
          { type: "scrim", bbox: [0, 1100, 1080, 1350], colour: NAVY },
          { type: "text", bbox: [80, 1120, 1000, 1230], content: wrap(story.photo_lines[0] ?? facts.title, FR, 50, 920), font: FR, size: 50, colour: "#f6f1e7", align: "left", line_height: 64 },
          aiTag(mix(CREAM, NAVY, 0.65)),
          ...band(facts.agency, no, total, mix(CREAM, NAVY, 0.7)),
        ],
      }));
      no++;
    }
  }

  // FACTS PLATE
  const rows: [string, string][] = [];
  if (facts.price) rows.push([T.price, facts.price]);
  if (facts.area) rows.push([T.area, facts.area]);
  if (facts.beds) rows.push([T.bedrooms, facts.beds]);
  if (facts.baths) rows.push([T.bathrooms, facts.baths]);
  const rowH = Math.min(140, 660 / Math.max(1, rows.length));
  specs.push(DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [80, 110, 1000, 144], content: facts.location, font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 190, 1000, 330], content: wrap(facts.title, FR, 76, 920), font: FR, size: 76, colour: NAVY, align: "left" },
      ...rows.flatMap(([k, v], i) => {
        const y = 430 + i * rowH;
        return [
          { type: "text", bbox: [90, y, 460, y + 34], content: k, font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "left", tracking: 5 },
          { type: "text", bbox: [460, y - 18, 990, y + 56], content: v, font: FR, size: 48, colour: NAVY, align: "right" },
          { type: "rect", bbox: [90, y + rowH - 52, 990, y + rowH - 51], fill: GOLD, opacity: 0.4 },
        ];
      }),
      { type: "text", bbox: [80, 1140, 940, 1192], content: T.save_sheet, font: "Jost", size: 26, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 15 } },
      ...band(facts.agency, no, total, muted),
    ],
  }));
  no++;

  // CTA — first photo re-crop, panel
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, 1080, 1350], zoom: 1.6, x: 0.5, y: 0.55, tint: NAVY, tint_opacity: 0.3 },
      { type: "scrim", bbox: [0, 0, 1080, 1350], colour: NAVY },
      { type: "rect", bbox: [90, 340, 990, 1030], fill: CREAM, radius: 8, opacity: 0.97 },
      { type: "text", bbox: [150, 420, 930, 610], content: wrap(story.cta_action || T.save_cta, FR, 62, 760), font: FR, size: 62, colour: NAVY, align: "center", line_height: 78, valign: "center" },
      { type: "text", bbox: [150, 690, 930, 770], content: wrap(`P.D. — ${story.cta_keyword || `${T.write_us}: ${T.visit_kw}`}`, FR, 34, 760), font: FR, size: 34, colour: NAVY, align: "center", italic: true, line_height: 46 },
      { type: "text", bbox: [150, 850, 930, 880], content: facts.contact, font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.6), align: "center", tracking: 2 },
      ...(facts.price ? [{ type: "text", bbox: [150, 920, 930, 990], content: `${facts.title} · ${facts.price}`, font: "Jost", size: 22, colour: mix(NAVY, CREAM, 0.75), align: "center", tracking: 1 }] : []),
      ...band(facts.agency, total, total, mix(CREAM, NAVY, 0.7)),
    ],
  }));
  return specs;
}

/** LISTING carousel in a chosen style. 'editorial' = the approved v2 default; horizonte falls back to it
 *  automatically when the hero photo is too narrow for a seamless run. */
export async function renderListingStyled(
  style: CarouselStyle, facts: CarouselFacts, copy: CarouselCopy, brand: CarouselBrand, photos: Buffer[], lang = "es",
): Promise<Buffer[]> {
  if (style === "horizonte") return horizonteListing(facts, copy, brand, photos, lang);
  if (style === "cartel") return renderAll(cartelListing(facts, copy, brand, photos.length, lang), photos, 0.05);
  if (style === "encalada") return renderAll(encaladaListing(facts, copy, brand, photos.length, lang), photos, 0.045);
  if (style === "sereno") return renderAll(serenoListing(facts, copy, brand, photos.length, lang), photos, 0.035);
  if (style === "plano") return renderAll(planoListing(facts, copy, brand, photos.length, lang), photos, 0.04);
  if (style === "portada") return renderAll(portadaListing(facts, copy, brand, photos.length, lang), photos, 0.045);
  if (style === "recorte") return renderAll(recorteListing(facts, copy, brand, photos.length, lang), photos, 0.08);
  if (style === "marea") return renderAll(mareaListing(facts, copy, brand, photos.length, lang), photos, 0.05);
  if (style === "cuarteto") return renderAll(cuartetoListing(facts, copy, brand, photos.length, lang), photos, 0.04);
  if (style === "brisa") return renderAll(brisaListing(facts, copy, brand, photos.length, lang), photos, 0.04);
  if (style === "riviera") return renderAll(rivieraListing(facts, copy, brand, photos.length, lang), photos, 0.035);
  if (style === "ventana") return renderAll(ventanaListing(facts, copy, brand, photos.length, lang), photos, 0.045);
  return renderCarousel(facts, brand, photos, copy, lang);
}
