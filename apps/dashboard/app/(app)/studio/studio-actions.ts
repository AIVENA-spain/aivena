"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Mints a signed upload URL for a Studio reference image. Only metadata
 * (contentType) crosses the Server Action — the file bytes go client-direct to
 * storage with the returned token, so the 1MB Server Action body cap never
 * applies. Errors collapse to a friendly string.
 */
const GENERIC =
  "Couldn't upload that image — please try again, and contact support if it keeps happening.";

export async function createStudioUploadUrlAction(
  contentType: string,
): Promise<
  | { ok: true; path: string; token: string; publicUrl: string }
  | { ok: false; error: string }
> {
  try {
    const res = await apiFetch<{ path: string; token: string; publicUrl: string }>(
      "/api/v1/studio/upload-url",
      { method: "POST", body: JSON.stringify({ contentType }) },
    );
    return { ok: true, ...res };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[studio] createStudioUploadUrlAction failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC };
  }
}
