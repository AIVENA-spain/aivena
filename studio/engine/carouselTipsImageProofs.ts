// TIPS-WITH-AI-IMAGERY PROOFS (Christian 2026-07-16): four research-specified styles composed from
// REAL KIE nano-banana generations — Bodegón (still-life metaphor), Litoral (travel-poster gouache),
// Tinta (risograph print), Salitre (film photo). Engine draws all type; images are backdrops only;
// every slide with a generated layer carries the disclosure micro-tag. Show-first — proofs only.
// Run: npx tsx studio/engine/carouselTipsImageProofs.ts <outdir> <genDir>
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderFreeform, DesignSpec } from "./renderFreeform";
import { applyGrain, mix, wrap } from "./carouselSlides";

const W = 1080, H = 1350;
const NAVY = "#1f3a5f", GOLD = "#c9a227", CREAM = "#f6f1e7", INK = "#23272f";
const AGENCY = "MEDITERRÁNEO COSTA HOMES";
const FR = "Fraunces 115pt";
const AI_TAG = "Imagen ilustrativa generada con IA";

function band(i: number, total: number, colour: string) {
  return [
    { type: "text", bbox: [80, 1272, 640, 1300], content: AGENCY, font: "Jost", size: 17, colour, align: "left", weight: "500", tracking: 4 },
    { type: "text", bbox: [640, 1272, 1000, 1300], content: `Nº ${String(i).padStart(2, "0")} — ${String(total).padStart(2, "0")}`, font: "Jost", size: 17, colour, align: "right", tracking: 3 },
  ];
}
function aiTag(colour: string, onLeft = false) {
  return { type: "text", bbox: onLeft ? [80, 1240, 640, 1262] : [440, 1240, 1000, 1262], content: AI_TAG, font: "Jost", size: 15, colour, align: onLeft ? "left" : "right", tracking: 1 };
}

interface DeckCopy {
  kicker: string; hook: string; s2title: string; s2body: string;
  tipNum: string; tipTitle: string; tipBody: string; teaser: string;
  ctaHeading: string; ctaAction: string; keyword: string;
}

/** COVER: full-bleed hero + engine hook. Three modes from the spec's legibility doctrine:
 *  dusk  = navy eased scrim from the top over a light sky zone, cream type (Bodegon)
 *  light = NO scrim — flat light ground carries navy type natively (Litoral / Tinta)
 *  photo = agency line under a top scrim, hook deep in a strong bottom scrim (Salitre) */
