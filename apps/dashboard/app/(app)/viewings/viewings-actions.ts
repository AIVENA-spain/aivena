"use server";

import { revalidatePath } from "next/cache";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { LeadPickerRow } from "@/lib/api/types";

const GENERIC =
  "Something went wrong saving that viewing — please try again, and contact support if it persists.";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(scope: string, err: unknown): { ok: false; error: string } {
  const detail =
    err instanceof ApiError
      ? `${err.status} ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[viewings] ${scope} failed:`, detail);
  if (err instanceof ApiError && err.status < 500 && err.message) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: GENERIC };
}

export type ViewingInput = {
  lead_id?: string;
  scheduled_at?: string;
  duration_minutes?: number;
  property_id?: string | null;
  location?: string | null;
  agent_name?: string | null;
  notes?: string | null;
};

export async function createViewingAction(
  input: ViewingInput,
): Promise<Result<{ bookingId: string }>> {
  try {
    const res = await apiFetch<{ ok: true; bookingId: string }>(
      "/api/v1/bookings",
      { method: "POST", body: JSON.stringify(input) },
    );
    revalidatePath("/viewings");
    return { ok: true, data: { bookingId: res.bookingId } };
  } catch (err) {
    return fail("create", err);
  }
}

export async function updateViewingAction(
  bookingId: string,
  input: ViewingInput,
): Promise<Result<{ bookingId: string }>> {
  try {
    const res = await apiFetch<{ ok: true; bookingId: string }>(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    revalidatePath("/viewings");
    return { ok: true, data: { bookingId: res.bookingId } };
  } catch (err) {
    return fail("update", err);
  }
}

export async function cancelViewingAction(
  bookingId: string,
  reason: string | null,
): Promise<Result<{ bookingId: string }>> {
  try {
    const res = await apiFetch<{ ok: true; bookingId: string }>(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`,
      { method: "POST", body: JSON.stringify({ reason }) },
    );
    revalidatePath("/viewings");
    return { ok: true, data: { bookingId: res.bookingId } };
  } catch (err) {
    return fail("cancel", err);
  }
}

export async function searchLeadsAction(
  q: string,
): Promise<Result<LeadPickerRow[]>> {
  try {
    const res = await apiFetch<{ leads: LeadPickerRow[] }>(
      `/api/v1/bookings/lead-search?q=${encodeURIComponent(q)}`,
    );
    return { ok: true, data: res.leads ?? [] };
  } catch (err) {
    return fail("lead-search", err);
  }
}

export async function quickCreateLeadAction(input: {
  full_name: string;
  email?: string | null;
  phone?: string | null;
}): Promise<Result<LeadPickerRow>> {
  try {
    const res = await apiFetch<{ ok: true; lead: LeadPickerRow }>(
      "/api/v1/bookings/quick-lead",
      { method: "POST", body: JSON.stringify(input) },
    );
    return { ok: true, data: res.lead };
  } catch (err) {
    return fail("quick-lead", err);
  }
}
