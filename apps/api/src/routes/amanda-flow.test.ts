import { describe, it, expect } from 'vitest';
import {
  parseMessage, mergeCollected, nextStep, hasContact, advance, replyFor,
  replyForCollected, classifyIntent, turnReply, STEP_ORDER, type Collected,
} from './amanda-flow';

describe('replyForCollected — reply from already-merged state (used by the /message route)', () => {
  it('fresh session (nothing collected/added) asks the first question, not a deflect', () => {
    expect(replyForCollected({}, true)).toEqual({ reply: replyFor('intent'), step: 'intent', readyToCapture: false, messageType: 'prompt' });
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
    expect(replyForCollected(full, false)).toEqual({ reply: replyFor('ready'), step: 'ready', readyToCapture: true, messageType: 'ready' });
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
  it('parses plain, dotted, and SPACE-separated budgets', () => {
    expect(parseMessage('budget 400000').budgetMax).toBe(400000);
    expect(parseMessage('hasta 300.000').budgetMax).toBe(300000);
    expect(parseMessage('around 250k').budgetMax).toBe(250000);
    expect(parseMessage('around 500 000 euro').budgetMax).toBe(500000);   // Christian's live bug
    expect(parseMessage('1 200 000').budgetMax).toBe(1200000);
  });
  it('a phone number is never read as a budget', () => {
    expect(parseMessage('call me on +34 600 111 222').budgetMax).toBeUndefined();
  });
  it('a bare number answers the bedrooms question', () => {
    expect(parseMessage('3').bedroomsMin).toBe(3);                        // Christian's live bug
    expect(parseMessage('300').bedroomsMin).toBeUndefined();              // not a bedroom count
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
    expect(r.reply).toMatch(/comprar.*vender/i);
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

describe('classifyIntent — the Phase-B forward-compat seam', () => {
  it('single funnel answers stay qualify; empty stays qualify', () => {
    expect(classifyIntent('buying')).toBe('qualify');
    expect(classifyIntent('Torrevieja')).toBe('qualify');
    expect(classifyIntent('')).toBe('qualify');
  });
  it('ANSWER-FIRST: a criteria statement is a search, not a questionnaire', () => {
    expect(classifyIntent('a 2 bed apartment in Denia')).toBe('property_question');
    expect(classifyIntent('2-bed apartment in Torrevieja under 200k')).toBe('property_question');
  });
  it('ANSWER-FIRST: recommend/suggest (typo-tolerant) is a property question', () => {
    expect(classifyIntent('hello can you reccomend me some properties in torrevieja')).toBe('property_question');
    expect(classifyIntent('can you recommend me some properties in torrevieja')).toBe('property_question');
    expect(classifyIntent('suggest something near the beach')).toBe('property_question');
  });
  it('ANSWER-FIRST: referring back to a listing is a property question', () => {
    expect(classifyIntent('tell me more about the one in playa del cura')).toBe('property_question');
    expect(classifyIntent('i need to see pictures, how do i find that property?')).toBe('property_question');
    expect(classifyIntent('can i see photos of that villa?')).toBe('property_question');
  });
  it('detects a property question', () => {
    expect(classifyIntent('do you have any villas with a pool?')).toBe('property_question');
    expect(classifyIntent('how much is the one in Javea?')).toBe('property_question');
    expect(classifyIntent('is it still available?')).toBe('property_question');
  });
  it('a human request wins over a property question', () => {
    expect(classifyIntent('can I speak to a person please')).toBe('human_request');
    expect(classifyIntent('I want a human, do you have villas')).toBe('human_request');
  });
});

describe('turnReply — Phase A never answers property questions (no invented facts)', () => {
  it('a property question defers to an agent + moves to contact, not an answer', () => {
    const r = turnReply({ intent: 'buyer' }, false, 'property_question');
    expect(r.messageType).toBe('property_defer');
    expect(r.reply).toBe(replyFor('property_defer'));
    expect(r.awaitingContact).toBe(true);       // asks for contact
    expect(r.readyToCapture).toBe(false);        // no contact yet
  });
  it('a human request defers to the team + asks for contact', () => {
    const r = turnReply({}, false, 'human_request', 'es');
    expect(r.messageType).toBe('human_defer');
    expect(r.reply).toBe(replyFor('human_defer', 'es'));
    expect(r.awaitingContact).toBe(true);
  });
  it('property/human deferral captures once contact is already present', () => {
    const r = turnReply({ email: 'x@y.com' }, false, 'property_question');
    expect(r.readyToCapture).toBe(true);
    expect(r.awaitingContact).toBe(false);
  });
  it('qualify path signals awaitingContact only at the contact step', () => {
    expect(turnReply({ intent: 'buyer' }, false, 'qualify').awaitingContact).toBe(false);
    const atContact = turnReply(
      { intent: 'buyer', location: 'Denia', budgetMax: 300000, bedroomsMin: 2, propertyType: 'villa' },
      false, 'qualify',
    );
    expect(atContact.awaitingContact).toBe(true);
    expect(atContact.messageType).toBe('prompt');
  });
  it('carries a messageType on every turn (extensible envelope)', () => {
    expect(turnReply({}, true, 'qualify').messageType).toBe('prompt');
  });
});
