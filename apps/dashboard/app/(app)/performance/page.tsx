import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Performance — Pilot 1 view. Layout + chart land in phase (d). The actual
 * aggregates are data-seams awaiting Vega's read contract; until then this
 * page shows a clean loading/empty state, not fabricated metrics.
 */
// DATA-SEAM: bind to <performance> read contract from Vega — expects
//   { period, leadsAnsweredByWeek: [{ weekStart, count }], aggregates: {...} }
export default function PerformancePage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Performance
        </h1>
        <p className="text-sm text-muted-foreground">
          Reply volume, response time, and lane mix. Aggregates land when the
          data contract is wired.
        </p>
      </header>
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted-foreground">
          Loading — Performance data isn&apos;t wired yet.
        </CardContent>
      </Card>
    </div>
  );
}