function cover(c: DeckCopy, total: number, mode: "dusk" | "light" | "photo", wash = 0.06, crop?: { z: number; y: number }) {
  const deepGold = mix(GOLD, NAVY, 0.72);
  void deepGold;
  const els: any[] = [{ type: "photo", photo: 0, bbox: [0, 0, W, H], ...(crop ? { zoom: crop.z, x: 0.5, y: crop.y } : {}), ...(wash ? { tint: NAVY, tint_opacity: wash } : {}) }];
  if (mode === "dusk") {
    els.push({ type: "scrim", bbox: [0, 0, W, 620], colour: NAVY, direction: "down" });
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
    els.push({ type: "text", bbox: [80, 200, 1000, 236], content: c.kicker.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
    els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(c.hook, FR, 92, 920), font: FR, size: 92, colour: "#f6f1e7", align: "left", line_height: 108 });
    els.push(aiTag(mix(CREAM, NAVY, 0.6)));
    els.push(...band(1, total, mix(CREAM, NAVY, 0.65)));
  } else if (mode === "light") {
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.75), align: "left", weight: "500", tracking: 5, shield: false });
    els.push({ type: "text", bbox: [80, 200, 1000, 236], content: c.kicker.toUpperCase(), font: "Jost", size: 22, colour: mix(NAVY, CREAM, 0.72), align: "left", tracking: 6, shield: false });
    els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(c.hook, FR, 92, 920), font: FR, size: 92, colour: NAVY, align: "left", line_height: 108, shield: false });
    els.push({ ...aiTag(mix(NAVY, CREAM, 0.5)), shield: false });
    els.push(...band(1, total, mix(NAVY, CREAM, 0.6)).map((e) => ({ ...e, shield: false })));
  } else {
    els.push({ type: "scrim", bbox: [0, 0, W, 260], colour: NAVY, direction: "down" });
    els.push({ type: "scrim", bbox: [0, 640, W, H], colour: NAVY });
    els.push({ type: "scrim", bbox: [0, 880, W, H], colour: NAVY });
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
    els.push({ type: "text", bbox: [80, 930, 1000, 966], content: c.kicker.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
    els.push({ type: "text", bbox: [80, 990, 1000, 1220], content: wrap(c.hook, FR, 88, 920), font: FR, size: 88, colour: "#f6f1e7", align: "left", line_height: 104 });
    els.push(aiTag(mix(CREAM, NAVY, 0.6)));
    els.push(...band(1, total, mix(CREAM, NAVY, 0.65)));
  }
  return DesignSpec.parse({ background: NAVY, elements: els });
}

/** TIP SLIDE: type-led on brand ground, tiny echo crop of the hero as corner motif. */
function tipSlide(c: DeckCopy, ground: string, ink: string, accent: string, total: number) {
  return DesignSpec.parse({
    background: ground,
    elements: [
      { type: "text", bbox: [80, 80, 620, 340], content: c.tipNum, font: FR, size: 230, colour: accent, align: "left" },
      { type: "photo", photo: 0, bbox: [860, 90, 1010, 240], zoom: 2.4, x: 0.5, y: 0.6, tint: NAVY, tint_opacity: 0.06 },
      { type: "rect", bbox: [80, 400, 164, 404], fill: accent },
      { type: "text", bbox: [80, 452, 1000, 650], content: wrap(c.tipTitle, FR, 64, 920), font: FR, size: 64, colour: ink, align: "left", line_height: 78 },
      { type: "text", bbox: [80, 700, 1000, 1080], content: wrap(c.tipBody, "Jost", 36, 920), font: "Jost", size: 36, colour: mix(ink, ground, 0.85), align: "left", line_height: 56, valign: "center" },
      { type: "text", bbox: [80, 1140, 900, 1188], content: c.teaser, font: "Jost", size: 26, colour: ground, align: "left", weight: "500", valign: "center", pill: { fill: ink, pad_x: 28, pad_y: 14 } },
      ...band(3, total, mix(ink, ground, 0.55)),
    ],
  });
}

/** CTA: the same hero re-cropped + heavily navy-graded as backdrop, solid panel carries the ask. */
function cta(c: DeckCopy, total: number, cropY = 0.7) {
  return DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 0, bbox: [0, 0, W, H], zoom: 1.7, x: 0.5, y: cropY, tint: NAVY, tint_opacity: 0.32 },
      { type: "scrim", bbox: [0, 0, W, H], colour: NAVY },
      { type: "rect", bbox: [90, 300, 990, 1050], fill: CREAM, radius: 8, opacity: 0.97 },
      { type: "text", bbox: [150, 380, 930, 600], content: wrap(c.ctaHeading, FR, 76, 760), font: FR, size: 76, colour: NAVY, align: "center", line_height: 92, valign: "center" },
      { type: "text", bbox: [180, 660, 900, 790], content: wrap(c.ctaAction, "Jost", 30, 700), font: "Jost", size: 30, colour: "#333333", align: "center", line_height: 46 },
      { type: "text", bbox: [310, 860, 770, 920], content: c.keyword.toUpperCase(), font: "Jost", size: 24, colour: CREAM, align: "center", weight: "600", tracking: 3, valign: "center", pill: { fill: NAVY, pad_x: 40, pad_y: 20 } },
      { type: "text", bbox: [150, 968, 930, 998], content: "mediterraneocostahomes.es · +34 600 999 066", font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.6), align: "center", tracking: 2 },
      aiTag(mix(CREAM, NAVY, 0.6)),
      ...band(4, total, mix(CREAM, NAVY, 0.65)),
    ],
  });
}

async function renderDeck(specs: unknown[], photos: Buffer[], grain: number): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const s of specs) out.push(await applyGrain(await renderFreeform(s as DesignSpec, { width: W, height: H }, photos), grain));
  return out;
}

