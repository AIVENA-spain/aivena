import { supabaseAdmin } from './supabase-admin';

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
};

/** Colour schemes — all deliberately Spanish-coastal: the longing, the light, the promise. */
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
}): Promise<{ buffers: Buffer[]; paths: string[] } | null> {
  const files = TIPS_LIBRARY[opts.style];
  const scheme = TIPS_SCHEMES[opts.scheme] ?? TIPS_SCHEMES.clasico;
  const scenes = opts.scenes.filter((x) => typeof x === 'string' && x.trim().length >= 10).slice(0, 9);
  if (!files || scenes.length < 1) return null;
  try {
    const key = await kieKey();
    if (!key) return null;
    const signed = await supabaseAdmin.storage.from(BUCKET)
      .createSignedUrl(`${LIBRARY_PREFIX}/${opts.style}/${files[0]}`, 3600);
    const anchorUrl = signed.data?.signedUrl;
    if (!anchorUrl) return null;

    const tasks: (string | null)[] = [];
    for (const scene of scenes) {
      const prompt = `Keep exactly the same artistic style, technique, texture, lighting and composition language as this reference image, but create a different scene: ${scene}. ${scheme.clause} Keep generous calm empty space for text. ${NEG}`;
      const res = await fetch(KIE_CREATE, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'google/nano-banana-edit', input: { prompt, image_urls: [anchorUrl], output_format: 'png' } }),
      });
      const cj = (await res.json()) as { data?: { taskId?: string } };
      tasks.push(cj?.data?.taskId ?? null);
    }
    if (tasks.some((t) => !t)) return null;

    const buffers = await Promise.all(tasks.map((t) => pollTask(key, t!, 150_000)));
    if (buffers.some((b) => !b)) return null;

    const paths: string[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const path = `carousel/${opts.agencyId}/${opts.genId}/src-${i + 1}.png`;
      const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buffers[i]!, { contentType: 'image/png', upsert: true });
      if (up.error) return null;
      paths.push(path);
    }
    return { buffers: buffers as Buffer[], paths };
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
