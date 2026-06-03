"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Studio image upload — forwards the agent's chosen reference image (multipart)
 * to the Hono studio route, which stores it in the agency-assets bucket and
 * returns its public URL. Errors collapse to a friendly string.
 */
const GENERIC =
  "Upload failed — please try again, and contact support if it keeps happening.";

export async function uploadStudioImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { ok: false, error: "Choose an image to upload." };
  }
  const forward = new FormData();
  forward.set("file", file);
  try {
    const res = await apiFetch<{ url: string }>("/api/v1/studio/uploads", {
      method: "POST",
      body: forward,
    });
    return { ok: true, url: res.url };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[studio] uploadStudioImageAction failed:", detail);
    if (err instanceof ApiError && err.status < 500 && err.message) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: GENERIC };
  }
}
