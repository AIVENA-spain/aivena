"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type {
  CreateImageResponse,
  ImageGeneration,
  ImageGenerationResponse,
  ImageGenerationsResponse,
  ImageQuota,
} from "@/lib/api/types";

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

// ── Image generation (W13) ────────────────────────────────────────────────

const GEN_GENERIC =
  "Something went wrong generating that image — please try again, and contact support if it persists.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

function genError(scope: string, err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[studio] ${scope} failed:`, detail);
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: GEN_GENERIC };
}

export type GenerateImageInput = {
  generationType: "ad_creative" | "social_post" | "renovation";
  prompt: string;
  sourceImageUrl?: string | null;
  width?: number;
  height?: number;
  sourcePropertyId?: string;
};

export async function generateImageAction(
  input: GenerateImageInput,
): Promise<Result<CreateImageResponse>> {
  try {
    const res = await apiFetch<CreateImageResponse>("/api/v1/images", {
      method: "POST",
      body: JSON.stringify({
        generation_type: input.generationType,
        prompt: input.prompt,
        source_image_url: input.sourceImageUrl ?? undefined,
        width: input.width,
        height: input.height,
        source_property_id: input.sourcePropertyId,
      }),
    });
    return { ok: true, data: res };
  } catch (err) {
    return genError("generateImage", err);
  }
}

export async function getGenerationAction(
  id: string,
): Promise<Result<ImageGeneration>> {
  try {
    const res = await apiFetch<ImageGenerationResponse>(
      `/api/v1/images/${encodeURIComponent(id)}`,
    );
    return { ok: true, data: res.generation };
  } catch (err) {
    return genError("getGeneration", err);
  }
}

export async function listGenerationsAction(): Promise<
  Result<ImageGeneration[]>
> {
  try {
    const res = await apiFetch<ImageGenerationsResponse>("/api/v1/images");
    return { ok: true, data: res.generations ?? [] };
  } catch (err) {
    return genError("listGenerations", err);
  }
}

export async function getImageQuotaAction(
  type: GenerateImageInput["generationType"],
): Promise<ImageQuota | null> {
  try {
    const res = await apiFetch<{ ok: true; quota: ImageQuota | null }>(
      `/api/v1/images/quota?type=${encodeURIComponent(type)}`,
    );
    return res.quota;
  } catch {
    return null;
  }
}
