import { describe, it, expect } from 'vitest';
import { hostOf, agencyHosts, ownSiteUrl } from './site-link';

const OWN = agencyHosts(['https://mediterraneocostahomes.es']);

describe('site-link — share the agency\'s OWN links, never a third party\'s', () => {
  it('the live demo trap: montinmo.es is NOT the agency site', () => {
    expect(ownSiteUrl('https://montinmo.es/en/property/2509/villa/sale/spain/ciudad-quesada/ciudad-quesada/', OWN)).toBeNull();
  });

  it('the agency\'s own listing page IS shared (Christian: visits to their site are a win)', () => {
    const u = 'https://mediterraneocostahomes.es/propiedad/IC-81596';
    expect(ownSiteUrl(u, OWN)).toBe(u);
    expect(ownSiteUrl('https://www.mediterraneocostahomes.es/propiedad/IC-81596', OWN)).toContain('IC-81596');
  });

  it('subdomains of the agency count as the agency', () => {
    expect(ownSiteUrl('https://listings.mediterraneocostahomes.es/p/1', OWN)).not.toBeNull();
  });

  it('lookalike domains do NOT count', () => {
    expect(ownSiteUrl('https://mediterraneocostahomes.es.evil.com/p/1', OWN)).toBeNull();
    expect(ownSiteUrl('https://notmediterraneocostahomes.es/p/1', OWN)).toBeNull();
  });

  it('no configured website, junk urls, and non-web schemes share nothing', () => {
    expect(ownSiteUrl('https://mediterraneocostahomes.es/p/1', [])).toBeNull();
    expect(ownSiteUrl('not a url', OWN)).toBeNull();
    expect(ownSiteUrl('javascript:alert(1)', agencyHosts(['javascript:alert(1)']))).toBeNull();
    expect(hostOf(null)).toBeNull();
  });

  it('agencyHosts normalises www and dedupes', () => {
    expect(agencyHosts(['https://www.a.es', 'https://a.es', null, ''])).toEqual(['a.es']);
  });
});