/** INTERSTITIAL: the deck's third image full-bleed with one pulling line — the mid-deck re-hook. */
function interstitial(line: string, mode: "dusk" | "light" | "photo", total: number, idx = 4) {
  const els: any[] = [{ type: "photo", photo: 2, bbox: [0, 0, W, H] }];
  if (mode === "light") {
    els.push({ type: "text", bbox: [80, 150, 1000, 400], content: wrap(line, FR, 64, 920), font: FR, size: 64, colour: NAVY, align: "left", line_height: 80, shield: false });
    els.push({ ...aiTag(mix(NAVY, CREAM, 0.5)), shield: false });
    els.push(...band(idx, total, mix(NAVY, CREAM, 0.6)).map((e) => ({ ...e, shield: false })));
  } else {
    els.push({ type: "scrim", bbox: [0, 820, W, H], colour: NAVY });
    els.push({ type: "scrim", bbox: [0, 1000, W, H], colour: NAVY });
    els.push({ type: "text", bbox: [80, 1030, 1000, 1220], content: wrap(line, FR, 64, 920), font: FR, size: 64, colour: "#f6f1e7", align: "left", line_height: 80 });
    els.push(aiTag(mix(CREAM, NAVY, 0.6)));
    els.push(...band(idx, total, mix(CREAM, NAVY, 0.65)));
  }
  return DesignSpec.parse({ background: NAVY, elements: els });
}

/** S2 with the deck's second image — per-style treatment. */
function s2Card(c: DeckCopy, total: number) {  // image in a cream card on navy (Bodegon / Salitre polaroid-ish)
  return DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "rect", bbox: [310, 130, 770, 590], fill: CREAM, radius: 10 },
      { type: "photo", photo: 1, bbox: [332, 152, 748, 568], zoom: 1.15, x: 0.5, y: 0.5 },
      { type: "text", bbox: [80, 660, 1000, 696], content: c.kicker.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "center", tracking: 6 },
      { type: "text", bbox: [110, 740, 970, 970], content: wrap(c.s2title, FR, 64, 860), font: FR, size: 64, colour: CREAM, align: "center", line_height: 80, valign: "center" },
      { type: "text", bbox: [150, 1020, 930, 1150], content: wrap(c.s2body, "Jost", 29, 720), font: "Jost", size: 29, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 44 },
      aiTag(mix(CREAM, NAVY, 0.6)),
      ...band(2, total, mix(CREAM, NAVY, 0.65)),
    ],
  });
}
function s2Strip(c: DeckCopy, total: number) {  // cream page + the second image as a wide footer strip (Litoral)
  return DesignSpec.parse({
    background: CREAM,
    elements: [
      { type: "text", bbox: [80, 120, 1000, 156], content: c.kicker.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 220, 1000, 520], content: wrap(c.s2title, FR, 76, 920), font: FR, size: 76, colour: NAVY, align: "left", line_height: 92, valign: "center" },
      { type: "text", bbox: [80, 580, 1000, 720], content: wrap(c.s2body, "Jost", 32, 920), font: "Jost", size: 32, colour: "#333333", align: "left", line_height: 48 },
      { type: "photo", photo: 1, bbox: [0, 800, 1080, 1210], zoom: 1.15, x: 0.5, y: 0.6 },
      { type: "rect", bbox: [0, 796, 1080, 800], fill: NAVY },
      { ...aiTag(mix(INK, CREAM, 0.55), true), shield: false },
      ...band(2, total, mix(INK, CREAM, 0.55)).map((e) => ({ ...e, shield: false })),
    ],
  });
}
function s2Full(c: DeckCopy, total: number) {  // second image full-bleed, dusk text (Tinta lighthouse)
  return DesignSpec.parse({
    background: NAVY,
    elements: [
      { type: "photo", photo: 1, bbox: [0, 0, W, H] },
      { type: "scrim", bbox: [0, 0, W, 560], colour: NAVY, direction: "down" },
      { type: "text", bbox: [80, 130, 1000, 166], content: c.kicker.toUpperCase(), font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 6 },
      { type: "text", bbox: [80, 210, 1000, 470], content: wrap(c.s2title, FR, 72, 920), font: FR, size: 72, colour: "#f6f1e7", align: "left", line_height: 88 },
      aiTag(mix(CREAM, NAVY, 0.6)),
      ...band(2, total, mix(CREAM, NAVY, 0.65)),
    ],
  });
}

