/**
 * The honest trust signal behind the Studio "Research checked" mark.
 *
 * The mark used to light whenever research RAN (routing.researched). Christian, 2026-09-13: a badge
 * that says "checked" when a claim actually failed, was removed, was repaired, or was never checked
 * per claim is a customer-visible false trust signal. So "checked" is now EARNED: research ran, the
 * gate produced a report, and nothing was blocked, dropped, repaired, contradicted, degraded or
 * timed out. A remix — whose new cover never goes through the verification pass — can never be
 * "checked", even if it somehow carried the parent's routing.
 *
 * Pure by design: it reads only the metadata the generation already persisted (claim_qa,
 * fact_health, semantic_unit, claim_lineage, routing, remix_of). This changes what the status
 * endpoint REPORTS, not how anything is generated.
 */

export type TrustSignal = {
  /** research ran — the engine went and looked something up */
  researched: boolean;
  /** the strong mark: research ran and every material claim resolved as supported, nothing removed */
  claimsChecked: boolean;
};

/** The gate's report shape — only the fields that tell us a claim did not cleanly survive. */
type GateReport = {
  blocked?: unknown[];
  dropped?: number;
  repairs?: number;
  bankContradictions?: unknown[];
  degraded?: unknown;
};

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

export function deriveTrustSignal(meta: unknown): TrustSignal {
  const m = asObj(meta);
  const routing = asObj(m.routing);
  const researched = routing.researched === true;

  // A remix rewrites the cover with NO verification pass (studio-carousel-plan.ts: "the remix path
  // has no editor pass at all"), so it can never wear the checked mark. Guard on the marker even
  // though a remix does not currently persist routing — so it stays safe if that ever changes.
  if (m.remix_of) return { researched, claimsChecked: false };

  if (!researched) return { researched: false, claimsChecked: false };

  // Research ran but the gate left no report: we cannot claim the individual claims were checked.
  const claimQa = m.claim_qa as GateReport | undefined;
  if (!claimQa) return { researched: true, claimsChecked: false };

  const factHealth = asObj(m.fact_health);
  const semanticUnit = asObj(m.semantic_unit);
  const lineage = asObj(m.claim_lineage);

  // Any of these means a claim was removed, failed, repaired, contradicted, or could not be checked.
  const trouble =
    len(claimQa.blocked) > 0 ||
    (typeof claimQa.dropped === 'number' && claimQa.dropped > 0) ||
    (typeof claimQa.repairs === 'number' && claimQa.repairs > 0) ||
    len(claimQa.bankContradictions) > 0 ||
    !!claimQa.degraded ||
    len(factHealth.timedOut) > 0 ||
    factHealth.degraded != null ||
    semanticUnit.checkerFailed === true ||
    lineage.checkFailed === true;

  return { researched: true, claimsChecked: !trouble };
}
