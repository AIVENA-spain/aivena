"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { updatePreferencesAction } from "@/app/(app)/settings/actions";

type ThemeChoice = "light" | "dark" | "system";

/**
 * Compact segmented Light/Dark/System toggle for the topbar.
 *
 * - Calls `setTheme(value)` from next-themes — the class on <html> flips and
 *   the cookie-sync component writes the resolved theme cookie immediately.
 * - Fires-and-forgets a server action to persist the choice to
 *   user_preferences so the next session matches.
 * - Failure of the API call doesn't roll back the UI — the brief specifies
 *   the toggle is "working," and the user can re-flip if it didn't stick.
 *   Technical errors are logged server-side by updatePreferencesAction.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const t = useTranslations("topbar");
  const [, startTransition] = useTransition();

  // next-themes can't resolve the user's actual theme during SSR — no
  // localStorage on the server. To keep the markup byte-identical between
  // server and the very first client render, we render the buttons with no
  // active state until `mounted` flips true after hydration. That avoids the
  // aria-pressed / className mismatch warning entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: ThemeChoice =
    theme === "light" || theme === "dark" ? theme : "system";

  function select(value: ThemeChoice) {
    if (value === current) return;
    setTheme(value);
    startTransition(async () => {
      await updatePreferencesAction({ theme: value });
    });
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5"
      role="group"
      aria-label={t("themeLabel")}
    >
      <ThemeOpt
        active={mounted && current === "light"}
        onClick={() => select("light")}
        icon={<Sun className="h-3.5 w-3.5" aria-hidden />}
        label={t("themeLight")}
      />
      <ThemeOpt
        active={mounted && current === "dark"}
        onClick={() => select("dark")}
        icon={<Moon className="h-3.5 w-3.5" aria-hidden />}
        label={t("themeDark")}
      />
      <ThemeOpt
        active={mounted && current === "system"}
        onClick={() => select("system")}
        icon={<Monitor className="h-3.5 w-3.5" aria-hidden />}
        label={t("themeSystem")}
      />
    </div>
  );
}

function ThemeOpt({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
