import type { AgencyAuditEntry } from "@/lib/api/admin-types";

/**
 * PURE, React-free formatting of a staff-audit entry into a human title + detail
 * for the admin Audit tab. English-only (admin surface). Never invents data — it
 * only reads the entry's metadata the RPCs wrote.
 */
export function describeAuditEntry(e: AgencyAuditEntry): { title: string; detail: string } {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const reasonText = typeof m.reason === "string" && m.reason.trim() ? m.reason.trim() : null;
  const withReason = (base: string) => (reasonText ? `${base} — “${reasonText}”` : base);

  switch (e.action) {
    case "set_agency_status": {
      const from = String(m.from ?? "");
      const to = String(m.to ?? "");
      const title = to === "archived" ? "Archived" : from === "archived" ? "Restored" : "Status changed";
      return { title, detail: withReason(`${from} → ${to}`) };
    }
    case "set_test_flag": {
      const title = m.to === true ? "Marked as test agency" : "Unmarked as test agency";
      return { title, detail: reasonText ? `“${reasonText}”` : "—" };
    }
    case "set_pilot_status": {
      return { title: "Pilot status", detail: withReason(`${String(m.from ?? "")} → ${String(m.to ?? "")}`) };
    }
    default:
      return { title: e.action ?? e.event_type ?? "Action", detail: reasonText ? `“${reasonText}”` : "—" };
  }
}
