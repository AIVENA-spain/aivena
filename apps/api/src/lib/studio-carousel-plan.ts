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
  // RULE 9: what this agency does for someone with this topic — its own field, so it has its own
  // line and its own type size on the closing slide instead of being crammed into the action.
  agency_line: z.string().max(170).default(''),
  cta_action: z.string().min(1).max(140),
  // RULE 8: a complete sentence, not a code word — 34 chars could not hold one
  cta_keyword: z.string().min(1).max(90),
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
      agency_line: { type: 'string', description: 'RULE 9, max 170 chars: ONE plain sentence naming what this agency helps people with — allowed ONLY when the agency profile above states their actual SERVICES. Voice, tone, content-style and location notes are NOT services. If the profile states no services, return an EMPTY STRING: never infer a speciality from the post topic or from how they write.' },
      cta_keyword: { type: 'string', description: 'RULE 8, max 90 chars: a COMPLETE, NATURAL SENTENCE in the post language telling the reader exactly what to comment and what they get ("Comment FAMILY and we\'ll send it over."). NEVER a code line ("DM: FAMILY"), never a bare shouted word, never a "P.D." postscript.' },
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
// A subordinate opener makes the comma structural, not a splice: "If you want a quick sale, you
// need a realistic price" is one correct sentence. Without this the wider sweep below would
// convert it, and a gate that damages good copy is worse than one that misses bad copy.
const SUBORDINATE_OPENER = /^(if|when|while|because|since|after|before|although|though|unless|until|whenever|wherever|as|si|cuando|mientras|porque|aunque|hasta|wenn|wenn|weil|obwohl|während|bevor|nachdem|falls|quand|lorsque|parce|bien|si|als|omdat|terwijl|hoewel|voordat|quando|mentre|perché|sebbene|quando|porque|embora|när|medan|eftersom|när|fordi|hvis|mens|selv|jos|kun|koska|vaikka|jeśli|kiedy|ponieważ|chociaż|если|когда|потому|хотя)\b/i;

