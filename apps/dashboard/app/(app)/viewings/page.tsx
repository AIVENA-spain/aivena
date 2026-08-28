import { apiFetch, ApiError } from "@/lib/api/client";
import { PageLoadError } from "@/components/shell/page-error";
import { getCurrentUserContext } from "@/lib/auth/context";
import type {
  AmandaSettingsResponse,
  BookingRow,
  BookingsResponse,
  PropertiesResponse,
  PropertyRow,
} from "@/lib/api/types";

import { ViewingsWorkspace } from "./viewings-workspace";

export const dynamic = "force-dynamic";

/**
 * Viewings — AIVENA's built-in calendar over `bookings` (W11). Month + list
 * views with manual create / reschedule / cancel via Vega's RPCs
 * (create_manual_viewing / update_viewing / cancel_viewing). Manual creation
 * never sends anything (p_send_confirmation is not exposed). Agencies with
 * Google Calendar connected still sync; this view works without it.
 */
export default async function ViewingsPage() {
  const ctx = await getCurrentUserContext();
  const agencyId = ctx?.activeAgency?.agencyId ?? null;

  let bookings: BookingRow[] = [];
  let properties: PropertyRow[] = [];
  let amanda: AmandaSettingsResponse | null = null;
  try {
    const [bookingsRes, propsRes, amandaRes] = await Promise.allSettled([
      apiFetch<BookingsResponse>("/api/v1/bookings"),
      agencyId
        ? apiFetch<PropertiesResponse>(
            `/api/v1/agencies/${encodeURIComponent(agencyId)}/properties`,
          )
        : Promise.resolve({ properties: [] as PropertyRow[] }),
      // Availability (viewing hours + blocked days) rides the calendar page
      // too — degrades to null pre-migration, the drawer simply hides.
      apiFetch<AmandaSettingsResponse>("/api/v1/amanda/settings"),
    ]);
    if (bookingsRes.status === "rejected") throw bookingsRes.reason;
    bookings = bookingsRes.value.bookings;
    if (propsRes.status === "fulfilled") properties = propsRes.value.properties;
    if (amandaRes.status === "fulfilled") amanda = amandaRes.value;
  } catch (err) {
    const detail =
      err instanceof ApiError
        ? `${err.status} ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[/viewings] load failed:", detail);
    return <PageLoadError />;
  }

  return <ViewingsWorkspace bookings={bookings} properties={properties} amanda={amanda} />;
}
