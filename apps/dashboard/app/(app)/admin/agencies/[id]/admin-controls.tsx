"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, CheckCircle2, FlaskConical, RotateCcw } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgencyStatus } from "@/lib/api/admin-types";
import { setAgencyStatusAction, setAgencyTestFlagAction } from "../../admin-actions";

/**
 * Staff-only admin controls for an agency (Phase 1): mark/unmark as test, and
 * archive/restore (soft — status only, NEVER hard delete). Enforcement is
 * server-side (the RPC blocks live archives, requires the slug for non-test
 * archives, requires a reason, and audits everything); this UI mirrors those
 * rules for a clear flow but the server stays authoritative. English-only.
 */
type Mode = null | "archive" | "restore" | "test";

export function AdminControls({
  agencyId,
  slug,
  status,
  isTest,
  pilotStatus,
}: {
  agencyId: string;
  slug: string;
  status: AgencyStatus;
  isTest: boolean;
  pilotStatus: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [slugConfirm, setSlugConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isArchived = status === "archived";
  const isLive = pilotStatus === "live";

  function open(m: Mode) {
    setMode(m);
    setReason("");
    setSlugConfirm("");
    setMsg(null);
  }
  function reset() {
    setMode(null);
    setReason("");
    setSlugConfirm("");
  }

  const reasonOk = reason.trim().length > 0;
  const canArchive = reasonOk && (isTest || slugConfirm.trim() === slug) && !pending;
  const canRestore = reasonOk && !pending;

  function submitStatus(target: "archived" | "active") {
    startTransition(async () => {
      const res = await setAgencyStatusAction(agencyId, {
        status: target,
        reason: reason.trim(),
        confirmSlug: isTest ? null : slugConfirm.trim(),
      });
      if (res.ok) {
        setMsg({ ok: true, text: `Agency ${target === "archived" ? "archived" : "restored"}.` });
        reset();
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  function submitTestFlag() {
    startTransition(async () => {
      const res = await setAgencyTestFlagAction(agencyId, !isTest, reason.trim() || undefined);
      if (res.ok) {
        setMsg({ ok: true, text: !isTest ? "Marked as test agency." : "Unmarked as test agency." });
        reset();
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-foreground">Admin controls</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Staff-only. Nothing here deletes an agency — archiving is reversible, and every action
          is recorded in the Audit tab.
        </p>
      </div>

      {/* Test / demo flag */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[13px]">
          <FlaskConical className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
          <span className="text-foreground">
            {isTest ? "This is a test / demo agency" : "Not marked as a test agency"}
          </span>
          {isTest ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Test
            </span>
          ) : null}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => open("test")}>
          {isTest ? "Unmark as test" : "Mark as test"}
        </Button>
      </div>

      {/* Archive / restore */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] text-foreground">
            Status: <span className="font-medium capitalize">{status}</span>
          </span>
          {isLive && !isArchived ? (
            <span className="text-[11.5px] text-amber-600 dark:text-amber-400">
              A live agency can&rsquo;t be archived — set the pilot status away from live first.
            </span>
          ) : null}
        </div>
        {isArchived ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => open("restore")}>
            <RotateCcw aria-hidden />
            Restore
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending || isLive}
            onClick={() => open("archive")}
          >
            <Archive aria-hidden />
            Archive
          </Button>
        )}
      </div>

      {/* Contextual confirm form */}
      {mode ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          {mode === "archive" && !isTest ? (
            <div className="flex items-start gap-1.5 rounded-md bg-amber-50/70 px-2.5 py-1.5 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
              This is a real agency. To archive it, type its identifier{" "}
              <span className="font-mono font-medium">{slug}</span> below.
            </div>
          ) : null}

          {mode === "archive" && !isTest ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="slug-confirm" className="text-[12px] font-medium text-foreground">
                Confirm identifier
              </label>
              <Input
                id="slug-confirm"
                value={slugConfirm}
                onChange={(e) => setSlugConfirm(e.target.value)}
                disabled={pending}
                placeholder={slug}
                autoComplete="off"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <label htmlFor="admin-reason" className="text-[12px] font-medium text-foreground">
              Reason{" "}
              <span className="text-muted-foreground">
                {mode === "test" ? "(optional)" : "(required)"}
              </span>
            </label>
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              maxLength={500}
              rows={2}
              placeholder="Recorded in the audit trail"
            />
          </div>

          <div className="flex items-center gap-2">
            {mode === "archive" ? (
              <Button type="button" size="sm" variant="destructive" disabled={!canArchive} onClick={() => submitStatus("archived")}>
                {pending ? "Archiving…" : "Archive agency"}
              </Button>
            ) : mode === "restore" ? (
              <Button type="button" size="sm" disabled={!canRestore} onClick={() => submitStatus("active")}>
                {pending ? "Restoring…" : "Restore agency"}
              </Button>
            ) : (
              <Button type="button" size="sm" disabled={pending} onClick={submitTestFlag}>
                {pending ? "Saving…" : isTest ? "Unmark as test" : "Mark as test"}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Result */}
      {msg ? (
        <div
          className={
            msg.ok
              ? "flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12.5px] text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 text-[12.5px] text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300"
          }
        >
          {msg.ok ? (
            <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden />
          ) : (
            <AlertTriangle className="h-4 w-4 flex-none" aria-hidden />
          )}
          {msg.text}
        </div>
      ) : null}
    </Card>
  );
}
