/**
 * TEMPORARY, UI-ONLY test-agency hiding (approved 2026-07-02) — a hardcoded
 * allowlist of internal test agencies so the admin list isn't cluttered with
 * "delete me" rows. This is a stopgap: it does NOT touch the database. The real,
 * server-truth solution (an `agencies.is_test` flag + backfill + default-hide in
 * the RPC, and later an archive action) is parked as a separate approved-later
 * task (workboard [X5]). Because it's a hardcoded list it must be kept in sync by
 * hand — do not treat it as authoritative data.
 *
 * NOTHING here deletes, archives, or writes; it only filters the client-side view.
 */
export const TEST_AGENCY_IDS: ReadonlySet<string> = new Set([
  "cc-verify-delete-me",
  "cc-verify-email-test",
  "testing-agency",
  "wf1v2-test-agency-aaaaaaaaaaaa",
]);

export function isTestAgency(id: string): boolean {
  return TEST_AGENCY_IDS.has(id);
}
