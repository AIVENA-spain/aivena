import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Shared admin page heading. `eyebrow` renders as an italic Instrument Serif
 * tagline above the title (CRAFT emphasis). `back` adds a subtle back link.
 */
export function PageHeading({
  title,
  eyebrow,
  description,
  back,
  action,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          {eyebrow ? (
            <span className="font-serif text-[15px] italic leading-none text-brand">
              {eyebrow}
            </span>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex-none">{action}</div> : null}
      </div>
    </div>
  );
}
