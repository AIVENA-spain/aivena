import Link from "next/link";
import { Plus } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeading } from "../_components/page-heading";
import { listAgenciesAction } from "../admin-actions";
import { AgenciesList } from "./agencies-list";

export const dynamic = "force-dynamic";

/**
 * Agency list. Loads server-side, then a client island handles status/plan/
 * search filtering against the loaded set. Staff-gated by the admin layout.
 */
export default async function AgenciesPage() {
  const res = await listAgenciesAction();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="Onboarding console"
        title="Agencies"
        description="Every agency on AIVENA, with plan, team, and invitation status."
        back={{ href: "/admin", label: "Admin" }}
        action={
          <Link
            href="/admin/agencies/new"
            className={buttonVariants({ size: "sm" })}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New agency
          </Link>
        }
      />
      <AgenciesList
        initialAgencies={res.ok ? res.data : []}
        loadError={res.ok ? null : res.error}
      />
    </div>
  );
}
