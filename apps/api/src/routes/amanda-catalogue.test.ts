import { describe, it, expect } from 'vitest';
import {
  parseListingRef, wantsViewing, buildSearchFilters, toPropertyCard,
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
      ref: 'MCH-006', location: 'Denia', propertyType: 'villa',
      bedroomsMin: 3, budgetMax: 400000, openToAdjacent: false,
    });
  });
  it('leaves unset fields null (never invented)', () => {
    const f = buildSearchFilters({ intent: 'buyer' }, 'looking to buy');
    expect(f).toEqual({ ref: null, location: null, propertyType: null, bedroomsMin: null, budgetMax: null, openToAdjacent: false });
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

describe('templated replies — never free-form', () => {
  it('searchReply: honest zero-match asks for contact', () => {
    expect(searchReply(0, false)).toMatch(/don't have an active listing/i);
    expect(searchReply(0, false, 'es')).toMatch(/No tengo ahora mismo/i);
  });
  it('searchReply: counts and offers a viewing, not a claim', () => {
    expect(searchReply(3, false)).toMatch(/3 listings that match/i);
    expect(searchReply(1, false)).toMatch(/1 listing/i);
    expect(searchReply(3, true)).toMatch(/There are more/i);
  });
  it('specificReply: not-found defers to an agent', () => {
    expect(specificReply(false, 'MCH-006')).toMatch(/couldn't find an active listing with reference MCH-006/i);
    expect(specificReply(true, 'MCH-006')).toMatch(/what I have on MCH-006/i);
  });
  it('viewingReply: captured for an agent, never auto-booked', () => {
    expect(viewingReply(true)).toMatch(/nothing is booked automatically/i);
    expect(viewingReply(false)).toMatch(/best email or phone/i);
  });
  it('MAX_CARDS is 3', () => { expect(MAX_CARDS).toBe(3); });
});
