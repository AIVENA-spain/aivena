import sharp from 'sharp';
import { supabaseAdmin } from './supabase-admin';
import { critiqueArtwork } from './studio-carousel-art';

// TIPS IMAGE PIPELINE v2 (Christian 2026-07-17): the eight approved styles are ANCHORS, not fixed
// assets. Every tips post generates a FRESH 3-image family conditioned on its style's anchor —
// matched to the post's topic and emotion (the planner writes 3 scene beats), in a choosable colour
// scheme, with natural micro-variation so no two agencies ever post identical artwork. The approved
// seeded family stays as the instant fallback; the editorial type-only deck backstops everything.
// HONESTY HARD GUARD: reachable only from the tips flow; scene prompts forbid interiors/facades/
// landmarks; the engine still draws every word and fact.

const BUCKET = 'generated-images';
const LIBRARY_PREFIX = 'carousel/_library';
const KIE_CREATE = 'https://api.kie.ai/api/v1/jobs/createTask';
const KIE_INFO = 'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=';
const NEG = 'No text, no letters, no numbers, no signage, no logos, no watermarks. No human faces, no hands. ' +
  'No interiors, no building facades, no recognizable landmarks. No lens flare, no neon gradients, no cluttered background.';

/** The three approved scene files per style (cover, context, mid-deck) — anchor + seeded fallback. */
export const TIPS_LIBRARY: Record<string, [string, string, string]> = {
  bodegon: ['bodegon.png', 'bodegon-2.png', 'bodegon-3.png'],
  litoral: ['litoral.png', 'litoral-2.png', 'litoral-3.png'],
  tinta: ['tinta-h.png', 'tinta-2.png', 'tinta-3.png'],
  salitre: ['salitre-h.png', 'salitre-2.png', 'salitre-3.png'],
  papel: ['papel.png', 'papel-2.png', 'papel-3.png'],
  arcilla: ['arcilla.png', 'arcilla-2.png', 'arcilla-3.png'],
  acuarela: ['acuarela.png', 'acuarela-2.png', 'acuarela-3.png'],
  bordado: ['bordado.png', 'bordado-2.png', 'bordado-3.png'],
  pueblo: ['pueblo.png', 'pueblo-2.png', 'pueblo-3.png'],
  mercado: ['mercado.png', 'mercado-2.png', 'mercado-3.png'],
};

/** Colour schemes — all deliberately Spanish-coastal: the longing, the light, the promise. */
/** RULE 11 — ONE artwork medium per deck. Until now the medium existed only as pixels in the
 *  style's anchor image, while the same prompt sentence orders the model AWAY from that
 *  reference ("replace the subject completely") — so every slide drifted on its own and a deck
 *  could come back part painted, part photographic. Naming it in words, in the one prompt
 *  builder, holds all of a deck's slides to the same medium on the first pass and on the
 *  vision-QA retry alike. */
/** RULE 2 — artwork fills its frame or the slide does not ship. The failure we actually get is
 *  a letterboxed generation: a band of flat, near-identical rows (or columns) at an edge, with
 *  the picture squeezed into the rest. Detected on ONE cheap greyscale pass — a leading or
 *  trailing run of rows/columns whose own variation is near zero and whose brightness barely
 *  moves. Returns the fraction of the frame that band eats, 0 when the frame is filled. */
export async function blankBandFraction(buf: Buffer): Promise<number> {
  try {
    const W = 64, H = 80;
    const { data } = await sharp(buf).greyscale().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const rowStat = (r: number) => {
      let sum = 0; for (let x = 0; x < W; x++) sum += data[r * W + x];
      const mean = sum / W;
      let v = 0; for (let x = 0; x < W; x++) v += (data[r * W + x] - mean) ** 2;
      return { mean, sd: Math.sqrt(v / W) };
    };
    const colStat = (c: number) => {
      let sum = 0; for (let y = 0; y < H; y++) sum += data[y * W + c];
      const mean = sum / H;
      let v = 0; for (let y = 0; y < H; y++) v += (data[y * W + c] - mean) ** 2;
      return { mean, sd: Math.sqrt(v / H) };
    };
    const run = (n: number, stat: (i: number) => { mean: number; sd: number }, from: 'start' | 'end') => {
      const first = stat(from === 'start' ? 0 : n - 1);
      if (first.sd > 4) return 0;
      let k = 0;
      for (let i = 0; i < n; i++) {
        const s = stat(from === 'start' ? i : n - 1 - i);
        if (s.sd > 4 || Math.abs(s.mean - first.mean) > 6) break;
        k++;
      }
      return k / n;
    };
    return Math.max(
      run(H, rowStat, 'start'), run(H, rowStat, 'end'),
      run(W, colStat, 'start'), run(W, colStat, 'end'),
    );
  } catch { return 0; }
}

