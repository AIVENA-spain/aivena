// Amanda golden suite — deterministic CORE scenarios (design §7). One command:
//   npx vitest run apps/api/src/amanda-engine/golden/
// These prove the MACHINE (modes, gates, validators, confirmation law, booking
// path) end-to-end with a scripted model. Live-model quality scenarios ride the
// same harness behind AMANDA_GOLDEN_LIVE at P1.

import { describe, it, expect } from 'vitest';
import { runTurn } from '../turn';
import {
  FakeBackends, ScriptedModel, makeDeps, baseContext, inbound, pending,
  textResponse, toolResponse, CHALET,
} from './harness';

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

  it('S10: still-dirty after one regeneration → escalates, buyer gets NOTHING unvetted', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse('Last chance! Act now!'),
      textResponse('Final chance — it won’t last!'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('hmm'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.sent).toHaveLength(0);
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
    expect(journal.sent).toHaveLength(0);
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
    expect(journal.sent).toHaveLength(0);
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
      textResponse('Let me check the latest San Javier options with the office and come right back to you.'),
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
