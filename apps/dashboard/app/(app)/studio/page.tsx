import { apiFetch } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";

import { StudioHome } from "./studio-home";

export const dynamic = "force-dynamic";
// Editing a finished carousel re-renders every slide on the API and waits for the result — the
// only synchronous request in the Studio. On the platform default (10s) that call was being cut
// off before it could answer, which is why "Apply colours" and "Apply changes" appeared to do
// nothing. Slide uploads are now parallel (~4s), and this gives the action real headroom.
export const maxDuration = 60;

type LibraryItem = {
  id: string;
  image_url: string;
  generation_type: string;
  content_type: string | null;
  created_at: string;
  section?: string | null;
};

type Quota = {
  used?: number;
  quota?: number | null;
  remaining?: number | null;
  plan_tier?: string;
  unlimited?: boolean;
} | null;

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
  let quota: Quota = null;

  // Library + quota both fetched for first paint; either failing is non-fatal
  // (the wizard still works and refetches after each generation).
  // Christian 2026-08-31: "i had to set the colors myself in the custom section." The custom
  // colour pickers started on stock values, so the three he did not retype (accent, paper, ink)
  // silently used #c8a24b / #f4f1ea / #333333 instead of the brand he had just saved in Settings.
  // Fetched here, in parallel with the two calls the page already makes, so it costs nothing.
  const [libRes, quotaRes, brandRes] = await Promise.allSettled([
    apiFetch<{ ok: boolean; items?: LibraryItem[] }>("/api/studio/library"),
    apiFetch<{ ok: boolean; quota?: Quota }>(
      "/api/v1/images/quota?type=social_post",
    ),
    apiFetch<{ branding?: { primary_color?: string | null; accent_color?: string | null;
      background_color?: string | null; text_color?: string | null } }>("/api/v1/settings"),
  ]);
  const b = brandRes.status === "fulfilled" ? brandRes.value.branding : undefined;
  const brand = {
    main: b?.primary_color || "#1a2b4a",
    accent: b?.accent_color || "#c8a24b",
    paper: b?.background_color || "#f4f1ea",
    ink: b?.text_color || "#333333",
  };

  if (
    libRes.status === "fulfilled" &&
    libRes.value.ok &&
    Array.isArray(libRes.value.items)
  ) {
    library = libRes.value.items;
  }
  if (quotaRes.status === "fulfilled" && quotaRes.value.ok) {
    quota = quotaRes.value.quota ?? null;
  }

  // Greeting line for the page header (mirrors the topbar's own logic).
  const ctx = await getCurrentUserContext();
  const rawName = ctx?.email.split("@")[0]?.split(".")[0] ?? "";
  const firstName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "";
  const agencyName = ctx?.activeAgency?.agency.displayName ?? "";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <StudioHome
      brand={brand}
      initialLibrary={library}
      quota={quota}
      firstName={firstName}
      agencyName={agencyName}
      greeting={greeting}
      uiLanguage={ctx?.uiLanguage ?? "es"}
    />
  );
}
