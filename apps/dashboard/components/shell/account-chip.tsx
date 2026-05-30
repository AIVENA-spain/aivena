"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronUp, LogOut } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { emailInitial } from "@/lib/auth/initials";

/**
 * Sidebar account chip — avatar + chevron only, with a popover (DropdownMenu)
 * anchored to the chip that opens upward. The popover sizes to its content so
 * the full email and full agency brand name render without truncation —
 * replaces the previous double-ellipsis chip that read as broken.
 *
 * Brand-name source. The popover prefers `branding.brand_name` (Vega's
 * dashboard_settings contract) over `ctx.activeAgency?.agency.displayName`
 * (built from trading_name/legal_name) so the chip stays consistent with what
 * Settings shows. Falls back to displayName, then to the email's domain part,
 * never empty.
 */
export function AccountChip({
  email,
  brandName,
  agencyDisplayName,
}: {
  email: string;
  /** Pulled from dashboard_settings().branding.brand_name by the layout. */
  brandName: string | null;
  /** ctx.activeAgency?.agency.displayName — used as a fallback. */
  agencyDisplayName: string | null;
}) {
  const tBar = useTranslations("topbar");
  const tMenu = useTranslations("accountMenu");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const initial = emailInitial(email);
  const resolvedAgency = resolveAgencyLabel(brandName, agencyDisplayName, email);

  const onSignOut = useCallback(() => {
    startTransition(async () => {
      try {
        const supabase = createClient();
        await supabase.auth.signOut();
      } catch (err) {
        console.error("[account-chip] signOut failed:", err);
      }
      router.replace("/login");
      router.refresh();
    });
  }, [router]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={tBar("userMenu")}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-[12px] font-semibold text-background"
        >
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {email}
        </span>
        <ChevronUp
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="min-w-[240px] p-0"
      >
        {/* Identity row — full email + full agency name, no truncation. */}
        <div className="flex items-start gap-3 p-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-semibold text-background"
          >
            {initial}
          </span>
          <div className="flex flex-col leading-tight">
            <span className="whitespace-nowrap text-[13px] font-semibold text-foreground">
              {email}
            </span>
            <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">
              {resolvedAgency}
            </span>
          </div>
        </div>

        <div className="border-t border-border/60" />

        {/* Sign out row — calls browser-client signOut, then routes to /login. */}
        <button
          type="button"
          onClick={onSignOut}
          disabled={pending}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden />
          <span>{pending ? tMenu("signOutPending") : tMenu("signOut")}</span>
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function resolveAgencyLabel(
  brandName: string | null,
  agencyDisplayName: string | null,
  email: string,
): string {
  if (brandName && brandName.trim()) return brandName.trim();
  if (agencyDisplayName && agencyDisplayName.trim()) return agencyDisplayName.trim();
  // Last resort: the email's domain part so we never render a blank line.
  const domain = email.split("@")[1] ?? "";
  return domain || "—";
}
