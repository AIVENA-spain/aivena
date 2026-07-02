import { Clock, TriangleAlert, User } from "lucide-react";

import { Card } from "@/components/ui/card";
import { PageHeading } from "../../../_components/page-heading";
import { getAgencyAction, getAgencyAuditAction } from "../../../admin-actions";
import { AgencyTabs } from "../agency-tabs";
import { describeAuditEntry } from "./audit-format";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Agency Audit tab (Phase 1) — read-only history from the staff_audit_log
 * (staff-gated RPC). Shows every recorded staff action on the agency (status
 * changes, test-flag changes, pilot changes) with actor + reason. Staff-only via
 * the admin layout. English-only.
 */
export default async function AgencyAuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, audit] = await Promise.all([getAgencyAction(id), getAgencyAuditAction(id)]);

  if (!detail.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading title="Audit" back={{ href: "/admin/agencies", label: "Agencies" }} />
        <Card>
          <div className="flex items-center gap-3 px-4 py-4 text-sm">
            <TriangleAlert className="h-4 w-4 flex-none text-amber-600" aria-hidden />
            <span className="text-muted-foreground">{detail.error}</span>
          </div>
        </Card>
      </div>
    );
  }

  const agency = detail.data.agency;
  const tradingName =
    (typeof agency.trading_name === "string" && agency.trading_name.trim()) || agency.slug;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title={`${tradingName} — Audit`}
        back={{ href: `/admin/agencies/${agency.id}`, label: tradingName }}
      />
      <AgencyTabs agencyId={agency.id} />

      {!audit.ok ? (
        <Card>
          <div className="flex items-center gap-3 px-4 py-4 text-sm">
            <TriangleAlert className="h-4 w-4 flex-none text-amber-600" aria-hidden />
            <span className="text-muted-foreground">
              The audit history couldn&rsquo;t be loaded ({audit.error}).
            </span>
          </div>
        </Card>
      ) : audit.data.length === 0 ? (
        <Card>
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No recorded staff actions for this agency yet.
          </p>
        </Card>
      ) : (
        <Card className="gap-0 p-0">
          <ul className="flex flex-col divide-y divide-border/60">
            {audit.data.map((e) => {
              const d = describeAuditEntry(e);
              return (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-foreground">{d.title}</span>
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden />
                      {when(e.created_at)}
                    </span>
                  </div>
                  <span className="text-[12.5px] text-muted-foreground">{d.detail}</span>
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground/80">
                    <User className="h-3 w-3" aria-hidden />
                    {e.actor_email ?? "unknown"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
