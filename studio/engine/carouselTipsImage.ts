import { renderFreeform, DesignSpec } from "./renderFreeform";
import { CarouselPlan, applyGrain, mix, wrap, chrome } from "./carouselSlides";
import { CarouselBrand } from "./renderCarousel";

// TIPS-WITH-AI-IMAGERY styles (Christian-approved 2026-07-17: "all eight ships. looooove them all").
// Eight visual styles for tips/advice carousels, each built on a 3-image generated family (cover hero,
// context scene, mid-deck scene) from the pre-seeded KIE library. The engine draws ALL type and facts;
// images are backdrops only; every slide carrying a generated layer shows the localized disclosure
// micro-tag (EU AI Act Art 50(4) transparency — live duty from 2 Aug 2026, adopted early).
// Deck: cover(img0) → context(img1) → tips 1..N (type-led) → mid-deck moment(img2) → recap → CTA(img0 re-crop).

export type TipsImageStyle =
  | "bodegon" | "litoral" | "tinta" | "salitre"
  | "papel" | "arcilla" | "acuarela" | "bordado";
export const TIPS_IMAGE_STYLES: TipsImageStyle[] = [
  "bodegon", "litoral", "tinta", "salitre", "papel", "arcilla", "acuarela", "bordado",
];

const W = 1080, H = 1350;
const FR = "Fraunces 115pt";

interface StyleCfg {
  mode: "dusk" | "light" | "photo";   // cover/interstitial legibility mode (proven per style in the proofs)
  s2: "card" | "strip" | "full";      // context-slide treatment for img1
  grain: number;
  ctaY: number;                       // CTA re-crop focus for img0
  crop?: { z: number; y: number };    // cover crop (papel's artwork sits inside a generated frame)
}
const CFG: Record<TipsImageStyle, StyleCfg> = {
  bodegon: { mode: "dusk", s2: "card", grain: 0.04, ctaY: 0.75 },
  litoral: { mode: "light", s2: "strip", grain: 0.04, ctaY: 0.5 },
  tinta: { mode: "light", s2: "full", grain: 0.05, ctaY: 0.4 },
  salitre: { mode: "photo", s2: "card", grain: 0.045, ctaY: 0.5 },
  papel: { mode: "light", s2: "strip", grain: 0.035, ctaY: 0.6, crop: { z: 1.45, y: 0.52 } },
  arcilla: { mode: "light", s2: "card", grain: 0.035, ctaY: 0.7 },
  acuarela: { mode: "light", s2: "card", grain: 0.035, ctaY: 0.55 },
  bordado: { mode: "light", s2: "card", grain: 0.035, ctaY: 0.75 },
};

export function isTipsImageStyle(s: string): s is TipsImageStyle {
  return (TIPS_IMAGE_STYLES as string[]).includes(s);
}