export const TIPS_MEDIUM: Record<string, string> = {
  bodegon: 'a photographic old-master still life, natural dusk light',
  salitre: 'a 35mm editorial film photograph',
  pueblo: 'a natural-light travel photograph',
  mercado: 'a natural-light food and market photograph',
  litoral: 'a painted mid-century travel-poster illustration',
  tinta: 'a two-ink riso-print illustration',
  papel: 'a layered paper-cut illustration',
  arcilla: 'a photograph of a handmade clay miniature scene',
  acuarela: 'a watercolour and ink illustration',
  bordado: 'an embroidered-thread-on-linen illustration',
};

export const TIPS_SCHEMES: Record<string, { label: string; clause: string }> = {
  clasico: { label: 'Clásico', clause: 'Keep exactly the same colour palette as the reference image.' },
  atardecer: { label: 'Atardecer', clause: 'Shift the colour palette to warm terracotta, burnt orange, dusty pink and soft sand — a Spanish sunset — keeping the same Mediterranean warmth and the same amount of calm empty space.' },
  oliva: { label: 'Oliva', clause: 'Shift the colour palette to olive green, sage, warm linen cream and earthy brown — a Spanish olive grove — keeping the same Mediterranean warmth and the same amount of calm empty space.' },
  mar: { label: 'Mar', clause: 'Shift the colour palette to deep sea teal, clear aqua, foam white and pale driftwood sand — the Spanish sea — keeping the same Mediterranean warmth and the same amount of calm empty space.' },
};

// per-process cache for the immutable seeded families
const cache = new Map<string, Buffer[]>();

/** Load a style's APPROVED seeded family — the instant fallback path. Null on any miss. */
export async function loadTipsImages(style: string): Promise<Buffer[] | null> {
  const files = TIPS_LIBRARY[style];
  if (!files) return null;
  const hit = cache.get(style);
  if (hit) return hit;
  try {
    const buffers: Buffer[] = [];
    for (const f of files) {
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(`${LIBRARY_PREFIX}/${style}/${f}`);
      if (error || !data) {
        console.error(`[tips-image] library miss ${style}/${f}:`, error?.message ?? 'empty');
        return null;
      }
      buffers.push(Buffer.from(await data.arrayBuffer()));
    }
    cache.set(style, buffers);
    return buffers;
  } catch (err) {
    console.error('[tips-image] load failed:', (err as Error).message);
    return null;
  }
}

async function kieKey(): Promise<string | null> {
  const { data } = await supabaseAdmin.rpc('_get_platform_secret', { p_name: 'KIE_API_KEY' });
  return typeof data === 'string' && data ? data : null;
}

