// Art direction + visual QA for tips-carousel artwork (Christian 2026-08-28: "there should be
// more thought in the image generation process so it always looks thought through" — permanent,
// topic- and style-agnostic quality stages, not per-topic patches).
//
// Stage 1 — directScenes(): a dedicated art-director pass, separate from the copywriter. For each
// slide it names the IDEA (what a viewer must understand at a glance), picks a visual strategy
// that serves it (irony, quiet metaphor, literal staged still), and writes a scene an image model
// can render unambiguously. Runs once per generation; on any failure the planner's own scenes
// stand, so a post is never blocked.
//
// Stage 2 — critiqueArtwork(): a vision reviewer that LOOKS at each generated image before the
// customer does — rejects glitches (voids, warped geometry, accidental text) and images that
// read as random rather than staged. The caller regenerates rejects once with the problem fed
// back. QA unavailable → accept (never block).

import sharp from 'sharp';
import { env } from '../../../../packages/config/env';

const API = 'https://api.anthropic.com/v1/messages';
const HDRS = { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };

export interface ArtBrief { idea: string; scene: string }
export interface ArtDirection { cover: ArtBrief; context: ArtBrief | null; tips: ArtBrief[] }

const BRIEF_SHAPE = {
  type: 'object' as const,
  required: ['idea', 'scene'],
  properties: {
    idea: { type: 'string', description: 'ONE sentence: what the viewer must understand at a glance from this image alone' },
    scene: { type: 'string', description: 'the scene to render (ENGLISH, 20-45 words): concrete stageable objects only, hero object named in the first five words' },
  },
};

const DIRECT_TOOL = {
  name: 'submit_art_direction',
  description: 'Submit the art direction for every slide.',
  input_schema: {
    type: 'object' as const,
    required: ['cover', 'tips'],
    properties: {
      cover: { ...BRIEF_SHAPE, description: 'the cover artwork — carries the whole post' },
      context: { ...BRIEF_SHAPE, description: 'slide 2 artwork — the topic from a second angle, new hero object (omit only if not requested)' },
      tips: { type: 'array', items: BRIEF_SHAPE, description: 'one brief per tip, same order as given' },
    },
  },
} as const;

