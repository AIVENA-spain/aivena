// property-sync — pure, dependency-free safety logic. No Deno, no network, no DB → unit-testable
// (guard.test.ts). The I/O (fetch, storage upload, upsert, withdraw) stays in index.ts.

// ── Withdrawal guard ──────────────────────────────────────────────────────────────────────────
//
// The old sync withdrew EVERY active property not in the feed, with no guard. A truncated feed, a
// CRM that re-keys its ids, or a wrong agency_id in the invoke would therefore mass-withdraw a whole
// catalogue in one run. This is the guard that stops it.
//
// RULE (defer, don't abort): block the withdrawal step when it would remove more than a FLOOR of
// listings AND more than a PERCENTAGE of the agency's currently-active feed-owned catalogue. The
// upsert still lands; only the withdrawal is held, the run is marked needs_review, and the next
// healthy sync withdraws correctly. A human can force a genuine mass-delisting with allowMassWithdraw.
//
//   block  ⇔  toWithdraw > floor(5)  AND  toWithdraw > pctCap(20%) × activeBefore
//
// The FLOOR keeps small catalogues working (a 12-listing agency selling 4 is normal, 4 ≤ 5 → allowed);
// the PERCENTAGE catches the catastrophic cases (140-of-141, full re-key, wrong agency). `activeBefore`
// MUST be the count BEFORE the upsert (the upsert forces every feed row to status='active', which would
// otherwise inflate the denominator — the bug found during the 2026-07-14 feed research).

export interface WithdrawalDecision {
  toWithdraw: number;
  activeBefore: number;
  pct: number;        // toWithdraw / activeBefore, in [0,1]
  blocked: boolean;
  reason: string;     // machine-readable summary for property_sync_runs.error_message
}

export function evaluateWithdrawalGuard(
  toWithdraw: number,
  activeBefore: number,
  allowMassWithdraw = false,
  opts: { floor?: number; pctCap?: number } = {},
): WithdrawalDecision {
  const floor = opts.floor ?? 5;
  const pctCap = opts.pctCap ?? 0.20;
  const pct = activeBefore > 0 ? toWithdraw / activeBefore : (toWithdraw > 0 ? 1 : 0);

  if (toWithdraw <= 0) {
    return { toWithdraw, activeBefore, pct, blocked: false, reason: "nothing_to_withdraw" };
  }
  if (allowMassWithdraw) {
    return { toWithdraw, activeBefore, pct, blocked: false, reason: `override_mass_withdraw:${toWithdraw}` };
  }
  if (toWithdraw > floor && toWithdraw > pctCap * activeBefore) {
    return {
      toWithdraw, activeBefore, pct, blocked: true,
      reason: `withdraw_blocked:${toWithdraw}_of_${activeBefore}_active_exceeds_${Math.round(pctCap * 100)}pct_and_floor_${floor}`,
    };
  }
  return { toWithdraw, activeBefore, pct, blocked: false, reason: `within_limits:${toWithdraw}_of_${activeBefore}` };
}

// ── Image storage helpers ─────────────────────────────────────────────────────────────────────
//
// Feed images are MIRRORED into our own `property-images` bucket at ingest and the OWNED url is
// stored — never the feed's link. Storing links is exactly what let montinmo.es take 57% of the demo
// catalogue down with it (2026-07-14). ownedUrlFor() must produce a url containing OWNED_STORAGE_MARKER
// so the shared "usable photo" rule (apps/api/src/lib/property-images.ts) counts it as loadable.

export const OWNED_STORAGE_MARKER = "/storage/v1/object/public/property-images/";

/** Is this url already one of ours? (a re-sync must not re-download images it already mirrored). */
export function isOwnedImageUrl(u: unknown): u is string {
  return typeof u === "string" && u.includes(OWNED_STORAGE_MARKER);
}

/** Lower-case file extension from an image url (query string stripped); defaults to jpg. */
export function imageExt(url: string): string {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp|gif|avif)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

/** Deterministic, collision-free, path-safe storage key for one property image. */
export function storagePathFor(agencyId: string, externalId: string, index: number, ext: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe(agencyId)}/${safe(externalId)}/${index}.${ext}`;
}

/** The public, owned url for a stored path — guaranteed to contain OWNED_STORAGE_MARKER. */
export function ownedUrlFor(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}${OWNED_STORAGE_MARKER}${path}`;
}
