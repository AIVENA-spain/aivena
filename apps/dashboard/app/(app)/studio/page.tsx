import { apiFetch } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";

import { StudioHome } from "./studio-home";

export const dynamic = "force-dynamic";

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
  const [libRes, quotaRes] = await Promise.allSettled([
    apiFetch<{ ok: boolean; items?: LibraryItem[] }>("/api/studio/library"),
    apiFetch<{ ok: boolean; quota?: Quota }>(
      "/api/v1/images/quota?type=social_post",
    ),
  ]);

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
      initialLibrary={library}
      quota={quota}
      firstName={firstName}
      agencyName={agencyName}
      greeting={greeting}
    />
  );
}
