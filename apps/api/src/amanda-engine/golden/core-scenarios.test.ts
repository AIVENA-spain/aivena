// Amanda golden suite — deterministic CORE scenarios (design §7). One command:
//   npx vitest run apps/api/src/amanda-engine/golden/
// These prove the MACHINE (modes, gates, validators, confirmation law, booking
// path) end-to-end with a scripted model. Live-model quality scenarios ride the
// same harness behind AMANDA_GOLDEN_LIVE at P1.

import { describe, it, expect } from 'vitest';
import { runTurn, GATE_FALLBACK } from '../turn';
import {
  FakeBackends, ScriptedModel, makeDeps, baseContext, inbound, pending,
  textResponse, toolResponse, CHALET,
} from './harness';
import { buildSystemPrompt } from '../prompt';

const WARM_REPLY = 'It has a lovely private pool and a big terrace. Would you like to see it in person?';

describe('golden/core — shadow mode is structurally harmless', () => {
  it('S1: shadow answers-with-tools produce ZERO writes and nothing sent', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('get_property_details', { ref: 'IC-28746' }),
      textResponse('It has a private pool! Want me to send more photos?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('shadow', baseContext(), inbound('Does it have a pool?'), null, deps);
    expect(r.outcome).toBe('simulated');
    expect(journal.sent).toHaveLength(0);
    expect(journal.drafts).toHaveLength(0);
    expect(journal.bookings).toHaveLength(0);
    // Reads are allowed; WRITE-class effects must be absent from the backend journal.
    expect(backends.writes().filter((w) => w.effect !== 'read')).toHaveLength(0);
  });

  it('S2: shadow + buyer confirms a slot → NO booking executes, outcome records the would-book', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Wonderful — Friday 28 August at 17:00 it is. See you there!')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('shadow', baseContext(), inbound('Yes please!'), pending(), deps);
    expect(r.outcome).toBe('booked_and_simulated');
    expect(journal.bookings).toHaveLength(0);
    expect(journal.sent).toHaveLength(0);
  });
});

describe('golden/core — the confirmation law (§4: never parse "yes" loosely)', () => {
  it('S3: FULL + clear affirmation on one unexpired pending action → books, replies', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Booked! Friday 28 August at 17:00 — María will meet you there.')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Yes please!'), pending(), deps);
    expect(r.outcome).toBe('booked_and_sent');
    expect(r.bookingId).toBe('bk-pa-1');
    expect(journal.bookings).toEqual(['pa-1']);
    expect(journal.sent).toHaveLength(1);
  });

  it('S4: button postback confirms even when the text is empty', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Perfect — Friday 28 August, 17:00. Looking forward to it!')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('', { buttonPayload: 'pa-1' }), pending(), deps);
    expect(r.outcome).toBe('booked_and_sent');
    expect(journal.bookings).toEqual(['pa-1']);
  });

  it('S5: "yes but sunday" books NOTHING — proposal stays for the model to re-ask', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Of course — shall we say Sunday at the same time, or would another day suit better?')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('yes but sunday'), pending(), deps);
    expect(journal.bookings).toHaveLength(0);
    expect(r.bookingId).toBeNull();
    // The pending proposal was still in the model's context (re-ask, never guess).
    expect(model.requests[0].system.length).toBeGreaterThan(0);
    expect(JSON.stringify(model.requests[0].messages)).toContain('Friday 28 August');
  });

  it('S6: a decline releases the pending action', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('No problem at all. Is there another day that suits you better?')]);
    const { deps, journal } = makeDeps(model, backends);
    await runTurn('full', baseContext(), inbound('no'), pending(), deps);
    expect(journal.released).toEqual([{ id: 'pa-1', reason: 'declined' }]);
    expect(journal.bookings).toHaveLength(0);
  });

  it('S7: an EXPIRED pending action is never acted on, even on a clear yes', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Let me line up fresh times for you. Would Friday or Saturday suit?')]);
    const { deps, journal } = makeDeps(model, backends);
    const expired = { ...pending(), expiresAtMs: Date.UTC(2026, 7, 26, 9, 0) };   // before inbound
    const r = await runTurn('full', baseContext(), inbound('Yes please!'), expired, deps);
    expect(journal.bookings).toHaveLength(0);
    expect(r.bookingId).toBeNull();
  });

  it('S8: ASSISTED + affirmation → booking-confirm task filed (own type), never executes, reply auto-sends', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Lovely — I am locking that in with the office right now, one moment.')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('assisted', baseContext(), inbound('Yes please!'), pending(), deps);
    expect(journal.bookings).toHaveLength(0);
    expect(journal.bookingConfirms).toEqual([{ pendingActionId: 'pa-1', echo: 'Friday 28 August, 17:00 · Chalet IC-28746' }]);
    expect(journal.drafts).toHaveLength(0);   // NEVER a suggested_reply placeholder (reviewer bug)
    expect(r.bookingQueued).toBe(true);
    expect(r.outcome).toBe('sent');   // the conversational reply still auto-sends in assisted
    // The model was told it's being locked in — never re-asks which time.
    expect(JSON.stringify(model.requests[0].messages)).toContain('awaiting a quick approval');
  });

  it('S8b: "ok no problem!" affirms — negative-word collocations never decline', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Wonderful — Friday at 17:00 it is. See you there!')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('ok no problem!'), pending(), deps);
    expect(journal.bookings).toEqual(['pa-1']);
    expect(journal.released).toHaveLength(0);
    expect(r.bookingId).toBe('bk-pa-1');
  });
});

