import { PageHeading } from "../_components/page-heading";
import { ScoringCheckClient } from "./scoring-check-client";

export const dynamic = "force-dynamic";

/**
 * Admin → Scoring check. Internal and staff-only: the admin layout returns "not found" to everyone who is not AIVENA
 * staff, and it never appears in an agency's navigation. English-only like the rest of Admin.
 */
export default function ScoringCheckPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        back={{ href: "/admin", label: "Admin" }}
        eyebrow="AIVENA staff · internal"
        title="Scoring check"
        description="Runs the 11 practice conversations through the real lead scorer. Writes nothing and scores no real lead."
      />
      <ScoringCheckClient />
    </div>
  );
}