export function oneSentence(text: string): string {
  const t = (text ?? '').trim();
  if (!t) return t;
  // EVERY comma, not only the first. Checking one comma meant the module's own teaching example
  // of a splice — "In a new place, buyers hesitate, they need a plan" — passed untouched, because
  // the first comma is not the splice. Subordinate-opener lines are left alone entirely.
  if (SUBORDINATE_OPENER.test(t)) return t;
  return t.replace(/,(\s+)([^\s,]+)/g, (m, gap: string, next: string) => {
    // "you'll" must truncate AT the apostrophe, not concatenate across it — stripping every
    // non-letter turned it into "youll", so no contracted pronoun was ever recognised.
    const w = String(next).toLowerCase().split(/['\u2019]/)[0].replace(/[^\p{L}]/gu, '');
    return CLAUSE_STARTERS.includes(w) ? ` —${gap}${next}` : m;
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

/** Christian 2026-08-30: he picked a Get Inspired line and the cover came back rewritten. A topic
 *  typed as a subject ("how to tell if a town suits daily life") is a brief; a line that already
 *  READS as a headline is the agent's own writing and must survive to the cover. The test is
 *  shape, not length: it fits a cover, it is not phrased as an instruction to the writer, and it
 *  is a written line rather than a subject fragment. */
export function topicIsHeadline(topic: string): boolean {
  const t = (topic ?? '').trim();
  if (t.length < 18 || t.length > 90) return false;
  if (/^(how to|what to|tips? (on|for)|guide to|ideas? for|about|write|make|create)\b/i.test(t)) return false;
  // A colon does NOT make a line a brief — it is one of the commonest shapes a headline takes.
  // Christian picked "Retiring here isn't just about the sun: what your week actually looks like",
  // this rule alone rejected it, the writer treated it as a subject and returned "What your week
  // actually looks like here" — dropping the retirees the whole post was aimed at. A semicolon
  // still reads as a note to the writer rather than a line anyone would set in type.
  if (/;\s/.test(t)) return false;
  return /\s/.test(t);
}

/** Every plan this module hands out passes through here — one implementation, no per-path drift. */
export function normalisePlan(plan: CarouselPlan, language: string): CarouselPlan {
  plan.hook_title = oneSentence(plan.hook_title);
  plan.slide2_title = oneSentence(plan.slide2_title);
  plan.cta_heading = oneSentence(plan.cta_heading);
  plan.recap_title = oneSentence(plan.recap_title);
  plan.tips = plan.tips.map((t) => ({ ...t, title: oneSentence(t.title) }));
  plan.agency_line = oneSentence(plan.agency_line ?? '');
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


// A COSMETIC overflow must never kill a post. The model routinely writes a 45-character eyebrow
// or a teaser a few words long; that used to burn all three retries and hard-fail the whole
// generation — twice now, in front of Christian. These fields are trimmed at a word boundary
// instead. Structural problems (missing tips, wrong counts, a non-verbatim quote) still retry:
// those cannot be repaired without the model.
const SOFT_CAPS: Record<string, number> = {
  eyebrow: 44, hook_title: 90, slide2_title: 80, slide2_body: 220,
  recap_title: 60, save_line: 70, cta_heading: 78, agency_line: 170,
  cta_action: 140, cta_keyword: 90, swipe_cue: 18,
};
function trimWords(v: unknown, max: number): unknown {
  if (typeof v !== 'string' || v.length <= max) return v;
  const cut = v.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '');
}
function trimToCaps(input: Record<string, unknown>): void {
  for (const [k, max] of Object.entries(SOFT_CAPS)) input[k] = trimWords(input[k], max);
  if (Array.isArray(input.tips)) {
    input.tips = (input.tips as Record<string, unknown>[]).map((t) => (t && typeof t === 'object'
      ? { ...t, title: trimWords(t.title, 62), body: trimWords(t.body, 250), teaser: trimWords(t.teaser, 70) }
      : t));
  }
}

/** Doctrine + honesty gate on the generated copy (client quotes exempt — they're the client's words). */
function planIssues(p: CarouselPlan, quoteSource: string): string | null {
  // Hand-maintained field list, and it had drifted behind the schema: caption, eyebrow and
  // cta_keyword were all missing. The first two print on the post and the slide; the third
  // prints in the closing pill. A price or percentage claim in any of them walked straight
  // past the honesty gate that exists to stop exactly that.
  const advice = [p.hook_title, p.slide2_title, p.slide2_body, p.cta_heading, p.cta_action,
    p.agency_line, p.recap_title, p.save_line, p.caption, p.eyebrow, p.cta_keyword,
    ...p.tips.flatMap((t) => [t.title, t.body, t.teaser])];
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


/** RESEARCH BEFORE WRITING — Christian 2026-08-31.
 *
 *  "it shouldnt ask if something is correct, it should ask first the questions needed to make sure
 *  that the content is correct before writing it."
 *
 *  He is right, and it is a better design than checking afterwards. A writer working from
 *  researched material writes true things naturally; a writer checked afterwards is edited around
 *  holes, which reads stilted. It also generalises: an agent can type ANY topic and the engine
 *  finds out about that one, rather than us maintaining a list of subjects we prepared for.
 *
 *  Two steps, because a SPECIFIC question gets a specific answer and a vague "research this" does
 *  not — which is exactly his point about asking a chatbot a real question and getting a real
 *  answer. First work out what needs to be known; then answer those questions with live search.
 *  This is the pattern Amanda already runs in production (amanda-llm.ts) — she researches the area
 *  before she answers a buyer. The carousel writer had no tools at all and wrote from memory.
 *
 *  CALIBRATION, in his words: "it cant be too strict either... this is for content and its not
 *  soooooo strict." The goal is a well-informed writer, not a legal opinion. General mechanics are
 *  stable and easy to establish; what must never happen is an INVENTED SPECIFIC — a deadline, a
 *  threshold or a requirement nobody checked. Being informed is the point; refusing to write is a
 *  failure, not a safe outcome. */
async function researchTopic(topic: string, lang: string, region: string, markets = ''): Promise<string> {
  const call = async (body: Record<string, unknown>, ms: number): Promise<string> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      let messages = body.messages as Array<{ role: string; content: unknown }>;
      for (let i = 0; i < 3; i++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', signal: ctl.signal,
          headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, messages }),
        });
        if (!res.ok) return '';
        const data = await res.json() as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
        // the model paused mid-search — echo its turn back so the tool loop continues
        if (data.stop_reason === 'pause_turn' && data.content) {
          messages = [messages[0], { role: 'assistant', content: data.content }];
          continue;
        }
        return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
      }
      return '';
    } catch { return ''; }
    finally { clearTimeout(timer); }
  };

  // 1 — what do we need to know to write this truthfully?
  const questions = await call({
    model: 'claude-sonnet-5', max_tokens: 500,
    messages: [{ role: 'user', content:
      `An estate agency on ${region} is writing an Instagram carousel of practical tips for buyers and owners on this topic:\n\n"${topic}"\n\n` +
      `List the 3-5 questions someone would need answered to write ACCURATE, genuinely useful tips on it — the mechanics that decide whether the advice is right. ` +
      `Concrete and answerable, not essay questions. If the topic is about how something works in Spain, ask about how it actually works.\n\n` +
      `FIRST, THOUGH: the topic itself may assert something. "Your neighbour gets 80%, you get 60%", "you only get 90 days", ` +
      `"nothing happens without an NIE", "from 2026 your neighbours get a vote" — these are claims, not established facts, and ` +
      `a topic written by someone in a hurry is exactly where a wrong one hides. If this topic asserts a figure, a date, a ` +
      `deadline, a threshold or an absolute ("always", "never", "you must", "you cannot"), make your FIRST question ask whether ` +
      `that specific assertion is actually true, and under what conditions it holds. Do not ask questions that take the claim ` +
      `for granted and merely elaborate around it.\n\n` +
      `A QUESTION MUST NOT CARRY ITS OWN ANSWER. "Which towns barely change in winter versus which ` +
      `visibly empty" has already decided that both groups exist and which towns are in each — it asks ` +
      `for confirmation, not for evidence. Write "What actually closes here between November and March, ` +
      `and in which towns" instead. No named conclusions, no rate bands, no nationality filed under a ` +
      `legal category, no asserted cause. Ask what is the case, never whether a thing you already ` +
      `believe is the case.\n\n` +
      `Reply with the questions only, one per line, no numbering, no preamble.` }],
  }, 25_000);
  if (!questions) return '';

  // 2 — answer them, with live search, and say plainly what could not be established
  const findings = await call({
    model: 'claude-sonnet-5', max_tokens: 1600,
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content:
      `Research these questions for an estate agency on ${region} writing practical content for buyers and owners of Spanish coastal property. ` +
      `Search where it helps; today's rules matter more than old ones.\n\n${questions}\n\n` +
      `Write a plain briefing of what is ESTABLISHED — the mechanics, the sequence, what actually happens. Be specific where you are sure. ` +
      `If something varies by region, municipality or bank, say that it varies rather than picking a number.\n\n` +
      // Three category mistakes a confident model makes fluently. Each produced a wrong published
      // line before this guard existed: a Norwegian filed under "non-EU", a province-wide statistic
      // repeated as a town's, and a search figure reported as a sale.
      STATUS_MODEL + `\n\n` + (markets ? markets + `\n\n` : '') +
      // The questions above are generated, not verified. Auditing them is the step that was missing:
      // a question can smuggle in the very assumption it was meant to test.
      `AUDIT THE QUESTIONS BEFORE YOU ANSWER THEM. They were written by another model and NOTHING in ` +
      `them is established. A question can carry its own answer — naming towns on both sides of a ` +
      `conclusion ("which barely change in winter versus which visibly empty"), quoting a rate band, ` +
      `filing a nationality under a legal category, or asserting a cause. Where a question does that, ` +
      `test the buried assumption FIRST and report what you actually find, even if the question ` +
      `dissolves. Answering a loaded question accurately still produces a false briefing.\n\n` +
      `ALSO NEVER COLLAPSE THESE:\n` +
      `· GEOGRAPHY. Tag every figure with what it actually measures: Spain, the region, the province, ` +
      `or one municipality. A province-wide number is NOT a fact about a town — say so explicitly ` +
      `when it cannot be localised.\n` +
      `· THE METRIC. Asking price is not sale price; a search or a listing view is not an enquiry and ` +
      `not a purchase; transactions are not value; residents and non-residents are different populations. ` +
      `Name the metric and the period beside every number.\n\n` +
      `If you could not establish something, write "UNCLEAR:" and the question — do not fill the gap with a plausible answer. ` +
      `And if the TOPIC ITSELF turns out to rest on something you could not establish, or that the ` +
      `sources contradict, say so in one line beginning "PREMISE FAILS:" — the post can still be ` +
      `written, but it must be written about what is true rather than about the claim.\n` +
      `No preamble, no headings, no markdown. Under 400 words.` }],
  }, 60_000);
  return findings;
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
  /** Which markets this agency actually sells to, as prose — so a Norwegian buyer is not written
   *  to as though they were British. Derived from settings; empty when the agency has set none. */
  marketBrief?: string;
  /** Christian 2026-08-31 ("they could have a little box that informs them yes") — the caller
   *  receives what the research established, so the agent can read what their tips were built on
   *  before publishing under their own name. */
  onResearch?: (brief: string) => void;
}): Promise<CarouselPlan> {
  const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
  const lang = langNames[opts.language] ?? 'Spanish';
  const region = opts.region || 'the Costa Blanca';

  // Find out BEFORE writing. Never fatal: if research fails or times out the deck is still written,
  // just from the model's own knowledge as it always was — a slow search must not cost an agent
  // their post.
  const brief = opts.type === 'tips' && opts.topic
    ? await researchTopic(opts.topic, lang, region, opts.marketBrief ?? '').catch(() => '')
    : '';
  if (brief) {
    console.log(`[studio/carousel] researched "${String(opts.topic).slice(0, 60)}" — ${brief.length} chars`);
    opts.onResearch?.(brief);
  }

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
- THE CLOSING SLIDE SAYS WHAT THE AGENCY DOES — ONLY WHEN WE KNOW IT. agency_line may be written ONLY from stated SERVICES in the agency profile above; a voice note, a tone, a content style or a town is not a service. With no stated services, agency_line is an EMPTY STRING — printing an invented speciality would be a false claim about this business. cta_action stays SHORT — the action itself, nothing else. Contact details are handled by the design, not by you. NEVER "tag a friend", "share this", "follow for more" — Meta demotes engagement bait.
- save_line is the SECONDARY line, demoted under the agency line: the save/keep framing ("Save it for the week the move gets hard.").
- cta_keyword is a COMPLETE, NATURAL SENTENCE in the post language telling the reader exactly what to comment and what they get ("Comment FAMILY and we'll send it over."). NEVER a code line ("DM: FAMILY", "Escríbenos: GUÍA"), never a bare shouted word, never a "P.D." postscript.
- Caption: SHORT and human — 3 lines max + a CTA line, written like a person, not a brochure. No clichés, no rhetorical-question openers. Same place rule: no towns unless the topic names one. End with a short question answerable in ONE word — as a plain line, NEVER labelled "P.D." or "P.S.".
- Hashtags: 3-5 only, no mega-tags.
- image_scenes: 3 concrete Mediterranean scenes (ENGLISH). [0] is the COVER and it carries the whole post: it must stage the TOPIC so literally that a viewer could guess it from the image alone — never a generic pretty postcard (window, door, beach) unless the topic is literally about it. [1] appears on slide 2 (the second cover Instagram re-serves): a different composed scene, second angle on the topic, new hero object. The closing beat [2] may be one quiet simple subject (sea, beach, a lone tree) for rhythm.
- EVERY tip also gets its own "scene": a LITERAL visual translation of THAT tip — the props act out the advice, so a viewer who sees only the image could guess the tip. HERO OBJECT LAW: each scene names ONE hero object in its first five words, and no two scenes in the deck (cover included) may share a hero object or lean on the same motif — different objects, different compositions, same world. Repetition across slides is a failure. NEVER default to the stock clichés — keys, suitcases, luggage, generic doors — unless the tip is literally about them; pick the tip's OWN objects instead (bills → tied envelopes; maintenance → a dripping tap; paperwork → a stamped folder; viewings → a pocket torch on a windowsill at dusk).${opts.avoidMotifs?.length ? `
- RECENTLY USED in this agency's previous posts — do NOT use any of these as a hero object again, find fresh ones: ${opts.avoidMotifs.join('; ')}.` : ''}

- EVERY FACTUAL CLAIM MUST BE TRUE. Claims are wanted — vague advice is worthless — but a wrong one destroys trust.
${brief ? `
WHAT RESEARCH ESTABLISHED ABOUT THIS TOPIC — write from THIS, not from memory. It was looked up for
this post. Where it is specific, be specific: that is what makes a tip worth reading. Where it says
something varies, say it varies. Anything marked UNCLEAR was NOT established — do not write a tip
that depends on it, and never invent a deadline, a threshold or a requirement to fill the gap.
If the briefing contains a line beginning "PREMISE FAILS:", the topic itself was built on something
the research could not support. Do NOT write the deck the topic asked for. Write the deck the research
supports instead, on the same subject, and change the cover to match — a true post on a smaller claim
beats a confident one on a false one. The topic is a suggestion; the research is the evidence.

${brief}
` : ''}${brief ? `
${STATUS_MODEL}
${opts.marketBrief ? `\n${opts.marketBrief}\n` : ''}
` : ''} For anything about the NIE, banks, taxes, residency, mortgages or ownership: state what is USUALLY true and why it helps, never an absolute impossibility you cannot verify. Worked example of the failure: "without a local account you cannot pay utilities, taxes or a mortgage" is FALSE — Eurozone SEPA rules forbid refusing a valid IBAN from another member state. The honest version keeps the value: "a Spanish account makes utilities, taxes and a mortgage far simpler to run".

HARD RULES:
${brief ? `- A FIGURE MAY APPEAR ONLY IF THE RESEARCH ABOVE ESTABLISHED IT. Prices, percentages, rates,\n  tax figures, deadlines, dates, thresholds: if the briefing states it, you may state it — that\n  precision is what makes a tip worth reading. If the briefing does NOT state it, you have no\n  source and the number would be invented, so write the mechanism without the number. Never round,\n  stretch or “roughly” a researched figure into a different one. Never promise a legal guarantee.`
 : `- NO specific prices, percentages, statistics, interest rates, tax figures, or legal guarantees anywhere in slide copy. Nothing was researched for this post, so any figure would be invented. Use place names for specificity instead of numbers.`}
- BUYING PROPERTY IN SPAIN CONFERS NO RESIDENCE RIGHT. The golden visa / investor route was
  abolished with effect from 3 April 2025 (Ley Orgánica 1/2025, DF 21ª, emptying arts. 63-67 of
  Ley 14/2013); permits issued before then remain valid. Never write, imply or hint that a purchase
  helps with residence, a visa, or days allowed in the country. It is the claim an agency most wants
  to make and it is now false.
- NO invented facts about the agency, the market, or any client. The agency name is the only real-world name you may use${opts.type === 'quote' ? ' (plus the client attribution provided)' : ''}.
- Friendly expert tone: confident, warm, zero clickbait, no emoji in slide copy (caption may use a few).
- The research is what you KNOW, not what you SAY. Use the sharp, useful part of it and leave the
  rest out. A slide that recites everything established is a briefing, not a post — nobody reads to
  the end of it. Short sentences. One idea per slide. If a body needs forty words and one breath,
  the sentence underneath it is better: find that one instead.
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
    trimToCaps(input);
    const parsed = PlanSchema.safeParse(input);
    if (!parsed.success) {
      lastErr = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      continue;
    }
    const plan = parsed.data as CarouselPlan;
    // the agent's own headline is not the writer's to rewrite
    if (opts.type === 'tips' && opts.topic && topicIsHeadline(opts.topic)) plan.hook_title = opts.topic.trim();
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

export async function editPlan(plan: CarouselPlan, topic: string, language = 'es', brief = ''): Promise<{ plan: CarouselPlan; notes: string[] } | null> {
  // RULE 4 — the deterministic detector names the exact sentences that assert an absolute about
  // a regulated subject, so the editor verifies or hedges THOSE rather than re-reading blind.
  const flagged = riskyClaims(plan);
  // Christian's 2026-08-30 English deck came back with recap_title translated INTO Spanish, and
  // the editor's own note said it had "corrected" it. The prompt casts the editor as working on
  // the Spanish coast and never once states the deck's language, so with nothing to anchor to it
  // inferred Spanish and rewrote a field. The deck's language is not the editor's to revisit.
  const LANGS: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
  const deckLang = LANGS[language] ?? 'Spanish';
  const prompt = `You are the skeptical EDITOR at a real-estate agency on the Spanish coast.

THIS DECK IS WRITTEN IN ${deckLang.toUpperCase()}. Every field you return must stay in ${deckLang}. The
language was chosen by the agent, not by you — never translate a field, and never "correct" one that
looks out of place to you. If a field is already in ${deckLang}, leave its language alone. The reader of this Instagram carousel is a potential client — every slide must make sense on first read, teach something useful, and sound like an agent they can trust. Review the plan below and correct ONLY what fails.

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
8. THE CLOSING — agency_line may state ONLY a service this agency has actually told us about. If it names a speciality that could not have come from the agency's own facts (a claim inferred from the post topic), EMPTY IT rather than keep it; cta_action stays short and is the action alone; save_line carries the save framing, demoted.

RULES FOR CORRECTIONS:
- Rewrite in the SAME LANGUAGE as the existing copy, within the same length limits, same warm expert tone.
- NEVER change hook_title. The agent either wrote it or approved it; it is not yours to improve.
${brief ? `
CHECK EVERY FACTUAL CLAIM AGAINST THE RESEARCH BELOW. This was looked up for this post, before the
copy was written. Where a slide contradicts it, the slide is wrong — fix the slide. Where the
research says something VARIES, the slide must not state a single figure. Where the research marks
something UNCLEAR, no slide may depend on it.

A real example of what this catches, from Christian's own deck: a slide said "both types of debt
are capped" when the research established that only ONE of them is. Accurate on its face, false in
substance, and it took an eight-agent legal check to find. That is the job.

${brief}
` : ''}
HOW A CORRECTION MUST BE WRITTEN — this matters as much as the correction. Christian, 2026-09-01:
"i just want to make sure that it still is content, not just an information bomb. it needs to be as
entertaining as informative to read in a way while still staying professional and trustworthy."

A fixed line must still be a LINE, not a legal notice. The research is what the deck KNOWS; the
slide is what it SAYS, and those are never the same length. The best thing that fact-check produced
was three words — "Never waive it." When you correct something:
- say the useful half, not everything that is true
- short sentences a person could read aloud without running out of breath
- no clause-stacking, no "and, moreover, it should also be noted"
- if the honest version needs forty words, it is the wrong sentence — find the sharp one underneath
Never make a slide longer to make it more correct. Make it shorter and truer.
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
    trimToCaps(input);
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
    if (!out.success) return null;
    const hook = oneSentence(out.data.hook_title);
    // "Try a new angle" writes a brand-new cover and, until now, nothing checked it. The normal
    // path puts every hook through planIssues (RULE 4's price/percentage ban and the weak-opener
    // ban) and through riskyClaims -> the editor's verification block. The remix path has no
    // editor pass at all, so a remixed cover could assert a price, a percentage, or a flat legal
    // absolute — "Without a Spanish bank account you cannot sell your home" — with no gate
    // between the model and the slide. A cover is the most-read line in the deck; the false ones
    // are rejected here rather than shipped, and the route already tells the agent to try again.
    if (BANNED.test(hook) || WEAK_HOOK.test(hook.trim())) return null;
    if (riskyClaims({ ...plan, hook_title: hook } as CarouselPlan).length) return null;
    return { ...out.data, hook_title: hook };
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

/** Christian's own content research, 2026-09-01. He reframed the problem better than any category
 *  taxonomy would: people do not follow an estate agency because they want estate-agency content,
 *  they follow because they are asking "could I actually live there?", "am I about to make a massive
 *  mistake?", "what don't I know yet?". So ideas are organised by the NEED behind the question. */
/**
 * Five variables a model collapses fluently, and a person can be a different thing in each.
 * A Norwegian filed under "non-EU, 90/180" reached a published document before this existed —
 * Norway is EEA and Schengen, so neither half of that was true. Kept as ONE constant used by both
 * the research and the writing prompts, so the two can never drift apart.
 */
const STATUS_MODEL = `PERSON STATUS — FIVE SEPARATE VARIABLES. Never infer one from another:
1. NATIONALITY — the passport. Decides nothing on its own.
2. IMMIGRATION CATEGORY — EU · EEA-non-EU (Norway, Iceland, Liechtenstein) · Switzerland (its own
   bilateral regime) · third country (UK, US, Canada). EEA and Swiss citizens hold free-movement
   rights and are NOT on the 90/180 short-stay clock; Norway and Iceland are Schengen members.
   Only third-country nationals need a visa route to stay beyond 90 days.
3. SPANISH RESIDENCE STATUS — whether they actually hold residence here, and under which regime
   (EU/EEA registration certificate vs TIE). Having the right to reside is not the same as using it.
4. SPANISH TAX RESIDENCE — turns on where a person lives and where their interests are, NOT on their
   passport. A third-country national can be Spanish tax-resident; an EU citizen can be non-resident.
5. COUNTRY OF TAX RESIDENCE — which country taxes them, and which treaty applies.
Worked example: a Norwegian national, tax-resident in the UK, who owns a Costa Blanca flat is an
EEA citizen with free movement (not 90/180), a Spanish non-resident for tax, and taxed under the
Spain-UK treaty. Every one of the five differs. If a claim depends on one of them, name which.`

const BUYER_NEEDS: Array<[string, string, string]> = [
  ['MONEY', 'what will this really cost?', 'taxes, fees, mortgages, the bills after the keys, what a budget really has to cover'],
  ['FEAR', 'what could go wrong?', 'scams, illegal builds, contracts, deposits, the thing nobody warns you about'],
  ['DIRECTION', 'where should I buy?', 'town against town, neighbourhoods, who a place suits and who it does not'],
  ['DREAM', 'what would my life actually look like?', 'the ordinary Tuesday, the specific small change, never "imagine waking up to this view"'],
  ['DECISION', 'which option is better?', 'new vs resale, villa vs apartment, coast vs inland — and it must REACH A CONCLUSION'],
  ['UNDERSTANDING', 'how does Spain actually work?', 'NIE, notary, lawyer, the sequence of a purchase, what each step is for'],
  ['OPPORTUNITY', 'am I making a smart move?', 'the market, renting it out, timing, what the numbers mean for a person'],
  ['TRUST', 'can I trust this agency?', 'transparency, mistakes agencies make, what a good agent does that a bad one does not'],
];

export async function topicIdeas(language: string, exclude: string[]): Promise<string[] | null> {
  const month = new Date().toLocaleString('en', { month: 'long' });
  // Six ideas must span SIX DIFFERENT needs. Christian, 2026-09-01: "i feel like i am seeing the
  // same topics over and over again just another way of saying it." They were — the generator was
  // free to circle whichever theme it liked, and it liked paperwork and trust. Rotating the needs
  // forces breadth into the batch instead of hoping for it. The offset moves with the exclusion
  // list, so consecutive taps start from a different need.
  const off = exclude.length % BUYER_NEEDS.length;
  const chosen = Array.from({ length: 6 }, (_, i) => BUYER_NEEDS[(off + i) % BUYER_NEEDS.length]);
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

ONE IDEA PER NEED — the six ideas cover these six, in this order, one each. This is not optional:
${chosen.map(([n, q, w], i) => `${i + 1}. ${n} — the reader is asking "${q}". Territory: ${w}`).join('\n')}

WHAT A GOOD ONE SOUNDS LIKE (Christian's own examples — match this register, do not copy them):
- money:   "You found a home for €250,000. Here's why €250,000 isn't your real budget."
- fear:    "The beautiful villa we'd tell our own client NOT to buy."
- direction: "Who should NOT live in Torrevieja?" — never "Discover beautiful Torrevieja".
- dream:   "What Tuesday morning looks like when you don't have to scrape ice off your car."
- decision: "€200k apartment vs €300k villa: which actually costs more to own?"
- trust:   "Your estate agent says everything is fine. Your lawyer should still check this."
The test he uses: is this the kind of thing someone SENDS TO THEIR PARTNER? If not, it is not good
enough. And sending is not a soft metric — Instagram's confirmed ranking signals are watch time,
SENDS per reach and likes per reach, and sends carry the most weight for reaching people who do NOT
already follow the agency. (No public ratio of sends to likes exists; do not repeat one.) The two
people deciding on a house together are the real unit here. Write for the send.

Every good line carries at least ONE of: a specific number, a named consequence, or a literal
question people actually type. Beyond that:
- A comparison must reach a VERDICT. "Both are great depending on your preferences" is banned.
- Make the dream specific and honest — a November Tuesday, hour by hour, not "imagine the view".
- Prefer the sharp frame: who should NOT, the one wrong choice, what nobody tells you.
- Translate any market fact into "what does this mean for me?".
- Give away real insider knowledge. That is what builds trust; withholding it builds nothing.
- Two topics a reader would experience as the same post ARE the same topic, however differently
  worded. Vary the NEED, not the wording.
- Never invent a statistic. Use a figure only if it is current and you are sure of it.
- NEVER an idea that only the agency's own private history could answer: a specific past sale, a
  deal they talked a client out of, mistakes they made last year, a named client's timeline. We do
  not have those facts and the writer is forbidden to invent them, so the post comes out either
  false or hollow. Write the TRANSFERABLE version instead — "what a good agent does when the survey
  comes back bad", not "the €340,000 sale we walked away from".

VARY THE TONE across the 6 — most practical and direct, one bolder/provocative with a sting ("Some people buy a home in Spain. Others buy a problem with a pool."), one warm dream-selling angle about the life itself, maybe one life-philosophy angle ("Everyone talks about work-life balance. Almost nobody talks about location-life balance.") — but tone is the FLAVOUR; the pain point and instant clarity are the substance. A clear, slightly plain idea beats a clever, unclear one every time. The quoted lines above are register examples only — NEVER output them or close paraphrases of them.

Rules for all 6:
- NO place names, NO prices, NO statistics, NO legal/tax advice framing (bold lines may gesture at cost/time in the abstract, never with figures).
- 30-90 characters for direct ideas; bolder two-sentence lines may run up to 150. No emoji, no numbering, no labels in the output.${exclude.length ? `\n- These have ALREADY been shown to this agency. At most ONE of your six may revisit a subject from this list, and if it does it must be said a completely different way — a different angle, a different opening, different words. The other five must be subjects that are NOT on it:\n${exclude.slice(0, 24).map((t) => `  · ${t}`).join('\n')}` : ''}

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
