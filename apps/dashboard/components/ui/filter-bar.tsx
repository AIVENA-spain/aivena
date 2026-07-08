import { Search } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared filter/search/sort toolbar (2026 redesign). A consistent white card row
 * that hosts a search field on the left and filter/sort controls on the right,
 * replacing each page's ad-hoc filter layouts. Purely presentational — callers
 * wire the inputs.
 */
export function FilterBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border border-border bg-card p-2.5 shadow-soft sm:flex-row sm:items-center",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Search input styled for the FilterBar (icon + rounded field). Uncontrolled or
 *  controlled via value/onChange from the caller. */
export function FilterSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex-1", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}
