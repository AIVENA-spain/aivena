import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  LOCALE_COOKIE,
  catalogLocaleFor,
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
  // catalogLocaleFor, NOT isLocale: the cookie can legitimately hold 'nb'
  // (canonical Norwegian in storage) while the catalogue file is no.json.
  // A bare isLocale() check rendered those users in English.
  const locale: Locale = catalogLocaleFor(value);

  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
