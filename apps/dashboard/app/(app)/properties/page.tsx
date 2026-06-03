import { apiFetch, ApiError } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";
import { PageLoadError } from "@/components/shell/page-error";
import type { PropertiesResponse, PropertyRow } from "@/lib/api/types";

import { PropertiesView } from "./properties-view";

export const dynamic = "force-dynamic";

/**
 * Properties — first-class catalog page (§5.17). Server-fetches the agency's
 * promoted listings (RLS-scoped via the agency-context tx) and hands them to
 * the client view, which renders the card grid + the inline CSV import.
 */
export default async function PropertiesPage() {
  const ctx = await getCurrentUserContext();
  const agencyId = ctx?.activeAgency?.agencyId ?? null;
  if (!agencyId) return <PageLoadError />;

  let rows: PropertyRow[] = [];
  try {
    const res = await apiFetch<PropertiesResponse>(
      `/api/v1/agencies/${encodeURIComponent(agencyId)}/properties`,
    );
    rows = res.properties;
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/properties] load failed:", detail);
    return <PageLoadError />;
  }

  return <PropertiesView properties={rows} />;
}
