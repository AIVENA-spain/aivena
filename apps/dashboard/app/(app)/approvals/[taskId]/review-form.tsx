"use client";

import { useActionState, useState } from "react";

import { approveTaskAction, dismissTaskAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ReviewForm({
  taskId,
  initialSubject,
  initialBody,
}: {
  taskId: string;
  initialSubject: string;
  initialBody: string;
}) {
  const [approveState, approveFormAction, approving] = useActionState(
    approveTaskAction,
    {},
  );
  const [dismissState, dismissFormAction, dismissing] = useActionState(
    dismissTaskAction,
    {},
  );
  const [showDismiss, setShowDismiss] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <form action={approveFormAction} className="flex flex-col gap-4">
        <input type="hidden" name="taskId" value={taskId} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            name="subject"
            defaultValue={initialSubject}
            placeholder="(no subject)"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="body">Reply body</Label>
          <textarea
            id="body"
            name="body"
            defaultValue={initialBody}
            rows={12}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
            required
          />
        </div>

        {approveState.error ? (
          <div
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {approveState.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={approving || dismissing}>
            {approving ? "Approving..." : "Approve & send"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowDismiss((v) => !v)}
            disabled={approving || dismissing}
          >
            Dismiss
          </Button>
        </div>
      </form>

      {showDismiss ? (
        <form
          action={dismissFormAction}
          className="flex flex-col gap-3 rounded-md border border-neutral-200 bg-neutral-50 p-4"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <Label htmlFor="reason" className="text-sm">
            Dismiss reason
          </Label>
          <Input
            id="reason"
            name="reason"
            placeholder="Why are you dismissing this draft?"
            required
          />
          {dismissState.error ? (
            <div
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              {dismissState.error}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={approving || dismissing}
            >
              {dismissing ? "Dismissing..." : "Confirm dismiss"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowDismiss(false)}
              disabled={approving || dismissing}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
