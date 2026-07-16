// Local proof render for the CAROUSEL v2 slide library (tips + quote + listing) — Mediterráneo Costa Homes.
// Run: npx tsx studio/engine/carouselPlannedProof.ts <outdir> [photoDir]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderPlannedCarousel, CarouselPlan } from "./carouselSlides";
import { renderCarousel, CarouselFacts, CarouselCopy } from "./renderCarousel";

const BRAND = { navy: "#1f3a5f", gold: "#c9a227", cream: "#f6f1e7", text: "#333333" };
const AGENCY = "Mediterráneo Costa Homes";
const CONTACT = "mediterraneocostahomes.es · +34 600 999 066";

// tips plan written to the doctrine: loss-framed hook, standalone slide 2, open-loop teasers, recap, KPI CTA
const tipsPlan: CarouselPlan = {
  type: "tips",
  eyebrow: "Compradores en la costa",
  hook_title: "Los 5 errores que más cuestan al comprar en la costa",
  slide2_title: "¿Compras este año? Esto te ahorra disgustos.",
  slide2_body: "Cinco fallos que vemos cada semana en la Costa Blanca — y cómo evitarlos antes de firmar nada.",
  tips: [
    { title: "Comprar sin ver la zona en invierno", body: "Un pueblo de costa cambia por completo fuera de temporada. Visita en enero: mira qué comercios abren y si el barrio sigue vivo cuando se van los turistas.", teaser: "Siguiente: el recibo que nadie mira →" },
    { title: "Ignorar los gastos de comunidad", body: "Piscina, jardines y ascensor se pagan cada mes. Pide las actas de la comunidad antes de firmar: ahí aparecen las derramas previstas y los problemas del edificio.", teaser: "Siguiente: los tres papeles clave →" },
    { title: "No verificar la situación legal", body: "Nota simple, licencia de primera ocupación y certificado energético. Tres documentos que cuentan la verdad de una vivienda. Sin ellos, no hay visita que valga.", teaser: "Siguiente: por qué las fotos engañan →" },
    { title: "Fiarse solo de las fotos", body: "Las fotos enseñan la mejor versión. La orientación, el ruido de la calle y la luz real de cada habitación solo se descubren visitando a distintas horas.", teaser: "El último es el más caro →" },
    { title: "Negociar sin datos", body: "Antes de ofertar, estudia cuánto lleva la vivienda en el mercado y qué se ha vendido cerca. Una oferta informada se toma en serio; una cifra al azar, no.", teaser: "" },
  ],
  recap_title: "Los 5 errores, en 30 segundos",
  save_line: "Guárdalo para cuando empieces a buscar",
  quote_parts: [], quote_hook: "", quote_context: "", attribution: "",
  cta_heading: "¿Buscas casa en la Costa Blanca?",
  cta_action: "Envíaselo a la persona con quien vas a comprar — os ahorrará más de un disgusto.",
  cta_keyword: "Escríbenos: GUÍA",
  swipe_cue: "Desliza",
  caption: "-", hashtags: [],
};

const quotePlan: CarouselPlan = {
  type: "quote",
  eyebrow: "Una historia real",
  hook_title: "",
  slide2_title: "Vender desde fuera, sin perder el sueño",
  slide2_body: "",
  tips: [], recap_title: "", save_line: "",
  quote_parts: [
    "Vendimos nuestra villa en menos de dos meses. Nos explicaron cada paso con calma, sin prisas y sin sorpresas.",
    "Lo que más valoramos: siempre había una persona al otro lado del teléfono. Repetiríamos sin dudarlo.",
  ],
  quote_hook: "Vendimos nuestra villa en menos de dos meses.",
  quote_context: "Una familia que vendía su casa en Altea sin vivir en España — su experiencia, en sus propias palabras.",
  attribution: "— Familia Andersson, Altea",
  cta_heading: "Tu historia puede ser la siguiente",
  cta_action: "¿En la misma situación? Cuéntanos qué necesitas y te llamamos hoy mismo.",
  cta_keyword: "Escríbenos: EMPEZAR",
  swipe_cue: "Desliza",
  caption: "-", hashtags: [],
};

const listingFacts: CarouselFacts = {
  title: "Villa in Altea",
  location: "ALTEA · ALICANTE",
  price: "695.000 €",
  specs: "3 BED · 3 BATH · 214 M²",
  beds: "3", baths: "3", area: "214 m²",
  agency: AGENCY, contact: CONTACT,
  features: ["Piscina privada", "Vistas al mar", "Terraza de 40 m²", "Garaje doble"],
};
const listingCopy: CarouselCopy = {
  hook: "Atardeceres sobre el Mediterráneo, cada día",
  lifestyle_line: "Vivir en Altea: calas escondidas, el casco antiguo blanco y cafés junto al mar.",
  cta_action: "Guarda este anuncio para tu próxima visita a la zona.",
  cta_keyword: "Escríbenos: VISITA",
};

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-planned";
  const photoDir = process.argv[3] ?? "";
  mkdirSync(outdir, { recursive: true });

  const save = async (name: string, slides: Buffer[]) => {
    for (let i = 0; i < slides.length; i++) {
      const jpg = await sharp(slides[i]).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer();
      writeFileSync(join(outdir, `${name}-${i + 1}.jpg`), jpg);
    }
    console.log(`${name}: ${slides.length} slides`);
  };

  await save("tips", await renderPlannedCarousel(tipsPlan, AGENCY, CONTACT, BRAND));
  await save("quote", await renderPlannedCarousel(quotePlan, AGENCY, CONTACT, BRAND));

  if (photoDir && existsSync(join(photoDir, "altea_ext.jpg"))) {
    // 5 photos (fixtures reused) so the mid-deck lifestyle slide appears in the proof
    const p = (f: string) => readFileSync(join(photoDir, f));
    const photos = [p("altea_ext.jpg"), p("altea_int1.jpg"), p("altea_int2.jpg"), p("altea_int1.jpg"), p("altea_int2.jpg")];
    await save("listing", await renderCarousel(listingFacts, BRAND, photos, listingCopy));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
