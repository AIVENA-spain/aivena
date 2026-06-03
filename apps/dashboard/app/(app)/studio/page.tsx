import { apiFetch } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";
import type {
  PlanTier,
  PropertiesResponse,
  PropertyRow,
  SettingsResponse,
} from "@/lib/api/types";

import { StudioTabs } from "./studio-tabs";

export const dynamic = "force-dynamic";

/**
 * Studio — the v1.15 image-generation suite (W13a Ad Creative + W13b Social
 * Post + W13c Renovation). This is a fully laid-out, interactive SHELL: you can
 * configure every option; only the final Generate action is gated until Vega
 * ships the `image_generations` table + the kie.ai-backed endpoints. The
 * renovation tab is additionally €999-tier-gated. The property picker reads the
 * agency's live catalog so the shell is real, not faked.
 */
export default async function StudioPage() {
  const ctx = await getCurrentUserContext();
  const agencyId = ctx?.activeAgency?.agencyId ?? null;

  let properties: PropertyRow[] = [];
  let planTier: PlanTier = "starter";

  if (agencyId) {
    const [propsRes, settingsRes] = await Promise.allSettled([
      apiFetch<PropertiesResponse>(
        `/api/v1/agencies/${encodeURIComponent(agencyId)}/properties`,
      ),
      apiFetch<SettingsResponse>("/api/v1/settings"),
    ]);
    if (propsRes.status === "fulfilled") properties = propsRes.value.properties;
    if (settingsRes.status === "fulfilled") planTier = settingsRes.value.plan_tier;
  }

  return <StudioTabs properties={properties} planTier={planTier} />;
}
