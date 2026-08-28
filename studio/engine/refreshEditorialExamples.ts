// Refresh the editorial style's static example deck (the picker's "See full example") to the
// ORNAMENTO tip treatment so previews match what generates.
import { writeFileSync } from "fs";
import sharp from "sharp";
import { renderPlannedStyled } from "./studio/engine/carouselStyles";
import type { CarouselPlan } from "./studio/engine/carouselSlides";

const OUT = "apps/dashboard/public/studio/carousel-examples/editorial";
const brand = { navy: "#1a2b4a", gold: "#c8a24b", cream: "#f3efe6", text: "#333333" };

const plan = {
  type: "tips",
  eyebrow: "First year on the coast",
  hook_title: "The first year in Spain has three phases nobody warns you about",
  swipe_cue: "Swipe",
  slide2_title: "Moving is the easy part — settling is the project",
  slide2_body: "The boxes arrive in a week. Feeling at home takes a year. Knowing the three phases makes each one easier to ride.",
  tips: [
    { title: "The honeymoon fades faster than you'd think", body: "The first weeks feel like an endless holiday. Then routines creep back in, and the town that felt magical starts feeling ordinary. That's not disappointment — it's settling.", teaser: "Phase two is the real test", scene: "" },
    { title: "The admin phase catches almost everyone", body: "Around month three or four, real life arrives at once: utilities, local registrations, healthcare. It feels heavier than expected because the excitement has worn off.", teaser: "One folder saves the month", scene: "" },
    { title: "Belonging arrives quietly", body: "One day the baker knows your order and the streets feel like yours. It doesn't announce itself — it just happens, usually around the first year's end.", teaser: "", scene: "" },
  ],
  recap_title: "The three phases",
  save_line: "Save this for your first year",
  cta_heading: "Thinking about the move?",
  cta_action: "Send us a message and we'll talk you through a first year on the coast.",
  cta_keyword: "FIRST YEAR",
  caption: "x", hashtags: [], image_scenes: [],
  quote_hook: "", quote_context: "", quote_parts: [], attribution: "",
} as unknown as CarouselPlan;

async function main() {
  const slides = await renderPlannedStyled("editorial", plan, "Mediterráneo Costa Homes", "mediterraneocosta.es · +34 600 000 000", brand, "en", 0, false);
  for (let i = 0; i < slides.length; i++) {
    const jpg = await sharp(slides[i]).jpeg({ quality: 82 }).toBuffer();
    writeFileSync(`${OUT}/${i + 1}.jpg`, jpg);
  }
  console.log("editorial examples refreshed:", slides.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
