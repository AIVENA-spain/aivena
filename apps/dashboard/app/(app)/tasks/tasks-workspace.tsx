"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Inbox, MessageSquareOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { OpsTask } from "@/lib/api/types";

import { dismissTaskAction } from "./actions";
import {
  rowReducer,
  activeCount,
  whyItMatters,
  ageLabel,
  inboxHref,
  type Row,
  type RowEvent,
} from "./tasks-model";

/** Stable audit reason recorded on every resolve (dismiss_dashboard_task). */
const RESOLVE_REASON = "Marked resolved from the Tasks list";

/**
 * /tasks — the agency-facing action home for every open `dashboard_task` (F7).
 * Honesty-first: a non-Inbox lead gets NO "open" link (it would dead-end); its
 * only in-app action is Resolve, here. Resolve is two-step (a first click asks,
 * an explicit confirm commits) and writes exactly once; nothing auto-resolves;
 * history is preserved (dismiss, never delete).
 */
export function TasksWorkspace({ tasks }: { tasks: OpsTask[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    tasks.map((task) => ({ task, state: "idle", error: null })),
  );

  function dispatch(taskId: string, ev: RowEvent) {
    setRows((prev) => prev.map((r) => (r.task.taskId === taskId ? rowReducer(r, ev) : r)));
  }

  function onConfirm(taskId: string) {
    // Guard: only commit from `confirming` so a repeated confirm can't double-write.
    const row = rows.find((r) => r.task.taskId === taskId);
    if (!row || row.state !== "confirming") return;
    dispatch(taskId, { type: "CONFIRM" });
    void (async () => {
      const res = await dismissTaskAction(taskId, RESOLVE_REASON);
      dispatch(taskId, res.ok ? { type: "SUCCESS" } : { type: "FAIL", error: res.error });
    })();
  }

  const active = activeCount(rows);
  const allResolved = rows.length > 0 && active === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[20px] font-bold tracking-[-0.02em] text-foreground">Tasks</h1>
        <p className="text-[13px] text-muted-foreground">
          Everything that needs a decision — including leads with no conversation yet. Open a
          lead in the Inbox where there&apos;s a thread, or mark a task resolved once it&apos;s
          handled. Resolving keeps the full history.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <EmptyState
            icon={ClipboardList}
            title="You're all caught up"
            description="No open tasks need a decision right now."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <TaskRow
              key={row.task.taskId}
              row={row}
              onAsk={() => dispatch(row.task.taskId, { type: "ASK" })}
              onCancel={() => dispatch(row.task.taskId, { type: "CANCEL" })}
              onConfirm={() => onConfirm(row.task.taskId)}
            />
          ))}
          {allResolved ? (
            <p className="px-1 py-2 text-center text-[13px] text-muted-foreground">
              All tasks resolved 🎉
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function TaskRow({
  row,
  onAsk,
  onCancel,
  onConfirm,
}: {
  row: Row;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { task, state, error } = row;
  const who = task.leadName ?? "Unknown lead";
  const age = ageLabel(task.ageHours);
  const href = inboxHref(task);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card px-4 py-3 shadow-soft transition-opacity",
        state === "resolved" && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Left: what + why */}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-foreground">{who}</span>
            <Pill className="bg-muted text-muted-foreground">{task.label}</Pill>
            {task.inInbox ? (
              <Pill className="bg-brand-soft text-brand">
                <Inbox className="h-3 w-3" aria-hidden />
                In Inbox
              </Pill>
            ) : (
              <Pill className="bg-muted text-muted-foreground">
                <MessageSquareOff className="h-3 w-3" aria-hidden />
                No conversation yet
              </Pill>
            )}
          </div>
          <p className="text-[12.5px] leading-snug text-muted-foreground">{whyItMatters(task.type)}</p>
          {age ? <p className="text-[11px] text-muted-foreground">{age}</p> : null}
        </div>

        {/* Right: action zone (two-step confirm) */}
        <div className="flex flex-none items-center gap-2">
          {state === "resolved" ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Resolved
            </span>
          ) : state === "saving" ? (
            <span className="text-[12.5px] text-muted-foreground">Resolving…</span>
          ) : state === "confirming" ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onConfirm}
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              >
                Confirm resolve
              </button>
              <button
                type="button"
                onClick={onCancel}
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {href ? (
                <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Open in Inbox
                </Link>
              ) : null}
              <button
                type="button"
                onClick={onAsk}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Mark resolved
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirm helper + error live below the row so the action zone stays compact */}
      {state === "confirming" ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Mark this resolved? It clears from your list — the task history is kept.
        </p>
      ) : null}
      {state === "error" && error ? (
        <p className="mt-2 text-[12px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
