import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ShadowRun, ShadowStatus } from "./types";

/**
 * Admin → Scoring check → Shadow results (internal). What the scorer made of real conversations in shadow mode:
 * written only to the internal record, never to the lead. Server-rendered; reload the page to see newer runs.
 */

const when = (iso: string | null): string =>
  !iso
    ? "—"
    : new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const band = (b: string | null): string => (b ? b.replace(/_/g, " ") : "—");
const scoreBand = (score: number | null, b: string | null): string => `${score ?? "—"} · ${band(b)}`;

function Row({ run }: { run: ShadowRun }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{when(run.classifiedAt)}</td>
      <td className="px-2 py-3 font-medium text-foreground">{run.leadName ?? run.leadId?.slice(0, 8) ?? "—"}</td>
      <td className="whitespace-nowrap px-2 py-3 font-semibold text-foreground">
        {run.ok ? scoreBand(run.score, run.band) : <span className="text-rose-700 dark:text-rose-300">did not finish</span>}
      </td>
      <td className="whitespace-nowrap px-2 py-3 text-muted-foreground">
        {run.storedScore == null ? "none" : `${run.storedScore} · ${band(run.storedTemperature)}`}
        {run.storedScoredAt ? <div className="text-[11px]">stored {when(run.storedScoredAt)}</div> : null}
      </td>
      <td className="px-2 py-3 text-foreground">
        {run.error ? <span className="text-rose-700 dark:text-rose-300">{run.error}</span> : run.explanation}
        {run.discarded.map((d) => (
          <div key={d} className="mt-1 text-[11.5px] text-amber-800 dark:text-amber-200">
            Discarded: {d}
          </div>
        ))}
        {run.guards.map((g) => (
          <div key={g} className="mt-1 text-[11.5px] text-muted-foreground">
            Guard: {g}
          </div>
        ))}
        {run.trimmed ? <div className="mt-1 text-[11.5px] text-muted-foreground">Input: {run.trimmed}</div> : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11.5px] text-muted-foreground">
        {run.messagesSeen ?? "—"}
        {run.earlierMessagesSeen ? `+${run.earlierMessagesSeen}` : ""} msg
        <div>{run.costUsd == null ? "—" : `$${run.costUsd.toFixed(4)}`}</div>
      </td>
    </tr>
  );
}

export function ShadowResults({ status, error }: { status: ShadowStatus | null; error: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-bold text-foreground">Shadow results</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          What the scorer made of real conversations. Written only to the internal record: the lead&apos;s own score,
          temperature and status are never touched, and agencies cannot see any of this. Reload the page for newer runs.
        </p>
      </div>

      {status ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span
            className={cn(
              "rounded-md border px-2 py-1 font-medium",
              status.paused
                ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-800 dark:text-amber-200"
                : "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200",
            )}
          >
            {status.paused ? "Paused" : `Running · ${status.mode} mode`}
          </span>
          <span>
            Switched on for: {status.agencies.length ? status.agencies.join(", ") : "no agency"}
          </span>
        </div>
      ) : null}

      {error ? (
        <Card className="px-5 py-4 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</Card>
      ) : !status || status.runs.length === 0 ? (
        <Card className="px-5 py-4 text-[12.5px] text-muted-foreground">
          No shadow runs yet. A lead is scored 30 minutes after their last message, at most twice a day.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                <th className="px-4 py-2.5">When</th>
                <th className="px-2 py-2.5">Lead</th>
                <th className="px-2 py-2.5">Shadow score</th>
                <th className="px-2 py-2.5">Stored score</th>
                <th className="px-2 py-2.5">Why (verified facts only)</th>
                <th className="px-4 py-2.5 text-right">Input · cost</th>
              </tr>
            </thead>
            <tbody>
              {status.runs.map((run) => (
                <Row key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
