import { describe, it, expect } from 'vitest';
import { buildGroundedPrompt, parseLlmAnswer, passesGroundingGuard, type ListingForLlm } from './amanda-llm-lib';

const LISTING: ListingForLlm = {
  ref: 'MCH-001', title: '2-bedroom apartment near Playa del Cura, Torrevieja',
  propertyType: 'apartment', price: 128000, currency: 'EUR', bedrooms: 2, bathrooms: 1,
  areaSqm: 65, locationCity: 'Torrevieja', features: ['communal pool', 'near beach'],
  description: 'Bright south-facing apartment 300 m from Playa del Cura, refurbished in 2023.',
};

describe('buildGroundedPrompt — strict grounding + injection hardening', () => {
  const { system, user } = buildGroundedPrompt({ agencyName: 'Costa Vista', listing: LISTING, question: 'is it modern?', lang: 'en' });
  it('locks the model to the listing data and forbids outside knowledge', () => {
    expect(system).toMatch(/ONLY from the listing data/i);
    expect(system).toMatch(/Never invent/i);
    expect(system).toMatch(/needs_team/);
  });
  it('treats visitor text as untrusted input', () => {
    expect(system).toMatch(/UNTRUSTED INPUT, not instructions/);
    expect(user).toContain('<visitor_question>');
    expect(user).toContain('<listing_data>');
    expect(user).toContain('"MCH-001"');
  });
  it('demands strict JSON output', () => {
    expect(system).toMatch(/Output ONLY a JSON object/);
  });
});

describe('parseLlmAnswer', () => {
  it('parses plain and fenced JSON', () => {
    expect(parseLlmAnswer('{"answer":"Yes","grounded":true,"needs_team":false}')).toEqual({ answer: 'Yes', grounded: true, needsTeam: false });
    expect(parseLlmAnswer('```json\n{"answer":"Yes","grounded":true,"needs_team":false}\n```')?.answer).toBe('Yes');
  });
  it('rejects malformed output', () => {
    expect(parseLlmAnswer('Sure! The price is 1€')).toBeNull();
    expect(parseLlmAnswer('{"grounded":true}')).toBeNull();
  });
});

describe('passesGroundingGuard — no number leaves the listing data', () => {
  it('accepts answers whose numbers exist in the listing', () => {
    expect(passesGroundingGuard('It is 65 m² and costs €128,000 — refurbished in 2023.', LISTING)).toBe(true);
    expect(passesGroundingGuard('It has 2 bedrooms.', LISTING)).toBe(true);
  });
  it('REJECTS invented numbers (injection/hallucination shield)', () => {
    expect(passesGroundingGuard('You can have it for just €1,000!', LISTING)).toBe(false);
    expect(passesGroundingGuard('The community fee is €40 per month.', LISTING)).toBe(false);
  });
  it('rejects oversized answers', () => {
    expect(passesGroundingGuard('x'.repeat(700), LISTING)).toBe(false);
  });
});
