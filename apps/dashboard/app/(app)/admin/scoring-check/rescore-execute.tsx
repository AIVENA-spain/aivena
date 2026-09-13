"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { executeRescoreAction } from "./actions";
import type { RescoreDryRun, RescoreExecuteResult } from "./types";

/**
 * The go-live button (Stage 3c). Rendered only when the API says scoring is live and writing. Two steps, and the second
 * says exactly what will be written to production before anything runs.
 */
export function RescoreExecute({ totals }: { totals: RescoreDryRun["totals"] }) {
  const [step, setStep] = useState<"idle" | "confirm" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RescoreExecuteResult | null>(null);
  const clears = totals.rescoreAndClearLegacy + totals.clearLegacy;
  const scores = totals.rescoreAndClearLegacy + totals.rescore;

  async function run() {
    setStep("running");
    setError(null);
    const res = await executeRescoreAction();
    if (!res.ok) {
      setError(res.error);
      setStep("confirm");
      return;
    }
    setResult(res.data);
    setStep("done");
  }

  return (
    <Card className="flex flex-col gap-3 px-5 py-4">
      {step === "idle" ? (
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="inline-flex w-fit items-center rounded-md bg-brand px-4 py-2 text-[13px] font-semibold text-brand-fg hover:bg-brand/90"
        >
          Run go-live re-score
        </button>
      ) : null}
      {step === "confirm" || step === "running" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-foreground">
            This writes to production: June data archived and cleared for {clears} lead(s), and {scores} lead(s) scored for
            real (about ${totals.estimatedCostUsd.toFixed(3)}).
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={run}
              disabled={step === "running"}
              className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-[13px] font-semibold text-brand-fg hover:bg-brand/90 disabled:opacity-60"
            >
              {step === "running" ? "Running…" : "Confirm and run"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={step === "running"}
              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {step === "done" && result ? (
        <div className="flex flex-col gap-1 text-[12.5px] text-foreground">
          <p className="font-semibold">Done: {result.results.length} lead(s) processed. Reload the page to see the dry run again.</p>
          {result.results.map((r) => (
            <p key={`${r.agencyId}-${r.leadId}`} className="font-mono text-[11.5px] text-muted-foreground">
              {r.leadId.slice(0, 8)} · {r.action}
              {r.outcome ? ` · ${r.outcome.ok ? `${r.outcome.score ?? "—"} ${r.outcome.band ?? ""}` : `not scored: ${r.outcome.error}`}` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
