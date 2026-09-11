"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { ScoringCheckRun } from "./types";

/**
 * Admin → Scoring check. Staff-only twice over: the admin layout returns "not found" to everyone else, and the API
 * route sits behind requireAivenaStaff, which answers non-staff with 404. The AI key never reaches the dashboard.
 */

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function friendly(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "A scoring check is already running. Wait for it to finish.";
    if (err.status === 429) return "Today's limit of 10 scoring checks has been reached.";
    if (err.status === 404) return "That check run is no longer available. Run it again.";
  }
  return "The scoring check could not be reached. Please try again.";
}

export async function startScoringCheckAction(): Promise<Ok<{ runId: string }> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; runId?: string; error?: string }>("/api/v1/admin/scoring-check", {
      method: "POST",
    });
    return res.ok && res.runId ? { ok: true, data: { runId: res.runId } } : { ok: false, error: res.error ?? friendly(null) };
  } catch (err) {
    return { ok: false, error: friendly(err) };
  }
}

export async function getScoringCheckAction(runId: string): Promise<Ok<ScoringCheckRun> | Err> {
  try {
    const res = await apiFetch<{ ok: boolean; run?: ScoringCheckRun; error?: string }>(
      `/api/v1/admin/scoring-check/${encodeURIComponent(runId)}`,
    );
    return res.ok && res.run ? { ok: true, data: res.run } : { ok: false, error: res.error ?? friendly(null) };
  } catch (err) {
    return { ok: false, error: friendly(err) };
  }
}
