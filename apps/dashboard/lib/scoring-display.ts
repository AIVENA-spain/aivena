import type { UrgencySignal } from "@/lib/api/types";

/**
 * How a live score and its urgency read on screen (Stage 3b). The words live in the `inbox.intel` catalogue; this only
 * picks the message and its values, so the choice is testable without rendering.
 */

export type UrgencyMessageKey =
  | "urgencyWaiting"
  | "urgencyWaitingToday"
  | "urgencyViewingPassed"
  | "urgencyInactive"
  | "urgencyDormant";
export type UrgencyMessage = { key: UrgencyMessageKey; values: Record<string, string | number> };

export function urgencyMessages(
  signals: UrgencySignal[] | null | undefined,
  formatDay: (isoDay: string) => string = (d) => d,
): UrgencyMessage[] {
  return (signals ?? []).map((s): UrgencyMessage => {
    switch (s.kind) {
      case "waiting_for_reply":
        // "Today" is its own message: the catalogue check reads only standard plural branches, not "=0".
        return s.days === 0 ? { key: "urgencyWaitingToday", values: {} } : { key: "urgencyWaiting", values: { days: s.days } };
      case "viewing_date_passed":
        return { key: "urgencyViewingPassed", values: { date: formatDay(s.date) } };
      case "inactive":
        return { key: "urgencyInactive", values: { days: s.days } };
      case "dormant":
        return { key: "urgencyDormant", values: { days: s.days } };
    }
  });
}

/** "13 Sep, 10:02" in the viewer's language. */
export const formatScoredAt = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** "3 Sep" for a calendar day, independent of the viewer's time zone. */
export const formatDay = (isoDay: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${isoDay}T00:00:00Z`));
