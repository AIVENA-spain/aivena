"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Plus, Search, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type {
  AdminAgencyListItem,
  AgencyStatus,
  PlanTier,
} from "@/lib/api/admin-types";
function TestBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Test agency
    </span>
  );
}

function PlanPill({ tier }: { tier: PlanTier }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        tier === "unlimited"
          ? "bg-brand text-brand-fg"
          : tier === "pro"
            ? "bg-brand-soft text-brand"
            : "bg-muted text-muted-foreground",
      )}
    >
      {tier}
    </span>
  );
}

function StatusPill({ status }: { status: AgencyStatus }) {
  const tone =
    status === "active" ? "success" : status === "paused" ? "warning" : "neutral";
  return (
    <Badge tone={tone} className="capitalize">
      {status}
    </Badge>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AgenciesList({
  initialAgencies,
  loadError,
}: {
  initialAgencies: AdminAgencyListItem[];
  loadError: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>("all");
  const [plan, setPlan] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Internal test agencies (agencies.is_test, server truth) are hidden by default —
  // hidden from the view, never deleted. Toggle to show them.
  const [showTest, setShowTest] = useState(false);

  const testCount = useMemo(
    () => initialAgencies.filter((a) => a.is_test).length,
    [initialAgencies],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialAgencies.filter((a) => {
      if (!showTest && a.is_test) return false;
      if (status !== "all" && a.status !== status) return false;
      if (plan !== "all" && a.plan_tier !== plan) return false;
      if (q) {
        const hay = `${a.trading_name ?? ""} ${a.slug} ${a.legal_name ?? ""} ${
          a.primary_owner_email ?? ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [initialAgencies, status, plan, search, showTest]);

  if (loadError) {
    return (
      <Card>
        <div className="flex items-center gap-3 px-4 py-4 text-sm">
          <TriangleAlert className="h-4 w-4 flex-none text-amber-600" aria-hidden />
          <span className="text-muted-foreground">{loadError}</span>
        </div>
      </Card>
    );
  }

  if (initialAgencies.length === 0) {
    return (
      <Card className="bg-brand-soft/40">
        <EmptyState
          icon={Building2}
          title="No agencies yet"
          description="Create your first agency to start onboarding. It takes about three minutes."
        />
        <div className="flex justify-center pb-6">
          <Link href="/admin/agencies/new" className={buttonVariants({ size: "sm" })}>
            <Plus className="h-4 w-4" aria-hidden />
            Create your first agency
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, slug, or owner email"
            className="pl-8"
            aria-label="Search agencies"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="sm:w-40"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </Select>
        <Select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          aria-label="Filter by plan"
          className="sm:w-36"
        >
          <option value="all">All plans</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="unlimited">Unlimited</option>
        </Select>
        {testCount > 0 ? (
          <label
            className="flex flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap text-[12.5px] text-muted-foreground"
            title="Test agencies are hidden from this list, not deleted."
          >
            <input
              type="checkbox"
              checked={showTest}
              onChange={(e) => setShowTest(e.target.checked)}
              className="h-3.5 w-3.5 accent-muted-foreground"
            />
            Show hidden test agencies ({testCount})
          </label>
        ) : null}
      </div>
      {testCount > 0 && !showTest ? (
        <p className="text-[11.5px] text-muted-foreground">
          {testCount} test {testCount === 1 ? "agency is" : "agencies are"} hidden from this list —
          hidden, not deleted. Use the toggle to show {testCount === 1 ? "it" : "them"}.
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No matches"
            description="No agencies match these filters. Try clearing the search or changing the status."
          />
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-elevated">
          {/* Desktop table */}
          <div className="hidden sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Agency</th>
                  <th className="px-3 py-2.5 font-medium">Plan</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium text-right">Users</th>
                  <th className="px-3 py-2.5 font-medium text-right">Pending</th>
                  <th className="px-4 py-2.5 font-medium text-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => router.push(`/admin/agencies/${a.id}`)}
                    className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {a.trading_name ?? a.slug}
                        </span>
                        {a.is_test ? <TestBadge /> : null}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {a.slug}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <PlanPill tier={a.plan_tier} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {a.user_count}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {a.pending_invitation_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          {a.pending_invitation_count}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[12.5px] text-muted-foreground">
                      {fmtDate(a.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col divide-y divide-border/60 sm:hidden">
            {filtered.map((a) => (
              <Link
                key={a.id}
                href={`/admin/agencies/${a.id}`}
                className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {a.trading_name ?? a.slug}
                    </span>
                    {a.is_test ? <TestBadge /> : null}
                  </span>
                  <PlanPill tier={a.plan_tier} />
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {a.slug}
                </div>
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <StatusPill status={a.status} />
                  <span>· {a.user_count} users</span>
                  {a.pending_invitation_count > 0 ? (
                    <span className="text-foreground">
                      · {a.pending_invitation_count} pending
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