describe('golden/core — the law on drafts (§10 validators + §2 gates)', () => {
  it('S9: pushy draft is regenerated once, clean version sends', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('Many other interested buyers — reserve today!'),
      textResponse(WARM_REPLY),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Is it nice?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent).toEqual([WARM_REPLY]);
    // The regeneration request named the exact violations.
    expect(JSON.stringify(model.requests[1].messages)).toContain('banned:');
  });

  it('S10: still-dirty after one regeneration → escalates; buyer gets ONLY the pre-vetted holding line', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('Last chance! Act now!'),
      textResponse('Final chance — it won’t last!'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('hmm'), null, deps);
    expect(r.outcome).toBe('escalated');
    // Dead-air law (2026-08-28): nothing UNVETTED reaches the buyer — but the
    // deterministic office-framed fallback does, backed by the real task.
    expect(journal.sent).toEqual([GATE_FALLBACK.en]);
    expect(journal.escalations[0].reason).toBe('gates_failed');
  });

  it('S11: an invented price dies at the numeric gate (no tool data contains it)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('get_property_details', { ref: 'IC-28746' }),
      textResponse('It costs €199.000 — a real bargain.'),
      textResponse(`The asking price is €${CHALET.price as number} — shall I arrange a viewing?`),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('How much is IC-28746?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toContain('245000');
    expect(JSON.stringify(model.requests[2].messages)).toContain('ungrounded_numbers:199.000');
  });

  it('S12: an IBAN can never leave the building, even after regeneration', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('Transfer the deposit to ES91 2100 0418 4502 0005 1332 please.'),
      textResponse('Please send the deposit to account ES91 2100 0418 4502 0005 1332.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('How do I pay the deposit?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.sent).toEqual([GATE_FALLBACK.en]);   // holding line only — never the IBAN
    expect(r.gateFailures.join(',')).toContain('payment_floor');
  });

  it('S13: stacked intel questions are rejected and tightened to one', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('What is your budget? And when do you want to move? And which towns?'),
      textResponse('Lovely — which towns are you drawn to?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('We want to buy something on the coast'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toBe('Lovely — which towns are you drawn to?');
  });

  it('S14: social warmth is never fact-checked into evasiveness (§2)', async () => {
    const backends = new FakeBackends();
    let verifierCalls = 0;
    const model = new ScriptedModel([textResponse('See you Saturday! Enjoy the sunshine.')]);
    const { deps, journal } = makeDeps(model, backends);
    deps.verifier = async () => { verifierCalls += 1; return false; };   // would block if consulted
    const r = await runTurn('full', baseContext(), inbound('Thanks, see you then!'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(verifierCalls).toBe(0);
    expect(journal.sent).toHaveLength(1);
  });

  it('S15: the verifier being down BLOCKS fact-bearing sends (fail closed, §4)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('get_property_details', { ref: 'IC-28746' }),
      textResponse('It is 120 m² with 3 bedrooms.'),
      textResponse('It is 120 m² with 3 bedrooms — a lovely size.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    deps.verifier = async () => { throw new Error('verifier down'); };
    const r = await runTurn('full', baseContext(), inbound('How big is it?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.sent).toEqual([GATE_FALLBACK.en]);   // holding line only
    expect(r.gateFailures).toContain('verifier_unavailable');
  });
});

describe('golden/core — reviewer-regression scenarios', () => {
  it('R1: SHADOW gate-failure escalation is SIMULATED — no agent-visible task', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('Last chance! Act now!'),
      textResponse('Final chance — it won’t last!'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('shadow', baseContext(), inbound('hmm'), null, deps);
    expect(r.outcome).toBe('escalated');           // telemetry still records it
    expect(journal.escalations).toHaveLength(0);   // but no real task was written
  });

  it('R2: SHADOW decline never writes a release', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('No problem at all — another day perhaps?')]);
    const { deps, journal } = makeDeps(model, backends);
    await runTurn('shadow', baseContext(), inbound('no'), pending(), deps);
    expect(journal.released).toHaveLength(0);
  });

  it('R3: typed grounding — a price lurking in DESCRIPTION prose cannot launder a fake price', async () => {
    const poisoned = { ...CHALET, description: 'Great value. Previously listed at 199.000, a steal!' };
    const backends = new FakeBackends();
    backends.getPropertyDetails = async () => poisoned;
    const model = new ScriptedModel([
      toolResponse('get_property_details', { ref: 'IC-28746' }),
      textResponse('It costs €199.000 — a real bargain.'),
      textResponse(`The asking price is €${CHALET.price as number}.`),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Price?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toContain('245000');
  });

  it('R4: propose_viewing_slots executes for REAL in approval mode (no invented times)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'prop-1' }),
      textResponse('I could do Friday 28 August, 17:00 or Saturday 29 August, 11:00 — which suits?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('approval', baseContext(), inbound('Can I see it?'), null, deps);
    expect(backends.journal.filter((w) => w.effect === 'propose_slots')).toHaveLength(1);
    expect(r.outcome).toBe('drafted');
    expect(journal.drafts[0].text).toContain('Friday 28 August, 17:00');
  });

  it('R5: a throwing backend costs ONE tool call, never the turn', async () => {
    const backends = new FakeBackends();
    backends.searchProperties = async () => { throw new Error('db timeout'); };
    const model = new ScriptedModel([
      toolResponse('search_properties', { city: 'San Javier' }),
      // Law-compliant graceful degradation: no office promise without a filed
      // ticket (office-promise law, 2026-08-27), no self future promise.
      textResponse('My property search is being a little slow right now — mind asking me again in a few minutes?'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('What do you have in San Javier?'), null, deps);
    expect(r.outcome).toBe('sent');
    const ev = r.loop!.toolEvents.find((e) => e.tool === 'search_properties');
    expect(ev?.result.refused).toBe('backend_error');
  });

  it('R6: a ref passed as property_id resolves to the real uuid before slot proposal', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'IC-28746' }),
      textResponse('I could do Friday 28 August, 17:00 or Saturday 29 August, 11:00 — which suits?'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Can I see IC-28746?'), null, deps);
    expect(r.outcome).toBe('sent');
    const propose = backends.journal.find((w) => w.effect === 'propose_slots');
    expect(propose?.detail.propertyId).toBe('prop-1');   // resolved, not the raw ref
  });

  it('R7: long-form is earned by a details fetch — a property summary may run past 35 words', async () => {
    const longSummary = 'It is a bright three-bedroom chalet of 120 m² in San Javier with a private pool, a big terrace and air conditioning, listed at €245000. The living room opens onto the terrace, and the Mar Menor beaches are a short drive away. Shall I line up a viewing so you can feel it for yourself?';
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('get_property_details', { ref: 'IC-28746' }),
      textResponse(longSummary),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Tell me about IC-28746'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toBe(longSummary);
  });
});

describe('golden/core — greeting/gap law', () => {
  it('G1: the gap note reaches the model verbatim (fresh-start law is deterministic)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Hello again! Lovely to hear from you — how can I help today?')]);
    const { deps } = makeDeps(model, backends);
    const ctx = baseContext({ gapNote: 'The buyer\'s previous exchange was 42 days ago. Treat this as a FRESH conversation opening: greet warmly, do NOT resume their old requests unless they bring them up, and ask what they need today.' });
    const r = await runTurn('full', ctx, inbound('Hello!'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(JSON.stringify(model.requests[0].messages)).toContain('FRESH conversation opening');
    expect(model.requests[0].system).toContain('bare greeting');
    expect(model.requests[0].system).toContain('Never promise future actions');
  });
});

