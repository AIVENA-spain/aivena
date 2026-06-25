"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Property thumbnail with a guaranteed graceful fallback. Tries each candidate
 * URL in order (a property often carries many image URLs, some stale); the first
 * one that loads wins. If every URL fails (or there are none) it shows a clean,
 * intentional "no photo" state — it never renders a broken <img> and never
 * invents a photo. `emptyLabel` adds a caption on larger thumbnails.
 * Own "use client" module so the formatters in _shared stay server-safe.
 */
export function PropertyThumb({
  src,
  srcs,
  alt,
  className,
  emptyLabel,
}: {
  /** Single URL (back-compat). */
  src?: string | null;
  /** Ordered candidate URLs — first reachable one is used. */
  srcs?: (string | null | undefined)[];
  alt: string;
  className?: string;
  emptyLabel?: string;
}) {
  const candidates = (srcs && srcs.length ? srcs : src ? [src] : []).filter(
    (u): u is string => !!u,
  );
  const [idx, setIdx] = useState(0);

  // Reset to the first candidate whenever the set of URLs changes (new property).
  const key = candidates.join("|");
  useEffect(() => {
    setIdx(0);
  }, [key]);

  const current = candidates[idx];
  const showImg = !!current;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 overflow-hidden bg-gradient-to-br from-muted/70 to-muted/30 text-muted-foreground",
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current}
          src={current}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIdx((i) => i + 1)}
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background/60">
            <ImageOff className="h-4 w-4 opacity-60" aria-hidden strokeWidth={1.75} />
          </span>
          {emptyLabel ? (
            <span className="px-2 text-center text-[10.5px] font-medium opacity-70">
              {emptyLabel}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
