"use server";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Server actions for the Studio wizard. Each is a thin pass-through to the Hono
 * /api/studio/* proxy (which holds the secret + resolves the agency). We
 * preserve the { ok, error?, message?, ...data } envelope: the EF already wrote
 * a friendly `message` for every failure, so on an ApiError we surface
 * `message` (never `error`/raw text) — Law-2.
 */

type Envelope = Record<string, unknown> & { ok: boolean; error?: string; message?: string };

const GENERIC = "Something went wrong. Please try again.";

async function call(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Envelope> {
  try {
    const data = await apiFetch<Envelope>(path, {
      method: init?.method ?? "GET",
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { ...data, ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      // The proxy/EF body rides on ApiError — message is the friendly line,
      // and the JSON `error` code (quota_unavailable, revision_limit_reached…)
      // is preserved for the UI's specific handling.
      const body = (err.body ?? {}) as Partial<Envelope>;
      return {
        ok: false,
        error: typeof body.error === "string" ? body.error : "request_failed",
        message: typeof body.message === "string" ? body.message : GENERIC,
        ...body,
      };
    }
    console.error(`[studio-wizard] ${path} failed:`, err);
    return { ok: false, error: "network", message: GENERIC };
  }
}

export type DesignChoices = {
  generation_type: "ad_creative" | "social_post" | "renovation";
  // content_type/composition/dimensions are omitted for renovation (no overlay).
  content_type?: "listing" | "brand" | "educational" | "sold" | "launch";
  composition?: string;
  text_treatment?: string;
  font_set?: string;
  color_treatment?: string;
  source_property_id?: string;
  image_urls?: string[];
  image_storage_paths?: string[];
  source_image_url?: string;
  width?: number;
  height?: number;
  language?: string;
  headline?: string;
  kicker?: string;
  cta_text?: string;
  tagline?: string;
  badge_text?: string;
  bullets?: string[];
  stats?: { label: string; value: string }[];
  /** Display-ready price string for sold/launch (e.g. "450.000 €"). */
  price_text?: string;
  mood?: string;
  prompt?: string;
  /** "none" for renovation — tells the EF to skip the marketing overlay. */
  template?: string;
};

export async function previewAction(choices: DesignChoices): Promise<Envelope> {
  return call("/api/studio/preview", { method: "POST", body: choices });
}

export async function generateAction(choices: DesignChoices): Promise<Envelope> {
  return call("/api/studio/generate", { method: "POST", body: choices });
}

export async function reviseAction(
  generationId: string,
  editNote: string,
): Promise<Envelope> {
  return call("/api/studio/revise", {
    method: "POST",
    body: { generation_id: generationId, edit_note: editNote },
  });
}

export async function statusAction(id: string): Promise<Envelope> {
  return call(`/api/studio/status/${encodeURIComponent(id)}`);
}

export async function libraryAction(): Promise<Envelope> {
  return call("/api/studio/library");
}

export async function propertiesAction(q?: string): Promise<Envelope> {
  const suffix = q && q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
  return call(`/api/studio/properties${suffix}`);
}

export async function propertyPhotosAction(id: string): Promise<Envelope> {
  return call(`/api/studio/properties/${encodeURIComponent(id)}/photos`);
}

// ── editable-template engine (the 18 accepted strip-plate templates) ──────────
export async function editableTemplatesAction(): Promise<Envelope> {
  return call("/api/studio/editable-templates");
}

export async function editableDefaultsAction(templateId: string, propertyId: string): Promise<Envelope> {
  return call(
    `/api/studio/editable-defaults?template_id=${encodeURIComponent(templateId)}&property_id=${encodeURIComponent(propertyId)}`,
  );
}

export type EditablePreviewInput = {
  template_id: string;
  property_id: string;
  photos?: string[];
  text_overrides?: Record<string, string>;
  manual_colours?: Record<string, string>; // manual mode: per-layer wheel
  brand?: { navy: string; gold: string; cream: string; text: string }; // auto mode: a tapped scheme
  colour_overrides?: Record<string, string>;
};
export async function editablePreviewAction(input: EditablePreviewInput): Promise<Envelope> {
  return call("/api/studio/editable-preview", { method: "POST", body: input });
}
