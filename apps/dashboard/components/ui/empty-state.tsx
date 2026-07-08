import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

// Shared empty-state body. Mirrors the original inline pattern in
// SellersEmptyState (inbox-workspace.tsx) — icon chip + headline + helper,
// natural height (no min-h-* forced rectangle). Callers wrap in a Card when
// the empty state replaces an entire card surface, or drop it straight into
// an existing CardContent when the surrounding card chrome (header etc.)
// must stay.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional CTA / helper node rendered under the copy — makes an empty state
   *  read as intentional (e.g. "Connect calendar", "Import properties"). */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden strokeWidth={1.7} />
      </div>
      <div className="text-[14px] font-semibold text-foreground">{title}</div>
      {description ? (
        <p className="max-w-[380px] text-[12.5px] leading-[1.55] text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