export async function renderTipsImageStyled(
  style: TipsImageStyle, plan: CarouselPlan, agency: string, contact: string,
  brand: CarouselBrand, images: Buffer[], lang = "es",
): Promise<Buffer[]> {
  const cfg = CFG[style];
  const T = chrome(lang);
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const n = plan.tips.length;
  const midAfter = Math.ceil(n / 2);                 // the mid-deck image moment sits after this tip
  const total = n + 5;                               // cover + context + tips + moment + recap + CTA

  const band = (i: number, colour: string) => [
    { type: "text", bbox: [80, 1272, 640, 1300], content: agency.toUpperCase(), font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 },
  ];
  const aiTag = (colour: string, onLeft = false) =>
    ({ type: "text", bbox: onLeft ? [80, 1240, 640, 1262] : [440, 1240, 1000, 1262], content: T.ai_tag, font: "Jost", size: 15, colour, align: onLeft ? "left" : "right", tracking: 1 });
  const noShield = (e: Record<string, unknown>) => ({ ...e, shield: false });

  const specs: unknown[] = [];

  // ── 1 · COVER (img0) ─────────────────────────────────────────────────────────
  {
    const els: any[] = [{ type: "photo", photo: 0, bbox: [0, 0, W, H], ...(cfg.crop ? { zoom: cfg.crop.z, x: 0.5, y: cfg.crop.y } : {}) }];
    if (cfg.mode === "dusk") {
      els.push({ type: "scrim", bbox: [0, 0, W, 620], colour: NAVY, direction: "down" });
      els.push({ type: "text", bbox: [80, 96, 720, 128], content: agency.toUpperCase(), font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
      els.push({ type: "text", bbox: [80, 200, 1000, 236], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
      els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(plan.hook_title, FR, 92, 920), font: FR, size: 92, colour: "#f6f1e7", align: "left", line_height: 108 });
      els.push(aiTag(mix(CREAM, NAVY, 0.6)));
      els.push(...band(1, mix(CREAM, NAVY, 0.65)));
    } else if (cfg.mode === "light") {
      els.push(noShield({ type: "text", bbox: [80, 96, 720, 128], content: agency.toUpperCase(), font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.75), align: "left", weight: "500", tracking: 5 }));
      els.push(noShield({ type: "text", bbox: [80, 200, 1000, 236], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 22, colour: mix(NAVY, CREAM, 0.72), align: "left", tracking: 6 }));
      els.push(noShield({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(plan.hook_title, FR, 92, 920), font: FR, size: 92, colour: NAVY, align: "left", line_height: 108 }));
      els.push(noShield(aiTag(mix(NAVY, CREAM, 0.5))));
      els.push(...band(1, mix(NAVY, CREAM, 0.6)).map(noShield));
    } else {
      els.push({ type: "scrim", bbox: [0, 0, W, 260], colour: NAVY, direction: "down" });
      els.push({ type: "scrim", bbox: [0, 640, W, H], colour: NAVY });
      els.push({ type: "scrim", bbox: [0, 880, W, H], colour: NAVY });
      els.push({ type: "text", bbox: [80, 96, 720, 128], content: agency.toUpperCase(), font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
      els.push({ type: "text", bbox: [80, 930, 1000, 966], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
      els.push({ type: "text", bbox: [80, 990, 1000, 1220], content: wrap(plan.hook_title, FR, 88, 920), font: FR, size: 88, colour: "#f6f1e7", align: "left", line_height: 104 });
      els.push(aiTag(mix(CREAM, NAVY, 0.6)));
      els.push(...band(1, mix(CREAM, NAVY, 0.65)));
    }
    specs.push(DesignSpec.parse({ background: NAVY, elements: els }));
  }

  // ── 2 · CONTEXT (img1) — the standalone second cover ─────────────────────────
  {
    if (cfg.s2 === "card") {
      specs.push(DesignSpec.parse({
        background: NAVY,
        elements: [
          { type: "rect", bbox: [310, 130, 770, 590], fill: CREAM, radius: 10 },
          { type: "photo", photo: 1, bbox: [332, 152, 748, 568], zoom: 1.15, x: 0.5, y: 0.5 },
          { type: "text", bbox: [80, 660, 1000, 696], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "center", tracking: 6 },
          { type: "text", bbox: [110, 740, 970, 970], content: wrap(plan.slide2_title, FR, 64, 860), font: FR, size: 64, colour: CREAM, align: "center", line_height: 80, valign: "center" },
          { type: "text", bbox: [150, 1020, 930, 1150], content: wrap(plan.slide2_body, "Jost", 29, 720), font: "Jost", size: 29, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 44 },
          aiTag(mix(CREAM, NAVY, 0.6)),
          ...band(2, mix(CREAM, NAVY, 0.65)),
        ],
      }));
    } else if (cfg.s2 === "strip") {
      specs.push(DesignSpec.parse({
        background: CREAM,
        elements: [
          { type: "text", bbox: [80, 120, 1000, 156], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 6 },
          { type: "text", bbox: [80, 220, 1000, 520], content: wrap(plan.slide2_title, FR, 76, 920), font: FR, size: 76, colour: NAVY, align: "left", line_height: 92, valign: "center" },
          { type: "text", bbox: [80, 580, 1000, 720], content: wrap(plan.slide2_body, "Jost", 32, 920), font: "Jost", size: 32, colour: mix(NAVY, CREAM, 0.85), align: "left", line_height: 48 },
          { type: "photo", photo: 1, bbox: [0, 800, 1080, 1210], zoom: 1.15, x: 0.5, y: 0.6 },
          { type: "rect", bbox: [0, 796, 1080, 800], fill: NAVY },
          noShield(aiTag(mix(NAVY, CREAM, 0.5), true)),
          ...band(2, mix(NAVY, CREAM, 0.55)).map(noShield),
        ],
      }));
    } else {
      specs.push(DesignSpec.parse({
        background: NAVY,
        elements: [
          { type: "photo", photo: 1, bbox: [0, 0, W, H] },
          { type: "scrim", bbox: [0, 0, W, 560], colour: NAVY, direction: "down" },
          { type: "text", bbox: [80, 130, 1000, 166], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 6 },
          { type: "text", bbox: [80, 210, 1000, 470], content: wrap(plan.slide2_title, FR, 72, 920), font: FR, size: 72, colour: "#f6f1e7", align: "left", line_height: 88 },
          aiTag(mix(CREAM, NAVY, 0.6)),
          ...band(2, mix(CREAM, NAVY, 0.65)),
        ],
      }));
    }
  }

  // ── 3..N+2 · TIP SLIDES (type-led, hero echo crop) + the mid-deck moment ─────
  let slideNo = 3;
  plan.tips.forEach((tip, i) => {
    specs.push(DesignSpec.parse({
      background: CREAM,
      elements: [
        { type: "text", bbox: [80, 80, 620, 340], content: String(i + 1).padStart(2, "0"), font: FR, size: 230, colour: GOLD, align: "left" },
        { type: "photo", photo: 0, bbox: [860, 90, 1010, 240], zoom: 2.4, x: 0.5, y: 0.6 },
        { type: "rect", bbox: [80, 400, 164, 404], fill: GOLD },
        { type: "text", bbox: [80, 452, 1000, 650], content: wrap(tip.title, FR, 64, 920), font: FR, size: 64, colour: NAVY, align: "left", line_height: 78 },
        { type: "text", bbox: [80, 700, 1000, 1080], content: wrap(tip.body, "Jost", 36, 920), font: "Jost", size: 36, colour: mix(NAVY, CREAM, 0.85), align: "left", line_height: 56, valign: "center" },
        ...(tip.teaser ? [{ type: "text", bbox: [80, 1140, 900, 1188], content: tip.teaser, font: "Jost", size: 26, colour: CREAM, align: "left", weight: "500", valign: "center", pill: { fill: NAVY, pad_x: 28, pad_y: 14 } }] : []),
        ...band(slideNo, mix(NAVY, CREAM, 0.55)),
      ],
    }));
    slideNo++;
    if (i + 1 === midAfter) {
      // the mid-deck image moment (img2): the previous tip's open loop, writ large
      const line = tip.teaser || plan.save_line || plan.slide2_title;
      const els: any[] = [{ type: "photo", photo: 2, bbox: [0, 0, W, H] }];
      if (cfg.mode === "light") {
        els.push(noShield({ type: "text", bbox: [80, 150, 1000, 400], content: wrap(line, FR, 64, 920), font: FR, size: 64, colour: NAVY, align: "left", line_height: 80 }));
        els.push(noShield(aiTag(mix(NAVY, CREAM, 0.5))));
        els.push(...band(slideNo, mix(NAVY, CREAM, 0.6)).map(noShield));
      } else {
        els.push({ type: "scrim", bbox: [0, 820, W, H], colour: NAVY });
        els.push({ type: "scrim", bbox: [0, 1000, W, H], colour: NAVY });
        els.push({ type: "text", bbox: [80, 1030, 1000, 1220], content: wrap(line, FR, 64, 920), font: FR, size: 64, colour: "#f6f1e7", align: "left", line_height: 80 });
        els.push(aiTag(mix(CREAM, NAVY, 0.6)));
        els.push(...band(slideNo, mix(CREAM, NAVY, 0.65)));
      }
      specs.push(DesignSpec.parse({ background: NAVY, elements: els }));
      slideNo++;
    }
  });

  // ── RECAP — the save unit (type-led, hero echo) ──────────────────────────────
  {
    const rowH = Math.min(150, 760 / n);
    specs.push(DesignSpec.parse({
      background: CREAM,
      elements: [
        { type: "text", bbox: [80, 110, 700, 144], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "left", tracking: 5 },
        { type: "photo", photo: 0, bbox: [880, 84, 1010, 214], zoom: 2.4, x: 0.5, y: 0.6 },
        { type: "text", bbox: [80, 190, 1000, 300], content: wrap(plan.recap_title, FR, 64, 920), font: FR, size: 64, colour: NAVY, align: "left" },
        ...plan.tips.flatMap((tip, i) => {
          const y = 380 + i * rowH;
          return [
            { type: "text", bbox: [80, y, 200, y + rowH - 44], content: String(i + 1).padStart(2, "0"), font: FR, size: 44, colour: GOLD, align: "left", valign: "center" },
            { type: "text", bbox: [220, y, 1000, y + rowH - 44], content: wrap(tip.title, "Jost", 31, 770, "500"), font: "Jost", size: 31, colour: NAVY, align: "left", weight: "500", line_height: 38, valign: "center" },
            { type: "rect", bbox: [220, y + rowH - 36, 1000, y + rowH - 34.5], fill: mix(NAVY, CREAM, 0.2) },
          ];
        }),
        { type: "text", bbox: [80, 1140, 940, 1192], content: plan.save_line, font: "Jost", size: 26, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 15 } },
        ...band(total - 1, mix(NAVY, CREAM, 0.55)),
      ],
    }));
  }

  // ── CTA — img0 re-cropped + heavy navy grade, panel carries the ask ──────────
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], zoom: 1.7, x: 0.5, y: cfg.ctaY, tint: NAVY, tint_opacity: 0.32 },
      { type: "scrim", bbox: [0, 0, W, H], colour: NAVY },
      { type: "rect", bbox: [90, 300, 990, 1050], fill: CREAM, radius: 8, opacity: 0.97 },
      { type: "text", bbox: [150, 380, 930, 600], content: wrap(plan.cta_heading, FR, 76, 760), font: FR, size: 76, colour: NAVY, align: "center", line_height: 92, valign: "center" },
      { type: "text", bbox: [180, 660, 900, 790], content: wrap(plan.cta_action, "Jost", 30, 700), font: "Jost", size: 30, colour: mix(NAVY, CREAM, 0.85), align: "center", line_height: 46 },
      { type: "text", bbox: [310, 860, 770, 920], content: plan.cta_keyword.toUpperCase(), font: "Jost", size: 24, colour: CREAM, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [150, 968, 930, 998], content: contact, font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.6), align: "center", tracking: 2 },
      aiTag(mix(CREAM, NAVY, 0.6)),
      ...band(total, mix(CREAM, NAVY, 0.65)),
    ],
  }));

  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s as DesignSpec, { width: W, height: H }, images), cfg.grain));
  return out;
}


