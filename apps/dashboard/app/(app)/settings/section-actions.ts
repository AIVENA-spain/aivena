"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, ApiError } from "@/lib/api/client";

/**
 * Server actions for the Settings sections. Each action is a thin proxy onto
 * the corresponding Hono endpoint — the API owns validation + the
 * *_reviewed_at writes; this layer only translates ApiError into a friendly
 * `{ ok: false, error }` shape the section components can render inline.
 */

type ActionOk<T> = { ok: true; data: T };
type ActionErr = { ok: false; error: string };
type ActionResult<T> = ActionOk<T> | ActionErr;

const CANONICAL_FAILURE =
  "Something went wrong saving that — please try again, and contact support if it keeps happening.";

function actionError(scope: string, err: unknown): ActionErr {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[settings] ${scope} failed:`, detail);
  // Surface API-supplied friendly messages (400/404) when present; fall back
  // to the canonical string for anything else (5xx, network blip).
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: CANONICAL_FAILURE };
}

// ---------- branding (+ voice & tone share this save) ----------

export type BrandingPayload = {
  brand_name: string;
  primary_color: string;
  email_signature_name: string;
  email_signature_role: string;
  // tone + brand_voice are intentionally NOT part of the branding save in the
  // pilot view (tone is read-only pending column reconciliation; agency voice
  // is disabled). See settings.ts /branding.
  // Tier-1a contact/links — optional; empty strings persist as NULL server-side.
  phone: string;
  whatsapp_number: string;
  website_url: string;
  booking_url: string;
  office_address: string;
  city: string;
  region: string;
  country: string;
  instagram_url: string;
  facebook_url: string;
  linkedin_url: string;
};

export async function saveBrandingAction(
  payload: BrandingPayload,
): Promise<ActionResult<{ ok: true }>> {
  try {
    await apiFetch<{ ok: true }>("/api/v1/settings/branding", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    revalidatePath("/settings");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return actionError("saveBrandingAction", err);
  }
}

// ---------- sending identity (reply_to only) ----------

export async function saveIdentityAction(
  reply_to: string,
): Promise<ActionResult<{ ok: true }>> {
  try {
    await apiFetch<{ ok: true }>("/api/v1/settings/identity", {
      method: "POST",
      body: JSON.stringify({ reply_to }),
    });
    revalidatePath("/settings");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return actionError("saveIdentityAction", err);
  }
}

// ---------- working hours (7-day shape) ----------

export type DaySlotPayload = { enabled: boolean; start: string; end: string };
export type WorkingHoursPayload = {
  working_hours: {
    monday: DaySlotPayload;
    tuesday: DaySlotPayload;
    wednesday: DaySlotPayload;
    thursday: DaySlotPayload;
    friday: DaySlotPayload;
    saturday: DaySlotPayload;
    sunday: DaySlotPayload;
    timezone: string;
  };
  timezone: string;
};

export async function saveWorkingHoursAction(
  payload: WorkingHoursPayload,
): Promise<ActionResult<{ ok: true }>> {
  try {
    await apiFetch<{ ok: true }>("/api/v1/settings/working-hours", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    revalidatePath("/settings");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return actionError("saveWorkingHoursAction", err);
  }
}

// ---------- AI rules (4 toggles → reply_rules.dashboard_toggles) ----------

export type AiRulesPayload = {
  draft_replies_auto: boolean;
  auto_send_cold: boolean;
  require_approval_hot: boolean;
  auto_whatsapp_recovery: boolean;
};

export async function saveAiRulesAction(
  payload: AiRulesPayload,
): Promise<ActionResult<AiRulesPayload>> {
  try {
    const res = await apiFetch<{ ok: true; dashboard_toggles: AiRulesPayload }>(
      "/api/v1/settings/ai-rules",
      { method: "POST", body: JSON.stringify(payload) },
    );
    revalidatePath("/settings");
    return { ok: true, data: res.dashboard_toggles };
  } catch (err) {
    return actionError("saveAiRulesAction", err);
  }
}

// ---------- AI rules v2 (level + overrides → reply_rules lanes) ----------

export type ReplyLanesPayload = {
  level: "none" | "cold" | "cold_warm" | "all";
  overrides: {
    scheduling: boolean;
    followup: boolean;
    email: boolean;
    whatsapp: boolean;
  };
};

export async function saveReplyLanesAction(
  payload: ReplyLanesPayload,
): Promise<ActionResult<unknown>> {
  try {
    const res = await apiFetch<{ ok: true; reply_lanes: unknown }>(
      "/api/v1/settings/reply-lanes",
      { method: "POST", body: JSON.stringify(payload) },
    );
    revalidatePath("/settings");
    return { ok: true, data: res.reply_lanes };
  } catch (err) {
    return actionError("saveReplyLanesAction", err);
  }
}

// ---------- supported languages ----------

export async function saveLanguagesAction(
  supported_languages: string[],
): Promise<ActionResult<{ supported_languages: string[] }>> {
  try {
    const res = await apiFetch<{ ok: true; supported_languages: string[] }>(
      "/api/v1/settings/languages",
      { method: "POST", body: JSON.stringify({ supported_languages }) },
    );
    revalidatePath("/settings");
    return { ok: true, data: { supported_languages: res.supported_languages } };
  } catch (err) {
    return actionError("saveLanguagesAction", err);
  }
}

// ---------- agency-level languages (translation target + display default) ----

/**
 * Writes the agency-level single-language fields (v1.14.4 / v1.14.5):
 * translation_target_language and/or dashboard_display_language. Distinct from
 * the per-user ui_language in /me/preferences — this is agency scope. Pass only
 * the field(s) you want to change.
 */
export async function saveAgencyLanguagesAction(payload: {
  translation_target_language?: string;
  dashboard_display_language?: string;
}): Promise<
  ActionResult<{
    translation_target_language: string;
    dashboard_display_language: string;
  }>
> {
  try {
    const res = await apiFetch<{
      ok: true;
      translation_target_language: string;
      dashboard_display_language: string;
    }>("/api/v1/settings/agency-languages", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return {
      ok: true,
      data: {
        translation_target_language: res.translation_target_language,
        dashboard_display_language: res.dashboard_display_language,
      },
    };
  } catch (err) {
    return actionError("saveAgencyLanguagesAction", err);
  }
}

// ---------- logo upload (forwards base64 to Vega's Edge Function) ----------

export type LogoPayload = {
  filename: string;
  content_type: string;
  content_base64: string;
};

export async function uploadLogoAction(
  payload: LogoPayload,
): Promise<
  ActionResult<{
    branding: { logo_url: string | null } | null;
  }>
> {
  try {
    const res = await apiFetch<{
      ok: true;
      branding: { logo_url: string | null } | null;
    }>("/api/v1/settings/logo", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    revalidatePath("/settings");
    return { ok: true, data: { branding: res.branding } };
  } catch (err) {
    return actionError("uploadLogoAction", err);
  }
}

// ---------- invitations (Phase 1: real INSERT, plain stubs for revoke/resend) ----------

export type InvitationCreated = {
  invitation_id: string;
  token: string;
  expires_at: string;
  sent: boolean;
};

export type CreateInvitationFailure = {
  ok: false;
  error_code: string;
  email?: string;
  error: string;
};
export type CreateInvitationResult =
  | { ok: true; data: InvitationCreated }
  | CreateInvitationFailure;

export async function createInvitationAction(
  email: string,
  role: "agent" | "viewer",
): Promise<CreateInvitationResult> {
  try {
    const res = await apiFetch<InvitationCreated>("/api/v1/invitations", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    revalidatePath("/settings");
    return { ok: true, data: res };
  } catch (err) {
    // We want the structured {error_code, email} from create_invitation
    // mapping so the modal can localize. ApiError already carries the parsed
    // body — pluck it out, falling back to a generic shape if it isn't a
    // typed ApiError.
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[settings] createInvitationAction failed:", detail);
    if (err instanceof ApiError && err.body && typeof err.body === "object") {
      const body = err.body as Record<string, unknown>;
      return {
        ok: false,
        error_code:
          typeof body.error_code === "string" ? body.error_code : "unknown",
        email: typeof body.email === "string" ? body.email : undefined,
        error: typeof body.error === "string" ? body.error : err.message,
      };
    }
    return { ok: false, error_code: "unknown", error: CANONICAL_FAILURE };
  }
}

export async function revokeInvitationAction(
  invitationId: string,
): Promise<ActionResult<{ revoked: boolean; revoked_at: string }>> {
  try {
    const res = await apiFetch<{ revoked: boolean; revoked_at: string }>(
      `/api/v1/invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: "POST", body: "{}" },
    );
    revalidatePath("/settings");
    return { ok: true, data: res };
  } catch (err) {
    return actionError("revokeInvitationAction", err);
  }
}

