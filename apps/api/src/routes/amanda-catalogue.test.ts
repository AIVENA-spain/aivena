import { describe, it, expect } from 'vitest';
import {
  parseListingRef, parseSearchPhrase, wantsViewing, buildSearchFilters, toPropertyCard,
  humanizeFeatures, isFollowUpAboutLast, aboutListingReply,
  searchReply, specificReply, viewingReply, MAX_CARDS, type PropertyRow,
} from './amanda-catalogue';

describe('parseListingRef', () => {
  it('extracts a listing reference and uppercases it', () => {
    expect(parseListingRef('do you have anything like mch-006?')).toBe('MCH-006');
    expect(parseListingRef('tell me about E2E-CQ')).toBe('E2E-CQ');
  });
  it('returns null when there is no reference', () => {
    expect(parseListingRef('a 2 bed apartment in Denia')).toBeNull();
    expect(parseListingRef('')).toBeNull();
  });
});

describe('parseSearchPhrase — "the one in …" referring phrases', () => {
  it('extracts the phrase after "the one in/at/near"', () => {
    expect(parseSearchPhrase('tell me more about the one in playa del cura')).toBe('playa del cura');
    expect(parseSearchPhrase('that villa near la mata please')).toBe('la mata');
  });
  it('null when there is no referring phrase', () => {
    expect(parseSearchPhrase('do you have any villas?')).toBeNull();
    expect(parseSearchPhrase('')).toBeNull();
  });
});

describe('wantsViewing', () => {
  it('detects viewing intent (en/es)', () => {
    expect(wantsViewing('can I book a viewing?')).toBe(true);
    expect(wantsViewing('me gustaría agendar una visita')).toBe(true);
    expect(wantsViewing('quiero concertar una visita')).toBe(true);
  });
  it('is false for a plain question', () => {
    expect(wantsViewing('how much is it?')).toBe(false);
  });
});

describe('buildSearchFilters', () => {
  it('maps collected qualification to deterministic filters + parses a ref', () => {
    const f = buildSearchFilters(
      { intent: 'buyer', location: 'Denia', propertyType: 'villa', bedroomsMin: 3, budgetMax: 400000 },
      'anything like MCH-006?',
    );
    expect(f).toEqual({
      ref: 'MCH-006', q: null, location: 'Denia', propertyType: 'villa',
      bedroomsMin: 3, budgetMax: 400000, openToAdjacent: false,
    });
  });
  it('leaves unset fields null (never invented)', () => {
    const f = buildSearchFilters({ intent: 'buyer' }, 'looking to buy');
    expect(f).toEqual({ ref: null, q: null, location: null, propertyType: null, bedroomsMin: null, budgetMax: null, openToAdjacent: false });
  });
});

describe('toPropertyCard — safe shape only', () => {
  const row: PropertyRow & Record<string, unknown> = {
    id: 'p1', external_id: 'MCH-006', title: '3-bed villa', property_type: 'villa', status: 'active',
    price: '385000', price_currency: 'EUR', bedrooms: 3, bathrooms: 2, area_sqm: '120',
    location_city: 'Orihuela Costa', location_region: 'Alicante', source_url: 'https://x/y',
    // internal fields that must NEVER reach the card:
    agency_id: 'demo', embedding: [0.1], raw_payload: { secret: 1 }, lat: 37.9, lng: -0.7,
  };
  it('exposes only safe fields and coerces numerics', () => {
    const c = toPropertyCard(row, 'https://img/1.jpg');
    expect(c).toEqual({
      type: 'property', ref: 'MCH-006', title: '3-bed villa', propertyType: 'villa',
      price: 385000, currency: 'EUR', bedrooms: 3, bathrooms: 2, areaSqm: 120,
      locationCity: 'Orihuela Costa', url: 'https://x/y', image: 'https://img/1.jpg',
      features: [],
    });
    // no internal keys leaked
    expect(Object.keys(c)).not.toContain('agency_id');
    expect(Object.keys(c)).not.toContain('embedding');
    expect(Object.keys(c)).not.toContain('lat');
  });
  it('null image when none vetted', () => {
    expect(toPropertyCard(row, null).image).toBeNull();
  });
});

describe('conversation context — follow-ups about the last listing', () => {
  it("detects Christian's exact follow-up (typo included)", () => {
    expect(isFollowUpAboutLast('what is the best feautures of the property and is there a link to that property so i can see it online?')).toBe(true);
    expect(isFollowUpAboutLast('what are its features?')).toBe(true);
    expect(isFollowUpAboutLast('is there a link?')).toBe(true);
    expect(isFollowUpAboutLast('how big is it?')).toBe(true);
  });
  it('does not fire on a fresh search', () => {
    expect(isFollowUpAboutLast('do you have any villas?')).toBe(false);
    expect(isFollowUpAboutLast('2-bed apartment in torrevieja')).toBe(false);
  });
  it('humanizes agency feature tags verbatim (never invents)', () => {
    expect(humanizeFeatures(['communal_pool', 'near_beach', 'south_facing'])).toEqual(['communal pool', 'near beach', 'south facing']);
    expect(humanizeFeatures(null)).toEqual([]);
    expect(humanizeFeatures([1, '', 'ok'])).toEqual(['ok']);
  });
  it('aboutListingReply: features when present, honest link-pointer when not', () => {
    expect(aboutListingReply('MCH-001', ['communal pool', 'near beach'])).toMatch(/features: communal pool, near beach/);
    expect(aboutListingReply('MCH-001', [])).toMatch(/photos and the full description/);
  });
});

describe('templated replies — never free-form', () => {
  it('searchReply: honest zero-match offers (not demands) the team', () => {
    expect(searchReply(0, false)).toMatch(/don't have an active listing/i);
    expect(searchReply(0, false)).toMatch(/if you'd like/i);
    expect(searchReply(0, false, 'es')).toMatch(/Ahora mismo no tengo/i);
  });
  it('searchReply: counts and offers a viewing, not a claim', () => {
    expect(searchReply(3, false)).toMatch(/3 listings that match/i);
    expect(searchReply(1, false)).toMatch(/a listing that matches/i);
    expect(searchReply(3, true)).toMatch(/There are more/i);
  });
  it('specificReply: not-found is honest + offers the team', () => {
    expect(specificReply(false, 'MCH-006')).toMatch(/can't see an active listing with reference MCH-006/i);
    expect(specificReply(true, 'MCH-006')).toMatch(/what I have on MCH-006/i);
  });
  it('viewingReply: captured for an agent, never auto-booked', () => {
    expect(viewingReply(true)).toMatch(/nothing is booked automatically/i);
    expect(viewingReply(false)).toMatch(/best email or phone/i);
  });
  it('MAX_CARDS is 3', () => { expect(MAX_CARDS).toBe(3); });
});
