import { PageHeading } from "../../_components/page-heading";
import { AgencyWizard } from "./agency-wizard";

export const dynamic = "force-dynamic";

/**
 * New agency — 5-step wizard. Staff-gated by the admin layout.
 */
export default function NewAgencyPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Onboarding console"
        title="New agency"
        description="From sign-up to a live, branded agency in a few minutes."
        back={{ href: "/admin/agencies", label: "Agencies" }}
      />
      <AgencyWizard />
    </div>
  );
}
