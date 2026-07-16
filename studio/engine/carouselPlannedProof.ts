// Local proof render for the PLANNED carousel types (tips + quote) — Mediterráneo Costa Homes brand.
// Run: npx tsx studio/engine/carouselPlannedProof.ts <outdir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { renderPlannedCarousel, CarouselPlan } from "./carouselSlides";

const BRAND = { navy: "#1f3a5f", gold: "#c9a227", cream: "#f6f1e7", text: "#333333" };
const AGENCY = "Mediterráneo Costa Homes";
const CONTACT = "mediterraneocostahomes.es · +34 600 999 066";

const tipsPlan: CarouselPlan = {
  type: "tips",
  eyebrow: "Guía para compradores",
  hook_title: "5 errores al comprar tu casa en la costa",
  tips: [
    { title: "Comprar sin conocer la zona en invierno", body: "Un pueblo de costa cambia por completo fuera de temporada. Visita la zona en enero: comprueba qué comercios abren, cómo es el ambiente y si el barrio sigue vivo cuando se van los turistas." },
    { title: "Ignorar los gastos de comunidad", body: "Piscina, jardines, ascensor y mantenimiento se pagan cada mes. Pide siempre las actas de la comunidad antes de firmar: ahí aparecen derramas previstas y problemas del edificio." },
    { title: "No verificar la situación legal", body: "Nota simple, licencia de primera ocupación y certificado energético. Tres documentos que cuentan la verdad de una vivienda. Sin ellos, no hay visita que valga." },
    { title: "Fiarse solo de las fotos", body: "Las fotos enseñan la mejor versión. La orientación, el ruido de la calle y la luz real de cada habitación solo se descubren visitando a distintas horas del día." },
    { title: "Negociar sin datos", body: "Antes de hacer una oferta, estudia cuánto tiempo lleva la vivienda en el mercado y qué se ha vendido cerca. Una oferta informada se toma en serio; una cifra al azar, no." },
  ],
  quote_parts: [],
  attribution: "",
  cta_heading: "¿Buscas casa en la Costa Blanca?",
  cta_sub: "Te acompañamos en cada paso, de la primera visita a las llaves.",
  cta_button: "Escríbenos hoy",
  swipe_cue: "Desliza",
  caption: "-",
  hashtags: [],
};

const quotePlan: CarouselPlan = {
  type: "quote",
  eyebrow: "Clientes",
  hook_title: "Lo que dicen quienes ya encontraron su casa",
  tips: [],
  quote_parts: [
    "Vendimos nuestra villa en menos de dos meses. Nos explicaron cada paso con calma, sin prisas y sin sorpresas.",
    "Lo que más valoramos: siempre había una persona al otro lado del teléfono. Repetiríamos sin dudarlo.",
  ],
  attribution: "— Familia Andersson, Altea",
  cta_heading: "Tu historia puede ser la siguiente",
  cta_sub: "Cuéntanos qué buscas y te llamamos hoy mismo.",
  cta_button: "Hablemos",
  swipe_cue: "Desliza",
  caption: "-",
  hashtags: [],
};

async function main() {
  const outdir = process.argv[2] ?? "studio/out/carousel-planned";
  mkdirSync(outdir, { recursive: true });
  for (const [name, plan] of [["tips", tipsPlan], ["quote", quotePlan]] as const) {
    const slides = await renderPlannedCarousel(plan, AGENCY, CONTACT, BRAND);
    for (let i = 0; i < slides.length; i++) {
      const jpg = await sharp(slides[i]).resize({ width: 540 }).jpeg({ quality: 82 }).toBuffer();
      writeFileSync(join(outdir, `${name}-${i + 1}.jpg`), jpg);
    }
    console.log(`${name}: ${slides.length} slides → ${outdir}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