async function pollTask(key: string, taskId: string, maxMs: number): Promise<Buffer | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const q = await fetch(`${KIE_INFO}${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
      const qj = (await q.json()) as { data?: { state?: string; status?: string; resultJson?: string } };
      const state = qj?.data?.state ?? qj?.data?.status;
      if (state === 'success') {
        const rj = qj?.data?.resultJson ? JSON.parse(qj.data.resultJson) as { resultUrls?: string[] } : null;
        const url = rj?.resultUrls?.[0];
        if (!url) return null;
        return Buffer.from(await (await fetch(url)).arrayBuffer());
      }
      if (state === 'fail' || state === 'failed') return null;
    } catch { /* transient — keep polling */ }
  }
  return null;
}

/**
 * Generate a FRESH per-post image set: one nano-banana-edit task PER SCENE (cover + one per tip),
 * all in parallel, each conditioned on the style's approved anchor (same art, new scene) + the
 * chosen colour scheme. Finished images are copied under the generation so text edits re-render
 * without regenerating. Null on any failure — callers fall back to the seeded family, then editorial.
 */
export async function generateTipsImages(opts: {
  style: string; scheme: string; scenes: string[]; agencyId: string; genId: string;
  // parallel to scenes: the art-director's IDEA per scene — presence turns on the vision reviewer
  // (each image is LOOKED AT before it ships; rejects regenerate once with the problem fed back)
  ideas?: string[];
  // RULE 1: parallel to scenes — the region of each frame the art director keeps quiet, so the
  // image is COMPOSED for its type instead of the type fighting the picture afterwards
  quietZones?: (string | undefined)[];
  /** called with a human-readable reason when artwork could not be produced, so the deck can
   *  record why it fell back to stock images instead of leaving the agent guessing */
  onFail?: (reason: string) => void;
  /** the two colours the agent chose for this deck — the artwork is asked to be built from them
   *  so the pictures belong to the post instead of merely sitting behind it */
  brandColours?: { navy: string; gold: string };
}): Promise<{ buffers: Buffer[]; paths: string[]; qa?: { reviewed: number; regenerated: number; still_flagged: number } } | null> {
  const files = TIPS_LIBRARY[opts.style];
  const scheme = TIPS_SCHEMES[opts.scheme] ?? TIPS_SCHEMES.clasico;
  const scenes = opts.scenes.filter((x) => typeof x === 'string' && x.trim().length >= 10).slice(0, 9);
  if (!files || scenes.length < 1) return null;
  try {
    const key = await kieKey();
    if (!key) return null;
    const signed = await supabaseAdmin.storage.from(BUCKET)
      .createSignedUrl(`${LIBRARY_PREFIX}/${opts.style}/${files[0]}`, 3600);
    const fail = (reason: string) => { console.warn(`[carousel-art] ${reason}`); opts.onFail?.(reason); };
    const anchorUrl = signed.data?.signedUrl;
    if (!anchorUrl) return null;

    const buildPrompt = (si: number, extra = '') => {
      const scene = scenes[si];
      // SUBJECT REPLACEMENT (Christian 2026-07-17: the anchor's motif bled into 3 of 5 slides):
      // keep only the technique; the reference's objects/room/composition must NOT reappear, and
      // each task knows its siblings so the family can't converge on one motif.
      const siblings = scenes.filter((_, j) => j !== si).map((x) => x.split(/[,.]/)[0].trim()).filter(Boolean).slice(0, 8);
      const medium = TIPS_MEDIUM[opts.style] ? `Render this as ${TIPS_MEDIUM[opts.style]}. ` : '';
      // the agent's own two colours, carried INTO the picture: not a filter over it, but the
      // palette the scene is built from, so the artwork and the type belong to the same post
      const chosen = opts.brandColours
        ? `Build the scene's colour world around ${opts.brandColours.navy} and ${opts.brandColours.gold} — these two colours should be clearly present in the objects, light and surfaces, not laid over the image as a tint. `
        : '';
      return `${medium}${chosen}Keep exactly the same artistic style, technique, texture, grain, lighting mood and colour language as this reference image, but REPLACE THE SUBJECT COMPLETELY with a new scene: ${scene}. Render it as ONE deliberately composed still — every object purposeful and clearly readable, arranged with intent, nothing random. Do NOT reuse the reference image's objects, room, window, or composition — only its technique. ${siblings.length ? `Other images in this set show: ${siblings.join('; ')} — this one must be clearly different from all of them. ` : ''}${extra}${opts.brandColours ? '' : scheme.clause} ${opts.quietZones?.[si] ? `Leave the ${opts.quietZones[si]} of the frame QUIET — continuous low-detail ground with no subject, no props and no busy texture there; the deck sets its headline in it.` : 'Keep generous calm empty space for text.'} ${NEG}`;
    };
    const createTask = async (si: number, extra = ''): Promise<string | null> => {
      try {
        const res = await fetch(KIE_CREATE, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'google/nano-banana-edit', input: { prompt: buildPrompt(si, extra), image_urls: [anchorUrl], output_format: 'png' } }),
        });
        const cj = (await res.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
        if (!cj?.data?.taskId) {
          // the artwork service refused this task — say so, instead of returning a bare null and
          // letting the deck silently fall back to stock images with no recorded reason
          fail(`artwork task refused (HTTP ${res.status}, code ${cj?.code ?? '?'}: ${String(cj?.msg ?? 'no message').slice(0, 120)})`);
          return null;
        }
        return cj.data.taskId;
      } catch (e) {
        fail(`artwork service unreachable: ${(e as Error).message.slice(0, 120)}`);
        return null;
      }
    };

    // One artwork, start to finish — used for the frame retry and by the vision-QA retry, so the
    // RULE 2 assert has exactly one place to live and cannot be bypassed.
    const renderOne = async (si: number, extra = ''): Promise<Buffer | null> => {
      const t = await createTask(si, extra);
      if (!t) return null;
      const buf = await pollTask(key, t, 150_000);
      if (!buf) { fail(`slide ${si + 1}: the artwork service returned nothing within the time limit`); return null; }
      const band = await blankBandFraction(buf);
      if (band <= 0.12) return buf;
      console.warn(`[carousel-art] slide ${si + 1}: ${(band * 100).toFixed(0)}% blank band — regenerating to fill the frame`);
      const t2 = await createTask(si, `${extra}IMPORTANT — the previous attempt left a large blank band along one edge. The scene must FILL the entire frame edge to edge, with no border, no letterboxing and no empty band. `);
      const buf2 = t2 ? await pollTask(key, t2, 150_000) : null;
      if (!buf2) return buf;
      return (await blankBandFraction(buf2)) < band ? buf2 : buf;
    };

    // Tasks are created ONE AT A TIME and polled together. Creating them all at once (which is
    // what I changed this to) makes the service refuse the burst, and every refusal came back as
    // a bare null — the deck then fell back to stock artwork with nothing recorded anywhere.
    const taskIds: (string | null)[] = [];
    for (let si = 0; si < scenes.length; si++) taskIds.push(await createTask(si));
    if (taskIds.some((t) => !t)) return null;
    const polled = await Promise.all(taskIds.map((t) => pollTask(key, t!, 150_000)));
    if (polled.some((b) => !b)) { fail('the artwork service did not return every image within the time limit'); return null; }
    const buffers: (Buffer | null)[] = [...polled];
    // RULE 2 — assert each frame is filled; a letterboxed one is re-issued (rare, so sequential)
    for (let si = 0; si < buffers.length; si++) {
      const band = await blankBandFraction(buffers[si]!);
      if (band > 0.12) buffers[si] = (await renderOne(si)) ?? buffers[si];
    }

    // VISION REVIEW (Christian 2026-08-28: "it always looks thought through") — look at every
    // image; a reject regenerates ONCE with the reviewer's problem in the prompt. Reviewer
    // unavailable or retry also flagged → ship what we have; QA never blocks a post.
    const qa = { reviewed: 0, regenerated: 0, still_flagged: 0 };
    if (Array.isArray(opts.ideas) && opts.ideas.length) {
      for (let si = 0; si < buffers.length; si++) {
        const idea = opts.ideas[si];
        if (typeof idea !== 'string' || !idea.trim()) continue;
        const verdict = await critiqueArtwork(buffers[si]!, idea, scenes[si]);
        if (!verdict) continue;
        qa.reviewed++;
        if (verdict.acceptable) continue;
        const retry = await renderOne(si, `IMPORTANT — a previous attempt at this scene was rejected in review: "${verdict.problem}". Avoid that specific problem; render the scene cleanly and unambiguously. `);
        if (retry) {
          qa.regenerated++;
          const second = await critiqueArtwork(retry, idea, scenes[si]);
          if (second && !second.acceptable) {
            qa.still_flagged++;
            // keep whichever the reviewer disliked less is unknowable — prefer the retry (it
            // addressed a named problem)
          }
          buffers[si] = retry;
        } else {
          qa.still_flagged++;
        }
      }
    }

    const paths: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const path = `carousel/${opts.agencyId}/${opts.genId}/src-${i + 1}.png`;
      const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buffers[i]!, { contentType: 'image/png', upsert: true });
      if (up.error) return null;
      paths.push(path);
    }
    return { buffers: buffers as Buffer[], paths, qa };
  } catch (err) {
    console.error('[tips-image] generate failed:', (err as Error).message);
    return null;
  }
}

/** Re-load a generation's own source images (for text edits — never regenerate on an edit). */
export async function loadGenerationImages(paths: string[]): Promise<Buffer[] | null> {
  try {
    const buffers: Buffer[] = [];
    for (const p of paths) {
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(p);
      if (error || !data) return null;
      buffers.push(Buffer.from(await data.arrayBuffer()));
    }
    return buffers;
  } catch {
    return null;
  }
}
