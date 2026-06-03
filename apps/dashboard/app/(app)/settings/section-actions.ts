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
  tone: string | null;
  brand_voice: string;
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
