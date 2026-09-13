"use server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { RescoreDryRun, RescoreExecuteResult, ScoringCheckRun, ShadowStatus } from "./types";

/**
 * Admin → Scoring check. Staff-only twice over: the admin layout returns "not found" to everyone else, and the API
 * routes sit behind requireAivenaStaff, which answers non-staff with 404. The AI key never reaches the dashboard.
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

/** Shadow results: what the scorer made of real conversations. Read-only; it changes nothing. */
export async function getShadowResultsAction(): Promise<Ok<ShadowStatus> | Err> {
  try {
    const res = await apiFetch<ShadowStatus & { ok: boolean; error?: string }>("/api/v1/admin/scoring-shadow");
    return res.ok
      ? { ok: true, data: { agencies: res.agencies ?? [], mode: res.mode, paused: res.paused, runs: res.runs ?? [] } }
      : { ok: false, error: res.error ?? "Could not load the shadow results." };
  } catch {
    return { ok: false, error: "Could not load the shadow results." };
  }
}

/** The go-live re-score dry run: lead by lead, what go-live would do. Read-only. */
export async function getRescoreDryRunAction(): Promise<Ok<RescoreDryRun> | Err> {
  try {
    const res = await apiFetch<RescoreDryRun & { ok: boolean; error?: string }>("/api/v1/admin/scoring-rescore/dry-run");
    return res.ok ? { ok: true, data: res } : { ok: false, error: res.error ?? "Could not prepare the re-score dry run." };
  } catch {
    return { ok: false, error: "Could not prepare the re-score dry run." };
  }
}

/**
 * Go-live re-score (Stage 3c): archives and clears June's legacy scoring data, then scores leads with messages to read.
 * The API refuses unless scoring is live and writing, and requires the explicit confirmation token.
 */
export async function executeRescoreAction(): Promise<Ok<RescoreExecuteResult> | Err> {
  try {
    const res = await apiFetch<RescoreExecuteResult & { ok: boolean; error?: string }>("/api/v1/admin/scoring-rescore/execute", {
      method: "POST",
      body: JSON.stringify({ confirm: "RESCORE" }),
    });
    return res.ok ? { ok: true, data: { results: res.results ?? [] } } : { ok: false, error: res.error ?? "The re-score did not run." };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return { ok: false, error: "Scoring is not live yet. Re-scoring runs only at go-live." };
    return { ok: false, error: "The re-score could not be reached. Run the dry run again to see where it stands." };
  }
}
