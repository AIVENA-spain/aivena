import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { apiFetch, ApiError } from "@/lib/api/client";
import type { ApiTask, TasksResponse } from "@/lib/api/types";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoadError } from "@/components/shell/page-error";

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

function TaskCard({
  task,
  labels,
}: {
  task: ApiTask;
  labels: {
    subject: string;
    noSubject: string;
    emptyDraft: string;
    noTemperature: string;
  };
}) {
  const lead = task.lead;
  return (
    <Link
      href={`/approvals/${task.id}`}
      className="block rounded-lg transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="cursor-pointer">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="truncate text-sm font-medium text-foreground">
                {lead.fullName ?? "Unknown buyer"}
              </span>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-inset ring-border">
                {languageLabel(lead.language)}
              </span>
              <TemperatureBadge
                temperature={lead.temperature}
                score={lead.score}
                noTempLabel={labels.noTemperature}
              />
              {lead.listingId ? (
                <span className="inline-flex items-center rounded-full bg-foreground px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-background">
                  {lead.listingId}
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {new Date(task.createdAt).toLocaleString()}
            </span>
          </div>

          <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {labels.subject}
            </div>
            <div className="text-sm text-foreground">
              {task.subject ?? (
                <span className="italic text-muted-foreground">
                  {labels.noSubject}
                </span>
              )}
            </div>
          </div>

          <div className="whitespace-pre-wrap rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground">
            {task.body || (
              <span className="italic text-muted-foreground">
                {labels.emptyDraft}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SuccessBanner({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-700 dark:text-green-300">
      {text}
    </div>
  );
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string; dismissed?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations("approvals");
  const banner: "approved" | "dismissed" | null =
    params.approved === "1"
      ? "approved"
      : params.dismissed === "1"
        ? "dismissed"
        : null;

  let tasks: ApiTask[] = [];
  let loadFailed = false;

  try {
    const res = await apiFetch<TasksResponse>(
      "/api/v1/tasks?type=suggested_reply&status=pending",
    );
    tasks = res.tasks;
  } catch (err) {
    loadFailed = true;
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/approvals] failed to load tasks:", detail);
  }

  const cardLabels = {
    subject: t("subject"),
    noSubject: t("noSubject"),
    emptyDraft: t("emptyDraft"),
    noTemperature: t("noTemperature"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {banner ? (
        <SuccessBanner
          text={banner === "approved" ? t("approvedBanner") : t("dismissedBanner")}
        />
      ) : null}

      {loadFailed ? (
        <PageLoadError />
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} labels={cardLabels} />
          ))}
        </div>
      )}
    </div>
  );
}
