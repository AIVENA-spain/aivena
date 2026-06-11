import { apiFetch } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";
import type {
  ContentItemRow,
  ContentItemsResponse,
  PlanTier,
  PropertiesResponse,
  PropertyRow,
  SettingsResponse,
} from "@/lib/api/types";

import { StudioTabs } from "./studio-tabs";

export const dynamic = "force-dynamic";

/**
 * Studio — the W13 image-generation suite. The Create tab generates real images
 * (ad_creative / social_post / renovation) through the Hono /api/v1/images
 * routes → image-generate-create Edge Function, polling the async result; the
 * Library tab reads the agency's content_items. Renovation is €999-tier-gated.
 */
export default async function StudioPage() {
  const ctx = await getCurrentUserContext();
  const agencyId = ctx?.activeAgency?.agencyId ?? null;

  let properties: PropertyRow[] = [];
  let planTier: PlanTier = "starter";
  let library: ContentItemRow[] = [];

  if (agencyId) {
    const [propsRes, settingsRes, contentRes] = await Promise.allSettled([
      apiFetch<PropertiesResponse>(
        `/api/v1/agencies/${encodeURIComponent(agencyId)}/properties`,
      ),
      apiFetch<SettingsResponse>("/api/v1/settings"),
      apiFetch<ContentItemsResponse>("/api/v1/content"),
    ]);
    if (propsRes.status === "fulfilled") properties = propsRes.value.properties;
    if (settingsRes.status === "fulfilled") planTier = settingsRes.value.plan_tier;
    if (contentRes.status === "fulfilled") library = contentRes.value.items;
  }

  return (
    <StudioTabs properties={properties} planTier={planTier} library={library} />
  );
}
