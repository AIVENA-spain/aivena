import Link from "next/link";

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
}: {
  temperature: string | null;
  score: number | null;
}) {
  const t = (temperature ?? "").toLowerCase();
  const tone =
    t === "super_hot"
      ? "bg-red-50 text-red-700 ring-red-200"
      : t === "hot"
        ? "bg-orange-50 text-orange-700 ring-orange-200"
        : t === "warm"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : t === "cold"
            ? "bg-sky-50 text-sky-700 ring-sky-200"
            : "bg-neutral-100 text-neutral-700 ring-neutral-200";
  const label = temperature ? temperature.replace("_", " ") : "no temperature";
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

function TaskCard({ task }: { task: ApiTask }) {
  const lead = task.lead;
  return (
    <Link
      href={`/approvals/${task.id}`}
      className="block transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 rounded-lg"
    >
      <Card className="cursor-pointer">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="truncate text-sm font-medium text-neutral-900">
                {lead.fullName ?? "Unknown buyer"}
              </span>
              <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-700 ring-1 ring-inset ring-neutral-200">
                {languageLabel(lead.language)}
              </span>
              <TemperatureBadge
                temperature={lead.temperature}
                score={lead.score}
              />
              {lead.listingId ? (
                <span className="inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-white">
                  {lead.listingId}
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-neutral-500">
              {new Date(task.createdAt).toLocaleString()}
            </span>
          </div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
              Subject
            </div>
            <div className="text-sm text-neutral-900">
              {task.subject ?? (
                <span className="italic text-neutral-500">(no subject)</span>
              )}
            </div>
          </div>

          <div className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800">
            {task.body || (
              <span className="italic text-neutral-500">(empty draft)</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SuccessBanner({ kind }: { kind: "approved" | "dismissed" }) {
  const text =
    kind === "approved"
      ? "Reply approved and queued for send."
      : "Task dismissed.";
  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
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
    // Log the technical detail server-side so we can debug, but never surface
    // the raw text to the user.
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/approvals] failed to load tasks:", detail);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Approvals
        </h1>
        <p className="text-sm text-neutral-500">
          AI-drafted replies awaiting human approval. Click a card to review,
          edit, and approve or dismiss.
        </p>
      </header>

      {banner ? <SuccessBanner kind={banner} /> : null}

      {loadFailed ? (
        <PageLoadError />
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-neutral-500">
            Nothing waiting. New AI drafts will appear here as buyers reply.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