/** Candidate cover for the "more styles" strip. */
function candidate(hook: string, kicker: string, mode: "light" | "dusk", zoom?: { z: number; y: number }) {
  const els: any[] = [{ type: "photo", photo: 0, bbox: [0, 0, W, H], ...(zoom ? { zoom: zoom.z, x: 0.5, y: zoom.y } : {}) }];
  if (mode === "light") {
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.75), align: "left", weight: "500", tracking: 5, shield: false });
    els.push({ type: "text", bbox: [80, 200, 1000, 236], content: kicker.toUpperCase(), font: "Jost", size: 22, colour: mix(NAVY, CREAM, 0.72), align: "left", tracking: 6, shield: false });
    els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(hook, FR, 92, 920), font: FR, size: 92, colour: NAVY, align: "left", line_height: 108, shield: false });
    els.push({ ...aiTag(mix(NAVY, CREAM, 0.5)), shield: false });
    els.push(...band(1, 8, mix(NAVY, CREAM, 0.6)).map((e) => ({ ...e, shield: false })));
  } else {
    els.push({ type: "scrim", bbox: [0, 0, W, 620], colour: NAVY, direction: "down" });
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
    els.push({ type: "text", bbox: [80, 200, 1000, 236], content: kicker.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
    els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(hook, FR, 92, 920), font: FR, size: 92, colour: "#f6f1e7", align: "left", line_height: 108 });
    els.push(aiTag(mix(CREAM, NAVY, 0.6)));
    els.push(...band(1, 8, mix(CREAM, NAVY, 0.65)));
  }
  return DesignSpec.parse({ background: NAVY, elements: els });
}

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-tips-ai";
  const genDir = process.argv[3] ?? "";
  mkdirSync(outdir, { recursive: true });
  const g = (f: string) => readFileSync(join(genDir, `gen-${f}.png`));
  const save = async (name: string, slides: Buffer[]) => {
    for (let i = 0; i < slides.length; i++) {
      writeFileSync(join(outdir, `${name}-${i + 1}.jpg`), await sharp(slides[i]).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer());
    }
    console.log(`${name}: ${slides.length} slides`);
  };

  // ── BODEGÓN — hidden costs (amphora / paper boat / balancing stones) ─────────
  {
    const c: DeckCopy = {
      kicker: "Guía para compradores", hook: "Los costes que no ves",
      s2title: "Lo que queda bajo la superficie", s2body: "Impuestos, notaría, comunidad, suministros — los gastos que no salen en el anuncio, uno a uno.",
      tipNum: "01", tipTitle: "El impuesto que llega después", tipBody: "El ITP se paga tras la compra, no en la reserva. Resérvalo desde el primer día o el presupuesto se hunde cuando ya no hay vuelta atrás.",
      teaser: "Siguiente: la factura de la notaría →",
      ctaHeading: "Que nada te pille bajo el agua", ctaAction: "Envíaselo a la persona con quien vas a comprar — y guardadlo para la firma.", keyword: "Escríbenos: COSTES",
    };
    const photos = [g("bodegon"), g("bodegon-2"), g("bodegon-3")];
    const specs: unknown[] = [
      cover(c, 5, "dusk"),
      s2Card(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("El equilibrio se aprende antes de firmar.", "dusk", 5),
      cta(c, 5, 0.75),
    ];
    await save("bodegon", await renderDeck(specs, photos, 0.04));
  }

  // ── LITORAL — moving to the coast (street / harbor / terrace) ────────────────
  {
    const c: DeckCopy = {
      kicker: "Mudarse a la costa", hook: "Lo que nadie te cuenta antes de mudarte",
      s2title: "¿Cambias de país este año?", s2body: "Papeles, plazos, barrios y estaciones — la guía honesta para llegar bien a la Costa Blanca.",
      tipNum: "01", tipTitle: "El pueblo cambia en invierno", tipBody: "Visita tu futura calle en enero. Los comercios que abren, el ruido real y la luz de la tarde cuentan más que cualquier foto de agosto.",
      teaser: "Siguiente: el papeleo del NIE →",
      ctaHeading: "El Mediterráneo te espera", ctaAction: "Envíaselo a quien sueña con mudarse contigo — y guardadlo para el gran día.", keyword: "Escríbenos: COSTA",
    };
    const photos = [g("litoral"), g("litoral-2"), g("litoral-3")];
    const specs: unknown[] = [
      cover(c, 5, "light", 0),
      s2Strip(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("Tu mesa al sol ya existe. Falta la dirección.", "light", 5),
      cta(c, 5, 0.5),
    ];
    await save("litoral", await renderDeck(specs, photos, 0.04));
  }

  // ── TINTA — renovation/selling (sun / lighthouse / gold window) ──────────────
  {
    const c: DeckCopy = {
      kicker: "Vender bien", hook: "Que tu casa sea la que brilla",
      s2title: "El comprador ve cien anuncios. Guíalo al tuyo.", s2body: "Cinco decisiones que hacen que una casa destaque — antes de bajar un solo euro.",
      tipNum: "01", tipTitle: "La primera foto decide", tipBody: "Tu anuncio compite en una pantalla llena de miniaturas. Una portada luminosa y despejada dobla las visitas antes de que nadie lea el precio.",
      teaser: "Siguiente: la luz que vende →",
      ctaHeading: "Enciende tu anuncio", ctaAction: "Guárdalo para antes de publicar — y compártelo con quien vende contigo.", keyword: "Escríbenos: BRILLA",
    };
    const photos = [g("tinta-h"), g("tinta-2"), g("tinta-3")];
    const specs: unknown[] = [
      cover(c, 5, "light", 0),
      s2Full(c, 5),
      tipSlide(c, "#f2ecdd", NAVY, GOLD, 5),
      interstitial("Una ventana encendida basta.", "dusk", 5),
      cta(c, 5, 0.4),
    ];
    await save("tinta", await renderDeck(specs, photos, 0.05));
  }

  // ── SALITRE — coastal living (aerial boat / persiana wall / espadrilles) ─────
  {
    const c: DeckCopy = {
      kicker: "Vivir en la costa", hook: "Comprar en la costa, sin prisas",
      s2title: "La casa correcta llega despacio.", s2body: "Cómo visitar, comparar y decidir con calma — la compra que se disfruta también antes de las llaves.",
      tipNum: "01", tipTitle: "Toma el café en el barrio", tipBody: "Antes de la segunda visita, desayuna en la plaza más cercana. Si el barrio te gusta un martes cualquiera, la casa acertará.",
      teaser: "Siguiente: la lista de la visita →",
      ctaHeading: "Tu sitio al sol", ctaAction: "Envíaselo a la persona con quien compartirás la mesa — y guardadlo para la búsqueda.", keyword: "Escríbenos: CALMA",
    };
    const photos = [g("salitre-h"), g("salitre-2"), g("salitre-3")];
    const specs: unknown[] = [
      cover(c, 5, "photo", 0),
      s2Card(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("Despacio también es una dirección.", "photo", 5),
      cta(c, 5, 0.5),
    ];
    await save("salitre", await renderDeck(specs, photos, 0.045));
  }

  // ── PAPEL — buying in stages (cove / sailboats / paper sun) ──────────────────
  {
    const c: DeckCopy = {
      kicker: "Comprar por etapas", hook: "Los pasos que nadie te explica",
      s2title: "Del sueño a las llaves, por capas", s2body: "Reserva, arras, notaría — cada etapa tiene su momento y su papel. Aquí van, una a una.",
      tipNum: "01", tipTitle: "La reserva no es el contrato", tipBody: "La señal aparta la casa unos días; las arras te comprometen de verdad. Saber cuál firmas evita perder dinero — o la casa.",
      teaser: "Siguiente: las arras, sin susto →",
      ctaHeading: "Sube un escalón cada semana", ctaAction: "Guárdalo para tu proceso — y envíaselo a quien compra contigo.", keyword: "Escríbenos: ETAPAS",
    };
    const photos = [g("papel"), g("papel-2"), g("papel-3")];
    const specs: unknown[] = [
      cover(c, 5, "light", 0, { z: 1.45, y: 0.52 }),
      s2Strip(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("Cada etapa tiene su amanecer.", "light", 5),
      cta(c, 5, 0.6),
    ];
    await save("papel", await renderDeck(specs, photos, 0.035));
  }

  // ── ARCILLA — first home in Spain (house+pool / beach / moving boxes) ────────
  {
    const c: DeckCopy = {
      kicker: "Pequeña guía práctica", hook: "¿Tu primera casa en España?",
      s2title: "Pequeños pasos, casa grande", s2body: "NIE, cuenta bancaria, reserva y escritura — lo esencial para comprar siendo nuevo aquí, sin letra pequeña.",
      tipNum: "01", tipTitle: "Primero el NIE, luego todo", tipBody: "Sin el número de extranjero no hay compra, ni banco, ni luz. Pídelo antes de enamorarte de una casa — tarda más de lo que crees.",
      teaser: "Siguiente: la cuenta bancaria →",
      ctaHeading: "Tu casita te espera", ctaAction: "Guárdalo para tu mudanza — y compártelo con quien viene contigo.", keyword: "Escríbenos: PRIMERA",
    };
    const photos = [g("arcilla"), g("arcilla-2"), g("arcilla-3")];
    const specs: unknown[] = [
      cover(c, 5, "light", 0),
      s2Card(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("La mudanza también cabe en cajas pequeñas.", "light", 5),
      cta(c, 5, 0.7),
    ];
    await save("arcilla", await renderDeck(specs, photos, 0.035));
  }

  // ── ACUARELA — choosing views & light (balcony / doorway cat / bay) ──────────
  {
    const c: DeckCopy = {
      kicker: "La guía del balcón", hook: "Vivir con vistas, bien elegido",
      s2title: "La vista se disfruta; la luz se vive.", s2body: "Orientación, horas de sol y lo que se ve desde cada ventana — cómo elegir la casa que se siente bien todo el año.",
      tipNum: "01", tipTitle: "El sur paga la calefacción", tipBody: "Una orientación sur bien aprovechada regala luz en invierno y sombra fácil en verano. Pregunta la orientación antes que los metros.",
      teaser: "Siguiente: la hora de la visita →",
      ctaHeading: "Elige tu ventana", ctaAction: "Guárdalo para tus visitas — y envíaselo a quien mira casas contigo.", keyword: "Escríbenos: VISTAS",
    };
    const photos = [g("acuarela"), g("acuarela-2"), g("acuarela-3")];
    const specs: unknown[] = [
      cover(c, 5, "light", 0),
      s2Card(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("Hay bahías que se eligen desde arriba.", "light", 5),
      cta(c, 5, 0.55),
    ];
    await save("acuarela", await renderDeck(specs, photos, 0.035));
  }

  // ── BORDADO — advice that lasts (coast sunset / casita / sailboat) ───────────
  {
    const c: DeckCopy = {
      kicker: "Hecho a mano", hook: "Consejos que duran años",
      s2title: "Una casa se cuida puntada a puntada", s2body: "Mantenimiento, vecinos, humedad y sol — los cuidados pequeños que mantienen grande el valor de tu casa.",
      tipNum: "01", tipTitle: "Revisa la fachada cada otoño", tipBody: "El salitre trabaja despacio: una mano de cal y un repaso de juntas cada año ahorran la obra grande cada década.",
      teaser: "Siguiente: la humedad silenciosa →",
      ctaHeading: "Cose tu calendario de cuidados", ctaAction: "Guárdalo — es tu lista anual. Y envíaselo a quien comparte casa contigo.", keyword: "Escríbenos: CUIDAR",
    };
    const photos = [g("bordado"), g("bordado-2"), g("bordado-3")];
    const specs: unknown[] = [
      cover(c, 5, "light", 0),
      s2Card(c, 5),
      tipSlide(c, CREAM, NAVY, GOLD, 5),
      interstitial("Rumbo tranquilo, casa contenta.", "light", 5),
      cta(c, 5, 0.75),
    ];
    await save("bordado", await renderDeck(specs, photos, 0.035));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
