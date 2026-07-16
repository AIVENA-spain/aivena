"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { PrefPatch } from "./buyer-profile-edit-model";

/**
 * Update a buyer lead's editable preferences (location / budget / property type /
 * bedrooms / bathrooms) via PATCH /api/v1/leads/:leadId/preferences. The API's
 * `update_lead_preferences` RPC owns all validation, tenant + role + buyer guards,
 * and it fires the autoembed + automatch triggers — so the recommended properties
 * refresh on their own after a successful save. This layer forwards the API's
 * friendly 4xx text and collapses anything else to one calm line (Law 2 — never
 * surfaces status codes or DB detail).
 */

const GENERIC = "Something went wrong — please try again.";

type Ok = { ok: true };
type Err = { ok: false; error: string };

export async function updateLeadPreferencesAction(
  leadId: string,
  patch: PrefPatch,
): Promise<Ok | Err> {
  try {
    await apiFetch<{ ok: boolean }>(
      `/api/v1/leads/${encodeURIComponent(leadId)}/preferences`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    return { ok: true };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[preferences] update failed:", leadId, detail);
    // API-supplied friendly 4xx messages pass through; anything else → generic.
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC };
  }
}
