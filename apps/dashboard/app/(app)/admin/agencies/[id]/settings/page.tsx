import { TriangleAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { PageHeading } from "../../../_components/page-heading";
import { getAgencyAction, getAgencyInvitationsAction } from "../../../admin-actions";
import { AgencyTabs } from "../agency-tabs";
import { AgencyDetailsForm } from "./agency-details-form";
import { InvitationsPanel } from "./invitations-panel";

export const dynamic = "force-dynamic";

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Admin agency Settings tab (Phase 2) — staff-only edit of core agency details +
 * invitation management. Staff-gated by the admin layout. English-only.
 */
export default async function AgencySettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, invites] = await Promise.all([
    getAgencyAction(id),
    getAgencyInvitationsAction(id),
  ]);

  if (!detail.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading title="Settings" back={{ href: "/admin/agencies", label: "Agencies" }} />
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
  const tradingName = (typeof agency.trading_name === "string" && agency.trading_name.trim()) || agency.slug;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading
        title={`${tradingName} — Settings`}
        back={{ href: `/admin/agencies/${agency.id}`, label: tradingName }}
      />
      <AgencyTabs agencyId={agency.id} />

      <AgencyDetailsForm
        agencyId={agency.id}
        slug={agency.slug}
        initial={{
          legal_name: s(agency.legal_name),
          trading_name: s(agency.trading_name),
          cif_nif: s((agency as Record<string, unknown>).cif_nif),
          primary_region: s(agency.primary_region),
          primary_owner_email: s(agency.primary_owner_email),
          primary_owner_phone: s((agency as Record<string, unknown>).primary_owner_phone),
          notes: s((agency as Record<string, unknown>).notes),
        }}
      />

      {invites.ok ? (
        <InvitationsPanel agencyId={agency.id} invitations={invites.data} />
      ) : (
        <Card>
          <div className="flex items-start gap-3 px-4 py-4 text-sm">
            <TriangleAlert className="h-4 w-4 flex-none text-amber-600" aria-hidden />
            <span className="text-muted-foreground">
              Invitations couldn&rsquo;t be loaded ({invites.error}).
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
