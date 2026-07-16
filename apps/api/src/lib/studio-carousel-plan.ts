import { z } from 'zod';
import { env } from '../../../../packages/config/env';
import type { CarouselPlan } from '../../../../studio/engine/carouselSlides';

// CAROUSEL PLANNER (Christian-approved 2026-07-16): the AI writes the WORDS of a tips/quote carousel
// (hook, tip copy, CTA, caption, hashtags) as a validated plan; the deterministic slide library draws
// every pixel. Honesty rules are hard: general advice only — no prices, no statistics, no percentages,
// no legal guarantees, no market claims; quote carousels reuse the agent's own text, never invent praise.

export const PlanSchema = z.object({
  type: z.enum(['tips', 'quote']),
  eyebrow: z.string().min(1).max(44),
  hook_title: z.string().min(1).max(90),
  tips: z.array(z.object({
    title: z.string().min(1).max(62),
    body: z.string().min(1).max(250),
  })).max(7).default([]),
  quote_parts: z.array(z.string().min(1).max(250)).max(3).default([]),
  attribution: z.string().max(62).default(''),
  cta_heading: z.string().min(1).max(78),
  cta_sub: z.string().max(130).default(''),
  cta_button: z.string().min(1).max(26),
  swipe_cue: z.string().min(1).max(18).default('Desliza'),
  caption: z.string().min(1).max(1600),
  hashtags: z.array(z.string().min(2).max(40)).max(20).default([]),
}).superRefine((p, ctx) => {
  if (p.type === 'tips' && p.tips.length < 3) ctx.addIssue({ code: 'custom', path: ['tips'], message: 'tips carousel needs 3-7 tips' });
  if (p.type === 'quote' && p.quote_parts.length < 1) ctx.addIssue({ code: 'custom', path: ['quote_parts'], message: 'quote carousel needs 1-3 quote parts' });
});

const PLAN_TOOL = {
  name: 'submit_carousel',
  description: 'Submit the complete carousel content plan.',
  input_schema: {
    type: 'object',
    required: ['type', 'eyebrow', 'hook_title', 'cta_heading', 'cta_button', 'swipe_cue', 'caption'],
    properties: {
      type: { type: 'string', enum: ['tips', 'quote'] },
      eyebrow: { type: 'string', description: 'short kicker above the cover title, max 44 chars, e.g. "Guía para compradores"' },
      hook_title: { type: 'string', description: 'the scroll-stopping cover headline, max 90 chars' },
      tips: {
        type: 'array', description: 'tips carousels only: 3-7 tips, one slide each',
        items: {
          type: 'object', required: ['title', 'body'],
          properties: {
            title: { type: 'string', description: 'punchy tip headline, max 62 chars' },
            body: { type: 'string', description: 'the advice, 1-3 plain sentences, max 250 chars' },
          },
        },
      },
      quote_parts: { type: 'array', items: { type: 'string' }, description: 'quote carousels only: the quote split into 1-3 readable chunks of max 250 chars, VERBATIM from the provided text' },
      attribution: { type: 'string', description: 'quote carousels only: who said it, exactly as provided, e.g. "— María G., compradora"' },
      cta_heading: { type: 'string', description: 'closing-slide headline inviting contact, max 78 chars' },
      cta_sub: { type: 'string', description: 'one supporting line under the CTA heading, max 130 chars' },
      cta_button: { type: 'string', description: 'short button label, max 26 chars, e.g. "Escríbenos hoy"' },
      swipe_cue: { type: 'string', description: 'the "swipe" word in the post language, max 18 chars (es: "Desliza", en: "Swipe")' },
      caption: { type: 'string', description: 'ready-to-post Instagram caption in the post language: hook line, short value summary, call to action. No hashtags inside — they go in the hashtags field.' },
      hashtags: { type: 'array', items: { type: 'string' }, description: 'up to 20 relevant hashtags WITHOUT the # prefix, mixing Spanish real-estate + local + niche' },
    },
  },
} as const;

const BANNED = /(\d+\s*%|€|EUR\b|\$)/i;

/** Strip content the honesty rules forbid: percentages and money amounts in advice copy. */
function honest(p: CarouselPlan): string | null {
  const texts = [p.hook_title, p.cta_heading, p.cta_sub, ...p.tips.flatMap((t) => [t.title, t.body])];
  const bad = texts.find((t) => BANNED.test(t));
  return bad ? `copy contains a price/percentage claim ("${bad.slice(0, 60)}") — general advice only, no figures` : null;
}

