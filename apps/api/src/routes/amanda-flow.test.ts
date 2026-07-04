import { describe, it, expect } from 'vitest';
import {
  parseMessage, mergeCollected, nextStep, hasContact, advance, replyFor,
  replyForCollected, STEP_ORDER, type Collected,
} from './amanda-flow';

describe('replyForCollected — reply from already-merged state (used by the /message route)', () => {
  it('fresh session (nothing collected/added) asks the first question, not a deflect', () => {
    expect(replyForCollected({}, true)).toEqual({ reply: replyFor('intent'), step: 'intent', readyToCapture: false });
  });
  it('mid-flow with nothing added deflects to contact', () => {
    const r = replyForCollected({ intent: 'buyer', location: 'Denia' }, true);
    expect(r.reply).toBe(replyFor('deflect'));
    expect(r.readyToCapture).toBe(false);
  });
  it('asks the next missing field when facts were added', () => {
    expect(replyForCollected({ intent: 'buyer', location: 'Denia' }, false).step).toBe('budget');
  });
  it('all qualification + contact → ready + readyToCapture', () => {
    const full: Collected = { intent: 'buyer', location: 'Denia', budgetMax: 300000, bedroomsMin: 2, propertyType: 'apartment', email: 'x@y.com' };
    expect(replyForCollected(full, false)).toEqual({ reply: replyFor('ready'), step: 'ready', readyToCapture: true });
  });
  it('matches advance() (single source of truth)', () => {
    const a = advance({ intent: 'buyer' }, 'in Torrevieja', 'es');
    const r = replyForCollected(a.collected, false, 'es');
    expect(r.reply).toBe(a.reply);
    expect(r.step).toBe(a.step);
  });
});

describe('parseMessage — deterministic light parsing', () => {
  it('extracts intent, beds, type, location, budget from one sentence', () => {
    const p = parseMessage('I want to buy a 2 bed apartment in Torrevieja under 350k');
    expect(p.intent).toBe('buyer');
    expect(p.bedroomsMin).toBe(2);
    expect(p.propertyType).toBe('apartment');
    expect(p.location).toBe('Torrevieja');
    expect(p.budgetMax).toBe(350000);
  });
  it('detects seller intent + villa', () => {
    const p = parseMessage('I am selling my villa');
    expect(p.intent).toBe('seller');
    expect(p.propertyType).toBe('villa');
  });
  it('parses plain and dotted budgets', () => {
    expect(parseMessage('budget 400000').budgetMax).toBe(400000);
    expect(parseMessage('hasta 300.000').budgetMax).toBe(300000);
    expect(parseMessage('around 250k').budgetMax).toBe(250000);
  });
  it('extracts email + phone but not small numbers as phone', () => {
    const p = parseMessage('reach me at jane@example.com or +34 600 111 222');
    expect(p.email).toBe('jane@example.com');
    expect(p.phone?.replace(/\D/g, '')).toBe('34600111222');
    expect(parseMessage('3 bedrooms').phone).toBeUndefined(); // "3" is not a phone
  });
  it('returns empty for an off-topic / empty message', () => {
    expect(parseMessage('')).toEqual({});
    expect(parseMessage('hello there')).toEqual({});
  });
});

describe('mergeCollected — never overwrites a set field', () => {
  it('fills only missing fields', () => {
    const merged = mergeCollected({ intent: 'buyer', location: 'Denia' }, { location: 'Calpe', budgetMax: 300000 });
    expect(merged).toEqual({ intent: 'buyer', location: 'Denia', budgetMax: 300000 });
  });
});

describe('nextStep — asks the first missing qualification, contact last, then ready', () => {
  it('walks the step order', () => {
    let c: Collected = {};
    expect(nextStep(c)).toBe('intent');
    c = mergeCollected(c, { intent: 'buyer' });   expect(nextStep(c)).toBe('location');
    c = mergeCollected(c, { location: 'Javea' });  expect(nextStep(c)).toBe('budget');
    c = mergeCollected(c, { budgetMax: 400000 });  expect(nextStep(c)).toBe('bedrooms');
    c = mergeCollected(c, { bedroomsMin: 3 });     expect(nextStep(c)).toBe('type');
    c = mergeCollected(c, { propertyType: 'villa' }); expect(nextStep(c)).toBe('contact');
    c = mergeCollected(c, { email: 'x@y.com' });   expect(nextStep(c)).toBe('ready');
  });
  it('STEP_ORDER ends with contact', () => {
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe('contact');
  });
});

describe('advance — one turn at a time', () => {
  it('opening turn with no facts asks the intent question (not a deflect)', () => {
    const r = advance({}, 'hi there');
    expect(r.step).toBe('intent');
    expect(r.reply).toBe(replyFor('intent'));
    expect(r.readyToCapture).toBe(false);
  });
  it('advances to the next question as facts arrive', () => {
    const r = advance({ intent: 'buyer' }, 'looking in Torrevieja');
    expect(r.collected.location).toBe('Torrevieja');
    expect(r.step).toBe('budget');
    expect(r.reply).toBe(replyFor('budget'));
  });
  it('mid-flow message that adds nothing deflects to contact', () => {
    const r = advance({ intent: 'buyer', location: 'Denia' }, 'not sure honestly');
    expect(r.reply).toBe(replyFor('deflect'));
    expect(r.readyToCapture).toBe(false);
  });
  it('once contact is present it signals readyToCapture', () => {
    const r = advance(
      { intent: 'buyer', location: 'Denia', budgetMax: 300000, bedroomsMin: 2, propertyType: 'apartment' },
      'my email is buyer@example.com',
    );
    expect(r.collected.email).toBe('buyer@example.com');
    expect(r.step).toBe('ready');
    expect(r.readyToCapture).toBe(true);
    expect(r.reply).toBe(replyFor('ready'));
  });
  it('respects Spanish copy', () => {
    const r = advance({}, 'hola', 'es');
    expect(r.reply).toBe(replyFor('intent', 'es'));
    expect(r.reply).toMatch(/comprar o vender/i);
  });
  it('unknown language falls back to English', () => {
    expect(replyFor('budget', 'zz')).toBe(replyFor('budget', 'en'));
  });
});

describe('hasContact', () => {
  it('true with either email or phone', () => {
    expect(hasContact({ email: 'a@b.com' })).toBe(true);
    expect(hasContact({ phone: '+34600111222' })).toBe(true);
    expect(hasContact({ intent: 'buyer' })).toBe(false);
  });
});