describe('golden/core — cancel-viewing law', () => {
  it('C1: FULL + exactly one upcoming viewing → cancelled, calendar rides along', async () => {
    const backends = new FakeBackends();
    backends.upcomingViewings = [{ id: 'bk-1', label: 'Friday 28 August, 17:00 · Chalet (IC-28746)' }];
    const model = new ScriptedModel([
      toolResponse('cancel_viewing', {}),
      textResponse('All cancelled — no problem at all. Shall we look at another day, or leave it for now?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Please cancel my viewing'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(backends.journal.filter((w) => w.effect === 'cancel_viewing')).toEqual([{ effect: 'cancel_viewing', detail: { bookingId: 'bk-1' } }]);
    expect(journal.sent).toHaveLength(1);
  });

  it('C2: several upcoming viewings → NOTHING cancelled, the model gets the list to ask WHICH', async () => {
    const backends = new FakeBackends();
    backends.upcomingViewings = [
      { id: 'bk-1', label: 'Friday 28 August, 17:00' },
      { id: 'bk-2', label: 'Saturday 29 August, 11:00' },
    ];
    const model = new ScriptedModel([
      toolResponse('cancel_viewing', {}),
      textResponse('Of course — you have two coming up: Friday 28 August, 17:00 and Saturday 29 August, 11:00. Which one should I cancel?'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('cancel my viewing please'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(backends.journal.filter((w) => w.effect === 'cancel_viewing')).toHaveLength(0);
    expect(JSON.stringify(model.requests[1].messages)).toContain('candidates');
  });

  it('C3: ASSISTED → no cancellation executes; a human task is filed and the model reassures', async () => {
    const backends = new FakeBackends();
    backends.upcomingViewings = [{ id: 'bk-1', label: 'Friday 28 August, 17:00' }];
    const model = new ScriptedModel([
      toolResponse('cancel_viewing', {}),
      textResponse('Of course — the office is taking care of that cancellation right now. Anything else I can help with?'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('assisted', baseContext(), inbound('cancel my viewing'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(backends.journal.filter((w) => w.effect === 'cancel_viewing')).toHaveLength(0);
    expect(backends.journal.filter((w) => w.effect === 'cancel_request_task')).toHaveLength(1);
    expect(JSON.stringify(model.requests[1].messages)).toContain('queuedForHuman');
  });

  it('C4: SHADOW → simulated, zero writes', async () => {
    const backends = new FakeBackends();
    backends.upcomingViewings = [{ id: 'bk-1', label: 'Friday 28 August, 17:00' }];
    const model = new ScriptedModel([
      toolResponse('cancel_viewing', {}),
      textResponse('Done — consider it cancelled. Another day instead?'),
    ]);
    const { deps } = makeDeps(model, backends);
    await runTurn('shadow', baseContext(), inbound('cancel my viewing'), null, deps);
    expect(backends.journal.filter((w) => ['cancel_viewing', 'cancel_request_task'].includes(w.effect))).toHaveLength(0);
  });
});

describe('golden/core — office-answer relay (§3b step 3)', () => {
  const RELAY_NOTE = '[OFFICE ANSWER for Q3 — the buyer had asked: "Is the price negotiable?". The office answers: "Yes, we would consider offers from 230000 euros". Relay this to the buyer NOW...]';

  it('R8: the office\'s numbers are authoritative — the relay passes gates and sends in FULL', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('Word back from the office — they would consider offers from €230.000. Shall I set up a viewing so you can see it first?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const ctx = baseContext({ officeAnswerText: 'Yes, we would consider offers from 230000 euros' });
    const r = await runTurn('full', ctx, inbound(RELAY_NOTE), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toContain('230.000');
  });

  it('R9: in APPROVAL mode the relay becomes a draft — nothing auto-sends', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('The office says they would consider offers from €230.000 — happy to talk it through whenever you like.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const ctx = baseContext({ officeAnswerText: 'Yes, we would consider offers from 230000 euros' });
    const r = await runTurn('approval', ctx, inbound(RELAY_NOTE), null, deps);
    expect(r.outcome).toBe('drafted');
    expect(journal.sent).toHaveLength(0);
    expect(journal.drafts[0].text).toContain('230.000');
  });

  it('R10: the verifier receives the office answer as authoritative data', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('The office confirms: offers from €230.000 would be considered.'),
    ]);
    const { deps } = makeDeps(model, backends);
    let seenAuthoritative: string[] | undefined;
    deps.verifier = async (_draft, _events, authoritative) => {
      seenAuthoritative = authoritative;
      return true;
    };
    const ctx = baseContext({ officeAnswerText: 'Yes, we would consider offers from 230000 euros' });
    await runTurn('full', ctx, inbound(RELAY_NOTE), null, deps);
    expect(seenAuthoritative).toEqual(['Yes, we would consider offers from 230000 euros']);
  });

  it('R11: WITHOUT an office answer the same number still dies at the gate', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('They would consider offers from €230.000.'),
      // The regen must clear the office-promise law too: an OFFER (question),
      // not an unfiled first-person promise.
      textResponse('That is one for the office — want me to ask them about the price for you?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Is the price negotiable?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).not.toContain('230.000');
  });
});

describe('golden/core — research before escalation (Christian 2026-08-28)', () => {
  it('S30: a local question is RESEARCHED and answered — no office ticket is filed', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('research_area', { question: 'Where exactly is the Norwegian school near Ciudad Quesada?' }),
      textResponse('The Norwegian school sits just outside Ciudad Quesada, a few minutes from the centre — want me to look for homes around there?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Do you know where the Norwegian school is?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(backends.journal.filter((w) => w.effect === 'research_area')).toHaveLength(1);
    expect(backends.journal.filter((w) => w.effect === 'ask_agency')).toHaveLength(0);   // researched, not ticketed
    expect(journal.sent).toHaveLength(1);
  });

  it('S31: research is a READ — SHADOW may use it, and still sends nothing', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('research_area', { question: 'What is Ciudad Quesada like in winter?' }),
      textResponse('Quesada stays lively through the winter — plenty of the community lives there year round.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('shadow', baseContext(), inbound('Is Quesada dead in winter?'), null, deps);
    expect(r.outcome).toBe('simulated');
    expect(journal.sent).toHaveLength(0);
    const ev = r.loop!.toolEvents.find((e) => e.tool === 'research_area');
    expect(ev?.result.ok).toBe(true);
  });
});

describe('golden/core — escalation ladder (§3)', () => {
  it('S16: ask_agency files the ticket for real in APPROVAL mode; the reply is a draft', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('ask_agency', { question: 'Is the price of IC-28746 negotiable?', property_id: 'prop-1' }),
      textResponse('Good question — I have asked the office and will come back to you. Meanwhile, fancy a look at the terrace photos?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('approval', baseContext(), inbound('Is the price negotiable?'), null, deps);
    expect(backends.journal.filter((w) => w.effect === 'ask_agency')).toHaveLength(1);   // ticket is REAL (§3b)
    expect(r.outcome).toBe('drafted');
    expect(journal.sent).toHaveLength(0);
    expect(journal.drafts).toHaveLength(1);
  });

  it('S17: in SHADOW even the ticket is simulated', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('ask_agency', { question: 'Is the price negotiable?' }),
      textResponse('I will check that with the office and come right back to you.'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('shadow', baseContext(), inbound('Is the price negotiable?'), null, deps);
    expect(backends.journal.filter((w) => w.effect === 'ask_agency')).toHaveLength(0);
    expect(r.outcome).toBe('simulated');
  });

  it('S18: handoff_to_human executes in FULL and the warm handover line sends', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('handoff_to_human', { reason: 'live_negotiation', summary: 'Buyer offered 180k on IC-28746' }),
      textResponse('I will pass your offer to the team right now — they handle negotiations personally and will reply today.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('I offer 180k, take it or leave it'), null, deps);
    expect(backends.journal.filter((w) => w.effect === 'handoff')).toHaveLength(1);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toContain('pass your offer');
  });

  it('S19: intel is recorded for real in live modes and lands in the journal', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('record_lead_intel', { budget_max: 250000, areas: ['San Javier'], timeline: 'this autumn' }),
      textResponse('San Javier is a lovely choice. Shall I show you a couple of villas in your range?'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('assisted', baseContext(), inbound('We have about 250k and want San Javier this autumn'), null, deps);
    expect(r.outcome).toBe('sent');
    const intel = backends.journal.find((w) => w.effect === 'record_intel');
    expect(intel).toBeDefined();
    expect(JSON.stringify(intel!.detail)).toContain('250000');
  });
});

describe('golden/core — mode dial edges', () => {
  it('S20: OFF refuses the whole turn — no model call, no writes, nothing sent', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('off', baseContext(), inbound('Hola'), null, deps);
    expect(r.outcome).toBe('refused');
    expect(model.requests).toHaveLength(0);
    expect(journal.sent).toHaveLength(0);
    expect(backends.journal).toHaveLength(0);
  });

  it('S21: an empty model draft escalates instead of sending emptiness', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([{ content: [], stop_reason: 'end_turn' }]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Hello?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.escalations[0].reason).toBe('empty_draft');
  });

  it('S22: slot proposals surface the EXACT explicit labels for the model to echo', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'prop-1' }),
      textResponse('I could do Friday 28 August, 17:00 or Saturday 29 August, 11:00 — which suits you?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Can I see the chalet?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toContain('Friday 28 August, 17:00');
    // The tool result the model saw carried the same explicit label — no invented dates.
    expect(JSON.stringify(model.requests[1].messages)).toContain('Friday 28 August, 17:00');
  });

  it('S23: rejected properties context reaches the prompt (never re-pitch)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([textResponse('Understood — I will keep that one out of your list.')]);
    const { deps } = makeDeps(model, backends);
    const ctx = baseContext({ leadState: { rejected_property_ids: ['prop-2'] } });
    await runTurn('full', ctx, inbound('Not the Torrevieja one please'), null, deps);
    expect(JSON.stringify(model.requests[0].messages)).toContain('NOT interested in: prop-2');
  });

  it('S25: slot taken at execution → nothing booked, proposal released, model told honestly', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('So sorry — that Friday slot was just taken. Shall I line up a couple of fresh times for you?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    deps.executeBooking = async () => ({ ok: false, reason: 'slot_taken' });
    const r = await runTurn('full', baseContext(), inbound('Yes please!'), pending(), deps);
    expect(r.bookingId).toBeNull();
    expect(r.outcome).toBe('sent');
    expect(journal.released).toEqual([{ id: 'pa-1', reason: 'superseded' }]);
    expect(JSON.stringify(model.requests[0].messages)).toContain('JUST TAKEN');
  });

  it('S24: cannot_answer is surfaced to the orchestrator for calibration', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('cannot_answer', { reason: 'community fee not in listing data' }),
      textResponse('Let me get you the exact figure from the office rather than guessing — one moment.'),
    ]);
    const { deps } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('What are the community fees?'), null, deps);
    expect(r.loop?.cannotAnswer).toContain('community fee');
    expect(r.outcome).toBe('sent');
  });
});

/**
 * THE SUITE'S BLIND SPOT, and why none of the 44 scenarios above caught a
 * single one of this week's four live failures.
 *
 * Almost every scenario asks "is a BAD draft blocked?". Not one asked "is a
 * GOOD draft SENT?". Every live failure was the second kind — a correct,
 * researched answer destroyed on its way out, which Christian experienced as
 * Amanda being stupid and evasive. He named the risk exactly (2026-08-30):
 * "im just afraid that we make progress in this spesific conversation, but that
 * in another scenario with different questions she would break."
 *
 * These are the four real failures, frozen. A gate that starts eating correct
 * answers again fails here first, not on his phone.
 */
describe('golden/core — answers that MUST reach the buyer', () => {
  const school = 'The Norwegian school sits right in the middle of Ciudad Quesada, about ten minutes from the beach.';

  it('L1 (2026-08-29): a researched answer a little over the short cap is TRIMMED and sent, never escalated', async () => {
    const backends = new FakeBackends();
    const long = `${school} It is a popular spot with Scandinavian families, and there are homes nearby that would suit you well. Shall I show you a couple?`;
    const model = new ScriptedModel([
      toolResponse('research_area', { area: 'Ciudad Quesada' }),
      textResponse(long),
      textResponse(long),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    deps.verifier = async () => true;
    const r = await runTurn('full', baseContext(), inbound('Is there anything near the Norwegian school?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).not.toBe(GATE_FALLBACK.en);
    expect(journal.sent[0]).toContain('Ciudad Quesada');
  });

  it('L2 (2026-08-30): re-answering with NO tool calls is grounded by what she already told this buyer', async () => {
    const backends = new FakeBackends();
    const ctx = baseContext();
    ctx.recentTurns = [
      { role: 'buyer', text: 'Anything near the Norwegian school?', at: '2026-08-29T20:00:00Z' },
      { role: 'amanda', text: `${school} A three-bed townhouse there is 220 000 EUR.`, at: '2026-08-29T20:01:00Z' },
    ];
    const model = new ScriptedModel([textResponse('Yes — that one is in Quesada, close to the school, at 220 000 EUR.')]);
    const { deps, journal } = makeDeps(model, backends);
    deps.verifier = async () => true;
    const r = await runTurn('full', ctx, inbound('Is the house in Quesada, near the school?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).not.toBe(GATE_FALLBACK.en);
  });

  it('L3: a number she NEVER said is still blocked, even with history present', async () => {
    const backends = new FakeBackends();
    const ctx = baseContext();
    ctx.recentTurns = [{ role: 'amanda', text: 'That townhouse is 220 000 EUR.', at: '2026-08-29T20:01:00Z' }];
    const model = new ScriptedModel([
      textResponse('There is also one at 149 000 EUR.'),
      textResponse('There is also one at 149 000 EUR nearby.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    deps.verifier = async () => true;
    const r = await runTurn('full', ctx, inbound('Anything cheaper?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.sent).toEqual([GATE_FALLBACK.en]);
  });

  it('L4 (2026-08-30): the dead-air line never blames the office — that manufactured fake agent errands', async () => {
    for (const line of Object.values(GATE_FALLBACK)) {
      expect(line.toLowerCase()).not.toMatch(/office|oficina|büro|kontor|bureau|ufficio|escritório|biura|toimisto|офис/);
    }
  });
});

/**
 * Christian 2026-08-30, on the first genuinely good conversation: "she offered
 * to send pictures again ... the last message was pretty repetitive."
 *
 * Both are prompt laws, so the machine cannot enforce them — but the prompt
 * TEXT can be pinned. A future edit that quietly drops either rule fails here.
 */
describe('golden/core — prompt laws that survived a live complaint', () => {
  it('the photo ban is absolute, not a "do not promise" that leaves offering open', () => {
    const p = buildSystemPrompt({ agencyName: 'Test', leadLanguage: 'nb' } as never);
    expect(p).toContain('PHOTOS — ABSOLUTE');
    expect(p).toMatch(/never offer, suggest, or ask whether they would like to see pictures/i);
    // The old wording is what the model routed around — it must not come back.
    expect(p).not.toMatch(/do NOT promise to send photos yourself/);
  });

  it('the anti-padding law is present and names the real failure', () => {
    const p = buildSystemPrompt({ agencyName: 'Test', leadLanguage: 'nb' } as never);
    expect(p).toContain('NEVER PAD');
    expect(p).toMatch(/ONE fact dressed up three times/);
  });
});
