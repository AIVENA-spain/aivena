import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from "@/lib/i18n/config";

/**
 * Locale lookup is cookie-driven — no /en/, /pl/, etc. URL prefix. Each user
 * picks their dashboard language in Settings and that choice is persisted
 * server-side in user_preferences AND mirrored to a cookie so the next render
 * is correctly localised without any client roundtrip.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const value = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(value) ? value : DEFAULT_LOCALE;

  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