/**
 * V2 (Christian 2026-07-17): EVERY tip slide carries its OWN generated artwork — images[0] is the
 * cover, images[1..N] map 1:1 to tips. Three tip layouts rotate so consecutive slides never repeat:
 * art-top → art-card → full-art. Deck: cover / context (detail crop of the cover art) / N art-led
 * tips / recap (optional, by slide budget) / CTA (cover re-crop).
 */
export async function renderTipsImageStyledV2(
  style: TipsImageStyle, plan: CarouselPlan, agency: string, contact: string,
  brand: CarouselBrand, images: Buffer[], lang = "es", includeRecap = true, includeContext = true,
): Promise<Buffer[]> {
  const cfg = CFG[style];
  const T = chrome(lang);
  const NAVY = brand.navy, GOLD = brand.gold, CREAM = brand.cream;
  const n = plan.tips.length;
  const total = n + 2 + (includeContext ? 1 : 0) + (includeRecap ? 1 : 0);

  const band = (i: number, colour: string) => [
    { type: "text", bbox: [80, 1272, 640, 1300], content: agency.toUpperCase(), font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 },
  ];
  const aiTag = (colour: string, onLeft = false) =>
    ({ type: "text", bbox: onLeft ? [80, 1240, 640, 1262] : [440, 1240, 1000, 1262], content: T.ai_tag, font: "Jost", size: 15, colour, align: onLeft ? "left" : "right", tracking: 1 });
  const noShield = (e: Record<string, unknown>) => ({ ...e, shield: false });
  const specs: unknown[] = [];

  // 1 · COVER — identical grammar to V1
  {
    const els: any[] = [{ type: "photo", photo: 0, bbox: [0, 0, W, H], ...(cfg.crop ? { zoom: cfg.crop.z, x: 0.5, y: cfg.crop.y } : {}) }];
    if (cfg.mode === "dusk") {
      els.push({ type: "scrim", bbox: [0, 0, W, 620], colour: NAVY, direction: "down" });
      els.push({ type: "text", bbox: [80, 96, 720, 128], content: agency.toUpperCase(), font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
      els.push({ type: "text", bbox: [80, 200, 1000, 236], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
      els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(plan.hook_title, FR, 92, 920), font: FR, size: 92, colour: "#f6f1e7", align: "left", line_height: 108 });
      els.push(aiTag(mix(CREAM, NAVY, 0.6)));
      els.push(...band(1, mix(CREAM, NAVY, 0.65)));
    } else if (cfg.mode === "light") {
      els.push(noShield({ type: "text", bbox: [80, 96, 720, 128], content: agency.toUpperCase(), font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.75), align: "left", weight: "500", tracking: 5 }));
      els.push(noShield({ type: "text", bbox: [80, 200, 1000, 236], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 22, colour: mix(NAVY, CREAM, 0.72), align: "left", tracking: 6 }));
      els.push(noShield({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(plan.hook_title, FR, 92, 920), font: FR, size: 92, colour: NAVY, align: "left", line_height: 108 }));
      els.push(noShield(aiTag(mix(NAVY, CREAM, 0.5))));
      els.push(...band(1, mix(NAVY, CREAM, 0.6)).map(noShield));
    } else {
      els.push({ type: "scrim", bbox: [0, 0, W, 260], colour: NAVY, direction: "down" });
      els.push({ type: "scrim", bbox: [0, 640, W, H], colour: NAVY });
      els.push({ type: "scrim", bbox: [0, 880, W, H], colour: NAVY });
      els.push({ type: "text", bbox: [80, 96, 720, 128], content: agency.toUpperCase(), font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
      els.push({ type: "text", bbox: [80, 930, 1000, 966], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
      els.push({ type: "text", bbox: [80, 990, 1000, 1220], content: wrap(plan.hook_title, FR, 88, 920), font: FR, size: 88, colour: "#f6f1e7", align: "left", line_height: 104 });
      els.push(aiTag(mix(CREAM, NAVY, 0.6)));
      els.push(...band(1, mix(CREAM, NAVY, 0.65)));
    }
    specs.push(DesignSpec.parse({ background: NAVY, elements: els }));
  }

  // 2 · CONTEXT — a tight detail crop of the COVER art in a card (dropped on the shortest decks)
  if (includeContext) specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "rect", bbox: [310, 130, 770, 590], fill: CREAM, radius: 10 },
      { type: "photo", photo: 0, bbox: [332, 152, 748, 568], zoom: 1.8, x: 0.5, y: cfg.ctaY },
      { type: "text", bbox: [80, 660, 1000, 696], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "center", tracking: 6 },
      { type: "text", bbox: [110, 740, 970, 970], content: wrap(plan.slide2_title, FR, 64, 860), font: FR, size: 64, colour: CREAM, align: "center", line_height: 80, valign: "center" },
      { type: "text", bbox: [150, 1020, 930, 1150], content: wrap(plan.slide2_body, "Jost", 29, 720), font: "Jost", size: 29, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 44 },
      aiTag(mix(CREAM, NAVY, 0.6)),
      ...band(2, mix(CREAM, NAVY, 0.65)),
    ],
  }));

  // 3..N+2 · TIP SLIDES — each with its own art, three layouts rotating
  plan.tips.forEach((tip, i) => {
    const photo = Math.min(i + 1, images.length - 1);
    const slideNo = i + 2 + (includeContext ? 1 : 0);
    const variant = i % 3;
    if (variant === 0) {
      // ART-TOP: artwork band above, type below on ground
      specs.push(DesignSpec.parse({
        background: CREAM,
        elements: [
          { type: "photo", photo, bbox: [0, 0, W, 600] },
          { type: "rect", bbox: [0, 596, W, 600], fill: GOLD, opacity: 0.6 },
          { type: "text", bbox: [80, 640, 300, 800], content: String(i + 1).padStart(2, "0"), font: FR, size: 130, colour: GOLD, align: "left" },
          { type: "text", bbox: [320, 656, 1000, 830], content: wrap(tip.title, FR, 56, 660), font: FR, size: 56, colour: NAVY, align: "left", line_height: 68 },
          { type: "text", bbox: [80, 860, 1000, 1120], content: wrap(tip.body, "Jost", 33, 920), font: "Jost", size: 33, colour: mix(NAVY, CREAM, 0.85), align: "left", line_height: 50, valign: "center" },
          ...(tip.teaser ? [{ type: "text", bbox: [80, 1150, 900, 1196], content: tip.teaser, font: "Jost", size: 25, colour: CREAM, align: "left", weight: "500", valign: "center", pill: { fill: NAVY, pad_x: 26, pad_y: 13 } }] : []),
          aiTag(mix(NAVY, CREAM, 0.5)),
          ...band(slideNo, mix(NAVY, CREAM, 0.55)),
        ],
      }));
    } else if (variant === 1) {
      // ART-CARD: framed artwork right, number + title left, body full-width below
      specs.push(DesignSpec.parse({
        background: CREAM,
        elements: [
          { type: "rect", bbox: [560, 110, 1010, 620], fill: "#ffffff", radius: 10 },
          { type: "photo", photo, bbox: [578, 128, 992, 602], zoom: 1.05, x: 0.5, y: 0.45 },
          { type: "text", bbox: [80, 100, 520, 330], content: String(i + 1).padStart(2, "0"), font: FR, size: 200, colour: GOLD, align: "left" },
          { type: "text", bbox: [80, 360, 520, 640], content: wrap(tip.title, FR, 54, 440), font: FR, size: 54, colour: NAVY, align: "left", line_height: 66, valign: "center" },
          { type: "rect", bbox: [80, 690, 164, 694], fill: GOLD },
          { type: "text", bbox: [80, 740, 1000, 1080], content: wrap(tip.body, "Jost", 34, 920), font: "Jost", size: 34, colour: mix(NAVY, CREAM, 0.85), align: "left", line_height: 52, valign: "center" },
          ...(tip.teaser ? [{ type: "text", bbox: [80, 1140, 900, 1188], content: tip.teaser, font: "Jost", size: 25, colour: CREAM, align: "left", weight: "500", valign: "center", pill: { fill: NAVY, pad_x: 26, pad_y: 13 } }] : []),
          aiTag(mix(NAVY, CREAM, 0.5)),
          ...band(slideNo, mix(NAVY, CREAM, 0.55)),
        ],
      }));
    } else {
      // FULL-ART: the artwork is the slide; type rides the mode
      const els: any[] = [{ type: "photo", photo, bbox: [0, 0, W, H] }];
      if (cfg.mode === "light") {
        els.push(noShield({ type: "text", bbox: [80, 110, 280, 300], content: String(i + 1).padStart(2, "0"), font: FR, size: 150, colour: NAVY, align: "left" }));
        els.push(noShield({ type: "text", bbox: [80, 300, 1000, 470], content: wrap(tip.title, FR, 58, 900), font: FR, size: 58, colour: NAVY, align: "left", line_height: 70 }));
        els.push({ type: "rect", bbox: [64, 960, 1016, 1215], fill: CREAM, radius: 10, opacity: 0.94 });
        els.push({ type: "text", bbox: [100, 995, 980, 1180], content: wrap(tip.body, "Jost", 31, 860), font: "Jost", size: 31, colour: mix(NAVY, CREAM, 0.9), align: "left", line_height: 46, valign: "center" });
        els.push(noShield(aiTag(mix(NAVY, CREAM, 0.5))));
        els.push(...band(slideNo, mix(NAVY, CREAM, 0.6)).map(noShield));
      } else {
        els.push({ type: "scrim", bbox: [0, 0, W, 320], colour: NAVY, direction: "down" });
        els.push({ type: "scrim", bbox: [0, 760, W, H], colour: NAVY });
        els.push({ type: "scrim", bbox: [0, 960, W, H], colour: NAVY });
        els.push({ type: "text", bbox: [80, 100, 320, 260], content: String(i + 1).padStart(2, "0"), font: FR, size: 130, colour: GOLD, align: "left" });
        els.push({ type: "text", bbox: [80, 900, 1000, 1050], content: wrap(tip.title, FR, 58, 920), font: FR, size: 58, colour: "#f6f1e7", align: "left", line_height: 70 });
        els.push({ type: "text", bbox: [80, 1080, 1000, 1220], content: wrap(tip.body, "Jost", 30, 920), font: "Jost", size: 30, colour: mix(CREAM, NAVY, 0.9), align: "left", line_height: 44 });
        els.push(aiTag(mix(CREAM, NAVY, 0.6)));
        els.push(...band(slideNo, mix(CREAM, NAVY, 0.65)));
      }
      specs.push(DesignSpec.parse({ background: NAVY, elements: els }));
    }
  });

  // RECAP (optional by slide budget)
  if (includeRecap) {
    const rowH = Math.min(150, 760 / n);
    specs.push(DesignSpec.parse({
      background: CREAM,
      elements: [
        { type: "text", bbox: [80, 110, 700, 144], content: plan.eyebrow.toUpperCase(), font: "Jost", size: 21, colour: mix(NAVY, CREAM, 0.6), align: "left", tracking: 5 },
        { type: "photo", photo: 0, bbox: [880, 84, 1010, 214], zoom: 2.4, x: 0.5, y: 0.6 },
        { type: "text", bbox: [80, 190, 1000, 300], content: wrap(plan.recap_title, FR, 64, 920), font: FR, size: 64, colour: NAVY, align: "left" },
        ...plan.tips.flatMap((tip, i) => {
          const y = 380 + i * rowH;
          return [
            { type: "text", bbox: [80, y, 200, y + rowH - 44], content: String(i + 1).padStart(2, "0"), font: FR, size: 44, colour: GOLD, align: "left", valign: "center" },
            { type: "text", bbox: [220, y, 1000, y + rowH - 44], content: wrap(tip.title, "Jost", 31, 770, "500"), font: "Jost", size: 31, colour: NAVY, align: "left", weight: "500", line_height: 38, valign: "center" },
            { type: "rect", bbox: [220, y + rowH - 36, 1000, y + rowH - 34.5], fill: mix(NAVY, CREAM, 0.2) },
          ];
        }),
        { type: "text", bbox: [80, 1140, 940, 1192], content: plan.save_line, font: "Jost", size: 26, colour: NAVY, align: "left", weight: "500", valign: "center", pill: { fill: GOLD, pad_x: 30, pad_y: 15 } },
        ...band(total - 1, mix(NAVY, CREAM, 0.55)),
      ],
    }));
  }

  // CTA — cover art re-cropped
  specs.push(DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], zoom: 1.7, x: 0.5, y: cfg.ctaY, tint: NAVY, tint_opacity: 0.32 },
      { type: "scrim", bbox: [0, 0, W, H], colour: NAVY },
      { type: "rect", bbox: [90, 300, 990, 1050], fill: CREAM, radius: 8, opacity: 0.97 },
      { type: "text", bbox: [150, 380, 930, 600], content: wrap(plan.cta_heading, FR, 76, 760), font: FR, size: 76, colour: NAVY, align: "center", line_height: 92, valign: "center" },
      { type: "text", bbox: [180, 660, 900, 790], content: wrap(plan.cta_action, "Jost", 30, 700), font: "Jost", size: 30, colour: mix(NAVY, CREAM, 0.85), align: "center", line_height: 46 },
      { type: "text", bbox: [310, 860, 770, 920], content: plan.cta_keyword.toUpperCase(), font: "Jost", size: 24, colour: CREAM, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [150, 968, 930, 998], content: contact, font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.6), align: "center", tracking: 2 },
      aiTag(mix(CREAM, NAVY, 0.6)),
      ...band(total, mix(CREAM, NAVY, 0.65)),
    ],
  }));

  const out: Buffer[] = [];
  for (const sp of specs) out.push(await applyGrain(await renderFreeform(sp as DesignSpec, { width: W, height: H }, images), cfg.grain));
  return out;
}
