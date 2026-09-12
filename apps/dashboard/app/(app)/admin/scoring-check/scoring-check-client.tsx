"use client";

import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getScoringCheckAction, startScoringCheckAction } from "./actions";
import type { ScoringCheckCase, ScoringCheckReport, ScoringCheckRun } from "./types";

/**
 * Admin → Scoring check (internal). Starts a run, polls until it finishes, then shows expected vs actual per case,
 * every discarded quote, tokens and cost. English-only like the rest of Admin.
 */

const VERDICT_TONE: Record<ScoringCheckReport["verdict"], string> = {
  GREEN: "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200",
  ACCEPTABLE: "border-amber-500/30 bg-amber-500/[0.07] text-amber-800 dark:text-amber-200",
  "NOT ACCEPTABLE": "border-rose-500/30 bg-rose-500/[0.07] text-rose-800 dark:text-rose-200",
};

const band = (b: string) => b.replace(/_/g, " ");
const scoreBand = (score: number | null, b: string) => `${score ?? "—"} · ${band(b)}`;
const expectedText = (c: ScoringCheckCase) =>
  c.expected.range ? `${c.expected.range[0]}–${c.expected.range[1]} · ${band(c.expected.band)}` : scoreBand(c.expected.score, c.expected.band);
const usd = (n: number) => `$${n.toFixed(4)}`;

export function ScoringCheckClient() {
  const [run, setRun] = useState<ScoringCheckRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };
  useEffect(() => stopPolling, []);

  async function start() {
    setError(null);
    setCopied(false);
    setStarting(true);
    const res = await startScoringCheckAction();
    setStarting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const runId = res.data.runId;
    setRun({ id: runId, status: "running", startedAt: new Date().toISOString(), done: 0, total: 11, report: null, error: null });
    stopPolling();
    poll.current = setInterval(async () => {
      const r = await getScoringCheckAction(runId);
      if (!r.ok) {
        setError(r.error);
        stopPolling();
        return;
      }
      setRun(r.data);
      if (r.data.status !== "running") stopPolling();
    }, 2000);
  }

  async function copy() {
    if (!run?.report) return;
    await navigator.clipboard.writeText(JSON.stringify(run.report, null, 2));
    setCopied(true);
  }

  const running = starting || run?.status === "running";
  const report = run?.report ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Runs the 11 practice conversations through the real lead scorer, using the server&apos;s own AI key. It reads no
          leads and writes nothing. About 40 seconds and $0.04 per run; at most 10 runs a day.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="inline-flex items-center rounded-md bg-brand px-4 py-2 text-[13px] font-semibold text-brand-fg transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Running…" : "Run scoring check"}
          </button>
          {run?.status === "running" ? (
            <span className="text-[12.5px] text-muted-foreground">
              Checking case {Math.min(run.done + 1, run.total)} of {run.total}…
            </span>
          ) : null}
          {report ? (
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center rounded-md border border-border px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-muted"
            >
              {copied ? "Copied" : "Copy results"}
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-[12.5px] text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : null}
        {run?.status === "failed" && run.error ? (
          <p role="alert" className="text-[12.5px] text-rose-700 dark:text-rose-300">
            {run.error}
          </p>
        ) : null}
      </Card>

      {report ? (
        <>
          <div className={cn("rounded-lg border px-5 py-4", VERDICT_TONE[report.verdict])}>
            <div className="text-[15px] font-bold">Verdict: {report.verdict}</div>
            {report.reasons.length ? (
              <ul className="mt-1.5 list-disc pl-5 text-[12.5px]">
                {report.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <ul className="mt-2 flex flex-col gap-0.5 text-[12.5px]">
              {report.namedChecks.map((n) => (
                <li key={n.label}>
                  {n.pass ? "Yes" : "No"}: {n.label}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[12px] opacity-80">
              {usd(report.totalCostUsd)} of a {usd(report.capUsd)} cap · {report.inputTokens.toLocaleString()} tokens in,{" "}
              {report.outputTokens.toLocaleString()} out · {report.model} · rubric {report.rubricVersion}
            </div>
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-2 py-2.5">Case</th>
                  <th className="px-2 py-2.5">Expected</th>
                  <th className="px-2 py-2.5">Got</th>
                  <th className="px-2 py-2.5">Result</th>
                  <th className="px-2 py-2.5">Why (verified facts only)</th>
                  <th className="px-4 py-2.5 text-right">Tokens · cost</th>
                </tr>
              </thead>
              <tbody>
                {report.cases.map((c) => (
                  <tr key={c.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-mono text-muted-foreground">{c.id}</td>
                    <td className="px-2 py-3 font-medium text-foreground">
                      {c.title}
                      {c.minor ? <span className="ml-1 text-[11px] text-muted-foreground">(minor)</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-muted-foreground">{expectedText(c)}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-foreground">{c.actual ? scoreBand(c.actual.score, c.actual.band) : "—"}</td>
                    <td className={cn("px-2 py-3 font-semibold", c.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
                      {c.ok ? "OK" : "CHECK"}
                    </td>
                    <td className="px-2 py-3 text-foreground">
                      {c.error ? <span className="text-rose-700 dark:text-rose-300">{c.error}</span> : c.explanation}
                      {c.discarded.map((d) => (
                        <div key={d} className="mt-1 text-[11.5px] text-amber-800 dark:text-amber-200">
                          Discarded: {d}
                        </div>
                      ))}
                      {c.guards.map((g) => (
                        <div key={g} className="mt-1 text-[11.5px] text-muted-foreground">
                          Guard: {g}
                        </div>
                      ))}
                      {c.factDiffs.map((d) => (
                        <div key={d} className="mt-1 text-[11.5px] text-amber-800 dark:text-amber-200">
                          Fact differs: {d}
                        </div>
                      ))}
                      {c.timeNotes.map((n) => (
                        <div key={n} className="mt-1 text-[11.5px] text-muted-foreground">
                          Dates: {n}
                        </div>
                      ))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11.5px] text-muted-foreground">
                      {c.inputTokens + c.outputTokens} · {usd(c.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
