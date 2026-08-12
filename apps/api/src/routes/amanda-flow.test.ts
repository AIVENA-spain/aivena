import { describe, it, expect } from 'vitest';
import {
  parseMessage, mergeCollected, nextStep, hasContact, advance, replyFor,
  replyForCollected, classifyIntent, turnReply, interpretFunnelAnswer, STEP_ORDER, type Collected,
} from './amanda-flow';

describe('replyForCollected — reply from already-merged state (used by the /message route)', () => {
  it('fresh session (nothing collected/added) asks the first question, not a deflect', () => {
    expect(replyForCollected({}, true)).toEqual({ reply: replyFor('intent'), step: 'intent', readyToCapture: false, messageType: 'prompt' });
  });
  it('buyer intent → asks PERMISSION before any questions (never deflects there)', () => {
    const r = replyForCollected({ intent: 'buyer' }, true);
    expect(r.step).toBe('permission');
    expect(r.reply).toBe(replyFor('permission'));
  });
  it('permission granted → walks area → bedrooms → bathrooms → budget → specifics', () => {
    expect(replyForCollected({ intent: 'buyer', qualPermission: 'granted' }, false).step).toBe('location');
    expect(replyForCollected({ intent: 'buyer', qualPermission: 'granted', location: 'Denia' }, false).step).toBe('bedrooms');
    expect(replyForCollected({ intent: 'buyer', qualPermission: 'granted', location: 'Denia', bedroomsMin: 2 }, false).step).toBe('bathrooms');
    expect(replyForCollected({ intent: 'buyer', qualPermission: 'granted', location: 'Denia', bedroomsMin: 2, bathroomsMin: 1 }, false).step).toBe('budget');
    expect(replyForCollected({ intent: 'buyer', qualPermission: 'granted', location: 'Denia', bedroomsMin: 2, bathroomsMin: 1, budgetMax: 300000 }, false).step).toBe('specifics');
  });
  it('funnel complete → matches (route shows CARDS, no contact wall)', () => {
    const full: Collected = { intent: 'buyer', qualPermission: 'granted', location: 'Denia', budgetMax: 300000, bedroomsMin: 2, bathroomsMin: 1, specifics: 'pool' };
    const r = replyForCollected(full, false);
    expect(r.step).toBe('matches');
    expect(r.messageType).toBe('matches');
    expect(r.readyToCapture).toBe(false);
  });
  it('permission declined → browse (route shows cards immediately)', () => {
    const r = replyForCollected({ intent: 'buyer', qualPermission: 'declined' }, false);
    expect(r.step).toBe('browse');
    expect(r.messageType).toBe('browse');
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
  it('bare numbers resolve to the ASKED step via interpretFunnelAnswer', () => {
    expect(interpretFunnelAnswer('bedrooms', '3', {}).bedroomsMin).toBe(3);
    expect(interpretFunnelAnswer('bathrooms', '2', {}).bathroomsMin).toBe(2);
    expect(parseMessage('300').bedroomsMin).toBeUndefined();              // not a bedroom count
  });
  it('interpretFunnelAnswer: permission yes/no/implicit; specifics free text', () => {
    expect(interpretFunnelAnswer('permission', 'yes please', {}).qualPermission).toBe('granted');
    expect(interpretFunnelAnswer('permission', 'no, just show me', {}).qualPermission).toBe('declined');
    expect(interpretFunnelAnswer('permission', '2 beds in torrevieja', { bedroomsMin: 2, location: 'Torrevieja' }).qualPermission).toBe('granted');
    expect(interpretFunnelAnswer('permission', 'hmm maybe', {}).qualPermission).toBeUndefined();
    expect(interpretFunnelAnswer('specifics', 'a pool and sea views please', {}).specifics).toBe('a pool and sea views please');
    expect(interpretFunnelAnswer('specifics', 'nothing special', {}).specifics).toBe('none');
  });
  it('parses bathrooms from text', () => {
    expect(parseMessage('2 bathrooms please').bathroomsMin).toBe(2);
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

describe('nextStep — permission-first buyer funnel ending in matches', () => {
  it('walks the buyer step order', () => {
    let c: Collected = {};
    expect(nextStep(c)).toBe('intent');
    c = mergeCollected(c, { intent: 'buyer' });          expect(nextStep(c)).toBe('permission');
    c = mergeCollected(c, { qualPermission: 'granted' }); expect(nextStep(c)).toBe('location');
    c = mergeCollected(c, { location: 'Javea' });         expect(nextStep(c)).toBe('bedrooms');
    c = mergeCollected(c, { bedroomsMin: 3 });            expect(nextStep(c)).toBe('bathrooms');
    c = mergeCollected(c, { bathroomsMin: 2 });           expect(nextStep(c)).toBe('budget');
    c = mergeCollected(c, { budgetMax: 400000 });         expect(nextStep(c)).toBe('specifics');
    c = mergeCollected(c, { specifics: 'pool' });         expect(nextStep(c)).toBe('matches');
  });
  it('declined permission goes straight to browse', () => {
    expect(nextStep({ intent: 'buyer', qualPermission: 'declined' })).toBe('browse');
  });
  it('STEP_ORDER ends with specifics (matches follow; no contact wall)', () => {
    expect(STEP_ORDER[STEP_ORDER.length - 1]).toBe('specifics');
  });
  it('seller path unchanged: location → type → contact → ready', () => {
    expect(nextStep({ intent: 'seller' })).toBe('location');
    expect(nextStep({ intent: 'seller', location: 'Denia' })).toBe('type');
    expect(nextStep({ intent: 'seller', location: 'Denia', propertyType: 'villa' })).toBe('contact');
    expect(nextStep({ intent: 'seller', location: 'Denia', propertyType: 'villa', phone: '+34600111222' })).toBe('ready');
  });
});

describe('advance — one turn at a time', () => {
  it('opening turn with no facts asks the intent question (not a deflect)', () => {
    const r = advance({}, 'hi there');
    expect(r.step).toBe('intent');
    expect(r.reply).toBe(replyFor('intent'));
    expect(r.readyToCapture).toBe(false);
  });
  it('advances through the granted funnel as facts arrive', () => {
    const r = advance({ intent: 'buyer', qualPermission: 'granted' }, 'looking in Torrevieja');
    expect(r.collected.location).toBe('Torrevieja');
    expect(r.step).toBe('bedrooms');
    expect(r.reply).toBe(replyFor('bedrooms'));
  });
  it('mid-funnel message that adds nothing deflects helpfully', () => {
    const r = advance({ intent: 'buyer', qualPermission: 'granted', location: 'Denia' }, 'not sure honestly');
    expect(r.reply).toBe(replyFor('deflect'));
    expect(r.readyToCapture).toBe(false);
  });
  it('completed funnel reaches matches (cards shown by the route)', () => {
    const r = advance(
      { intent: 'buyer', qualPermission: 'granted', location: 'Denia', budgetMax: 300000, bedroomsMin: 2, bathroomsMin: 1 },
      'a pool would be lovely',
    );
    // parseMessage stores nothing for that message; specifics is route-interpreted —
    // simulate the granted state directly:
    const done = replyForCollected({ intent: 'buyer', qualPermission: 'granted', location: 'Denia', budgetMax: 300000, bedroomsMin: 2, bathroomsMin: 1, specifics: 'pool' }, false);
    expect(done.step).toBe('matches');
    expect(r.step).toBe('specifics');
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
  it('qualify path signals awaitingContact only at the (seller) contact step', () => {
    expect(turnReply({ intent: 'buyer' }, false, 'qualify').awaitingContact).toBe(false);
    const atContact = turnReply(
      { intent: 'seller', location: 'Denia', propertyType: 'villa' },
      false, 'qualify',
    );
    expect(atContact.awaitingContact).toBe(true);
    expect(atContact.messageType).toBe('prompt');
  });
  it('carries a messageType on every turn (extensible envelope)', () => {
    expect(turnReply({}, true, 'qualify').messageType).toBe('prompt');
  });
});
