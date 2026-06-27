import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  MessageSquareWarning,
  Radio,
  ShieldAlert,
  HeartPulse,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import type {
  OperationsResponse,
  OpsHealthBucket,
  OpsProviderState,
} from "@/lib/api/types";

/**
 * Command center / operations (F1 + F2 + F4) — pure display of the read-only
 * /api/v1/operations aggregates. Honesty-first: every section renders the real
 * count, an honest empty state, or a "couldn't load" line when a live signal
 * degraded (data.*.available === false). No fabricated states. Deep links open
 * the relevant lead in the inbox where the actual action happens.
 *
 * UI chrome is English for now (operations i18n across the 13 locales is a
 * tracked follow-up, matching the Studio-wizard chrome) — only the nav label is
 * localised. No fake translations.
 */

// ---- honest state → colour ---------------------------------------------------

function providerBadge(state: OpsProviderState): { label: string; cls: string } {
  switch (state) {
    case "ready":
      return { label: "Ready", cls: "bg-brand-soft text-brand" };
    case "degraded":
      return { label: "Degraded", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
    case "disconnected":
      return { label: "Disconnected", cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" };
    case "unavailable":
      return { label: "Not available", cls: "bg-muted text-muted-foreground" };
    case "unknown":
    default:
      return { label: "Unknown", cls: "bg-muted text-muted-foreground" };
  }
}

const BUCKET_META: Record<OpsHealthBucket, { cls: string }> = {
  at_risk: { cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  stuck: { cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  waiting_on_you: { cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200" },
  awaiting_reply: { cls: "bg-muted text-foreground" },
  healthy: { cls: "bg-brand-soft text-brand" },
};

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", className)}>
      {children}
    </span>
  );
}

function SectionCard({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card shadow-soft">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-muted-foreground" aria-hidden>{icon}</span>
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {typeof count === "number" && count > 0 ? (
          <span className="ml-auto rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">
            {count}
          </span>
        ) : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function leadHref(leadId: string | null): string | null {
  return leadId ? `/approvals?leadId=${encodeURIComponent(leadId)}` : null;
}

function ageLabel(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

// ---- the view ----------------------------------------------------------------

export function OperationsWorkspace({ data }: { data: OperationsResponse }) {
  const { attention, failedSends, actionQueue, providers, lifecycle, signalHealth } = data;
  const degraded = signalHealth.filter((s) => !s.ok);
  const allClear =
    attention.openActionItems === 0 &&
    attention.atRiskLeads === 0 &&
    attention.providerIssues === 0 &&
    degraded.length === 0;

  const kpis: Array<{ label: string; value: number; tone: "neutral" | "warn" | "danger" }> = [
    { label: "Failed sends", value: attention.failedSends, tone: attention.failedSends > 0 ? "danger" : "neutral" },
    { label: "Open tasks", value: attention.openTasks, tone: attention.openTasks > 0 ? "warn" : "neutral" },
    { label: "At-risk leads", value: attention.atRiskLeads, tone: attention.atRiskLeads > 0 ? "danger" : "neutral" },
    { label: "Provider issues", value: attention.providerIssues, tone: attention.providerIssues > 0 ? "warn" : "neutral" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-[20px] font-bold tracking-[-0.02em] text-foreground">Command center</h1>
        <p className="text-[13px] text-muted-foreground">
          What needs your attention right now — built from live data only.
        </p>
      </div>

      {/* Attention KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 shadow-soft",
              k.value > 0 && k.tone === "danger" && "border-red-200 dark:border-red-500/30",
              k.value > 0 && k.tone === "warn" && "border-amber-200 dark:border-amber-500/30",
              k.value === 0 && "border-border",
            )}
          >
            <div
              className={cn(
                "text-[28px] font-bold leading-none tracking-[-0.02em]",
                k.value === 0
                  ? "text-foreground"
                  : k.tone === "danger"
                    ? "text-red-600 dark:text-red-300"
                    : "text-amber-600 dark:text-amber-300",
              )}
            >
              {k.value}
            </div>
            <div className="mt-1.5 text-[12px] text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </section>

      {allClear ? (
        <div className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-[13px] text-brand">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          All clear — no failed sends, open tasks, at-risk leads, or provider issues right now.
        </div>
      ) : null}

      {/* Failed sends (F2) */}
      <SectionCard icon={<MessageSquareWarning className="h-4 w-4" />} title="Failed sends" count={failedSends.count}>
        {!failedSends.available ? (
          <p className="text-[12px] text-muted-foreground">Couldn&apos;t load failed sends right now.</p>
        ) : failedSends.items.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No failed sends in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {failedSends.items.map((f) => {
              const href = leadHref(f.leadId);
              return (
                <li key={f.messageId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <span className="text-[13px] font-medium text-foreground">{f.leadName ?? "Unknown lead"}</span>
                  {f.channel ? <Pill className="bg-muted text-muted-foreground">{f.channel}</Pill> : null}
                  <Pill className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                    {f.status}
                  </Pill>
                  {f.at ? <span className="text-[11px] text-muted-foreground"><RelativeTime iso={f.at} /></span> : null}
                  {href ? (
                    <Link href={href} className="ml-auto text-[12px] font-semibold text-brand hover:underline">
                      Open in inbox
                    </Link>
                  ) : null}
                  {f.preview ? (
                    <p className="w-full truncate text-[11.5px] text-muted-foreground">{f.preview}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
          {failedSends.note}
        </p>
      </SectionCard>

      {/* Action queue (F2 + F1) */}
      <SectionCard icon={<Inbox className="h-4 w-4" />} title="Action queue" count={actionQueue.total}>
        {!actionQueue.available ? (
          <p className="text-[12px] text-muted-foreground">Couldn&apos;t load the action queue right now.</p>
        ) : actionQueue.items.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nothing waiting — the queue is clear.</p>
        ) : (
          <>
            {actionQueue.byType.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {actionQueue.byType.map((t) => (
                  <Pill key={t.type} className="bg-muted text-foreground">
                    {t.label} · {t.count}
                  </Pill>
                ))}
              </div>
            ) : null}
            <ul className="flex flex-col divide-y divide-border">
              {actionQueue.items.map((t) => {
                const href = leadHref(t.leadId);
                const age = ageLabel(t.ageHours);
                return (
                  <li key={t.taskId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <Pill className="bg-muted text-foreground">{t.label}</Pill>
                    <span className="text-[13px] font-medium text-foreground">{t.leadName ?? "Unknown lead"}</span>
                    {t.temperature ? (
                      <span className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{t.temperature}</span>
                    ) : null}
                    {age ? <span className="text-[11px] text-muted-foreground">· {age}</span> : null}
                    {href ? (
                      <Link href={href} className="ml-auto text-[12px] font-semibold text-brand hover:underline">
                        Open in inbox
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </SectionCard>

      {/* Provider health (F1) */}
      <SectionCard icon={<Radio className="h-4 w-4" />} title="Provider health">
        <ul className="flex flex-col gap-2.5">
          {providers.map((p) => {
            const b = providerBadge(p.state);
            return (
              <li key={p.provider} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium capitalize text-foreground">{p.provider}</span>
                  <Pill className={b.cls}>{b.label}</Pill>
                </div>
                <p className="text-[12px] text-muted-foreground">{p.detail}</p>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      {/* Lead lifecycle health (F4) */}
      <SectionCard icon={<HeartPulse className="h-4 w-4" />} title="Lead lifecycle health">
        {!lifecycle.available ? (
          <p className="text-[12px] text-muted-foreground">Couldn&apos;t load lifecycle health right now.</p>
        ) : lifecycle.buckets.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No active conversations to assess.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {lifecycle.buckets.map((b) => (
                <Pill key={b.key} className={BUCKET_META[b.key]?.cls ?? "bg-muted text-foreground"}>
                  {b.label} · {b.count}
                </Pill>
              ))}
            </div>
            {lifecycle.atRisk.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {lifecycle.atRisk.map((r) => {
                  const href = leadHref(r.leadId);
                  const age = ageLabel(r.ageHours);
                  return (
                    <li key={r.leadId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0">
                      <ShieldAlert
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          r.bucket === "at_risk" ? "text-red-600 dark:text-red-300" : "text-amber-600 dark:text-amber-300",
                        )}
                        aria-hidden
                      />
                      <span className="text-[13px] font-medium text-foreground">{r.leadName ?? "Unknown lead"}</span>
                      <span className="text-[12px] text-muted-foreground">{r.reason}</span>
                      {r.temperature ? (
                        <span className="text-[11px] uppercase tracking-[0.04em] text-muted-foreground">{r.temperature}</span>
                      ) : null}
                      {age ? <span className="text-[11px] text-muted-foreground">· {age}</span> : null}
                      {href ? (
                        <Link href={href} className="ml-auto text-[12px] font-semibold text-brand hover:underline">
                          Open in inbox
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12px] text-muted-foreground">No at-risk leads.</p>
            )}
          </>
        )}
      </SectionCard>

      {/* Honest degradation footer */}
      {degraded.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Some live signals couldn&apos;t be read just now ({degraded.map((d) => d.signal).join(", ")}). Those
            sections show what they could; nothing here is estimated or faked.
          </span>
        </div>
      ) : null}
    </div>
  );
}
