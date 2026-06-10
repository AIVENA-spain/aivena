import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Users, MailWarning, Clock, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeading } from "../../_components/page-heading";
import { getAgencyAction } from "../../admin-actions";
import { AgencyTabs } from "./agency-tabs";

export const dynamic = "force-dynamic";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function relTime(iso: string | null): string {
  if (!iso) return "No activity yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default async function AgencyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await getAgencyAction(id);

  if (!res.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Agency"
          back={{ href: "/admin/agencies", label: "Agencies" }}
        />
        <Card>
          <div className="flex items-center gap-3 px-4 py-4 text-sm">
            <TriangleAlert className="h-4 w-4 flex-none text-amber-600" aria-hidden />
            <span className="text-muted-foreground">{res.error}</span>
          </div>
        </Card>
      </div>
    );
  }

  const { agency, settings, branding, user_count, pending_invitation_count, last_activity_at } =
    res.data;
  if (!agency) notFound();

  const tradingName = str(agency.trading_name) ?? agency.slug;
  const planTier = str((settings as Record<string, unknown> | null)?.plan_tier) ?? "starter";
  const status = str(agency.status) ?? "active";
  const logoUrl = str((branding as Record<string, unknown> | null)?.logo_url);
  const initials = tradingName.slice(0, 2).toUpperCase();
  const languages = Array.isArray(agency.supported_languages)
    ? (agency.supported_languages as string[])
    : [];

  const stats = [
    { icon: Users, label: "Team", value: String(user_count ?? 0) },
    {
      icon: MailWarning,
      label: "Pending invites",
      value: String(pending_invitation_count ?? 0),
      warn: (pending_invitation_count ?? 0) > 0,
    },
    { icon: Clock, label: "Last activity", value: relTime(last_activity_at) },
    { icon: Sparkles, label: "Plan", value: planTier, capitalize: true },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title={tradingName}
        back={{ href: "/admin/agencies", label: "Agencies" }}
      />

      {/* Identity header */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-xl bg-brand-soft text-brand">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={tradingName}
                width={56}
                height={56}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <span className="text-lg font-semibold">{initials}</span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-lg font-semibold text-foreground">{tradingName}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[12px] text-muted-foreground">{agency.slug}</span>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                {planTier}
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                  status === "active"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : status === "paused"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {status}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-1.5 p-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <s.icon className="h-3.5 w-3.5" aria-hidden />
              <span className="text-[11px] uppercase tracking-wide">{s.label}</span>
            </div>
            <span
              className={cn(
                "text-lg font-semibold text-foreground",
                s.capitalize && "capitalize",
                s.warn && "text-amber-600 dark:text-amber-400",
              )}
            >
              {s.value}
            </span>
          </Card>
        ))}
      </div>

      <AgencyTabs agencyId={agency.id} />

      {/* Overview body */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <h2 className="text-sm font-semibold text-foreground">Details</h2>
          <dl className="flex flex-col gap-2 text-sm">
            <DetailRow label="Owner email" value={str(agency.primary_owner_email) ?? "—"} />
            <DetailRow label="Legal name" value={str(agency.legal_name) ?? "—"} />
            <DetailRow label="Region" value={str(agency.primary_region) ?? "—"} />
            <DetailRow
              label="Languages"
              value={languages.length ? languages.join(", ") : "—"}
            />
            <DetailRow
              label="Created"
              value={
                str(agency.created_at)
                  ? new Date(String(agency.created_at)).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"
              }
            />
          </dl>
        </Card>

        <Card className="gap-3 p-4">
          <h2 className="text-sm font-semibold text-foreground">Next steps</h2>
          <p className="font-serif text-[13.5px] italic text-muted-foreground">
            Settings, branding, team, and the audit trail open up in the next
            phases.
          </p>
          <ul className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
            <li>· Set plan quotas, channels, and working hours</li>
            <li>· Upload a logo and tune brand colours and voice</li>
            <li>· Invite team members and manage roles</li>
          </ul>
          {pending_invitation_count > 0 ? (
            <p className="text-[12.5px] text-amber-600 dark:text-amber-400">
              {pending_invitation_count} invitation
              {pending_invitation_count === 1 ? "" : "s"} pending.
            </p>
          ) : null}
          <div>
            <Link
              href="/admin/agencies"
              className="text-[13px] text-brand underline-offset-4 hover:underline"
            >
              ← Back to all agencies
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[60%] text-right text-foreground">{value}</dd>
    </div>
  );
}
