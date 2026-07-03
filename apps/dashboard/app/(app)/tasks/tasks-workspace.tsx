"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList, Inbox, Link2, MessageSquareOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { OpsTask } from "@/lib/api/types";

import { dismissTaskAction } from "./actions";
import {
  rowReducer,
  whyItMatters,
  ageLabel,
  inboxHref,
  DISMISS_REASONS,
  DEFAULT_REASON,
  type Row,
  type RowEvent,
} from "./tasks-model";

/**
 * /tasks — the agency-facing action home for every open `dashboard_task` (F7).
 * Honesty-first: a non-Inbox lead gets NO "open" link (it would dead-end); its
 * only in-app action is Resolve, here. Resolve is two-step (a first click asks
 * + lets the operator pick an honest reason, an explicit confirm commits) and
 * writes exactly once; nothing auto-resolves; history is preserved (dismiss,
 * never delete). The reason is one of the RPC whitelist values — never free text.
 */
export function TasksWorkspace({ tasks }: { tasks: OpsTask[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    tasks.map((task) => ({ task, state: "idle", error: null, reason: DEFAULT_REASON })),
  );

  function dispatch(taskId: string, ev: RowEvent) {
    setRows((prev) => prev.map((r) => (r.task.taskId === taskId ? rowReducer(r, ev) : r)));
  }

  function onConfirm(taskId: string) {
    // Guard: only commit from `confirming` so a repeated confirm can't double-write.
    const row = rows.find((r) => r.task.taskId === taskId);
    if (!row || row.state !== "confirming") return;
    const reason = row.reason;
    dispatch(taskId, { type: "CONFIRM" });
    void (async () => {
      const res = await dismissTaskAction(taskId, reason);
      dispatch(taskId, res.ok ? { type: "SUCCESS" } : { type: "FAIL", error: res.error });
    })();
  }

  // A resolved task leaves the active list immediately (Christian's cleanup):
  // resolved rows are filtered out of the render, and only kept in state to feed
  // the tiny "resolved this session" counter. On refresh they're gone for real —
  // /operations only returns pending/open tasks.
  const visible = rows.filter((r) => r.state !== "resolved");
  const resolvedCount = rows.length - visible.length;

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
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card shadow-soft">
          <EmptyState
            icon={CheckCircle2}
            title="All caught up"
            description={`You resolved ${resolvedCount} task${resolvedCount > 1 ? "s" : ""} — nothing else needs a decision right now.`}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((row) => (
            <TaskRow
              key={row.task.taskId}
              row={row}
              onAsk={() => dispatch(row.task.taskId, { type: "ASK" })}
              onCancel={() => dispatch(row.task.taskId, { type: "CANCEL" })}
              onConfirm={() => onConfirm(row.task.taskId)}
              onSetReason={(reason) => dispatch(row.task.taskId, { type: "SET_REASON", reason })}
            />
          ))}
          {resolvedCount > 0 ? (
            <p className="px-1 pt-1 text-center text-[12px] text-muted-foreground">
              ✓ {resolvedCount} resolved this session
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
  onSetReason,
}: {
  row: Row;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSetReason: (reason: string) => void;
}) {
  const { task, state, error } = row;
  const who = task.leadName ?? "Unknown lead";
  const age = ageLabel(task.ageHours);
  const href = inboxHref(task);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-soft">
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
            {task.type === "whatsapp_handoff" ? (
              <Pill className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Link2 className="h-3 w-3" aria-hidden />
                WhatsApp handoff pending
              </Pill>
            ) : null}
          </div>
          <p className="text-[12.5px] leading-snug text-muted-foreground">{whyItMatters(task.type)}</p>
          {age ? <p className="text-[11px] text-muted-foreground">{age}</p> : null}
        </div>

        {/* Right: action zone (two-step confirm). Resolved rows never reach here —
            they're filtered out of the list the moment they resolve. Wraps on
            narrow phones instead of overflowing. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {state === "saving" ? (
            <span className="text-[12.5px] text-muted-foreground">Resolving…</span>
          ) : state === "confirming" ? (
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor={`reason-${task.taskId}`}>
                Reason
              </label>
              <select
                id={`reason-${task.taskId}`}
                value={row.reason}
                onChange={(e) => onSetReason(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {DISMISS_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onConfirm}
                className={cn(buttonVariants({ variant: "default", size: "sm" }))}
              >
                Confirm
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
          Pick a reason and confirm to clear this from your list — the task history is kept.
        </p>
      ) : null}
      {state === "error" && error ? (
        <p className="mt-2 text-[12px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
