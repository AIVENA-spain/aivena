import { redirect } from "next/navigation";

import { getCurrentUserContext } from "@/lib/auth/context";
import { PageStub } from "@/components/shell/page-stub";

export default async function AdminPage() {
  const ctx = await getCurrentUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.isAivenaStaff) redirect("/");

  return (
    <PageStub
      title="All Agencies"
      description="AIVENA staff god-view. Restricted to aivena_staff role."
    />
  );
}
