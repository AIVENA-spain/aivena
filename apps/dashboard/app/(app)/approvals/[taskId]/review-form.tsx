"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("approvals");
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
          <Label htmlFor="subject">{t("subject")}</Label>
          <Input
            id="subject"
            name="subject"
            defaultValue={initialSubject}
            placeholder={t("noSubject")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="body">{t("replyBody")}</Label>
          <textarea
            id="body"
            name="body"
            defaultValue={initialBody}
            rows={12}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>

        {approveState.error ? (
          <div
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
            role="alert"
          >
            {approveState.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={approving || dismissing}>
            {approving ? t("approving") : t("approveAndSend")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowDismiss((v) => !v)}
            disabled={approving || dismissing}
          >
            {t("dismiss")}
          </Button>
        </div>
      </form>

      {showDismiss ? (
        <form
          action={dismissFormAction}
          className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-4"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <Label htmlFor="reason" className="text-sm">
            {t("dismissReasonLabel")}
          </Label>
          <Input
            id="reason"
            name="reason"
            placeholder={t("dismissReasonPlaceholder")}
            required
          />
          {dismissState.error ? (
            <div
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
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
              {dismissing ? t("dismissing") : t("confirmDismiss")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowDismiss(false)}
              disabled={approving || dismissing}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
