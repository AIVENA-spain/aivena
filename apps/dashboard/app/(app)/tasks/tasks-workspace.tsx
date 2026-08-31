"use client";

import { useRouter } from "next/navigation";

import { useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, ClipboardList, Inbox, Link2, MessageSquareOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { OpsTask } from "@/lib/api/types";

import { answerQuestionAction, dismissTaskAction, executeBookingAction } from "./actions";
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
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    tasks.map((task) => ({ task, state: "idle", error: null, reason: DEFAULT_REASON })),
  );

  function dispatch(taskId: string, ev: RowEvent) {
    setRows((prev) => prev.map((r) => (r.task.taskId === taskId ? rowReducer(r, ev) : r)));
    // The sidebar Tasks badge is server-rendered: without this it kept showing
    // a count for work already done (Christian, 2026-08-28) until the next
    // navigation. Refresh the server tree the moment a task actually resolves.
    if (ev.type === "SUCCESS") router.refresh();
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
              onAnswered={() => dispatch(row.task.taskId, { type: "SUCCESS" })}
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
  onAnswered,
}: {
  row: Row;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSetReason: (reason: string) => void;
  onAnswered: () => void;
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
          {/* The task's OWN words first. The per-type line is a fallback, not a
              replacement: it used to overwrite every task, so three different
              escalations all read "AIVENA wasn't sure how to handle something"
              and an agent could not tell them apart, let alone answer one
              (Christian 2026-08-30). The engine now writes a real title (the
              buyer's question) and a real body (the properties in play plus the
              reply Amanda wanted to send) — show those. */}
          {task.title ? (
            <p className="text-[12.5px] font-medium leading-snug text-foreground">{task.title}</p>
          ) : null}
          {task.body ? (
            <p className="mt-0.5 whitespace-pre-line text-[12.5px] leading-snug text-muted-foreground">{task.body}</p>
          ) : (
            <p className="text-[12.5px] leading-snug text-muted-foreground">{whyItMatters(task.type)}</p>
          )}
          {age ? <p className="mt-0.5 text-[11px] text-muted-foreground">{age}</p> : null}
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

      {/* Amanda question: the ONE-BOX answer (design §3b) — answer here and
          Amanda relays it to the buyer, mode-governed. Self-contained state so
          the two-step Resolve machinery above stays untouched. */}
      {task.type === "amanda_question" && state !== "saving" ? (
        <AnswerBox
          taskId={task.taskId}
          question={task.body ?? null}
          property={task.property ?? null}
          onAnswered={onAnswered}
        />
      ) : null}

      {/* Amanda booking confirm: ONE TAP books the buyer-accepted slot through
          the same deterministic path the engine uses; Amanda tells the buyer. */}
      {task.type === "amanda_booking_confirm" && state !== "saving" ? (
        <ConfirmBookingBox taskId={task.taskId} detail={task.body ?? task.title ?? null} onDone={onAnswered} />
      ) : null}

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

/**
 * One-box answer for a "Question from Amanda" (design §3b). Shows the question,
 * takes one line, sends it. On success the row resolves out of the list —
 * Amanda relays the answer to the buyer (as a draft for approval-mode agencies,
 * auto-sent for assisted/full).
 */
function AnswerBox({
  taskId,
  question,
  property,
  onAnswered,
}: {
  taskId: string;
  question: string | null;
  property?: OpsTask["property"];
  onAnswered: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [imageBroken, setImageBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
  const [teach, setTeach] = useState("");
  const [teachNote, setTeachNote] = useState<string | null>(null);

  function onSend() {
    if (busy || !answer.trim()) return;
    setBusy(true);
    setError(null);
    void (async () => {
      const res = await answerQuestionAction(taskId, answer, teachOpen ? teach : undefined);
      if (res.ok) {
        if (res.teachRejected) {
          // The ANSWER went through (Amanda is relaying it) — only the save to
          // her memory was refused. Tell the agent why, then clear the row.
          setBusy(false);
          setTeachNote(
            res.teachRejected === "property_specific"
              ? "Answer sent. Not saved to Amanda's memory: it's about one specific property, and she only keeps general facts (taxes, financing, areas, process)."
              : "Answer sent. Not saved to Amanda's memory: the note didn't pass the safety screen.",
          );
          window.setTimeout(onAnswered, 6000);
        } else {
          onAnswered();
        }
      } else {
        setBusy(false);
        setError(res.error);
      }
    })();
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3">
      {question ? (
        <p className="mb-2 text-[13px] text-foreground">
          <span className="font-semibold">Amanda asks:</span> {question}
        </p>
      ) : null}

      {/* WHICH property (Christian 2026-08-31). An agent picking this up was
          never in the conversation, so "this villa" identifies nothing — the
          card is what turns a question into something answerable, and the ref
          is what they search the Properties page with. Rendered independently
          of the question text so it shows even when a question arrives bare. */}
      {property ? (
        <div className="mb-2 flex items-center gap-2.5 rounded-md border border-border bg-card p-2">
          {property.image && !imageBroken ? (
            // eslint-disable-next-line @next/next/no-img-element
            // Catalogue photos are hotlinked from the source site and many are
            // already dead (this one 404s). Hiding the broken image left a GAP
            // where the picture should be, which reads as the card having lost
            // its property; falling back to the icon keeps the card whole.
            <img
              src={property.image}
              alt=""
              loading="lazy"
              onError={() => setImageBroken(true)}
              className="h-12 w-16 shrink-0 rounded object-cover"
            />
          ) : (
            <span aria-hidden className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
              <Building2 className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-foreground">
              {property.title
                || [property.bedrooms ? `${property.bedrooms} bed` : null, property.type, property.city]
                     .filter(Boolean).join(" · ")
                || "Property"}
            </p>
            <p className="truncate text-[11.5px] text-muted-foreground">
              {[
                property.ref ? `Ref ${property.ref}` : null,
                property.city,
                property.price != null ? `${property.price.toLocaleString()} EUR` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Link
            href={`/properties?q=${encodeURIComponent(property.ref ?? property.id)}`}
            className="shrink-0 rounded px-2 py-1 text-[11.5px] font-medium text-brand hover:bg-brand-soft"
          >
            Open
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`answer-${taskId}`}>
          Your answer
        </label>
        <input
          id={`answer-${taskId}`}
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
          placeholder="Type the answer — Amanda passes it to the buyer"
          disabled={busy}
          maxLength={1200}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={busy || !answer.trim()}
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "shrink-0")}
        >
          {busy ? "Sending…" : "Send to Amanda"}
        </button>
      </div>
      {/* Teach Amanda (Christian's learning laws, 2026-08-28): optional, general
          facts only — property-specific answers are refused server-side, and the
          entry lands in THIS agency's memory alone. */}
      {!teachOpen ? (
        <button
          type="button"
          onClick={() => setTeachOpen(true)}
          className="mt-2 text-[12px] font-medium text-brand hover:underline"
        >
          + Teach Amanda this for next time
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          <label htmlFor={`teach-${taskId}`} className="text-[12px] font-medium text-foreground">
            Teach Amanda for next time (optional)
          </label>
          <p className="text-[11.5px] text-muted-foreground">
            Write it as a general fact — taxes, financing, areas, process. Answers about one specific
            property can&apos;t be saved. Amanda will use this for every future buyer of this agency.
          </p>
          <textarea
            id={`teach-${taskId}`}
            value={teach}
            onChange={(e) => setTeach(e.target.value)}
            disabled={busy}
            maxLength={800}
            rows={2}
            placeholder='e.g. "Non-residents usually need a 30-40% deposit for a Spanish mortgage."'
            className="min-h-[52px] rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40"
          />
        </div>
      )}
      {teachNote ? <p className="mt-2 text-[12px] text-muted-foreground">{teachNote}</p> : null}
      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

/** One-tap confirm for a buyer-accepted viewing slot (amanda_booking_confirm). */
function ConfirmBookingBox({
  taskId,
  detail,
  onDone,
}: {
  taskId: string;
  detail: string | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onConfirmBooking() {
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      const res = await executeBookingAction(taskId);
      if (res.ok) {
        onDone();
      } else {
        setBusy(false);
        setError(res.error);
      }
    })();
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3">
      {detail ? <p className="mb-2 text-[13px] text-foreground">{detail}</p> : null}
      <button
        type="button"
        onClick={onConfirmBooking}
        disabled={busy}
        className={cn(buttonVariants({ variant: "default", size: "sm" }))}
      >
        {busy ? "Booking…" : "Confirm booking"}
      </button>
      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}
