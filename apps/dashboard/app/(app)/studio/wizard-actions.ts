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
  /** SMART only: KIE composes the whole post (layout + text) from every selected photo. */
  design_mode?: boolean;
  /** KIE aspect enum (square_hd | portrait_4_3 | portrait_16_9 | landscape_16_9 | …). Smart only. */
  image_size?: string;
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
  // interactive editor: move a text block (canvas-px top-left) / resize it (canvas-px font size)
  position_overrides?: Record<string, { x: number; y: number }>;
  size_overrides?: Record<string, number>;
  // KIE finishing pass: render the template with the CLEANED photos instead of the raw listing ones
  cleaned_generation_ids?: string[];
  // move/crop a photo inside its frame: { [photoIndex]: { zoom, x, y } }
  photo_transforms?: Record<number, { zoom?: number; x?: number; y?: number }>;
};

// ── KIE finishing pass: hand each chosen photo to KIE (watermark removal + the asked-for aesthetic
// changes). KIE only ever touches the images — the template + text stay deterministic. One job per photo;
// poll each with statusAction, then re-render with cleaned_generation_ids.
export type FinishJob = { photo: string; generation_id: string | null; error: string | null };
export async function editableFinishAction(
  propertyId: string,
  photos: string[],
  note?: string,
): Promise<Envelope> {
  return call("/api/studio/editable-finish", {
    method: "POST",
    body: { property_id: propertyId, photos, note: note?.trim() || undefined },
  });
}
export async function editablePreviewAction(input: EditablePreviewInput): Promise<Envelope> {
  return call("/api/studio/editable-preview", { method: "POST", body: input });
}

// ── Templates gallery: the render PLAN (top listings + neutral+accent per template) ──
export async function editableGalleryAction(): Promise<Envelope> {
  return call("/api/studio/editable-gallery");
}

// ── Save a template render to the library (records a row; optional section) ─────
export type EditableGenerateInput = EditablePreviewInput & { section?: string | null };
export async function editableGenerateAction(input: EditableGenerateInput): Promise<Envelope> {
  return call("/api/studio/editable-generate", { method: "POST", body: input });
}

// ── Translate the typed slot copy into the post's output language (DeepL auto-detects source) ──
export async function translateSlotsAction(
  texts: Record<string, string>,
  targetLang: string,
): Promise<Envelope> {
  return call("/api/studio/translate-slots", { method: "POST", body: { texts, target_lang: targetLang } });
}

// ── SMART v2: Claude designs the layout, the engine draws it (photos stay photos, facts stay facts) ──
export async function smartDesignAction(input: {
  property_id: string; photos: string[]; size: string; brief?: string; clean_photos?: boolean;
}): Promise<Envelope> {
  return call("/api/studio/smart-design", { method: "POST", body: input });
}
// ── CAROUSEL: deterministic multi-slide post (cover + photo slides + CTA card) ──
export async function carouselAction(input: {
  type?: "listing" | "tips" | "quote";
  property_id?: string;
  photos?: string[];
  topic?: string;
  quote_text?: string;
  quote_author?: string;
  slide_count?: number;
  language?: string;
  style?: string;
  scheme?: string;
  slides?: number;
}): Promise<Envelope> {
  return call("/api/studio/carousel", { method: "POST", body: input });
}
export async function carouselStyleExamplesAction(): Promise<Envelope> {
  return call("/api/studio/carousel/style-examples");
}
export async function carouselUpdateAction(generationId: string, plan: unknown): Promise<Envelope> {
  return call("/api/studio/carousel/update", { method: "POST", body: { generation_id: generationId, plan } });
}
// GET INSPIRED: 6 fresh tips-carousel topic ideas (free; exclude = already-shown ideas)
export async function carouselTopicIdeasAction(language: string, exclude: string[]): Promise<Envelope> {
  return call("/api/studio/carousel/topic-ideas", { method: "POST", body: { language, exclude } });
}
// SUGGESTED FOR TODAY: the Studio-home suggestion row (a carousel topic + a real listing + a room nudge)
export async function studioSuggestionsAction(): Promise<Envelope> {
  return call("/api/studio/suggestions");
}
// OTRA VUELTA: one-axis remix of a finished tips carousel (hook | style | layout) — free, lands as a new generation
export async function carouselRemixAction(generationId: string, axis: "hook" | "style" | "layout"): Promise<Envelope> {
  return call("/api/studio/carousel/remix", { method: "POST", body: { generation_id: generationId, axis } });
}
export async function smartReviseAction(generationId: string, editNote: string): Promise<Envelope> {
  return call("/api/studio/smart-design/revise", {
    method: "POST",
    body: { generation_id: generationId, edit_note: editNote },
  });
}

// ── Library sections (the agency's own buckets) + filing an existing creation ───
export async function editableSectionsAction(): Promise<Envelope> {
  return call("/api/studio/editable-sections");
}
export async function setSectionAction(generationId: string, section: string | null): Promise<Envelope> {
  return call("/api/studio/set-section", { method: "POST", body: { generation_id: generationId, section } });
}
