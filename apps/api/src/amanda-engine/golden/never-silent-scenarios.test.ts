import { describe, it, expect } from 'vitest';
import { runTurn, GATE_FALLBACK } from '../turn';
import { FakeBackends, ScriptedModel, makeDeps, baseContext, inbound, textResponse, toolResponse } from './harness';

// Live 2026-09-19 10:20: "Kan jeg se villaen på mandag" → six read-only lookups,
// the loop cap, no text → escalated as empty_draft and the buyer got SILENCE.
// Never again: an empty turn gets one answer-now call, and if that is empty too,
// the buyer gets the holding line like every other escalation.
const lookups = (n: number) => Array.from({ length: n }, (_, i) => toolResponse('get_area_info', { area: `Quesada ${i}` }));

describe('never silent — a turn that ends without a reply', () => {
  it('six lookups, then a tools-free answer that passes the gates, is SENT', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([...lookups(6), textResponse('Quesada is a family-friendly coastal town with sandy beaches nearby.')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('What is Quesada like?'), null, deps);
    expect(r.outcome).toBe('sent');
    expect(journal.sent).toEqual(['Quesada is a family-friendly coastal town with sandy beaches nearby.']);
    expect(journal.escalations).toHaveLength(0);
  });

  it('when even the answer-now call is empty: escalated AND the buyer gets the holding line (not silence)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([...lookups(6), textResponse('')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext({ leadLanguage: 'nb' }), inbound('Kan jeg se villaen på mandag?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.escalations[0].reason).toBe('empty_draft');
    expect(journal.sent).toEqual([GATE_FALLBACK.nb]);
    expect(r.replyText).toBe(GATE_FALLBACK.nb);
  });

  it('live 12:45 replay: a half-sentence written before a lookup is NEVER sent — the buyer gets the holding line', async () => {
    const backends = new FakeBackends();
    const fragment = 'Beklager, jeg vil bare være sikker på at jeg booker visning til riktig villa – kan du si';
    const model = new ScriptedModel([
      toolResponse('search_properties', { cities: ['Ciudad Quesada'], keywords: ['Calle Sevilla'] }, fragment),
      ...lookups(5),
      textResponse(''),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext({ leadLanguage: 'nb' }), inbound('Kan jeg se villaen i Calle Sevilla 14 på mandag kl 12?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.sent).toEqual([GATE_FALLBACK.nb]);
    expect(journal.sent.join(' ')).not.toContain('kan du si');
  });

  it('a handoff that FAILS sends no "passed to a colleague" line and fails the turn loudly (retried)', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([...lookups(6), textResponse('')]);
    const { deps, journal } = makeDeps(model, backends);
    deps.escalateToHuman = async () => { throw new Error('task insert failed'); };
    await expect(runTurn('full', baseContext({ leadLanguage: 'nb' }), inbound('Hei?'), null, deps)).rejects.toThrow('task insert failed');
    expect(journal.sent).toEqual([]);                    // no false reassurance
  });

  it('the gates_failed path is gated the same way', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse("I'll get back to you with some options later."),
      textResponse("I'll come back to you with a few ideas."),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    deps.escalateToHuman = async () => { throw new Error('task insert failed'); };
    await expect(runTurn('full', baseContext(), inbound('Any villas?'), null, deps)).rejects.toThrow('task insert failed');
    expect(journal.sent).toEqual([]);
  });

  it('when the handoff succeeds on the gates_failed path, the holding line IS sent', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([
      textResponse("I'll get back to you with some options later."),
      textResponse("I'll come back to you with a few ideas."),
    ]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('full', baseContext(), inbound('Any villas?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.escalations[0].reason).toBe('gates_failed');
    expect(journal.sent).toEqual([GATE_FALLBACK.en]);
  });

  it('shadow mode: the holding line is simulated, nothing leaves', async () => {
    const backends = new FakeBackends();
    const model = new ScriptedModel([...lookups(6), textResponse('')]);
    const { deps, journal } = makeDeps(model, backends);
    const r = await runTurn('shadow', baseContext(), inbound('Hello?'), null, deps);
    expect(r.outcome).toBe('escalated');
    expect(journal.sent).toEqual([]);
    expect(journal.drafts).toEqual([]);
  });
});
