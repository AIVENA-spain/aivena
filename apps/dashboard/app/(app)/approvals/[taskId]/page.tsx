import Link from "next/link";
import { notFound } from "next/navigation";

import { apiFetch, ApiError } from "@/lib/api/client";
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

function ThreadEntry({ msg }: { msg: ThreadMessage }) {
  const inbound = msg.direction === "inbound";
  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        inbound
          ? "border-neutral-200 bg-white"
          : "border-neutral-900 bg-neutral-900 text-white"
      }`}
    >
      <div
        className={`mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide ${
          inbound ? "text-neutral-500" : "text-neutral-400"
        }`}
      >
        <span>
          {inbound ? "Buyer" : "Agency"} · {msg.messageType}
        </span>
        <span>{new Date(msg.createdAt).toLocaleString()}</span>
      </div>
      <div
        className={`whitespace-pre-wrap text-sm leading-relaxed ${
          inbound ? "text-neutral-800" : "text-neutral-100"
        }`}
      >
        {msg.content ?? <span className="italic opacity-70">(empty)</span>}
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
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to approvals
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
        className="text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← Back to approvals
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {lead.fullName ?? "Unknown buyer"}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
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
          {lead.source ? (
            <span className="text-xs text-neutral-500">
              source: {lead.source}
              {lead.sourceType ? ` · ${lead.sourceType}` : ""}
            </span>
          ) : null}
        </div>
        {lead.email ? (
          <p className="text-xs text-neutral-500">{lead.email}</p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buyer&apos;s enquiry</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {originalMessage ? (
            <div className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-800">
              {originalMessage}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">
              No original enquiry text on file.
            </p>
          )}

          {thread.length > 0 ? (
            <div className="flex flex-col gap-2 pt-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Conversation
              </div>
              {thread.map((msg) => (
                <ThreadEntry key={msg.id} msg={msg} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Draft reply</CardTitle>
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
