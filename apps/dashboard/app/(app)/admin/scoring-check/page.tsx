import { PageHeading } from "../_components/page-heading";
import { getShadowResultsAction } from "./actions";
import { ScoringCheckClient } from "./scoring-check-client";
import { ShadowResults } from "./shadow-results";

export const dynamic = "force-dynamic";

/**
 * Admin → Scoring check. Internal and staff-only: the admin layout returns "not found" to everyone who is not AIVENA
 * staff, and it never appears in an agency's navigation. English-only like the rest of Admin.
 */
export default async function ScoringCheckPage() {
  const shadow = await getShadowResultsAction();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        back={{ href: "/admin", label: "Admin" }}
        eyebrow="AIVENA staff · internal"
        title="Scoring check"
        description="Runs the 11 practice conversations through the real lead scorer, and shows what it made of real conversations in shadow mode."
      />
      <ScoringCheckClient />
      <ShadowResults status={shadow.ok ? shadow.data : null} error={shadow.ok ? null : shadow.error} />
    </div>
  );
}
