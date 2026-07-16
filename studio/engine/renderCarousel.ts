import { renderFreeform, DesignSpec } from "./renderFreeform";

// CAROUSEL renderer (Christian 2026-07-16): a deterministic multi-slide Instagram carousel built from the
// listing's real photos and facts — cover slide, one full-bleed slide per photo, and a closing facts/CTA
// card. Every slide is drawn by the freeform engine (no AI, no provider): facts are canonical strings
// passed in by the server, so nothing can be invented, and rendering takes seconds. HONEST SCOPE: this
// produces the slide IMAGES for the agent to post — publishing/scheduling to Instagram is not part of it.

export interface CarouselFacts {
  title: string;            // "Villa in Altea"
  location: string;         // "ALTEA · ALICANTE"
  price: string;            // "€695,000" ("" when unknown → hidden)
  specs: string;            // "3 BED · 3 BATH · 214 M²" ("" → hidden)
  agency: string;           // agency display name
  contact: string;          // "aivena.es · +34 600 999 066"
}

export interface CarouselBrand { navy: string; gold: string; cream: string; text: string; }

const W = 1080, H = 1350;

/** the slide-position indicator: N dots along the bottom, current one in the accent */
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

function coverSpec(facts: CarouselFacts, brand: CarouselBrand, total: number) {
  const elements: any[] = [
    { type: "photo", photo: 0, bbox: [0, 0, W, H] },
    { type: "scrim", bbox: [0, 0, W, 220], colour: "#0a0c10", direction: "down" },
    { type: "scrim", bbox: [0, H * 0.45, W, H], colour: "#0a0c10", direction: "up" },
    { type: "text", bbox: [64, 44, 700, 80], content: facts.agency.toUpperCase(), font: "Jost", size: 21, colour: "#f3efe6", align: "left", weight: "500", tracking: 5 },
    { type: "text", bbox: [64, 950, 1016, 982], content: facts.location, font: "Jost", size: 20, colour: brand.gold, align: "left", tracking: 6 },
    { type: "text", bbox: [64, 996, 1016, 1104], content: facts.title, font: "Libre Caslon Display", size: 80, colour: "#f3efe6", align: "left" },
  ];
  if (facts.price) {
    elements.push({ type: "text", bbox: [64, 1128, 1016, 1210], content: facts.price, font: "Libre Caslon Display", size: 62, colour: brand.gold, align: "left" });
  }
  if (facts.specs) {
    elements.push({ type: "text", bbox: [64, 1232, 760, 1262], content: facts.specs, font: "Jost", size: 21, colour: "#f3efe6", align: "left", tracking: 3 });
  }
  // the swipe cue, right-aligned against the specs row
  elements.push({ type: "text", bbox: [760, 1230, 1016, 1264], content: "DESLIZA  →", font: "Jost", size: 20, colour: "#f3efe6", align: "right", weight: "500", tracking: 4 });
  elements.push(...dots(total, 0, brand, 1312, true));
  return DesignSpec.parse({ background: "#0a0c10", elements });
}

function photoSpec(photoIndex: number, slideIndex: number, facts: CarouselFacts, brand: CarouselBrand, total: number) {
  const elements: any[] = [
    { type: "photo", photo: photoIndex, bbox: [0, 0, W, H] },
    { type: "scrim", bbox: [0, H - 200, W, H], colour: "#0a0c10", direction: "up" },
    { type: "text", bbox: [64, 1272, 700, 1300], content: facts.agency.toUpperCase(), font: "Jost", size: 17, colour: "#f3efe6", align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [700, 1272, 1016, 1300], content: facts.location, font: "Jost", size: 16, colour: "#f3efe6", align: "right", tracking: 3 },
  ];
  elements.push(...dots(total, slideIndex, brand, 1230, true));
  return DesignSpec.parse({ background: "#0a0c10", elements });
}

function ctaSpec(facts: CarouselFacts, brand: CarouselBrand, total: number) {
  const elements: any[] = [
    // brand panel page: navy ground, gold rules, the full card
    { type: "rect", bbox: [64, 200, 128, 203], fill: brand.gold },
    { type: "text", bbox: [64, 96, 1016, 132], content: facts.agency.toUpperCase(), font: "Jost", size: 22, colour: brand.cream, align: "left", weight: "500", tracking: 5 },
    { type: "text", bbox: [64, 236, 1016, 268], content: facts.location, font: "Jost", size: 21, colour: brand.gold, align: "left", tracking: 6 },
    { type: "text", bbox: [64, 288, 1016, 420], content: facts.title, font: "Libre Caslon Display", size: 92, colour: brand.cream, align: "left" },
  ];
  let y = 470;
  if (facts.specs) {
    elements.push({ type: "text", bbox: [64, y, 1016, y + 34], content: facts.specs, font: "Jost", size: 24, colour: brand.cream, align: "left", tracking: 3 });
    y += 90;
  }
  if (facts.price) {
    elements.push({ type: "text", bbox: [64, y, 1016, y + 110], content: facts.price, font: "Libre Caslon Display", size: 96, colour: brand.gold, align: "left" });
    y += 170;
  }
  elements.push({ type: "rect", bbox: [64, y, 1016, y + 1.5], fill: brand.gold, opacity: 0.5 });
  y += 44;
  elements.push({
    type: "text", bbox: [64, y, 620, y + 46], content: "ESCRÍBENOS HOY", font: "Jost", size: 22,
    colour: brand.navy, align: "left", weight: "600", tracking: 4, valign: "center",
    pill: { fill: brand.gold, pad_x: 34, pad_y: 16 },
  });
  y += 110;
  elements.push({ type: "text", bbox: [64, y, 1016, y + 30], content: facts.contact, font: "Jost", size: 21, colour: brand.cream, align: "left", tracking: 2 });
  elements.push(...dots(total, total - 1, brand, 1312, true));
  return DesignSpec.parse({ background: brand.navy, elements });
}

/**
 * Render the full carousel: cover (photo 0) → one slide per remaining photo → CTA card.
 * photos.length must be 2..9 (=> 3..10 slides, Instagram's carousel cap).
 */
export async function renderCarousel(
  facts: CarouselFacts, brand: CarouselBrand, photos: Buffer[],
): Promise<Buffer[]> {
  if (photos.length < 2 || photos.length > 9) throw new Error("carousel needs 2-9 photos");
  const total = photos.length + 1;
  const slides: Buffer[] = [];
  slides.push(await renderFreeform(coverSpec(facts, brand, total), { width: W, height: H }, photos));
  for (let i = 1; i < photos.length; i++) {
    slides.push(await renderFreeform(photoSpec(i, i, facts, brand, total), { width: W, height: H }, photos));
  }
  slides.push(await renderFreeform(ctaSpec(facts, brand, total), { width: W, height: H }, photos));
  return slides;
}