export async function directScenes(opts: {
  topic: string;
  hook: string;
  tips: { title: string; body: string }[];
  includeContext: boolean;
  avoidMotifs: string[];
}): Promise<ArtDirection | null> {
  const tipList = opts.tips.map((t, i) => `${i + 1}. "${t.title}" — ${t.body}`).join('\n');
  const prompt = `You are the ART DIRECTOR for a premium Mediterranean real-estate agency's Instagram carousels. The copy is already written; your only job is the artwork brief for each slide. These images decide whether the post looks like considered editorial work or random AI output — every one must look THOUGHT THROUGH.

POST TOPIC: "${opts.topic}"
COVER HEADLINE: "${opts.hook}"
TIPS (one slide each):
${tipList}

YOUR PROCESS for every slide, in order:
1. IDEA — one sentence: what must a viewer understand at a glance, seeing only this image?
2. STRATEGY — choose what serves the idea best: quiet irony (a surface that looks perfect with trouble hinted at the margins), a staged still that literally acts out the advice, or a calm single-subject beat. Subtlety beats shock; suggestion beats depiction. MATCH THE TOPIC'S REGISTER: for dream/philosophical/aspirational topics, the scenes are luminous and desirable — morning light, a set table, an open window to the sea — with NO flaws or trouble anywhere; save the hidden-trouble grammar for practical warning topics.
3. SCENE — 20-45 words of concrete, stageable objects. Hero object in the first five words, then 2-4 supporting props. Every object must earn its place in the idea.

THE STANDARD (learn from this example): topic "Some buy a home in Spain. Others buy a renovation." A large hole or crater in a floor is WRONG — image models render damage as surreal voids, and destruction reads cheap. RIGHT is the hidden-trouble version: "a freshly painted white wall, one corner of the new paint lifting to show an older ochre layer beneath, a folded dust sheet and a spirit level resting against the skirting, warm afternoon light" — the house looks good at first glance; the story is in the details.

HARD RULES:
- RENDERABILITY: nothing that needs impossible geometry or large-scale damage. Flaws must be SMALL and peripheral: a hairline crack, one lifted tile corner, a faint damp shadow, peeling paint the size of a hand. NEVER holes, craters, voids, floods, or collapsed anything.
- The COVER must pass the guess-the-topic test: a stranger seeing only it should sense what the post is about. A generic pretty postcard (shuttered window, nice door, plain beach) is a failure unless the topic is literally about it.
- Slide-2 (context) artwork: the topic from a SECOND angle — new hero object, no overlap with the cover.
- Across the deck: every slide a different hero object; one or two tip slides may be quiet simple beats (open sea, a lone olive tree) for rhythm.
- NEVER default to keys, suitcases or luggage unless the tip is literally about them.
- No text or lettering in scenes, no people close-up, no interiors, no building facades that could read as a real property, no recognizable landmarks.${opts.avoidMotifs.length ? `
- Recently used in this agency's posts — do NOT reuse as hero objects: ${opts.avoidMotifs.join('; ')}.` : ''}

${opts.includeContext ? 'Provide cover, context, and one brief per tip.' : 'Provide cover and one brief per tip (no context slide).'}
Submit with the submit_art_direction tool.`;

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: HDRS,
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 2500,
        tools: [DIRECT_TOOL], tool_choice: { type: 'tool', name: 'submit_art_direction' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = data.content?.find((c) => c.type === 'tool_use')?.input as {
      cover?: ArtBrief; context?: ArtBrief; tips?: ArtBrief[];
    } | undefined;
    const okBrief = (b: unknown): b is ArtBrief =>
      !!b && typeof (b as ArtBrief).idea === 'string' && typeof (b as ArtBrief).scene === 'string' &&
      (b as ArtBrief).scene.trim().length >= 15;
    if (!input || !okBrief(input.cover) || !Array.isArray(input.tips)) return null;
    const tips = input.tips.filter(okBrief).slice(0, opts.tips.length);
    if (tips.length !== opts.tips.length) return null;
    return {
      cover: input.cover,
      context: opts.includeContext && okBrief(input.context) ? input.context : null,
      tips,
    };
  } catch {
    return null;
  }
}

const CRITIQUE_TOOL = {
  name: 'submit_review',
  description: 'Submit the artwork review verdict.',
  input_schema: {
    type: 'object' as const,
    required: ['acceptable'],
    properties: {
      acceptable: { type: 'boolean', description: 'true only if the image is glitch-free, reads as the intended idea, and looks considered' },
      problem: { type: 'string', description: 'when not acceptable: the concrete problem, one short sentence (what to avoid on the retry)' },
    },
  },
} as const;

/** Look at ONE generated artwork before the customer does. null = reviewer unavailable (accept). */
export async function critiqueArtwork(png: Buffer, idea: string, scene: string): Promise<{ acceptable: boolean; problem: string } | null> {
  try {
    const jpeg = await sharp(png).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const res = await fetch(API, {
      method: 'POST',
      headers: HDRS,
      body: JSON.stringify({
        model: 'claude-sonnet-5', max_tokens: 300,
        tools: [CRITIQUE_TOOL], tool_choice: { type: 'tool', name: 'submit_review' },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
            { type: 'text', text: `You are reviewing ONE AI-generated illustration for a premium real-estate Instagram slide, BEFORE it is shown to the client.

INTENDED IDEA: ${idea}
SCENE BRIEF: ${scene}

REJECT if any of these:
- a visual glitch: impossible geometry, melted or warped objects, unexplained voids or hole-like shapes, floating elements, accidental letters or text-like marks
- the image does not communicate the intended idea — a viewer would call it a random pretty picture
- it reads cheap, cluttered or accidental instead of deliberately composed

Minor imperfections and loose artistic style are FINE — this is illustration, not photography. Judge harshly on glitches and on whether the idea lands. Submit with submit_review.` },
          ],
        }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const input = data.content?.find((c) => c.type === 'tool_use')?.input as { acceptable?: unknown; problem?: unknown } | undefined;
    if (!input || typeof input.acceptable !== 'boolean') return null;
    return { acceptable: input.acceptable, problem: typeof input.problem === 'string' ? input.problem : '' };
  } catch {
    return null;
  }
}
