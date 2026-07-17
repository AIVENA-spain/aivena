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
            scene: { type: 'string', description: "THIS TIP's visual (ENGLISH, 15-40 words): one concrete Mediterranean object/scene that translates THIS specific tip into imagery — different from every other tip's scene. Same rules as image_scenes: concrete nouns, no interiors, no facades, no landmarks, no close people, no text." },
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
      image_scenes: { type: 'array', items: { type: 'string' }, description: 'EXACTLY 3 concrete visual scenes (in ENGLISH, 15-40 words each) translating the post topic and its EMOTION into imagery: [0] the cover hero — one familiar Mediterranean object or scene carrying the topic as a visual metaphor (longing, the promise of a better life in Spain); [1] a companion scene in the same world; [2] a quieter closing beat. Rules: concrete nouns only (diffusion fails on abstractions), NO interiors, NO building facades that could read as a real property, NO recognizable landmarks, NO people close-up, NO text in the scene. Example for hidden costs: "a half-submerged terracotta amphora in clear turquoise water".' },
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
}): Promise<CarouselPlan> {
  const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
  const lang = langNames[opts.language] ?? 'Spanish';
  const region = opts.region || 'the Costa Blanca';

  const task = opts.type === 'tips'
    ? `Create an EDUCATIONAL carousel: exactly ${Math.min(7, Math.max(1, opts.slideCount ?? 5))} points about: "${opts.topic}".
Prefer the LOSS/MISTAKE frame — "errors that cost you money", "what nobody warns you about", "what I'd never do" — it is the only hook style with experimental proof. Each point = one slide: punchy title + 15-40 words of genuinely useful, practical advice a real buyer/seller can act on. One idea per point. Each point's "teaser" is an open loop pulling to the next slide; leave the last teaser empty.
If the hook promises a number ("5 errores"), it MUST equal the number of points delivered.`
    : `Create a CLIENT STORY carousel from this quote (provided by the agency — treat as authentic):
QUOTE: "${opts.quoteText}"
ATTRIBUTION: "${opts.quoteAuthor ?? ''}"
The COVER (quote_hook) is the most concrete, emotional VERBATIM fragment of the quote (max 120 chars) — never a "Testimonial" label. Split the full quote VERBATIM into 2-3 readable chunks (quote_parts) — one chunk only if the quote is a single short sentence; do NOT rewrite, embellish or translate the quote itself. slide2_title + quote_context set the scene using ONLY what the quote itself reveals (no invented details about the client). attribution exactly as provided, prefixed "— ".`;

  const prompt = `You are the social media content director for "${opts.agencyName}", a real-estate agency in ${region}, Spain. Their goals: local authority, saves and sends, buyer/seller DMs — not likes.

${task}

Write ALL copy in ${lang} — one language for the whole post (comprehension and keyword search are language-literal).

CAROUSEL DOCTRINE (how these posts win — follow it):
- The cover headline: 5-8 words, loss/gap-framed, and it must leave the question open — a title that summarizes the answer kills the swipe.
- PLACES: mention a specific town/area ONLY if the topic itself names one. If it doesn't, keep every slide and the caption location-neutral ("the coast", "the area") — never insert a town the user didn't ask for.
- Slide 2 is a SECOND cover: Instagram re-serves unswiped carousels starting at slide 2, so slide2_title must stand alone with zero context ("Selling this year? This saves you money.").
- One idea per slide. Each slide answers the question the previous one raised.
- The recap is the SAVE unit — people screenshot and forward it.
- The CTA leads with ONE action: a save or send framing (cta_action) + a DM keyword (cta_keyword). Contact details are handled by the design, not by you. NEVER "tag a friend", "share this", "follow for more" — Meta demotes engagement bait; help-framing ("send this to the person you're buying with") is the substitute.
- Caption: SHORT and human — 3 lines max + a CTA line, written like a person, not a brochure. No clichés, no rhetorical-question openers. Same place rule: no towns unless the topic names one. End with a short P.D. question answerable in ONE word.
- Hashtags: 3-5 only, no mega-tags.
- image_scenes: 3 concrete Mediterranean scenes (ENGLISH) that translate the topic's emotion — the longing for a home in Spain, the promise of a better life — into carefully purposeful imagery. One familiar object/scene per beat carrying one extra meaning. Concrete nouns; no interiors, no property facades, no landmarks, no close people, no text.
- EVERY tip also gets its own "scene": the visual translation of THAT tip specifically. All scenes across the deck must be clearly DIFFERENT from each other — different objects, different compositions — while living in the same world. Repetition across slides is a failure.

HARD RULES:
- NO specific prices, percentages, statistics, interest rates, tax figures, or legal guarantees anywhere in slide copy. General, evergreen advice only — you have no data source, so any figure would be invented. Use place names for specificity instead of numbers.
- NO invented facts about the agency, the market, or any client. The agency name is the only real-world name you may use${opts.type === 'quote' ? ' (plus the client attribution provided)' : ''}.
- Friendly expert tone: confident, warm, zero clickbait, no emoji in slide copy (caption may use a few).

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
    const input = { type: opts.type, ...(unesc(tool?.input) as object ?? {}) };  // the requested type always wins
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
    return plan;
  }
  throw new Error(`carousel plan invalid after retries: ${lastErr}`);
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
      art_style: { type: 'string', enum: ['bodegon', 'litoral', 'tinta', 'salitre', 'papel', 'arcilla', 'acuarela', 'bordado'], description: 'the artwork style that best matches this property vibe' },
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
