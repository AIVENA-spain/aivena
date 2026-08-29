import { z } from 'zod';
import { env } from '../../../../packages/config/env';
import type { CarouselPlan } from '../../../../studio/engine/carouselSlides';

// CAROUSEL PLANNER v2 (research-rebuilt 2026-07-16): the AI writes the WORDS of a tips/quote carousel
// as a validated plan; the deterministic slide library draws every pixel. The prompt encodes the
// carousel-effectiveness doctrine (loss-framed hooks, standalone slide 2, open loops, recap-as-save-unit,
// KPI-matched CTA, ≤5 hashtags) and the honesty rules stay hard: no prices, no statistics, no invented
// facts; client quotes verbatim.

export const PlanSchema = z.object({
  type: z.enum(['tips', 'quote']),
  eyebrow: z.string().min(1).max(44),
  hook_title: z.string().min(1).max(90),
  slide2_title: z.string().min(1).max(80),
  slide2_body: z.string().max(220).default(''),
  tips: z.array(z.object({
    title: z.string().min(1).max(62),
    body: z.string().min(1).max(250),
    teaser: z.string().max(70).default(''),
    scene: z.string().max(300).default(''),
  })).max(7).default([]),
  recap_title: z.string().max(60).default(''),
  save_line: z.string().max(70).default(''),
  quote_parts: z.array(z.string().min(1).max(250)).max(3).default([]),
  quote_hook: z.string().max(120).default(''),
  quote_context: z.string().max(220).default(''),
  attribution: z.string().max(62).default(''),
  cta_heading: z.string().min(1).max(78),
  cta_action: z.string().min(1).max(140),
  cta_keyword: z.string().min(1).max(34),
  swipe_cue: z.string().min(1).max(18).default('Desliza'),
  image_scenes: z.array(z.string().min(10).max(300)).max(3).default([]),
  caption: z.string().min(1).max(1600),
  hashtags: z.array(z.string().min(2).max(40)).max(5).default([]),   // Instagram hard cap since Dec 2025
}).superRefine((p, ctx) => {
  if (p.type === 'tips') {
    if (p.tips.length < 1) ctx.addIssue({ code: 'custom', path: ['tips'], message: 'tips carousel needs 1-7 tips' });
    if (!p.recap_title) ctx.addIssue({ code: 'custom', path: ['recap_title'], message: 'tips carousel needs a recap heading' });
    if (!p.save_line) ctx.addIssue({ code: 'custom', path: ['save_line'], message: 'tips carousel needs a save line' });
  }
  if (p.type === 'quote') {
    if (p.quote_parts.length < 1) ctx.addIssue({ code: 'custom', path: ['quote_parts'], message: 'quote carousel needs 1-3 quote parts' });
    if (!p.quote_hook) ctx.addIssue({ code: 'custom', path: ['quote_hook'], message: 'quote carousel needs a cover fragment' });
  }
});

const PLAN_TOOL = {
  name: 'submit_carousel',
  description: 'Submit the complete carousel content plan.',
  input_schema: {
    type: 'object',
    required: ['type', 'eyebrow', 'hook_title', 'slide2_title', 'cta_heading', 'cta_action', 'cta_keyword', 'swipe_cue', 'caption'],
    properties: {
      type: { type: 'string', enum: ['tips', 'quote'] },
      eyebrow: { type: 'string', description: 'short kicker above the cover headline, max 44 chars — names the audience or topic ("Guía para compradores extranjeros")' },
      hook_title: { type: 'string', description: 'the cover headline: 5-8 words, max 12, max 90 chars. Loss/mistake/gap framed, leaves the question OPEN. Use a place name ONLY if the topic itself names one — NEVER add a town/area the user did not mention. Banned: "tips", "consejos útiles", "update", "bienvenido", anything that summarizes the whole carousel.' },
      slide2_title: { type: 'string', description: 'SLIDE 2 IS A SECOND COVER (Instagram re-serves unswiped carousels starting at slide 2): a standalone self-qualification headline, max 80 chars ("¿Vendes este año? Esto te ahorra dinero"). Never a continuation of slide 1.' },
      slide2_body: { type: 'string', description: 'slide 2 supporting line: who this is for + the stakes, max 220 chars, standalone.' },
      tips: {
        type: 'array', description: 'tips carousels only: 3-7 points, one slide each',
        items: {
          type: 'object', required: ['title', 'body'],
          properties: {
            title: { type: 'string', description: 'the point as a punchy headline, max 62 chars' },
            body: { type: 'string', description: 'the advice: 15-40 words, one idea, concrete and actionable, max 250 chars' },
            teaser: { type: 'string', description: 'OPEN LOOP: one short line teasing the NEXT slide, max 70 chars ("Siguiente: el gasto que todos olvidan"). Leave empty on the last tip.' },
            scene: { type: 'string', description: "THIS TIP's visual (ENGLISH, 20-45 words): a small COMPOSED SCENE that literally acts out this tip's advice — name ONE concrete hero object IN THE FIRST FIVE WORDS, then 2-4 supporting props drawn from the tip's own content, arranged together like a styled still (hidden costs → a stack of sealed envelopes fanned beside a small brass tap dripping into a saucer, coins scattered). Someone seeing only the image should be able to guess the advice. The hero object must be different from every other slide's hero object (cover included). NEVER default to keys, suitcases or luggage — use them only when the tip is literally about them. Same rules as image_scenes: concrete nouns, no interiors, no facades, no landmarks, no close people, no text." },
          },
        },
      },
      recap_title: { type: 'string', description: 'tips only: recap-slide heading, max 60 chars ("En 30 segundos")' },
      save_line: { type: 'string', description: 'tips only: the save trigger on the recap, max 70 chars ("Guárdalo para cuando llegue el momento")' },
      quote_parts: { type: 'array', items: { type: 'string' }, description: 'quote carousels only: the quote split VERBATIM into 1-3 readable chunks of max 250 chars — never rewrite, embellish or translate the quote' },
      quote_hook: { type: 'string', description: 'quote only: the single most concrete, emotional fragment of the quote, VERBATIM subset, max 120 chars — this is the cover' },
      quote_context: { type: 'string', description: 'quote only, slide 2: one line of context that ONLY restates what the quote itself says (who/what situation), max 220 chars. No invented details about the client.' },
      attribution: { type: 'string', description: 'quote only: who said it, exactly as provided, prefixed with "— "' },
      cta_heading: { type: 'string', description: 'closing-slide headline, max 78 chars — an invitation, not "Contáctanos"' },
      cta_action: { type: 'string', description: 'THE REAL CTA, max 140 chars: a save or send action matched to the post ("Envíaselo a la persona con quien compras" / "Guarda esta guía para tu próxima visita"). Help-framed — never "tag a friend"/"share this"/"follow us" (Meta demotes engagement bait).' },
      cta_keyword: { type: 'string', description: 'the DM keyword pill, max 34 chars: "Escríbenos: GUÍA" style — one word the reader can DM' },
      swipe_cue: { type: 'string', description: 'the "swipe" word in the post language, max 18 chars (es: "Desliza", en: "Swipe")' },
      image_scenes: { type: 'array', items: { type: 'string' }, description: 'EXACTLY 3 concrete visual scenes (in ENGLISH, 20-45 words each) translating the post topic and its EMOTION into imagery: [0] the COVER — the strongest, most literal scene of the whole deck: a composed scene (hero object + 2-4 supporting props) that STAGES THE TOPIC ITSELF so someone seeing only this image could guess what the post is about. A generic pretty postcard — a shuttered window, a nice door, a plain beach — is a FAILURE unless the topic is literally about it. [1] the SLIDE-2 artwork: a DIFFERENT composed scene restating the topic from a second angle (never a variation of the cover scene — new hero object, new props); [2] a quieter closing beat — this one MAY be a simple single subject (open sea, an empty beach, a lone olive tree). Rules: concrete nouns only (diffusion fails on abstractions), NO interiors, NO building facades that could read as a real property, NO recognizable landmarks, NO people close-up, NO text in the scene. Example cover for "a home you only visit a few times a year": "a garden table under a dust sheet on a terrace, four espresso cups upturned in a row, a wall calendar with four small red circles, drifted pine needles and unopened mail at the foot of a shuttered door".' },
      caption: { type: 'string', description: 'the Instagram caption — SHORT and HUMAN, like an agent typing on their phone: max 3 short lines + one CTA line (under 320 chars total). Contractions, plain words, no rhetorical-question openers, no formulas. BANNED: dreaming of, hidden gem, look no further, imagine yourself, sueñas con, joya escondida. Include one location word naturally. No hashtags inside.' },
      hashtags: { type: 'array', items: { type: 'string' }, description: 'EXACTLY 3-5 hashtags WITHOUT #: geo tags ONLY if the topic names a place, otherwise topic-niche tags + optionally the agency name. NEVER mega-tags like realestate/home/luxury.' },
    },
  },
} as const;

