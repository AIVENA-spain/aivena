import { apiFetch } from "@/lib/api/client";

import { StudioHome } from "./studio-home";

export const dynamic = "force-dynamic";

type LibraryItem = {
  id: string;
  image_url: string;
  generation_type: string;
  content_type: string | null;
  created_at: string;
};

/**
 * Studio (W13 v0.6) — the agent-facing image generator. A Smart/Wizard fork →
 * content type → subject → look-by-sight → live fine-tune → generate → free
 * revisions, all through the Hono /api/studio/* proxy (which holds the secret
 * and resolves the agency). The generation engine lives entirely in Vega's
 * Edge Functions; this is presentation + orchestration only.
 *
 * Server-fetches the finished-image library for the first paint; everything
 * else is interactive.
 */
export default async function StudioPage() {
  let library: LibraryItem[] = [];
  try {
    const res = await apiFetch<{ ok: boolean; items?: LibraryItem[] }>(
      "/api/studio/library",
    );
    if (res.ok && Array.isArray(res.items)) library = res.items;
  } catch {
    // Library is non-critical for first paint — the wizard still works; it
    // refetches after each generation.
  }

  return <StudioHome initialLibrary={library} />;
}
