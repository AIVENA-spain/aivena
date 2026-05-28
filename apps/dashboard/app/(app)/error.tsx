"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Route-level safety net for the authenticated dashboard segment. Page loaders
 * already catch their own fetch failures and render <PageLoadError />; this
 * boundary catches anything that slips through — an uncaught throw during a
 * client component's render, a bad data shape, etc. The user only ever sees
 * the canonical friendly line; the real error is logged to the console (and
 * Next records its digest server-side). `reset()` re-renders the segment so a
 * transient blip can recover without a full reload.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    console.error("[app/(app)] render error boundary caught:", error);
  }, [error]);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">{t("pageLoad")}</p>
        <Button type="button" onClick={() => reset()}>
          {t("retry")}
        </Button>
      </CardContent>
    </Card>
  );
}
