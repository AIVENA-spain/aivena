"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, ApiError } from "@/lib/api/client";
import { getCurrentUserContext } from "@/lib/auth/context";

/**
 * Property catalog import actions (§5.17). Thin proxies onto the Hono routes at
 * /api/v1/agencies/:id/property-imports. The CSV file is forwarded as multipart
 * FormData; apiFetch leaves the content-type to fetch so the boundary is set
 * correctly. Errors collapse to a friendly `{ ok: false, error }`.
 */

const CANONICAL_FAILURE =
  "Something went wrong — please try again, and contact support if it keeps happening.";

export type ImportPreview = {
  batchId: string;
  totalRows: number;
  validRows: number;
  matchedColumns: Record<string, string>;
  unmatchedColumns: string[];
  sampleRows: Array<{
    rowNumber: number;
    status: string;
    resolved: Record<string, unknown>;
    errors: string[];
  }>;
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function toError(scope: string, err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[settings/properties] ${scope} failed:`, detail);
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: CANONICAL_FAILURE };
}

async function agencyId(): Promise<string | null> {
  const ctx = await getCurrentUserContext();
  return ctx?.activeAgency?.agencyId ?? null;
}

export async function importPropertiesAction(
  formData: FormData,
): Promise<Ok<ImportPreview> | Err> {
  const id = await agencyId();
  if (!id) return { ok: false, error: "No active agency on your account." };

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { ok: false, error: "Choose a CSV file to import." };
  }

  const forward = new FormData();
  forward.set("file", file);

  try {
    const res = await apiFetch<ImportPreview>(
      `/api/v1/agencies/${encodeURIComponent(id)}/property-imports`,
      { method: "POST", body: forward },
    );
    return { ok: true, data: res };
  } catch (err) {
    return toError("importPropertiesAction", err);
  }
}

export async function confirmImportAction(
  batchId: string,
): Promise<Ok<{ promoted: number; skipped: number }> | Err> {
  const id = await agencyId();
  if (!id) return { ok: false, error: "No active agency on your account." };

  try {
    const res = await apiFetch<{ promoted: number; skipped: number }>(
      `/api/v1/agencies/${encodeURIComponent(id)}/property-imports/${encodeURIComponent(batchId)}/confirm`,
      { method: "POST", body: "{}" },
    );
    revalidatePath("/properties");
    revalidatePath("/settings");
    return { ok: true, data: res };
  } catch (err) {
    return toError("confirmImportAction", err);
  }
}
