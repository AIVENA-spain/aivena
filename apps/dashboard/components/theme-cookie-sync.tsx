"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

import { THEME_COOKIE } from "@/lib/i18n/config";

/**
 * Mirrors the *resolved* theme ('light' | 'dark') into a cookie so the next
 * server render of <html className=...> already matches the user's actual
 * theme — preventing a FOUC on reload. We store the resolved value (not the
 * preference) because the SSR pass can't compute `prefers-color-scheme`
 * itself; the cookie carries last-known truth.
 *
 * The preference ('light' | 'dark' | 'system') is persisted server-side in
 * user_preferences via the API; that is the source of truth for what the user
 * picked. This cookie is purely a UI render hint.
 */
export function ThemeCookieSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    document.cookie = `${THEME_COOKIE}=${resolvedTheme}; path=/; max-age=${
      60 * 60 * 24 * 365
    }; SameSite=Lax`;
  }, [resolvedTheme]);

  return null;
}