export async function resendInvitationAction(
  invitationId: string,
): Promise<ActionResult<{ resent: boolean; sent_at: string; attempts: number }>> {
  try {
    const res = await apiFetch<{ resent: boolean; sent_at: string; attempts: number }>(
      `/api/v1/invitations/${encodeURIComponent(invitationId)}/resend`,
      { method: "POST", body: "{}" },
    );
    revalidatePath("/settings");
    return { ok: true, data: res };
  } catch (err) {
    return actionError("resendInvitationAction", err);
  }
}

// ---------- property feed (catalogue import config; P3-A) ----------
// The agency's own property feed → catalogue import + scheduled resync. This is CATALOGUE data
// (the agency's listings), NOT a lead/message channel — AIVENA never messages portal leads.

export type FeedConfig = {
  feed_url: string | null;
  sync_interval_hours: number | null;
  sync_enabled: boolean | null;
  feed_format: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  properties_found_last_run: number | null;
};

export type FeedConfigPayload = {
  feed_url: string;
  sync_enabled: boolean;
  sync_interval_hours: number;
};

export async function saveFeedConfigAction(
  payload: FeedConfigPayload,
): Promise<ActionResult<FeedConfig>> {
  try {
    const res = await apiFetch<{ ok: true; config: FeedConfig }>("/api/v1/settings/feed", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    revalidatePath("/settings");
    return { ok: true, data: res.config };
  } catch (err) {
    return actionError("saveFeedConfigAction", err);
  }
}

// ---------- Google Calendar connect / disconnect (Packet 2 · L2) ----------
// Thin proxies onto the calendar OAuth endpoints. Connect returns the Google
// consent URL for the browser to navigate to (the API signs the state with the
// authed agency id); disconnect revokes via the SECURITY DEFINER revoke RPC.

export async function getCalendarConnectUrlAction(): Promise<ActionResult<{ url: string }>> {
  try {
    const res = await apiFetch<{ ok: true; url: string }>("/api/v1/calendar/google/connect");
    return { ok: true, data: { url: res.url } };
  } catch (err) {
    return actionError("getCalendarConnectUrlAction", err);
  }
}

export async function disconnectCalendarAction(): Promise<ActionResult<{ ok: true }>> {
  try {
    await apiFetch<{ ok: true }>("/api/v1/calendar/google/disconnect", {
      method: "POST",
      body: "{}",
    });
    revalidatePath("/settings");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return actionError("disconnectCalendarAction", err);
  }
}

// ── Amanda auto-mode (design §6): settings + screened knowledge ───────────────

export async function saveAmandaSettingsAction(input: {
  viewing_duration_min?: number;
  viewing_notice_hours?: number;
  viewing_hours_by_weekday?: Record<string, number[]>;
  blocked_dates?: string[];
  blocked_slots?: Array<{ date: string; from: number; to: number }>;
  calendar_notes?: Array<{ date: string; from: number; to: number; note: string }>;
}): Promise<ActionResult<{ ok: true }>> {
  try {
    await apiFetch<{ ok: true }>("/api/v1/amanda/settings", {
      method: "POST",
      body: JSON.stringify(input),
    });
    revalidatePath("/settings");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return actionError("saveAmandaSettingsAction", err);
  }
}

/** Add a knowledge entry — the API scrubs at save time (design §5) and a
 *  rejection carries a `reason` key the card maps to friendly copy. */
export async function addAmandaKnowledgeAction(
  content: string,
): Promise<ActionResult<{ id: string; content: string; createdAt: string }> | { ok: false; error: string; reason: string }> {
  try {
    const res = await apiFetch<{ ok: true; entry: { id: string; content: string; status: string; createdAt: string } }>(
      "/api/v1/amanda/knowledge",
      { method: "POST", body: JSON.stringify({ content }) },
    );
    revalidatePath("/settings");
    return { ok: true, data: { id: res.entry.id, content: res.entry.content, createdAt: res.entry.createdAt } };
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      const body = err.body as { reason?: unknown } | null;
      const reason = body && typeof body.reason === "string" ? body.reason : "rejected";
      return { ok: false, error: "rejected", reason };
    }
    return actionError("addAmandaKnowledgeAction", err);
  }
}

export async function removeAmandaKnowledgeAction(id: string): Promise<ActionResult<{ ok: true }>> {
  try {
    await apiFetch<{ ok: true }>(`/api/v1/amanda/knowledge/${encodeURIComponent(id)}/remove`, {
      method: "POST",
      body: "{}",
    });
    revalidatePath("/settings");
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return actionError("removeAmandaKnowledgeAction", err);
  }
}
