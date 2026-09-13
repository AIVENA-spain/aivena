import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { RescoreExecute } from "./rescore-execute";
import type { RescoreAction, RescoreDryRun } from "./types";

/**
 * Admin → Scoring check → Go-live re-score (internal, staff only). Lead by lead, across every active agency, exactly what
 * going live would do: archive and clear June's legacy scoring data, then score for real where there is something to
 * read. This view only reads. The execute action exists in the API but refuses until scoring is live (Stage 3c).
 */

const ACTION_LABEL: Record<RescoreAction, string> = {
  rescore_and_clear_legacy: "Clear June data, then score",
  clear_legacy: "Clear June data",
  rescore: "Score",
  nothing: "Nothing to do",
};

const ACTION_TONE: Record<RescoreAction, string> = {
  rescore_and_clear_legacy: "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200",
  clear_legacy: "border-amber-500/30 bg-amber-500/[0.07] text-amber-800 dark:text-amber-200",
  rescore: "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200",
  nothing: "border-border bg-muted text-muted-foreground",
};

export function RescoreDryRunView({ dryRun, error }: { dryRun: RescoreDryRun | null; error: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-bold text-foreground">Go-live re-score (dry run)</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          What going live would do to every lead in every active agency. June&apos;s legacy scoring data is archived
          internally and then cleared, so nothing from June can appear live. Leads with messages to read are then scored
          for real. This view writes nothing.
        </p>
      </div>

      {error ? (
        <Card className="px-5 py-4 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</Card>
      ) : !dryRun ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className="rounded-md border border-border px-2 py-1 font-medium">
              {dryRun.canExecute ? "Ready to run at go-live" : "Runs only at go-live (Stage 3c)"}
            </span>
            <span>
              {dryRun.totals.leads} leads · {dryRun.totals.rescoreAndClearLegacy} clear and score · {dryRun.totals.clearLegacy} clear
              only · {dryRun.totals.rescore} score · {dryRun.totals.nothing} nothing
            </span>
            <span>
              · about ${dryRun.totals.estimatedCostUsd.toFixed(3)} (at most ${dryRun.totals.maxCostUsd.toFixed(3)})
            </span>
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <th className="px-4 py-2.5">Agency</th>
                  <th className="px-2 py-2.5">Lead</th>
                  <th className="px-2 py-2.5">Action</th>
                  <th className="px-2 py-2.5">Why</th>
                  <th className="px-4 py-2.5">June data present</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.agencies.flatMap((a) =>
                  a.leads.map((l) => (
                    <tr key={`${a.agencyId}-${l.leadId}`} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[11.5px] text-muted-foreground">{a.agencyId}</td>
                      <td className="px-2 py-3 font-medium text-foreground">{l.name ?? l.leadId.slice(0, 8)}</td>
                      <td className="px-2 py-3">
                        <span className={cn("whitespace-nowrap rounded-md border px-2 py-0.5 text-[11.5px] font-medium", ACTION_TONE[l.action])}>
                          {ACTION_LABEL[l.action]}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-foreground">{l.reason}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                        {l.legacyFields.length ? l.legacyFields.join(", ") : "—"}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </Card>
          {dryRun.canExecute ? <RescoreExecute totals={dryRun.totals} /> : null}
        </>
      )}
    </div>
  );
}
