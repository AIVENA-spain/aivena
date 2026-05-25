import { redirect } from "next/navigation";

import { getCurrentUserContext } from "@/lib/auth/context";
import { NoAgencyState } from "@/components/shell/no-agency-state";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentUserContext();
  if (!ctx) redirect("/login");

  if (ctx.memberships.length === 0) {
    return <NoAgencyState email={ctx.email} />;
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <Sidebar ctx={ctx} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar ctx={ctx} />
        <main className="flex-1 overflow-y-auto px-6 py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
