import { describe, it, expect } from 'vitest';
import { buildPingBody } from './agent-ping-lib';

/**
 * What lands on an agent's phone. They may be driving, between viewings, or
 * have three of these open — so the message has to say who, what, and what to
 * do, in the first two lines, without an app to open.
 */
describe('buildPingBody', () => {
  const body = buildPingBody({
    shortCode: 3,
    question: 'Can we confirm the exact street address of the villa?',
    leadName: 'Marte Brenno',
    agencyName: 'Mediterráneo Costa Homes',
  });

  it('names the buyer and the question number', () => {
    expect(body).toContain('Marte Brenno');
    expect(body).toContain('Q3');
  });

  it('carries the question itself, not a summary', () => {
    expect(body).toContain('Can we confirm the exact street address of the villa?');
  });

  it('tells them plainly that replying IS the answer', () => {
    expect(body.toLowerCase()).toContain('reply to this message');
  });

  it('falls back gracefully when the buyer has no name yet', () => {
    const anon = buildPingBody({ shortCode: 1, question: 'Is the price negotiable?', leadName: null, agencyName: null });
    expect(anon).toContain('A client');
    expect(anon).not.toContain('null');
  });

  it('stays short enough to read on a lock screen before the question', () => {
    expect(body.split('\n')[0].length).toBeLessThan(120);
  });
});
