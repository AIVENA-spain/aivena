import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { PageHeading } from "./_components/page-heading";

/**
 * Admin home. Link cards to the sub-sections. Staff-gated by the admin layout.
 * English-only (brief §12).
 */
export default function AdminHome() {
  const sections = [
    {
      href: "/admin/agencies",
      icon: Building2,
      title: "Agencies",
      description:
        "Onboard new agencies, manage plans, branding, team, and invitations.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        eyebrow="AIVENA staff"
        title="Admin"
        description="Super-admin console. Restricted to AIVENA staff."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="group/link">
            <Card className="px-4 py-4 transition-shadow group-hover/link:shadow-elevated">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <s.icon className="h-5 w-5" aria-hidden strokeWidth={1.8} />
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-foreground">
                    {s.title}
                  </span>
                  <span className="text-[12.5px] leading-snug text-muted-foreground">
                    {s.description}
                  </span>
                </div>
                <ChevronRight
                  className="ml-auto h-4 w-4 flex-none text-muted-foreground transition-transform group-hover/link:translate-x-0.5"
                  aria-hidden
                />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
