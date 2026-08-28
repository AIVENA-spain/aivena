// Proof: a Russian deck no longer overflows. The design faces have no Cyrillic, so the engine
// now resolves the drawing face for measurement AND emission (renderEditable.faceForText).
import { writeFileSync, mkdirSync } from "fs";
import { renderPlannedStyled } from "./carouselStyles";
import type { CarouselPlan } from "./carouselSlides";

const OUT = "/private/tmp/claude-501/-Users-christianscholte-aivena/3638da7f-aabe-4cea-8da2-cc182d9bf454/scratchpad/script-safety";
mkdirSync(OUT, { recursive: true });
const brand = { navy: "#1a2b4a", gold: "#c8a24b", cream: "#f3efe6", text: "#333333" };

const ru = {
  type: "tips",
  eyebrow: "Первый год на побережье",
  hook_title: "Приобретение недвижимости в Испании: скрытые расходы, о которых молчат",
  swipe_cue: "Листайте",
  slide2_title: "Переезд — это простая часть",
  slide2_body: "Коробки приезжают за неделю. Чувство дома приходит за год.",
  tips: [
    { title: "Приобретение недвижимости в Испании: скрытые расходы", body: "Первые недели похожи на бесконечный отпуск. Затем возвращается рутина, и город, который казался волшебным, становится обычным.", teaser: "Дальше — главное", scene: "" },
    { title: "Проверьте кадастровую стоимость заранее", body: "Примерно на третий или четвёртый месяц реальная жизнь наступает сразу: коммунальные услуги, регистрация, здравоохранение.", teaser: "", scene: "" },
  ],
  recap_title: "Три этапа",
  save_line: "Сохраните на первый год",
  cta_heading: "Думаете о переезде?",
  cta_action: "Напишите нам, и мы расскажем о первом годе на побережье.",
  cta_keyword: "ПЕРВЫЙ ГОД",
  caption: "x", hashtags: [], image_scenes: [],
  quote_hook: "", quote_context: "", quote_parts: [], attribution: "",
} as unknown as CarouselPlan;

async function main() {
  for (const [style, ed] of [["editorial", 0], ["cartel", 1], ["sereno", 1]] as const) {
    const slides = await renderPlannedStyled(style, ru, "Mediterráneo Costa Homes", "mediterraneocosta.es", brand, "es", ed, false);
    slides.forEach((b, i) => writeFileSync(`${OUT}/${style}-ru-${i + 1}.png`, b));
    console.log(style, "ru ok", slides.length);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
