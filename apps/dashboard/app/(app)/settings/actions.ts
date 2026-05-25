"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { apiFetch, ApiError } from "@/lib/api/client";
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  isLocale,
} from "@/lib/i18n/config";

type Patch = {
  uiLanguage?: string;
  messageLanguage?: string;
  theme?: string;
};

export type PreferencesResult =
  | {
      ok: true;
      preferences: {
        uiLanguage: string;
        messageLanguage: string;
        theme: string;
      };
    }
  | { ok: false };

/**
 * Server-side preference save. Calls the guarded API, then mirrors the new
 * values into the locale + theme cookies so the next server render is
 * correctly localised and themed without waiting for a client roundtrip.
 *
 * Always returns a stable success/failure flag — the page renders a friendly
 * inline message based on `ok`. The technical detail is logged server-side
 * only; we never bubble status codes or stack text to the UI.
 */
export async function updatePreferencesAction(
  patch: Patch,
): Promise<PreferencesResult> {
  try {
    const res = await apiFetch<{
      uiLanguage: string;
      messageLanguage: string;
      theme: string;
    }>("/api/v1/me/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });

    const cookieStore = await cookies();
    const year = 60 * 60 * 24 * 365;
    if (isLocale(res.uiLanguage)) {
      cookieStore.set(LOCALE_COOKIE, res.uiLanguage, {
        path: "/",
        maxAge: year,
        sameSite: "lax",
      });
    }
    // We don't write the THEME_COOKIE here. The theme cookie stores the
    // *resolved* theme ('light' | 'dark') and is written client-side by
    // ThemeCookieSync whenever next-themes' resolvedTheme changes. Writing it
    // server-side would race with the client's resolution of 'system'.

    revalidatePath("/", "layout");

    return {
      ok: true,
      preferences: {
        uiLanguage: res.uiLanguage,
        messageLanguage: res.messageLanguage,
        theme: res.theme,
      },
    };
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[settings] updatePreferencesAction failed:", detail);
    return { ok: false };
  }
}
