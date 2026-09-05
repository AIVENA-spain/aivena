import { describe, expect, it } from 'vitest';
import { buildPalette } from './studio-palette';
import type { SourceFact } from './studio-evidence';

const fact = (o: Partial<SourceFact> & { id: string; canonical: string }): SourceFact => ({
  sourceId: 'S1', excerpt: '', language: 'es', sourceClass: 'professional_body',
  geography: '', period: '', metric: '', ...o,
});

describe('the palette governs facts, not creativity', () => {
  const facts = [
    fact({ id: 'F1', canonical: 'Dutch buyers completed 3,708 purchases in Alicante province in 2025.',
      geography: 'Alicante province', period: '2025', metric: 'count' }),
    fact({ id: 'F2', canonical: 'The Registradores nationality ranking is published at national level only.',
      metric: 'rule' }),
  ];
  const p = buildPalette({ facts, unknown: ['Which nationality leads each municipality'],
    forbidden: ['Do not generalise a national ranking to Alicante province'],
    agency: 'Works in: Jávea, Moraira, Dénia, Teulada' });

  it('offers the facts with their scope and metric attached', () => {
    expect(p).toContain('F1 [count · Alicante province · 2025 · professional body]');
    expect(p).toContain('3,708 purchases');
  });
  it('names what is not established and forbids implying it', () => {
    expect(p).toContain('NOT ESTABLISHED');
    expect(p).toContain('Which nationality leads each municipality');
    // "nobody publishes this" is itself a claim — the leak H4 shipped twice
    expect(p).toMatch(/nobody publishes this/i);
  });
  it('carries the guardrails as forbidden conclusions, not as background reading', () => {
    expect(p).toContain('FORBIDDEN CONCLUSIONS');
    expect(p).toContain('Do not generalise a national ranking to Alicante province');
  });
  // Christian, 2026-09-05: "Do NOT invent five laws because the template has five cards."
  it('tells the writer not to write five factual slides', () => {
    expect(p).toMatch(/DO NOT WRITE FIVE FACTUAL SLIDES/);
    expect(p).toMatch(/better post than five citations/i);
  });
  it('leaves hooks, framing, opinion and argument explicitly free', () => {
    expect(p).toMatch(/EVERYTHING ELSE IS YOURS/);
    expect(p).toMatch(/HOW SELLING WORKS IS NOT A FACT THAT NEEDS A SOURCE/);
  });
  it('says what to do instead of reaching for a remembered number', () => {
    expect(p).toMatch(/A figure you did not get from this list is an invention/);
  });

  it('is empty for a topic with nothing to constrain, so pure marketing is untouched', () => {
    expect(buildPalette({ facts: [], unknown: [], forbidden: [], agency: 'Works in: Jávea' })).toBe('');
  });
  it('says so plainly when research opened nothing', () => {
    const none = buildPalette({ facts: [], unknown: ['x'], forbidden: [], agency: '' });
    expect(none).toMatch(/ESTABLISHED — nothing/);
    expect(none).toMatch(/experience, judgement and position/);
  });
});
