import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentUserContext } from "@/lib/auth/context";
import { apiFetch } from "@/lib/api/client";
import type { TasksResponse } from "@/lib/api/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function getPendingApprovalsCount(): Promise<number | null> {
  try {
    const res = await apiFetch<TasksResponse>(
      "/api/v1/tasks?type=suggested_reply&status=pending",
    );
    return res.tasks.length;
  } catch {
    return null;
  }
}

export default async function OverviewPage() {
  const ctx = await getCurrentUserContext();
  if (!ctx) redirect("/login");
  const active = ctx.activeAgency;
  const awaitingApproval = await getPendingApprovalsCount();
  const t = await getTranslations("overview");

  const stats: { label: string; value: string | number }[] = [
    { label: t("stats.newLeadsToday"), value: "—" },
    { label: t("stats.awaitingApproval"), value: awaitingApproval ?? "—" },
    { label: t("stats.activeConversations"), value: "—" },
    { label: t("stats.responseTime"), value: "—" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("welcomeBack")}
        </h1>
        <p className="text-sm text-muted-foreground">{ctx.email}</p>
      </header>

      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>{active.agency.displayName}</CardTitle>
            <CardDescription>{t("activeAgencyDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Field
                label={t("fields.role")}
                value={capitalize(active.role)}
              />
              <Field
                label={t("fields.region")}
                value={active.agency.region ?? "—"}
              />
              <Field
                label={t("fields.languages")}
                value={
                  active.agency.languages.length > 0
                    ? active.agency.languages.join(", ")
                    : "—"
                }
              />
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription className="text-xs uppercase tracking-wide text-muted-foreground">
                {s.label}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight text-foreground">
                {s.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
