import { TriangleAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { PilotStatus } from "@/lib/api/types";
import { PageHeading } from "../../../_components/page-heading";
import { getAgencyAction, getAgencyReadinessAction } from "../../../admin-actions";
import { AgencyTabs } from "../agency-tabs";
import { GoLiveSummary } from "./go-live-summary";
import { ReadinessPanel } from "./readiness-panel";
import { ReadinessRail } from "./readiness-rail";
import { GoLiveControl } from "./go-live-control";

export const dynamic = "force-dynamic";

/**
 * Internal AIVENA staff go-live surface for one agency (C4). Server component:
 * pulls the agency + a fresh target-agency readiness recompute, renders the
 * honest readiness panel, and mounts the lifecycle control. Staff-gated by the
 * admin layout (non-staff get 404). English-only (brief §12).
 */
export default async function AgencyGoLivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, readiness] = await Promise.all([
    getAgencyAction(id),
    getAgencyReadinessAction(id),
  ]);

  if (!detail.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading title="Go-Live" back={{ href: "/admin/agencies", label: "Agencies" }} />
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
  const pilotFromAgency =
    typeof agency.pilot_status === "string" ? (agency.pilot_status as PilotStatus) : null;
  const currentPilot: PilotStatus | null = readiness.ok
    ? readiness.data.pilotStatus
    : pilotFromAgency;
  const itemLabels: Record<string, string> = readiness.ok
    ? Object.fromEntries(readiness.data.items.map((i) => [i.id, i.label]))
    : {};

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title={`${tradingName} — Go-Live`}
        back={{ href: `/admin/agencies/${agency.id}`, label: tradingName }}
      />

      <AgencyTabs agencyId={agency.id} />

      {readiness.ok ? (
        /* Two-column layout (approved mockups): the verdict → control → grouped
           checks flow stays in the main column; the right rail carries the
           at-a-glance readiness summary ring. Same data, zero behavior change. */
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <GoLiveSummary readiness={readiness.data} />
            <GoLiveControl agencyId={agency.id} currentPilot={currentPilot} itemLabels={itemLabels} />
            <ReadinessPanel readiness={readiness.data} />
          </div>
          <div className="lg:sticky lg:top-4">
            <ReadinessRail readiness={readiness.data} />
          </div>
        </div>
      ) : (
        <>
          <Card>
            <div className="flex items-start gap-3 px-4 py-4 text-sm">
              <TriangleAlert className="h-4 w-4 flex-none text-amber-600" aria-hidden />
              <span className="text-muted-foreground">
                Live readiness couldn&rsquo;t be loaded ({readiness.error}). You can still change
                the pilot status below — the server re-checks readiness on every change.
              </span>
            </div>
          </Card>
          <GoLiveControl agencyId={agency.id} currentPilot={currentPilot} itemLabels={itemLabels} />
        </>
      )}
    </div>
  );
}
