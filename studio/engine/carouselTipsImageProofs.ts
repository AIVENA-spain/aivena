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
function cover(c: DeckCopy, total: number, mode: "dusk" | "light" | "photo", wash = 0.06) {
  const deepGold = mix(GOLD, NAVY, 0.72);
  const els: any[] = [{ type: "photo", photo: 0, bbox: [0, 0, W, H], ...(wash ? { tint: NAVY, tint_opacity: wash } : {}) }];
  if (mode === "dusk") {
    els.push({ type: "scrim", bbox: [0, 0, W, 620], colour: NAVY, direction: "down" });
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: CREAM, align: "left", weight: "500", tracking: 5 });
    els.push({ type: "text", bbox: [80, 200, 1000, 236], content: c.kicker.toUpperCase(), font: "Jost", size: 22, colour: GOLD, align: "left", tracking: 6 });
    els.push({ type: "text", bbox: [80, 260, 1000, 560], content: wrap(c.hook, FR, 92, 920), font: FR, size: 92, colour: "#f6f1e7", align: "left", line_height: 108 });
    els.push(aiTag(mix(CREAM, NAVY, 0.6)));
    els.push(...band(1, total, mix(CREAM, NAVY, 0.65)));
  } else if (mode === "light") {
    els.push({ type: "text", bbox: [80, 96, 720, 128], content: AGENCY, font: "Jost", size: 20, colour: mix(NAVY, CREAM, 0.75), align: "left", weight: "500", tracking: 5, shield: false });
    els.push({ type: "text", bbox: [80, 200, 1000, 236], content: c.kicker.toUpperCase(), font: "Jost", size: 22, colour: deepGold, align: "left", tracking: 6, shield: false });
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

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-tips-ai";
  const genDir = process.argv[3] ?? "";
  mkdirSync(outdir, { recursive: true });
  const hero = (f: string) => readFileSync(join(genDir, f));

  const save = async (name: string, slides: Buffer[]) => {
    for (let i = 0; i < slides.length; i++) {
      writeFileSync(join(outdir, `${name}-${i + 1}.jpg`), await sharp(slides[i]).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer());
    }
    console.log(`${name}: ${slides.length} slides`);
  };

  // ── BODEGÓN — hidden costs / the amphora ────────────────────────────────────
  {
    const c: DeckCopy = {
      kicker: "Guía para compradores", hook: "Los costes que no ves",
      s2title: "¿Compras este año? Esto es lo que queda bajo la superficie.",
      s2body: "Impuestos, notaría, comunidad, suministros — los gastos que no salen en el anuncio, explicados uno a uno.",
      tipNum: "01", tipTitle: "El impuesto que llega después", tipBody: "El ITP se paga tras la compra, no en la reserva. Resérvalo desde el primer día o el presupuesto se hunde cuando ya no hay vuelta atrás.",
      teaser: "Siguiente: la factura de la notaría →",
      ctaHeading: "Que nada te pille bajo el agua", ctaAction: "Envíaselo a la persona con quien vas a comprar — y guardadlo para la firma.", keyword: "Escríbenos: COSTES",
    };
    const photos = [hero("gen-bodegon.png")];
    const specs: unknown[] = [
      cover(c, 4, "dusk"),
      // S2: tight object crop in a cream card on navy — zero contrast risk
      DesignSpec.parse({
        background: NAVY,
        elements: [
          { type: "rect", bbox: [330, 140, 750, 560], fill: CREAM, radius: 10 },
          { type: "photo", photo: 0, bbox: [352, 162, 728, 538], zoom: 1.9, x: 0.5, y: 0.62 },
          { type: "text", bbox: [80, 640, 1000, 676], content: "GUÍA PARA COMPRADORES", font: "Jost", size: 21, colour: GOLD, align: "center", tracking: 6 },
          { type: "text", bbox: [110, 720, 970, 960], content: wrap(c.s2title, FR, 64, 860), font: FR, size: 64, colour: CREAM, align: "center", line_height: 80, valign: "center" },
          { type: "text", bbox: [150, 1010, 930, 1140], content: wrap(c.s2body, "Jost", 29, 720), font: "Jost", size: 29, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 44 },
          aiTag(mix(CREAM, NAVY, 0.6)),
          ...band(2, 4, mix(CREAM, NAVY, 0.65)),
        ],
      }),
      tipSlide(c, CREAM, NAVY, GOLD, 4),
      cta(c, 4, 0.75),
    ];
    await save("bodegon", await renderDeck(specs, photos, 0.04));
  }

  // ── LITORAL — moving to the coast / the gouache street ──────────────────────
  {
    const c: DeckCopy = {
      kicker: "Mudarse a la costa", hook: "Lo que nadie te cuenta antes de mudarte",
      s2title: "¿Cambias de país este año? Empieza por aquí.",
      s2body: "Papeles, plazos, barrios y estaciones — la guía honesta para llegar bien a la Costa Blanca.",
      tipNum: "01", tipTitle: "El pueblo cambia en invierno", tipBody: "Visita tu futura calle en enero. Los comercios que abren, el ruido real y la luz de la tarde cuentan más que cualquier foto de agosto.",
      teaser: "Siguiente: el papeleo del NIE →",
      ctaHeading: "El Mediterráneo te espera", ctaAction: "Envíaselo a quien sueña con mudarse contigo — y guardadlo para el gran día.", keyword: "Escríbenos: COSTA",
    };
    const photos = [hero("gen-litoral.png")];
    const specs: unknown[] = [
      cover(c, 4, "light", 0),
      // S2: solid cream + thin illustrated horizon strip as footer
      DesignSpec.parse({
        background: CREAM,
        elements: [
          { type: "text", bbox: [80, 120, 1000, 156], content: "MUDARSE A LA COSTA", font: "Jost", size: 21, colour: GOLD, align: "left", tracking: 6 },
          { type: "text", bbox: [80, 220, 1000, 520], content: wrap(c.s2title, FR, 76, 920), font: FR, size: 76, colour: NAVY, align: "left", line_height: 92, valign: "center" },
          { type: "text", bbox: [80, 580, 1000, 720], content: wrap(c.s2body, "Jost", 32, 920), font: "Jost", size: 32, colour: "#333333", align: "left", line_height: 48 },
          { type: "photo", photo: 0, bbox: [0, 830, 1080, 1200], zoom: 1.4, x: 0.5, y: 0.86 },
          { type: "rect", bbox: [0, 826, 1080, 830], fill: NAVY },
          { ...aiTag(mix(INK, CREAM, 0.55), true), shield: false },
          ...band(2, 4, mix(INK, CREAM, 0.55)).map((e) => ({ ...e, shield: false })),
        ],
      }),
      tipSlide(c, CREAM, NAVY, GOLD, 4),
      cta(c, 4, 0.5),
    ];
    await save("litoral", await renderDeck(specs, photos, 0.04));
  }

  // ── TINTA — renovation traps / the riso paint roller ────────────────────────
  {
    const c: DeckCopy = {
      kicker: "Reformas sin sustos", hook: "Los errores que la pintura no tapa",
      s2title: "¿Reformas para vender? Lee esto antes de pintar.",
      s2body: "Cinco arreglos que suman valor — y los parches que un comprador detecta en la primera visita.",
      tipNum: "01", tipTitle: "La grieta vuelve siempre", tipBody: "Tapar una grieta sin tratar la causa cuesta el doble: la pintura la esconde tres meses, la tasación la encuentra en tres minutos.",
      teaser: "Siguiente: el presupuesto honesto →",
      ctaHeading: "Reforma lo que suma", ctaAction: "Guárdalo antes de pedir el primer presupuesto — y compártelo con quien reforma contigo.", keyword: "Escríbenos: REFORMA",
    };
    const photos = [hero("gen-tinta.png")];
    const specs: unknown[] = [
      cover(c, 4, "light", 0),
      // S2: pure typographic print poster — engine-only, no image
      DesignSpec.parse({
        background: "#f2ecdd",
        elements: [
          { type: "rect", bbox: [80, 150, 430, 168], fill: GOLD },
          { type: "text", bbox: [80, 230, 1000, 610], content: wrap(c.s2title, FR, 92, 920), font: FR, size: 92, colour: NAVY, align: "left", line_height: 110, valign: "center" },
          { type: "rect", bbox: [80, 680, 1000, 683], fill: NAVY },
          { type: "text", bbox: [80, 730, 1000, 880], content: wrap(c.s2body, "Jost", 32, 920), font: "Jost", size: 32, colour: mix(NAVY, "#f2ecdd", 0.85), align: "left", line_height: 48 },
          { type: "text", bbox: [80, 1000, 1000, 1036], content: "SERIE · REFORMAS SIN SUSTOS · Nº 02", font: "Jost", size: 20, colour: GOLD, align: "left", tracking: 5 },
          ...band(2, 4, mix(NAVY, "#f2ecdd", 0.55)),
        ],
      }),
      tipSlide(c, "#f2ecdd", NAVY, GOLD, 4),
      cta(c, 4, 0.75),
    ];
    await save("tinta", await renderDeck(specs, photos, 0.05));
  }

  // ── SALITRE — coastal living / the film photo ───────────────────────────────
  {
    const c: DeckCopy = {
      kicker: "Vivir en la costa", hook: "Comprar en la costa, sin prisas",
      s2title: "La casa correcta llega despacio.",
      s2body: "Cómo visitar, comparar y decidir con calma — la compra que se disfruta también antes de las llaves.",
      tipNum: "01", tipTitle: "Toma el café en el barrio", tipBody: "Antes de la segunda visita, desayuna en la plaza más cercana. Si el barrio te gusta un martes cualquiera, la casa acertará.",
      teaser: "Siguiente: la lista de la visita →",
      ctaHeading: "Tu mesa junto al mar", ctaAction: "Envíaselo a la persona con quien compartirás la mesa — y guardadlo para la búsqueda.", keyword: "Escríbenos: CALMA",
    };
    const photos = [hero("gen-salitre.png")];
    const specs: unknown[] = [
      cover(c, 4, "photo", 0),
      // S2: solid navy + the photo as a small taped polaroid card (honest hybrid)
      DesignSpec.parse({
        background: NAVY,
        elements: [
          { type: "rect", bbox: [340, 130, 760, 560], fill: "#ffffff", rotate: -2 },
          { type: "photo", photo: 0, bbox: [362, 152, 738, 500], zoom: 1.3, x: 0.5, y: 0.55, rotate: -2 },
          { type: "rect", bbox: [480, 96, 630, 140], fill: "#e8e0cd", opacity: 0.85, rotate: -8 },
          { type: "text", bbox: [80, 640, 1000, 676], content: "VIVIR EN LA COSTA", font: "Jost", size: 21, colour: GOLD, align: "center", tracking: 6 },
          { type: "text", bbox: [110, 720, 970, 920], content: wrap(c.s2title, FR, 72, 860), font: FR, size: 72, colour: CREAM, align: "center", line_height: 88, valign: "center" },
          { type: "text", bbox: [150, 980, 930, 1110], content: wrap(c.s2body, "Jost", 29, 720), font: "Jost", size: 29, colour: mix(CREAM, NAVY, 0.85), align: "center", line_height: 44 },
          aiTag(mix(CREAM, NAVY, 0.6)),
          ...band(2, 4, mix(CREAM, NAVY, 0.65)),
        ],
      }),
      tipSlide(c, CREAM, NAVY, GOLD, 4),
      cta(c, 4, 0.55),
    ];
    await save("salitre", await renderDeck(specs, photos, 0.045));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