/** Models sometimes emit literal backslash-n sequences — render them as real newlines everywhere. */
function unesc(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/\\n/g, '\n');
  if (Array.isArray(v)) return v.map(unesc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unesc(x)]));
  return v;
}

const BANNED = /(\d+\s*%|€|EUR\b|\$)/i;
const WEAK_HOOK = /^(tips|consejos|\d+\s+(tips|consejos)\b.{0,12}$|update|actualización|bienvenid|welcome|nueva propiedad|new listing)/i;

/** Normalize for verbatim comparison: quotes/ellipses/edge punctuation and case are presentation, not content. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[«»"“”'‘’…]/g, '').replace(/\s+/g, ' ')
    .replace(/^[\s.,;:¡!¿?—–-]+/, '').replace(/[\s.,;:¡!¿?—–-]+$/, '');
}


// ── THE COPY RULES (Christian 2026-08-28, carousel rules pass) ────────────────
// Deterministic, language-aware, and applied at EVERY exit of this module — planCarousel,
// editPlan and remixHook all return through normalisePlan(), so a rule cannot hold on one path
// and not another. Nothing here redesigns a palette, font, edition or layout.

// RULE 7 — a headline is ONE clean sentence: never two independent clauses joined by a comma.
// Detected by the shape that actually produces it: a comma followed by a subject pronoun that
// starts a new clause. Fixed with an em dash, which is what the sentence meant.
const CLAUSE_STARTERS = [
  // en, es, de, fr, nl, it, pt, sv, no, da, fi, pl, ru
  'they', 'it', 'you', 'we', 'he', 'she', 'that', 'this', 'there', 'i',
  'ellos', 'ellas', 'eso', 'esto', 'tú', 'usted', 'nosotros', 'él', 'ella',
  'sie', 'er', 'es', 'wir', 'du', 'das', 'dies',
  'ils', 'elles', 'il', 'elle', 'nous', 'vous', 'cela', 'ça',
  'zij', 'ze', 'het', 'hij', 'wij', 'jij', 'dat', 'dit',
  'loro', 'lui', 'lei', 'noi', 'voi', 'questo', 'quello',
  'eles', 'elas', 'ele', 'ela', 'nós', 'isso', 'isto',
  'de', 'den', 'det', 'vi', 'du', 'han', 'hon',
  'oni', 'ono', 'to', 'my', 'ty',
  'они', 'это', 'мы', 'вы', 'он', 'она', 'оно',
];
export function oneSentence(text: string): string {
  const t = (text ?? '').trim();
  if (!t) return t;
  // only the FIRST comma splice matters — a headline is short by construction
  return t.replace(/,\s+([^\s,]+)/, (m, next: string) => {
    const w = String(next).toLowerCase().replace(/[^\p{L}]/gu, '');
    return CLAUSE_STARTERS.includes(w) ? ` — ${next}` : m;
  });
}

// RULE 8 — the comment keyword is a SENTENCE, not a code line, and never a "P.D." postscript.
const KEYWORD_SENTENCE: Record<string, (w: string) => string> = {
  en: (w) => `Comment ${w} and we'll send it over.`,
  es: (w) => `Escribe ${w} en los comentarios y te lo enviamos.`,
  de: (w) => `Kommentiere ${w} und wir schicken es dir.`,
  fr: (w) => `Commentez ${w} et nous vous l'envoyons.`,
  nl: (w) => `Reageer met ${w} en we sturen het je toe.`,
  it: (w) => `Commenta ${w} e te lo inviamo.`,
  pt: (w) => `Comente ${w} e nós enviamos.`,
  sv: (w) => `Kommentera ${w} så skickar vi det.`,
  no: (w) => `Kommenter ${w}, så sender vi det.`,
  da: (w) => `Kommenter ${w}, så sender vi det.`,
  fi: (w) => `Kommentoi ${w}, niin lähetämme sen.`,
  pl: (w) => `Napisz ${w} w komentarzu, a wyślemy Ci to.`,
  ru: (w) => `Напишите ${w} в комментариях, и мы пришлём это.`,
};
const PS_PREFIX = /^\s*(p\.?\s?d\.?|p\.?\s?s\.?|п\.?\s?с\.?)\s*[—–:-]?\s*/i;
export function commentSentence(raw: string, language: string): string {
  let t = (raw ?? '').replace(PS_PREFIX, '').trim();
  if (!t) return t;
  // "Escríbenos: GUÍA" / "DM: FAMILY" — a label plus a shouted code word is not a sentence
  const code = t.match(/^[\p{L}\s'’]{0,18}[:·—–-]\s*([\p{Lu}\p{N}\s]{2,24})$/u);
  const bare = /^[\p{Lu}\p{N}]{2,24}$/u.test(t) ? t : null;
  const word = code ? code[1].trim() : bare;
  if (word) {
    const make = KEYWORD_SENTENCE[language] ?? KEYWORD_SENTENCE.en;
    return make(word);
  }
  return t;
}

/** Every plan this module hands out passes through here — one implementation, no per-path drift. */
export function normalisePlan(plan: CarouselPlan, language: string): CarouselPlan {
  plan.hook_title = oneSentence(plan.hook_title);
  plan.slide2_title = oneSentence(plan.slide2_title);
  plan.cta_heading = oneSentence(plan.cta_heading);
  plan.recap_title = oneSentence(plan.recap_title);
  plan.tips = plan.tips.map((t) => ({ ...t, title: oneSentence(t.title) }));
  plan.cta_keyword = commentSentence(plan.cta_keyword, language);
  plan.caption = (plan.caption ?? '').split('\n').map((l) => l.replace(PS_PREFIX, '')).join('\n').trim();
  return plan;
}

// RULE 4 — every factual claim must be TRUE. Claims are wanted; wrong ones are not. This detector
// does not rewrite copy: it flags an absolute impossibility asserted about the regulated subjects
// so the editor can verify or hedge it. Christian's live example: "without a local account you
// cannot pay utilities, taxes, or a mortgage" — false, SEPA forbids refusing a Eurozone IBAN.
const RISK_DOMAIN = /\b(nie|tie|padr[oó]n|banco?|bank|iban|impuesto|tax|hacienda|residencia|residency|hipoteca|mortgage|escritura|notar|propiedad|ownership|visa|empadronamiento)\w*/i;
const ABSOLUTE = /\b(cannot|can't|no puedes?|nunca|never|imposible|impossible|siempre|always|obligatorio|mandatory|required by law|must have|hay que tener|sin \w+ no|without \w+ you)\b/i;
export function riskyClaims(plan: CarouselPlan): string[] {
  const lines = [plan.hook_title, plan.slide2_title, plan.slide2_body, plan.cta_action,
    ...plan.tips.flatMap((t) => [t.title, t.body])].filter(Boolean);
  const out: string[] = [];
  for (const l of lines) {
    for (const sentence of String(l).split(/(?<=[.!?])\s+/)) {
      if (RISK_DOMAIN.test(sentence) && ABSOLUTE.test(sentence)) out.push(sentence.trim().slice(0, 160));
    }
  }
  return out;
}

/** Doctrine + honesty gate on the generated copy (client quotes exempt — they're the client's words). */
function planIssues(p: CarouselPlan, quoteSource: string): string | null {
  const advice = [p.hook_title, p.slide2_title, p.slide2_body, p.cta_heading, p.cta_action,
    p.recap_title, p.save_line, ...p.tips.flatMap((t) => [t.title, t.body, t.teaser])];
  const priced = advice.find((t) => t && BANNED.test(t));
  if (priced) return `copy contains a price/percentage claim ("${priced.slice(0, 60)}") — general advice only, no figures`;
  if (p.type === 'tips' && WEAK_HOOK.test(p.hook_title.trim())) {
    return `hook_title "${p.hook_title}" is a banned generic opener — rewrite it loss/gap-framed and specific`;
  }
  if (p.type === 'quote' && p.quote_hook && !norm(quoteSource).includes(norm(p.quote_hook))) {
    // verbatim by construction: fall back to the quote's own first sentence instead of failing the run
    const first = quoteSource.split(/(?<=[.!?])\s+/)[0]?.trim().slice(0, 120);
    if (first) { p.quote_hook = first; return null; }
    return 'quote_hook must be a verbatim fragment of the quote itself';
  }
  return null;
}

export async function planCarousel(opts: {
  type: 'tips' | 'quote';
  topic?: string;            // tips: what the carousel teaches
  quoteText?: string;        // quote: the testimonial, verbatim source
  quoteAuthor?: string;      // quote: attribution as the agent wrote it
  slideCount?: number;       // tips: desired number of points (3-7)
  language: string;          // 'es', 'en', ...
  agencyName: string;
  region?: string;           // for locally relevant advice + hashtags
  /** RULE 9: what this agency actually does — the closing slide is written from it */
  agencyProfile?: string;
  avoidMotifs?: string[];    // hero objects from this agency's recent posts — variety across generations
}): Promise<CarouselPlan> {
  const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
  const lang = langNames[opts.language] ?? 'Spanish';
  const region = opts.region || 'the Costa Blanca';

  const task = opts.type === 'tips'
    ? `Create an EDUCATIONAL carousel: exactly ${Math.min(7, Math.max(1, opts.slideCount ?? 5))} points about: "${opts.topic}".
TONE LAW — read the topic's REGISTER first and match the whole deck to it:
- PRACTICAL topics (how-to, costs, process) → the LOSS/MISTAKE frame ("errors that cost you money", "what nobody warns you about") — it has experimental proof and is the default.
- DREAM / PHILOSOPHICAL topics (the life, the place, time, identity — e.g. "location-life balance", "a life you don't need to retire from") → STAY in that reflective, aspirational register: tips become principles, perspectives and ways to choose, written with warmth and longing. Converting a dream topic into a warnings-and-mistakes listicle is a FAILURE — the reader chose that topic for its feeling.
- PROVOCATIVE topics (a sting, a challenged belief) → keep the sting through the whole deck, not just the cover.
Each point = one slide: punchy title + 15-40 words that genuinely deliver in the topic's register — practical advice for practical topics, a real shift in perspective for dream topics. One idea per point. Each point's "teaser" is an open loop pulling to the next slide; leave the last teaser empty.
IF THE TOPIC ALREADY READS AS A FINISHED HOOK LINE — a crafted sentence or two with its own punch (often picked from the inspiration ideas, e.g. "Some people buy a home in the sun. Others buy a problem with a pool.") — the user chose those words on purpose: use the line (translated into the post language if needed) VERBATIM as hook_title when it fits 90 chars; if longer, the sharpest sentence verbatim as hook_title and let slide2 carry the rest. NEVER flatten a provocative topic into a generic listicle title — losing its edge is a failure.
If the hook promises a number ("5 errores"), it MUST equal the number of points delivered.`
    : `Create a CLIENT STORY carousel from this quote (provided by the agency — treat as authentic):
QUOTE: "${opts.quoteText}"
ATTRIBUTION: "${opts.quoteAuthor ?? ''}"
The COVER (quote_hook) is the most concrete, emotional VERBATIM fragment of the quote (max 120 chars) — never a "Testimonial" label. Split the full quote VERBATIM into 2-3 readable chunks (quote_parts) — one chunk only if the quote is a single short sentence; do NOT rewrite, embellish or translate the quote itself. slide2_title + quote_context set the scene using ONLY what the quote itself reveals (no invented details about the client). attribution exactly as provided, prefixed "— ".`;

  const prompt = `You are the social media content director for "${opts.agencyName}", a real-estate agency in ${region}, Spain. Their goals: local authority, saves and sends, buyer/seller DMs — not likes.${opts.agencyProfile ? `

THE AGENCY (write the closing slide from this): ${opts.agencyProfile}` : ''}

${task}

Write ALL copy in ${lang} — one language for the whole post (comprehension and keyword search are language-literal).

CAROUSEL DOCTRINE (how these posts win — follow it):
- The cover headline: 5-8 words, loss/gap-framed, and it must leave the question open — a title that summarizes the answer kills the swipe.
- PLACES: mention a specific town/area ONLY if the topic itself names one. If it doesn't, keep every slide and the caption location-neutral ("the coast", "the area") — never insert a town the user didn't ask for.
- Slide 2 is a SECOND cover: Instagram re-serves unswiped carousels starting at slide 2, so slide2_title must stand alone with zero context ("Selling this year? This saves you money.").
- One idea per slide. Each slide answers the question the previous one raised.
- The recap is the SAVE unit — people screenshot and forward it.
- THE CLOSING SLIDE SAYS WHAT THE AGENCY DOES. cta_action OPENS with one plain sentence naming what this agency helps people with, written from the topic + the agency profile above ("We help families find homes near the international schools along this coast."). Then, and only then, the action. Contact details are handled by the design, not by you. NEVER "tag a friend", "share this", "follow for more" — Meta demotes engagement bait.
- save_line is the SECONDARY line, demoted under the agency line: the save/keep framing ("Save it for the week the move gets hard.").
- cta_keyword is a COMPLETE, NATURAL SENTENCE in the post language telling the reader exactly what to comment and what they get ("Comment FAMILY and we'll send it over."). NEVER a code line ("DM: FAMILY", "Escríbenos: GUÍA"), never a bare shouted word, never a "P.D." postscript.
- Caption: SHORT and human — 3 lines max + a CTA line, written like a person, not a brochure. No clichés, no rhetorical-question openers. Same place rule: no towns unless the topic names one. End with a short question answerable in ONE word — as a plain line, NEVER labelled "P.D." or "P.S.".
- Hashtags: 3-5 only, no mega-tags.
- image_scenes: 3 concrete Mediterranean scenes (ENGLISH). [0] is the COVER and it carries the whole post: it must stage the TOPIC so literally that a viewer could guess it from the image alone — never a generic pretty postcard (window, door, beach) unless the topic is literally about it. [1] appears on slide 2 (the second cover Instagram re-serves): a different composed scene, second angle on the topic, new hero object. The closing beat [2] may be one quiet simple subject (sea, beach, a lone tree) for rhythm.
- EVERY tip also gets its own "scene": a LITERAL visual translation of THAT tip — the props act out the advice, so a viewer who sees only the image could guess the tip. HERO OBJECT LAW: each scene names ONE hero object in its first five words, and no two scenes in the deck (cover included) may share a hero object or lean on the same motif — different objects, different compositions, same world. Repetition across slides is a failure. NEVER default to the stock clichés — keys, suitcases, luggage, generic doors — unless the tip is literally about them; pick the tip's OWN objects instead (bills → tied envelopes; maintenance → a dripping tap; paperwork → a stamped folder; viewings → a pocket torch on a windowsill at dusk).${opts.avoidMotifs?.length ? `
- RECENTLY USED in this agency's previous posts — do NOT use any of these as a hero object again, find fresh ones: ${opts.avoidMotifs.join('; ')}.` : ''}

- EVERY FACTUAL CLAIM MUST BE TRUE. Claims are wanted — vague advice is worthless — but a wrong one destroys trust. For anything about the NIE, banks, taxes, residency, mortgages or ownership: state what is USUALLY true and why it helps, never an absolute impossibility you cannot verify. Worked example of the failure: "without a local account you cannot pay utilities, taxes or a mortgage" is FALSE — Eurozone SEPA rules forbid refusing a valid IBAN from another member state. The honest version keeps the value: "a Spanish account makes utilities, taxes and a mortgage far simpler to run".

HARD RULES:
- NO specific prices, percentages, statistics, interest rates, tax figures, or legal guarantees anywhere in slide copy. General, evergreen advice only — you have no data source, so any figure would be invented. Use place names for specificity instead of numbers.
- NO invented facts about the agency, the market, or any client. The agency name is the only real-world name you may use${opts.type === 'quote' ? ' (plus the client attribution provided)' : ''}.
- Friendly expert tone: confident, warm, zero clickbait, no emoji in slide copy (caption may use a few).
- Every sentence must parse cleanly on FIRST read: no clipped elliptical constructions ("has needs a full-time home doesn't"), no dropped relative pronouns that read like typos — write the complete clause ("has needs that a full-time home doesn't").

Submit with the submit_carousel tool.`;

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        tools: [PLAN_TOOL],
        tool_choice: { type: 'tool', name: 'submit_carousel' },
        messages: [{ role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nYour previous plan was rejected: ${lastErr}. Fix exactly that and resubmit the full plan.` }],
      }),
    });
    if (!res.ok) {
      lastErr = `api_${res.status}`;
      if (res.status >= 500 || res.status === 429) continue;
      throw new Error(`carousel plan failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const tool = data.content?.find((c) => c.type === 'tool_use');
    const input = { type: opts.type, ...(unesc(tool?.input) as object ?? {}) } as Record<string, unknown>;  // the requested type always wins
    // Self-heal common model quirks instead of failing the whole generation (2026-08-28: a
    // string-shaped hashtags field burned all 3 retries and killed Christian's post):
    if (typeof input.hashtags === 'string') input.hashtags = (input.hashtags as string).split(/[\s,#]+/);
    if (Array.isArray(input.hashtags)) {
      input.hashtags = (input.hashtags as unknown[])
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.replace(/["'\u201c\u201d\u2018\u2019#]/g, '').trim().slice(0, 40))
        .filter((h) => h.length >= 2).slice(0, 5);
    }
    const parsed = PlanSchema.safeParse(input);
    if (!parsed.success) {
      lastErr = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      continue;
    }
    const plan = parsed.data as CarouselPlan;
    // the slides draw their own quotation glyphs — strip any the model added around the fragments
    const dequote = (s: string) => s.replace(/^["“”«»'\s]+/, '').replace(/["“”«»'\s]+$/, '');
    plan.quote_hook = dequote(plan.quote_hook);
    plan.quote_parts = plan.quote_parts.map(dequote);
    const issue = planIssues(plan, opts.quoteText ?? '');
    if (issue) { lastErr = issue; continue; }
    return normalisePlan(plan, opts.language);
  }
  throw new Error(`carousel plan invalid after retries: ${lastErr}`);
}

// ── EDITOR pass (Christian 2026-08-28: "we always need to make sure that the content makes
// sense and brings value and builds trust") — a skeptical second read of the whole tips plan
// BEFORE anything renders. His live case: a tip body stapled salt-air corrosion to guests
// running showers as if one caused the other — almost-right copy is exactly what erodes trust,
// and a one-shot writer cannot catch its own non-sequiturs. Fails open: null → original plan.

const EDIT_TOOL = {
  name: 'submit_edited_plan',
  description: 'Submit the reviewed carousel plan (corrected where needed) plus review notes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      ...(PLAN_TOOL.input_schema.properties as Record<string, unknown>),
      review_notes: { type: 'array', items: { type: 'string' }, description: 'one short note per problem found and fixed; EMPTY array if the plan passed clean' },
    },
  },
} as const;

export async function editPlan(plan: CarouselPlan, topic: string, language = 'es'): Promise<{ plan: CarouselPlan; notes: string[] } | null> {
  // RULE 4 — the deterministic detector names the exact sentences that assert an absolute about
  // a regulated subject, so the editor verifies or hedges THOSE rather than re-reading blind.
  const flagged = riskyClaims(plan);
  const prompt = `You are the skeptical EDITOR at a real-estate agency on the Spanish coast. The reader of this Instagram carousel is a potential client — every slide must make sense on first read, teach something useful, and sound like an agent they can trust. Review the plan below and correct ONLY what fails.

POST TOPIC: "${topic}"${flagged.length ? `

CLAIMS FLAGGED FOR VERIFICATION — each of these asserts an absolute about the NIE, banks, taxes, residency, mortgages or ownership. Verify each one. If it is not true as written, rewrite it so it stays USEFUL but true (keep the claim, lose the falsehood). Do not simply delete the advice:
${flagged.map((f) => `- "${f}"`).join('\n')}` : ''}
THE PLAN (JSON):
${JSON.stringify({ ...plan, image_scenes: undefined, tips: plan.tips.map((t) => ({ ...t, scene: undefined })) }, null, 1)}

CHECK EVERY TEXT FIELD:
1. SENSE — every sentence must parse and be TRUE on first read. Cause and effect must be genuinely connected: never staple two unrelated mechanisms into one sentence (real failure caught this week: "sea air corrodes pipes and railings, especially with guests running showers daily" — salt air and shower usage are different problems; pick one mechanism per sentence, or split them cleanly).
2. VALUE — the reader must finish each tip knowing something specific they can DO: a question to ask, a check to schedule, a decision rule. Vague filler ("be careful", "keep an eye on it") fails.
3. TRUST — no invented facts, figures or statistics; nothing a seasoned local agent wouldn't stand behind; no scaremongering, no overpromising.
4. DELIVERY — each tip title's promise must be delivered by its body; the cover hook's promise must be delivered by the deck as a whole. This includes REGISTER: a dreamy or philosophical topic answered with a warnings-and-mistakes listicle is a failure — the deck's tone must match the topic's tone.
5. NO REPEATED PROMISE — the cover and the first advice slide must not say the same thing twice. If slide 2 only restates the cover's promise ("the order that saves you weeks" under a cover about the order nobody explains), rewrite it as the FIRST piece of real advice.
6. TRUE CLAIMS — any statement about the NIE, banks, taxes, residency, mortgages or ownership must be true as written. Prefer "usually / makes it far simpler" to an absolute impossibility you cannot verify. Keep the claim's usefulness; lose the falsehood.
7. ONE CLEAN SENTENCE — no headline may join two independent clauses with a comma ("…in a new place, they need a plan"). Use an em dash or two sentences.
8. THE CLOSING — cta_action must open by saying what this agency does for someone with this topic, before any save/send framing; save_line carries the save framing, demoted.

RULES FOR CORRECTIONS:
- Rewrite in the SAME LANGUAGE as the existing copy, within the same length limits, same warm expert tone.
- Keep the hook_title unless it fails a check (the user may have chosen it deliberately).
- Change as little as possible — this is an edit, not a rewrite.
- Artwork is handled by a separate art director: do NOT create, review or mention image_scenes or tip scenes.
- Return the FULL plan (all fields, corrected where needed) with review_notes listing each fix in one short English sentence. If everything passes, return the plan unchanged with an empty review_notes array.

Submit with the submit_edited_plan tool.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 3000,
        tools: [EDIT_TOOL], tool_choice: { type: 'tool', name: 'submit_edited_plan' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const raw = unesc(data.content?.find((c) => c.type === 'tool_use')?.input) as Record<string, unknown> | undefined;
    if (!raw) return null;
    const notes = Array.isArray(raw.review_notes)
      ? (raw.review_notes as unknown[]).filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 12)
      : [];
    delete raw.review_notes;
    // the editor reviews words, not art direction — the planner's scenes ride through untouched
    const input = {
      ...raw, type: plan.type,
      image_scenes: plan.image_scenes,
      tips: Array.isArray(raw.tips)
        ? (raw.tips as Record<string, unknown>[]).map((t, i) => ({ ...t, scene: plan.tips[i]?.scene ?? '' }))
        : plan.tips,
    } as Record<string, unknown>;
    if (typeof input.hashtags === 'string') input.hashtags = (input.hashtags as string).split(/[\s,#]+/);
    if (Array.isArray(input.hashtags)) {
      input.hashtags = (input.hashtags as unknown[])
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.replace(/["'\u201c\u201d\u2018\u2019#]/g, '').trim().slice(0, 40))
        .filter((h) => h.length >= 2).slice(0, 5);
    }
    const parsed = PlanSchema.safeParse(input);
    if (!parsed.success) return null;
    const edited = parsed.data as CarouselPlan;
    if (edited.tips.length !== plan.tips.length) return null;   // the editor may not add or drop slides
    if (planIssues(edited, '')) return null;
    return { plan: normalisePlan(edited, language), notes };
  } catch {
    return null;
  }
}

// ── LISTING copy (v2): hook overlay + lifestyle line + caption, from canonical facts only ──

const LISTING_TOOL = {
  name: 'submit_listing_copy',
  description: 'Submit the listing carousel copy package.',
  input_schema: {
    type: 'object',
    required: ['hook', 'caption'],
    properties: {
      hook: { type: 'string', description: 'short benefit hook for the cover photo overlay, max 60 chars, NO digits (the price/location render separately): the lifestyle promise, not the spec sheet ("A dos minutos de la playa", "Morning coffee over the marina")' },
      lifestyle_line: { type: 'string', description: 'one line selling the TOWN, not the house, max 130 chars, no digits ("Vivir en Altea: cafés junto al mar y calas escondidas")' },
      cta_action: { type: 'string', description: 'save/send action line, max 120 chars ("Guárdalo para tu próxima visita a la zona"), help-framed, no engagement bait' },
      cta_keyword: { type: 'string', description: 'DM keyword pill, max 34 chars ("Escríbenos: VISITA")' },
      caption: { type: 'string', description: 'SHORT HUMAN caption (under 250 chars): 1-2 plain lines a person would actually type — the town name once, one honest reason to care, then a one-line CTA with the DM keyword. Contractions fine. BANNED: dreaming of, hidden gem, look no further, oasis, imagine yourself, sueñas con. Facts verbatim only. No hashtags inside.' },
      hashtags: { type: 'array', items: { type: 'string' }, description: '3-5 hashtags WITHOUT #: 2 geo (town + region), 1-2 niche (property type / buyer intent), optionally the agency. No mega-tags.' },
    },
  },
} as const;

export interface ListingCopy {
  hook: string;
  lifestyle_line: string;
  cta_action: string;
  cta_keyword: string;
  caption: string;
  hashtags: string[];
}

const STORY_TOOL = {
  name: 'submit_story',
  description: 'Submit the listing story package.',
  input_schema: {
    type: 'object',
    required: ['hook', 'photo_lines', 'vibe_scene', 'art_style', 'caption'],
    properties: {
      hook: { type: 'string', description: 'cover hook over the best photo, max 58 chars, NO digits — the lifestyle promise this specific property makes (you can SEE the photos)' },
      photo_lines: { type: 'array', items: { type: 'string' }, description: 'ONE line per photo, in the exact order given (max 80 chars each): what makes THAT photo worth pausing on — concrete, sensory, human, no digits, never generic ("bright living room" is a failure; "morning light hits the long table first" is the standard)' },
      vibe_scene: { type: 'string', description: "ENGLISH, 15-35 words: one artwork scene capturing this property's VIBE (golf calm / beach morning / village evening...) as a Mediterranean visual metaphor. Concrete nouns. NO interiors, NO building facades, NO landmarks, NO people close-up, NO text." },
      art_style: { type: 'string', enum: ['bodegon', 'litoral', 'tinta', 'salitre', 'papel', 'arcilla', 'acuarela', 'bordado', 'pueblo', 'mercado'], description: 'the artwork style that best matches this property vibe' },
      caption: { type: 'string', description: 'SHORT HUMAN caption (max 250 chars): 1-2 plain lines a person would type + one CTA line with the DM keyword. Town once. Facts verbatim only if used. BANNED: dreaming of, hidden gem, look no further, oasis, imagine yourself, sueñas con.' },
      cta_action: { type: 'string', description: 'save/send line, max 100 chars, help-framed' },
      cta_keyword: { type: 'string', description: 'DM keyword pill, max 30 chars' },
      hashtags: { type: 'array', items: { type: 'string' }, description: '3-5 without #: 2 geo + 1-2 niche, no mega-tags' },
      details: { type: 'array', items: { type: 'object', required: ['photo', 'box', 'line', 'score'], properties: {
        photo: { type: 'integer', description: '0-based index of the photo containing this detail' },
        box: { type: 'array', items: { type: 'number' }, description: '[x,y,w,h] of the detail region, fractions 0-1 of that photo' },
        line: { type: 'string', description: 'a whispered curator line about this detail, max 70 chars, no digits, no property name' },
        score: { type: 'number', description: '0-1: how evocative/scroll-stopping this detail is as a COLD OPEN (sliver of sea, lemon tree, original tiles). Below 0.7 = not worth it.' },
      } }, description: 'the 2-3 most evocative DETAILS across all photos — small telling things a design magazine would notice. Empty if the photos are too plain.' },
    },
  },
} as const;

export interface StoryDetail { photo: number; box: number[]; line: string; score: number }
export interface ListingStory {
  hook: string; photo_lines: string[]; vibe_scene: string; art_style: string;
  caption: string; cta_action: string; cta_keyword: string; hashtags: string[];
  details: StoryDetail[];
}

/** Vision storyteller for the Vibra listing style: LOOKS at the chosen photos, writes one line per
 *  photo + the property's vibe as an artwork scene. Facts verbatim; null on any failure. */
export async function listingStory(opts: {
  photoUrls: string[]; facts: Record<string, string>; language: string; agencyName: string;
}): Promise<ListingStory | null> {
  try {
    const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
    const factList = Object.entries(opts.facts).filter(([, v]) => v).map(([k, v]) => `  ${k}: "${v}"`).join('\n');
    const content: unknown[] = opts.photoUrls.slice(0, 8).map((u) => ({ type: 'image', source: { type: 'url', url: u } }));
    content.push({
      type: 'text',
      text: `These are the chosen photos (in posting order) of a real listing marketed by "${opts.agencyName}". Facts (verbatim only): \n${factList}\n\nWrite the story package in ${langNames[opts.language] ?? 'Spanish'} (vibe_scene in English). One photo_line PER photo, same order, each specific to what is visible in THAT photo. Also hunt for 2-3 evocative DETAILS (small telling things: the sliver of sea between walls, original tiles, the lemon tree) with precise boxes — they become cinematic cold-open crops. End the caption with a short P.D. question answerable in ONE word (e.g. 'P.D. ¿Terraza o playa?'). Human, warm, zero brochure-speak. Submit with submit_story.`,
    });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 1600,
        tools: [STORY_TOOL], tool_choice: { type: 'tool', name: 'submit_story' },
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = unesc(data.content?.find((c) => c.type === 'tool_use')?.input) as Partial<ListingStory> | undefined;
    if (!input || typeof input.hook !== 'string' || !Array.isArray(input.photo_lines)) return null;
    const clean = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
    const hook = clean(input.hook, 58);
    if (!hook || /\d/.test(hook)) return null;
    return {
      hook,
      photo_lines: input.photo_lines.map((l) => clean(l, 80)).slice(0, 8),
      vibe_scene: clean(input.vibe_scene, 300),
      art_style: typeof input.art_style === 'string' ? input.art_style : 'litoral',
      caption: clean(input.caption, 260),
      cta_action: clean(input.cta_action, 100),
      cta_keyword: clean(input.cta_keyword, 30),
      hashtags: Array.isArray(input.hashtags) ? input.hashtags.filter((h): h is string => typeof h === 'string').map((h) => h.replace(/^#/, '').trim()).slice(0, 5) : [],
      details: Array.isArray((input as { details?: unknown }).details)
        ? ((input as { details: StoryDetail[] }).details)
            .filter((d) => d && Number.isInteger(d.photo) && Array.isArray(d.box) && d.box.length === 4 && typeof d.line === 'string' && typeof d.score === 'number')
            .map((d) => ({ photo: d.photo, box: d.box.map((v) => Math.max(0, Math.min(1, Number(v)))), line: d.line.slice(0, 70), score: Math.max(0, Math.min(1, d.score)) }))
            .slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
}

/** Best-effort AI copy for a LISTING carousel — facts passed verbatim, never invented. Null on any failure. */
export async function listingCopy(opts: {
  facts: Record<string, string>;
  language: string;
  agencyName: string;
}): Promise<ListingCopy | null> {
  try {
    const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
    const factList = Object.entries(opts.facts).filter(([, v]) => v).map(([k, v]) => `  ${k}: "${v}"`).join('\n');
    const prompt = `Write the copy package for a property-listing Instagram carousel posted by "${opts.agencyName}", in ${langNames[opts.language] ?? 'Spanish'}.

THE FACTS (the design renders these separately — your copy must NOT restate numbers; where the caption uses a fact, copy it VERBATIM):
${factList}

The hook is the reason to stop: the lifestyle benefit, never the spec sheet. The caption stays SHORT (short captions + carousels measure best for listings). One CTA only, matched to a DM keyword. Submit with submit_listing_copy.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        tools: [LISTING_TOOL],
        tool_choice: { type: 'tool', name: 'submit_listing_copy' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = unesc(data.content?.find((c) => c.type === 'tool_use')?.input) as Partial<ListingCopy> | undefined;
    if (!input || typeof input.hook !== 'string' || typeof input.caption !== 'string') return null;
    const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
    const hook = clean(input.hook, 60);
    if (!hook || /\d/.test(hook)) return null;             // hook may not carry digits (facts render separately)
    return {
      hook,
      lifestyle_line: /\d/.test(clean(input.lifestyle_line, 130)) ? '' : clean(input.lifestyle_line, 130),
      cta_action: clean(input.cta_action, 120),
      cta_keyword: clean(input.cta_keyword, 34),
      caption: clean(input.caption, 1600),
      hashtags: Array.isArray(input.hashtags)
        ? input.hashtags.filter((h): h is string => typeof h === 'string' && !!h.trim()).map((h) => h.replace(/^#/, '').trim()).slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

// ── OTRA VUELTA · hook remix (2026-07-17) ─────────────────────────────────────
// Rewrites ONLY the cover framing of a finished tips deck from a different angle.
// No credit, no image work — one small call; the rest of the plan stays verbatim.
const REMIX_TOOL = {
  name: 'submit_remix',
  description: 'Submit the reframed carousel cover.',
  input_schema: {
    type: 'object' as const,
    properties: {
      eyebrow: { type: 'string', description: 'kicker label, max 40 chars, same language' },
      hook_title: { type: 'string', description: 'the NEW cover hook, max 85 chars, same language, different persuasion angle than the current one' },
      swipe_cue: { type: 'string', description: 'short swipe cue, max 16 chars, same language' },
    },
    required: ['eyebrow', 'hook_title', 'swipe_cue'],
  },
};

export async function remixHook(plan: CarouselPlan, language: string, topic: string): Promise<Pick<CarouselPlan, 'eyebrow' | 'hook_title' | 'swipe_cue'> | null> {
  const prompt = `You reframe Instagram carousel covers for Spanish real-estate agencies.

CURRENT COVER (language: ${language}):
- eyebrow: ${plan.eyebrow}
- hook: ${plan.hook_title}
- swipe cue: ${plan.swipe_cue}
Topic: ${topic || '(same as the hook implies)'}
The tips inside stay EXACTLY the same — you only reframe the cover.

Write a NEW cover in ${language} with a DIFFERENT persuasion angle: if the current hook is loss-framed, go curiosity or contrarian; if it asks a question, make a bold claim; if it is generic, make it specific. Same topic, same honesty (no prices, no statistics, no invented facts, no place names unless the current cover names one). No emoji, no clickbait words.

Submit with the submit_remix tool.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 600,
        tools: [REMIX_TOOL], tool_choice: { type: 'tool', name: 'submit_remix' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = unesc(data.content?.find((c) => c.type === 'tool_use')?.input) as Record<string, unknown> | undefined;
    const out = z.object({
      eyebrow: z.string().min(1).max(44),
      hook_title: z.string().min(1).max(90),
      swipe_cue: z.string().min(1).max(18),
    }).safeParse(input);
    return out.success ? { ...out.data, hook_title: oneSentence(out.data.hook_title) } : null;
  } catch {
    return null;
  }
}

// ── GET INSPIRED · topic ideas (2026-07-17) ───────────────────────────────────
// Six fresh tips-carousel topics for agents who don't know what to post. Free, no
// credit; same honesty rails as the planner (no prices/stats/place names).
const IDEAS_TOOL = {
  name: 'submit_ideas',
  description: 'Submit the topic ideas.',
  input_schema: {
    type: 'object' as const,
    properties: {
      topics: { type: 'array', items: { type: 'string' }, description: '6 carousel topics in the requested language: five of 30-90 chars, plus exactly one provocative hook of up to 150 chars' },
    },
    required: ['topics'],
  },
};

export async function topicIdeas(language: string, exclude: string[]): Promise<string[] | null> {
  const month = new Date().toLocaleString('en', { month: 'long' });
  const prompt = `You suggest Instagram tips-carousel topics for a real-estate agency on the Spanish coast (buyers are often foreign, sellers often local; the audience dreams of a home in Spain).

Write 6 topic ideas in language "${language}".

EVERY idea must be built on a REAL pain point or desire of a REAL person in this audience. Draw from concerns like these (rotate widely, never all from one area):
- foreign buyers: overpaying, being far away during the process, not knowing the true costs, choosing the wrong town or wrong type of home (apartment vs villa vs townhouse)
- families relocating with children: schools, making friends, the adaptation year, timing the move
- retirees moving for the climate: healthcare, distance from grandchildren, community, what daily life is really like
- paperwork stress: NIE, residency, bank accounts, the process feeling opaque from abroad
- owning across borders: managing a home in two countries, the empty months, renting it out or not
- trust: how to know which agent, lawyer or builder to rely on when you don't know anyone here
- money and culture: how negotiation really works here, what surprises people about prices, local customs around buying
- sellers: pricing right, presenting the home, why some homes sit unsold
- renovations: budgeting, finding builders, what's worth doing before selling or after buying
- getting to know areas: which town fits your life, summer vs winter reality, tourist zones vs living zones

THE TEST — every idea must pass all three, and this test OUTRANKS everything else:
1. INSTANT: a stranger scrolling understands it in ONE read. No riddles, no poetry that needs decoding, no insider references.
2. "THAT'S ME": the target person immediately feels it names THEIR worry or THEIR dream.
3. PAYOFF: it's obvious what they'll learn or feel if they open the post.
FAILURES to never produce (real rejected examples): "The August terraces that empty out right when the light gets best" (atmospheric, means nothing on first read) · "Why agents go quiet when you ask about the neighbour's terrace extension" (too niche — not a real person's real worry).

VARY THE TONE across the 6 — most practical and direct, one bolder/provocative with a sting ("Some people buy a home in Spain. Others buy a problem with a pool."), one warm dream-selling angle about the life itself, maybe one life-philosophy angle ("Everyone talks about work-life balance. Almost nobody talks about location-life balance.") — but tone is the FLAVOUR; the pain point and instant clarity are the substance. A clear, slightly plain idea beats a clever, unclear one every time. The quoted lines above are register examples only — NEVER output them or close paraphrases of them.

Rules for all 6:
- NO place names, NO prices, NO statistics, NO legal/tax advice framing (bold lines may gesture at cost/time in the abstract, never with figures).
- 30-90 characters for direct ideas; bolder two-sentence lines may run up to 150. No emoji, no numbering, no labels in the output.${exclude.length ? `\n- Do NOT repeat or paraphrase these already-shown ideas:\n${exclude.slice(0, 24).map((t) => `  · ${t}`).join('\n')}` : ''}

Submit with the submit_ideas tool.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 700,
        tools: [IDEAS_TOOL], tool_choice: { type: 'tool', name: 'submit_ideas' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = unesc(data.content?.find((c) => c.type === 'tool_use')?.input) as { topics?: unknown } | undefined;
    const topics = Array.isArray(input?.topics)
      ? input.topics.filter((t): t is string => typeof t === 'string' && t.trim().length >= 10).map((t) => t.trim().slice(0, 160)).slice(0, 6)
      : [];
    return topics.length >= 3 ? topics : null;
  } catch {
    return null;
  }
}
