import { Card, CardContent } from "@/components/ui/card";

/**
 * Calm, user-facing fallback for infrastructure failures (API down, schema
 * cache cold, network blip). The underlying technical error is logged on the
 * server but never shown to the user. Domain errors from individual actions —
 * "lead has opted out", "task already handled" — are surfaced separately by
 * each form's own error state.
 */
export function PageLoadError() {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-neutral-600">
        Something went wrong loading this page. Please refresh — if it keeps
        happening, contact support.
      </CardContent>
    </Card>
  );
}
