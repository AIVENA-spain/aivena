import { supabaseAdmin } from './supabase-admin';

// TIPS IMAGE LIBRARY (Christian-approved 2026-07-17): the pre-seeded, human-approved generated-image
// families behind the eight AI-imagery tips styles. Each style owns THREE scenes (cover hero, context,
// mid-deck moment) living in storage — generated once via KIE, approved by Christian, reused across
// every agency, language and repost at zero marginal cost. The engine grades them at composite time.
// HONESTY HARD GUARD: these images are reachable ONLY through the tips flow — the listing renderers
// never see this library, so a generated image can never stand in for a property photo.

const BUCKET = 'generated-images';
const LIBRARY_PREFIX = 'carousel/_library';

/** The three scene files per style, in deck order (cover, context, mid-deck). */
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

// per-process cache — the library is immutable once seeded, so downloads happen once per boot
const cache = new Map<string, Buffer[]>();

/** Load a style's 3-image family from the seeded library. Null on ANY miss — the caller falls back
 *  to the editorial (type-only) deck; a missing image must never block or delay a post. */
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
