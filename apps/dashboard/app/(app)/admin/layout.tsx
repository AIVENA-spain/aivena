import { notFound, redirect } from "next/navigation";

import { getCurrentUserContext } from "@/lib/auth/context";

/**
 * Admin section guard. Renders inside the (app) shell (sidebar + topbar).
 *
 * Non-staff must NOT learn the route exists — so a non-staff (or signed-in but
 * unauthorized) user gets the standard 404, never a 403 or a redirect. Signed-
 * out users still go to /login. Staff status is the canonical
 * `app_metadata.aivena_staff`, resolved in getCurrentUserContext.
 *
 * The admin UI is English-only (brief §12).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.isAivenaStaff) notFound();

  return <div className="flex flex-col gap-6">{children}</div>;
}
