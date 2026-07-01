"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, ApiError } from "@/lib/api/client";
import type {
  AdminAgenciesResponse,
  AdminAgencyDetail,
  AdminAgencyListItem,
  CreateAgencyInput,
  CreateAgencyResult,
  SlugCheckResult,
} from "@/lib/api/admin-types";
import type { ReadinessResponse } from "@/lib/api/types";

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

/**
 * Staff read of a TARGET agency's go-live readiness (C4). Backed by the
 * staff-only GET /api/v1/admin/agencies/:id/readiness — which recomputes the B2
 * model for :id server-side, so the panel reads the selected agency (never the
 * caller's). Read-only.
 */
export async function getAgencyReadinessAction(
  id: string,
): Promise<ActionResult<ReadinessResponse>> {
  try {
    const res = await apiFetch<ReadinessResponse>(
      `/api/v1/admin/agencies/${encodeURIComponent(id)}/readiness`,
    );
    return { ok: true, data: res };
  } catch (err) {
    return actionError("getAgencyReadiness", err);
  }
}

/** A blocked (422) go-live attempt keeps the server's honest detail so the UI
 *  can list exactly what's unresolved — it is never flattened to a bare string. */
export type SetPilotStatusResult =
  | { ok: true; data: { pilot_status?: string; from?: string } }
  | { ok: false; error: string; blockedBy?: string[]; missingAttestations?: string[] };

/**
 * Staff sets an agency's pilot lifecycle (C3/C4) via POST
 * /api/v1/admin/agencies/:id/go-live. The server recomputes readiness, enforces
 * the attestations for `live`, records any override, and writes+audits through
 * the SECURITY DEFINER RPC. The BROWSER never decides readiness — a 422 here is
 * surfaced verbatim (blockedBy + missingAttestations) so nothing is faked.
 */
export async function setPilotStatusAction(
  agencyId: string,
  input: {
    target: string;
    attestations?: Record<string, boolean>;
    override?: boolean;
    reason?: string | null;
  },
): Promise<SetPilotStatusResult> {
  try {
    const res = await apiFetch<{ ok: true; pilot_status?: string; from?: string }>(
      `/api/v1/admin/agencies/${encodeURIComponent(agencyId)}/go-live`,
      { method: "POST", body: JSON.stringify(input) },
    );
    revalidatePath(`/admin/agencies/${agencyId}/go-live`);
    revalidatePath(`/admin/agencies/${agencyId}`);
    return { ok: true, data: { pilot_status: res.pilot_status, from: res.from } };
  } catch (err) {
    // 422 = the go-live gate blocked it — carry the structured detail to the UI.
    if (
      err instanceof ApiError &&
      err.status === 422 &&
      err.body &&
      typeof err.body === "object"
    ) {
      const b = err.body as {
        error?: unknown;
        blockedBy?: unknown;
        missingAttestations?: unknown;
      };
      return {
        ok: false,
        error: typeof b.error === "string" ? b.error : "This change was blocked.",
        blockedBy: Array.isArray(b.blockedBy) ? b.blockedBy.map(String) : [],
        missingAttestations: Array.isArray(b.missingAttestations)
          ? b.missingAttestations.map(String)
          : [],
      };
    }
    return actionError("setPilotStatus", err);
  }
}
