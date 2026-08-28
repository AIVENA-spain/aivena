// Amanda engine — may this listing URL be shared with a buyer?
//
// Christian's question (2026-08-28): "isn't it just positive for the agency to
// get people visiting their website?" — yes, when it IS their website. The
// live catalogue proved the trap: the demo agency (Mediterráneo Costa Homes)
// has 141 listings whose source_url all point at montinmo.es, the third-party
// site the feed came from. Sending that hands the agency's own buyer to
// someone else's branding and contact form.
//
// So the rule is ownership, not a blanket ban: a listing link is shared only
// when its host is the agency's own site (or a subdomain of it). An agency
// whose feed IS their website gets real links today; an agency fed by a portal
// gets none until AIVENA-hosted share pages exist.

/** Bare host, lowercased, "www." stripped. Null for anything not http(s). */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** The agency's own hosts, from its configured website URL(s). */
export function agencyHosts(websiteUrls: Array<string | null | undefined>): string[] {
  return [...new Set(websiteUrls.map(hostOf).filter((h): h is string => Boolean(h)))];
}

/**
 * The listing URL if it belongs to the agency, else null.
 * Matches the exact host or any subdomain of it (listings.agency.com).
 */
export function ownSiteUrl(sourceUrl: string | null | undefined, ownHosts: string[]): string | null {
  const host = hostOf(sourceUrl);
  if (!host || ownHosts.length === 0) return null;
  const owned = ownHosts.some((own) => host === own || host.endsWith(`.${own}`));
  return owned ? (sourceUrl as string).trim() : null;
}
