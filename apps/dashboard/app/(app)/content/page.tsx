import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Content — coming soon. The real section (AI-generated social posts +
 * ad creative the agency posts themselves) lands in a later step per the
 * design plan. Until then this is a clean placeholder so the nav resolves.
 *
 * Per the data-honesty law, this page shows NO metrics, NO sample numbers.
 * (The plan does allow a watermarked sample preview on Content + Network
 * eventually — that gets built in its own pass, not here.)
 */
export default function ContentPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Content
        </h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Content
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              Soon
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          AI-generated social posts and ad creative — drafted for your
          agency&apos;s tone, your colours, your buyer languages. You post them
          yourself; AIVENA never touches your ad budget.
        </CardContent>
      </Card>
    </div>
  );
}