export async function planCarousel(opts: {
  type: 'tips' | 'quote';
  topic?: string;            // tips: what the carousel teaches
  quoteText?: string;        // quote: the testimonial, verbatim source
  quoteAuthor?: string;      // quote: attribution as the agent wrote it
  slideCount?: number;       // tips: desired number of tips (3-7)
  language: string;          // 'es', 'en', ...
  agencyName: string;
  region?: string;           // for locally relevant advice + hashtags
}): Promise<CarouselPlan> {
  const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
  const lang = langNames[opts.language] ?? 'Spanish';

  const task = opts.type === 'tips'
    ? `Create a TIPS carousel: exactly ${Math.min(7, Math.max(3, opts.slideCount ?? 5))} tips about: "${opts.topic}".
Each tip = one slide: a punchy title + 1-3 sentences of genuinely useful, practical advice a real buyer/seller/owner can act on. One idea per tip, no filler.`
    : `Create a QUOTE/testimonial carousel from this client quote (provided by the agency — treat as authentic):
QUOTE: "${opts.quoteText}"
ATTRIBUTION: "${opts.quoteAuthor ?? ''}"
Split the quote VERBATIM into 1-3 readable chunks (max 250 chars each) for quote_parts — do NOT rewrite, embellish or translate the quote itself. hook_title = a short cover line about client experiences (your words, in the post language). attribution = the attribution exactly as provided (prefix with "— " if missing).`;

  const prompt = `You are the social media content director for "${opts.agencyName}", a real-estate agency${opts.region ? ` in ${opts.region}, Spain` : ' in Spain'}.

${task}

Write ALL copy in ${lang}.

HARD RULES:
- NO specific prices, percentages, statistics, interest rates, tax figures, or legal guarantees. General, evergreen advice only — you have no data source, so any figure would be invented.
- NO invented facts about the agency or the market. The agency name is the only real-world name you may use.
- Friendly expert tone: confident, warm, zero clickbait, no emoji in slide copy (caption may use a few).
- hook_title must stop the scroll: short, concrete, benefit-led.
- caption: 2-5 short paragraphs in ${lang}, ends inviting a DM/message. Hashtags go ONLY in the hashtags field.

Submit with the submit_carousel tool.`;

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        tools: [PLAN_TOOL],
        tool_choice: { type: 'tool', name: 'submit_carousel' },
        messages: [{ role: 'user', content: attempt === 0 ? prompt : `${prompt}\n\nYour previous plan was invalid: ${lastErr}. Fix it and resubmit.` }],
      }),
    });
    if (!res.ok) {
      lastErr = `api_${res.status}`;
      if (res.status >= 500 || res.status === 429) continue;
      throw new Error(`carousel plan failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const tool = data.content?.find((c) => c.type === 'tool_use');
    const input = { type: opts.type, ...(tool?.input as object ?? {}) };  // the requested type always wins
    const parsed = PlanSchema.safeParse(input);
    if (!parsed.success) {
      lastErr = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      continue;
    }
    const dishonest = honest(parsed.data as CarouselPlan);
    if (dishonest) { lastErr = dishonest; continue; }
    return parsed.data as CarouselPlan;
  }
  throw new Error(`carousel plan invalid after retry: ${lastErr}`);
}

const CAPTION_TOOL = {
  name: 'submit_caption',
  description: 'Submit the Instagram caption and hashtags.',
  input_schema: {
    type: 'object',
    required: ['caption'],
    properties: {
      caption: { type: 'string', description: 'ready-to-post caption: hook line, the listing in 2-3 short lines using ONLY the provided facts verbatim, closing invitation to message. No hashtags inside.' },
      hashtags: { type: 'array', items: { type: 'string' }, description: 'up to 20 hashtags WITHOUT the # prefix' },
    },
  },
} as const;

/** Best-effort AI caption for a LISTING carousel — facts passed verbatim, never invented. Null on any failure. */
export async function listingCaption(opts: {
  facts: Record<string, string>;
  language: string;
  agencyName: string;
}): Promise<{ caption: string; hashtags: string[] } | null> {
  try {
    const langNames: Record<string, string> = { es: 'Spanish', en: 'English', de: 'German', fr: 'French', nl: 'Dutch', sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish', pl: 'Polish', ru: 'Russian', it: 'Italian', pt: 'Portuguese' };
    const factList = Object.entries(opts.facts).filter(([, v]) => v).map(([k, v]) => `  ${k}: "${v}"`).join('\n');
    const prompt = `Write the Instagram caption for a property-listing carousel posted by "${opts.agencyName}", in ${langNames[opts.language] ?? 'Spanish'}.

THE FACTS (copy them VERBATIM where used — never alter a number, never add facts that are not listed):
${factList}

Structure: one scroll-stopping hook line, the listing in 2-3 short lines (price/specs/location from the facts), a closing line inviting a DM. A few emoji are fine. Submit with submit_caption.`;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1500,
        tools: [CAPTION_TOOL],
        tool_choice: { type: 'tool', name: 'submit_caption' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = data.content?.find((c) => c.type === 'tool_use')?.input as { caption?: unknown; hashtags?: unknown } | undefined;
    if (!input || typeof input.caption !== 'string' || !input.caption.trim()) return null;
    const hashtags = Array.isArray(input.hashtags)
      ? input.hashtags.filter((h): h is string => typeof h === 'string' && !!h.trim()).map((h) => h.replace(/^#/, '').trim()).slice(0, 20)
      : [];
    return { caption: input.caption.trim().slice(0, 1600), hashtags };
  } catch {
    return null;
  }
}
