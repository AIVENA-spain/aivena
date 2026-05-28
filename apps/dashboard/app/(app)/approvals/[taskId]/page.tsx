import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import { intlLocaleFor } from "@/lib/i18n/date-locale";
import type { TaskDetailResponse, ThreadMessage } from "@/lib/api/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageLoadError } from "@/components/shell/page-error";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

function languageLabel(code: string | null): string {
  if (!code) return "—";
  return code.toUpperCase();
}

function TemperatureBadge({
  temperature,
  score,
  noTempLabel,
}: {
  temperature: string | null;
  score: number | null;
  noTempLabel: string;
}) {
  const t = (temperature ?? "").toLowerCase();
  const tone =
    t === "super_hot"
      ? "bg-red-500/15 text-red-700 dark:text-red-300 ring-red-500/30"
      : t === "hot"
        ? "bg-orange-500/15 text-orange-700 dark:text-orange-300 ring-orange-500/30"
        : t === "warm"
          ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30"
          : t === "cold"
            ? "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30"
            : "bg-muted text-muted-foreground ring-border";
  const label = temperature ? temperature.replace("_", " ") : noTempLabel;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${tone}`}
    >
      <span>{label}</span>
      {typeof score === "number" ? (
        <span className="opacity-70">· {score}</span>
      ) : null}
    </span>
  );
}

function ThreadEntry({
  msg,
  buyerLabel,
  agencyLabel,
  emptyLabel,
  bcp47Locale,
}: {
  msg: ThreadMessage;
  buyerLabel: string;
  agencyLabel: string;
  emptyLabel: string;
  /** Pre-resolved BCP-47 locale tag (from intlLocaleFor on the server). */
  bcp47Locale: string;
}) {
  const inbound = msg.direction === "inbound";
  // Inbound: prefer the server-cleaned body (quote chain / footer stripped);
  // outbound is dashboard-composed and never quoted, so it renders raw content.
  const body = inbound ? (msg.bodyClean ?? msg.content) : msg.content;
  return (
    <div
      className={
        inbound
          ? "rounded-md border border-border bg-card px-3 py-2"
          : "rounded-md border border-foreground bg-foreground px-3 py-2 text-background"
      }
    >
      <div
        className={
          "mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide " +
          (inbound ? "text-muted-foreground" : "text-background/70")
        }
      >
        <span>
          {inbound ? buyerLabel : agencyLabel} · {msg.messageType}
        </span>
        <span>
          {new Date(msg.createdAt).toLocaleString(bcp47Locale, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div
        className={
          "whitespace-pre-wrap text-sm leading-relaxed " +
          (inbound ? "text-foreground" : "text-background")
        }
      >
        {body ?? <span className="italic opacity-70">{emptyLabel}</span>}
      </div>
    </div>
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const t = await getTranslations("approvals");
  const bcp47Locale = intlLocaleFor(await getLocale());

  let detail: TaskDetailResponse;
  try {
    detail = await apiFetch<TaskDetailResponse>(`/api/v1/tasks/${taskId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    const detailLog =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`[/approvals/${taskId}] failed to load task:`, detailLog);
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/approvals"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← {t("back")}
        </Link>
        <PageLoadError />
      </div>
    );
  }

  const { task, lead, originalMessage, thread } = detail;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/approvals"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {t("back")}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {lead.fullName ?? "Unknown buyer"}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-inset ring-border">
            {languageLabel(lead.language)}
          </span>
          <TemperatureBadge
            temperature={lead.temperature}
            score={lead.score}
            noTempLabel={t("noTemperature")}
          />
          {lead.listingId ? (
            <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-background">
              {lead.listingId}
            </span>
          ) : null}
          {lead.source ? (
            <span className="text-xs text-muted-foreground">
              source: {lead.source}
              {lead.sourceType ? ` · ${lead.sourceType}` : ""}
            </span>
          ) : null}
        </div>
        {lead.email ? (
          <p className="text-xs text-muted-foreground">{lead.email}</p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("buyerEnquiryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {originalMessage ? (
            <div className="whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-sm leading-relaxed text-foreground">
              {originalMessage}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noEnquiry")}</p>
          )}

          {thread.length > 0 ? (
            <div className="flex flex-col gap-2 pt-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("conversationLabel")}
              </div>
              {thread.map((msg) => (
                <ThreadEntry
                  key={msg.id}
                  msg={msg}
                  buyerLabel={t("buyer")}
                  agencyLabel={t("agency")}
                  emptyLabel={t("emptyMessage")}
                  bcp47Locale={bcp47Locale}
                />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("draftReplyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewForm
            taskId={task.id}
            initialSubject={task.subject ?? ""}
            initialBody={task.body}
          />
        </CardContent>
      </Card>
    </div>
  );
}
