import { describe, it, expect } from 'vitest';
import { runTurn, GATE_FALLBACK } from '../turn';
import { FakeBackends, ScriptedModel, makeDeps, baseContext, inbound, textResponse, toolResponse } from './harness';

// Christian 2026-09-19 (binding): proposed times must be SEEN in the reply that
// proposed them; no promise to "come back"; "tomorrow" must match the real days.
// Harness clock: Wednesday 26 August 2026, 12:00 Madrid. Fake slots: Friday
// 28 August 17:00 (the day after tomorrow) and Saturday 29 August 11:00.

describe('slot truth — the live 2026-09-19 failure, replayed through a whole turn', () => {
  it('a hidden-times promise is rejected; the rewrite keeps its answer and the buyer gets the times', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'prop-1' }),
      // The exact shape of the live reply: fact, then a promise, no times, wrong "tomorrow".
      textResponse('Villaen ligger nær den norske skolen. La meg sjekke hva vi har ledig i morgen, så kommer jeg straks tilbake med tider.'),
      // The rewrite drops the promise but still forgets the times.
      textResponse('Villaen ligger nær den norske skolen.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext({ leadLanguage: 'nb' }), inbound('Hei!'), null, deps);

    expect(r.outcome).toBe('sent');
    const sent = journal.sent[0];
    expect(sent).not.toMatch(/tilbake med tider|i morgen/);
    expect(sent).toContain('17:00');
    expect(sent).toContain('11:00');
    expect(sent).toMatch(/fredag 28\. august/);
    expect(sent).toMatch(/lørdag 29\. august/);
    expect(journal.released).toEqual([]);                 // the proposals stay: the buyer can now pick one
    // The retry was told exactly what was wrong.
    const retryPrompt = JSON.stringify(model.requests[2].messages);
    expect(retryPrompt).toContain('self_future_promise');
    expect(retryPrompt).toContain('proposed_times_not_shown');
    expect(retryPrompt).toContain('relative_day_does_not_match');
  });

  it('a draft that keeps promising twice escalates, and the unseen proposals are released', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'prop-1' }),
      textResponse('La meg sjekke, så kommer jeg straks tilbake med tider.'),
      textResponse('Jeg sjekker kalenderen og kommer tilbake til deg.'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext({ leadLanguage: 'nb' }), inbound('Kan jeg se den?'), null, deps);

    expect(r.outcome).toBe('escalated');
    expect(journal.escalations[0].reason).toBe('gates_failed');
    expect(journal.released).toEqual([
      { id: 'pa-1a', reason: 'superseded' },
      { id: 'pa-1b', reason: 'superseded' },
    ]);
    expect(journal.sent).toEqual([GATE_FALLBACK.nb]);
  });

  it('"tomorrow" that matches no proposed day is corrected before sending', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'prop-1' }),
      textResponse('I have tomorrow at 17:00 or Saturday 29 August at 11:00 — which suits you?'),
      textResponse('I have Friday 28 August at 17:00 or Saturday 29 August at 11:00 — which suits you?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Can I see it this week?'), null, deps);

    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toBe('I have Friday 28 August at 17:00 or Saturday 29 August at 11:00 — which suits you?');
  });

  it('showing the times in the buyer\'s own words passes untouched (no appended line)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      toolResponse('propose_viewing_slots', { property_id: 'prop-1' }),
      textResponse('Jeg kan tilby fredag 28. august kl. 17:00 eller lørdag 29. august kl. 11:00. Hva passer?'),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext({ leadLanguage: 'nb' }), inbound('Kan jeg se den?'), null, deps);

    expect(r.outcome).toBe('sent');
    expect(journal.sent[0]).toBe('Jeg kan tilby fredag 28. august kl. 17:00 eller lørdag 29. august kl. 11:00. Hva passer?');
    expect(model.requests).toHaveLength(2);                // no regeneration was needed
  });
});
