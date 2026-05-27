import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Network — coming soon. No metrics, no fake matches; honest teaser only.
 */
export default function NetworkPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Network
        </h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Network
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Coming soon
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Opt-in cooperation with other AIVENA agencies — share buyers or
          listings on agreed terms.
        </CardContent>
      </Card>
    </div>
  );
}
