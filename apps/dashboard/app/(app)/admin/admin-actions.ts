"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type {
  AdminAgenciesResponse,
  AdminAgencyDetail,
  AdminAgencyListItem,
  CreateAgencyInput,
  CreateAgencyResult,
  SlugCheckResult,
} from "@/lib/api/admin-types";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type ActionResult<T> = Ok<T> | Err;

const GENERIC =
  "Something went wrong — please try again, and contact support if it persists.";

function actionError(scope: string, err: unknown): Err {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[admin] ${scope} failed:`, detail);
  // Surface the API's own friendly message for client errors (< 500); fall back
  // to the canonical line for server / network errors.
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: GENERIC };
}

export async function listAgenciesAction(filter?: {
  status?: string;
  search?: string;
}): Promise<ActionResult<AdminAgencyListItem[]>> {
  try {
    const params = new URLSearchParams();
    if (filter?.status && filter.status !== "all")
      params.set("status", filter.status);
    if (filter?.search) params.set("search", filter.search);
    const qs = params.toString();
    const res = await apiFetch<AdminAgenciesResponse>(
      `/api/v1/admin/agencies${qs ? `?${qs}` : ""}`,
    );
    return { ok: true, data: res.agencies ?? [] };
  } catch (err) {
    return actionError("listAgencies", err);
  }
}

export async function getAgencyAction(
  id: string,
): Promise<ActionResult<AdminAgencyDetail>> {
  try {
    const res = await apiFetch<AdminAgencyDetail & { ok: true }>(
      `/api/v1/admin/agencies/${encodeURIComponent(id)}`,
    );
    return { ok: true, data: res };
  } catch (err) {
    return actionError("getAgency", err);
  }
}

export async function createAgencyAction(
  input: CreateAgencyInput,
): Promise<ActionResult<CreateAgencyResult>> {
  try {
    const res = await apiFetch<CreateAgencyResult>("/api/v1/admin/agencies", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { ok: true, data: res };
  } catch (err) {
    return actionError("createAgency", err);
  }
}

/**
 * Retry sending an invitation email (wizard success screen, when the first
 * send failed). No token rotation — a plain re-send.
 */
export async function resendInvitationAction(
  agencyId: string,
  invitationId: string,
): Promise<ActionResult<{ email_sent: true }>> {
  try {
    const res = await apiFetch<{ ok: true; email_sent: true }>(
      `/api/v1/admin/agencies/${encodeURIComponent(agencyId)}/invitations/${encodeURIComponent(
        invitationId,
      )}/send`,
      { method: "POST", body: "{}" },
    );
    return { ok: true, data: { email_sent: res.email_sent } };
  } catch (err) {
    return actionError("resendInvitation", err);
  }
}

/**
 * Live slug-availability check for the wizard (debounced client-side). Calls
 * the dedicated /check-slug endpoint, which mirrors the RPC's validation +
 * reserved-word list. On any error we report `available: true` so we never
 * block the user on a transient failure — create is the authoritative guard.
 */
export async function checkSlugAction(slug: string): Promise<SlugCheckResult> {
  const clean = slug.trim().toLowerCase();
  try {
    const res = await apiFetch<SlugCheckResult>(
      `/api/v1/admin/agencies/check-slug?slug=${encodeURIComponent(clean)}`,
    );
    return { available: Boolean(res.available), reason: res.reason ?? null };
  } catch {
    return { available: true };
  }
}
