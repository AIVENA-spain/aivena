import { describe, expect, it } from 'vitest';

import { adjudicate, incompleteBody, trimWords, uncoveredRequirements, RESOLVED_HARD_FAIL, RESOLVED_OK } from './studio-copy-gate';

/**
 * REGRESSION: a generated card shipped ending "timelines still vary by court and".
 *
 * The old trim cut at a word boundary, which is not a thought boundary. A reader cannot see the
 * character cap — a body ending on a connective just reads as a broken product. Cosmetic failures
 * trim and send; they never fail the run, so the trim itself has to produce something sendable.
 */
describe('trimWords', () => {
  it('leaves anything inside the budget untouched', () => {
    expect(trimWords('Short enough already.', 250)).toBe('Short enough already.');
    expect(trimWords(undefined, 250)).toBe(undefined);
  });

  it('never ends on a dangling connective', () => {
    const DANGLE = /\s(?:and|or|but|so|because|since|while|with|without|for|from|to|of|in|on|at|by|as|that|which|than|per|y|o|pero|con|sin|para|de|en|por|como|que|a)$/i;
    const cases: [string, number][] = [
      ['Since 3 April 2025 the rule changed. Before the reform, courts averaged 23.2 months nationally — timelines still vary by court and jurisdiction.', 150],
      ['One idea here and another idea there and a third that runs long and', 40],
      ['The withholding is only an advance against the final bill, and it is settled later by', 60],
      ['Buyers notice the gap before they ever ask about the house, which is why', 55],
      ['Precio, notaría, registro y gestoría se descuentan del importe final para', 50],
    ];
    for (const [text, max] of cases) {
      const out = trimWords(text, max) as string;
      expect(out.length).toBeLessThanOrEqual(max);
      expect(out, `dangling connective left in: ${JSON.stringify(out)}`).not.toMatch(DANGLE);
      expect(out).not.toMatch(/[\s,;:—–-]$/);
    }
  });

  it('prefers the last complete sentence when one lands past half the budget', () => {
    const text = 'The bank is paid off from the proceeds at completion, before you ever see a cent. '
      + 'A cancellation cost applies on top of that, and it varies by lender.';
    expect(trimWords(text, 110))
      .toBe('The bank is paid off from the proceeds at completion, before you ever see a cent.');
  });

  it('takes a shorter complete sentence over a longer incomplete one', () => {
    // Policy change, Christian 2026-09-03: a complete shorter card beats an incomplete longer one.
    // The old rule kept more text by word-cutting, and that is how a card shipped without a full stop.
    const text = 'The bank is paid off at completion. A cancellation cost applies on top of that, and it varies by lender.';
    expect(trimWords(text, 80)).toBe('The bank is paid off at completion.');
  });

  it('only falls back to a word cut when no sentence ends inside the budget at all', () => {
    const text = 'An exclusive mandate hands the sale to a single agency for a set period of months';
    const out = trimWords(text, 50) as string;
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).not.toMatch(/\s(?:and|of|by|on|to|for|a)$/i);
    expect(text.startsWith(out)).toBe(true);
  });

  it('falls back to a word cut when no sentence fits inside the budget', () => {
    const text = 'An exclusive mandate hands the sale to a single agency for a set period of three to six months.';
    const out = trimWords(text, 40) as string;
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.split(' ').length).toBeGreaterThan(3);
    expect(text.startsWith(out)).toBe(true);
  });
});

describe('a prose card ends where a sentence ends', () => {
  it('prefers a complete sentence wherever it falls, not only past half the budget', () => {
    // THE REAL CASE. This shipped as "...each with its own tourist office" with no full stop,
    // because the only sentence end sat below the old half-budget floor and the word cut took over.
    const d2 = 'Dénia has carried UNESCO Creative City of Gastronomy status since 2015 — its identity '
      + 'runs through the port and its kitchens. Jávea instead spreads across three distinct centres: '
      + 'Centro Histórico, Puerto and Arenal, each with its own tourist office and its own character.';
    const out = trimWords(d2, 250) as string;
    expect(out.length).toBeLessThanOrEqual(250);
    expect(out.endsWith('.')).toBe(true);
    expect(incompleteBody('tips[1].body', out)).toBe(false);
  });

  it('does not cut at an abbreviation or a decimal', () => {
    // "art. 245.2" and "3.404 €/m²" both contain full stops that end nothing.
    const legal = 'Occupation of an empty home falls under art. 245.2 of the criminal code, which is '
      + 'tried as a minor offence rather than on the fast track, and the distinction changes the '
      + 'timeline completely for an owner who is trying to act quickly.';
    const out = trimWords(legal, 120) as string;
    expect(out).not.toMatch(/\bart\.$/);
    const price = 'Dénia averages around €3.404/m² town-wide as of May 2026 and the figure has been '
      + 'climbing steadily through the year across most of the coastal towns nearby.';
    expect(trimWords(price, 60) as string).not.toMatch(/€3\.$/);
  });

  it('flags a cut body but never a styled fragment', () => {
    expect(incompleteBody('tips[1].body', 'Jávea instead spreads across three centres, each with its own tourist office')).toBe(true);
    expect(incompleteBody('tips[1].body', 'Jávea spreads across three centres.')).toBe(false);
    // Titles, hooks and recap lines are allowed to be fragments — this is the check that must NOT
    // grow into the dangling-word logic that flagged five correct sentences.
    expect(incompleteBody('hook_title', 'One agency. One price. One story')).toBe(false);
    expect(incompleteBody('recap_title', 'In 30 seconds')).toBe(false);
    expect(incompleteBody('tips[0].title', 'Nobody actually owns the sale')).toBe(false);
    // And a body ending on a short word is fine when the sentence is finished.
    expect(incompleteBody('tips[0].body', 'Structure the listing around what a buyer decides on.')).toBe(false);
    expect(incompleteBody('caption', 'Which one matches how you actually want to spend a Tuesday?')).toBe(false);
  });
});

describe('the bank asks, the research answers — or the writer is told it did not', () => {
  const MUST_B20 = [
    'Verified distance and drive time between the two town centres',
    'Use the current INE Censo Anual de Población municipality tables for nationality and cite the exact table and reference year',
    'Year-round versus seasonal population for each',
  ];

  it('flags the requirement a live post asserted anyway', () => {
    // Real defect: bank card B20 requires year-round versus seasonal population, the brief came
    // back without it, and the post asserted which town is busier in summer regardless.
    const brief = 'Javea and Denia are 11km apart, about 20 minutes by car. Denia has held UNESCO '
      + 'Creative City of Gastronomy status since 2015. Javea spreads across three centres.';
    expect(uncoveredRequirements(MUST_B20, brief))
      .toContain('Year-round versus seasonal population for each');
  });

  it('clears once the brief actually covers it', () => {
    const brief = 'Javea and Denia sit 11km apart, roughly 20 minutes by car between the two town '
      + 'centres. Year-round population versus seasonal population differs sharply in each: both '
      + 'record large seasonal swings, with Denia the larger year-round.';
    expect(uncoveredRequirements(MUST_B20, brief))
      .not.toContain('Year-round versus seasonal population for each');
  });

  it('treats an empty brief as covering nothing, and vague requirements as unjudgeable', () => {
    expect(uncoveredRequirements(MUST_B20, '')).toHaveLength(3);
    // Too few distinctive words to judge — silence beats a false alarm the writer must route around.
    expect(uncoveredRequirements(['Check the price'], 'Nothing relevant here at all.')).toHaveLength(0);
  });
});

describe('adjudication — the second opinion is evidence, not a judge', () => {
  const RESEARCH = 'Non-resident sellers have 3% of the price withheld by the buyer and paid to the '
    + 'Treasury. Plusvalía municipal is charged by the town hall on the rise in land value.';
  const EVIDENCE = 'WHAT THIS AGENCY HAS ACTUALLY TOLD US:\n· Works in: Jávea, Moraira, Dénia, '
    + 'Teulada\n· Mandate types offered: both\n· Staff actually speak: es, en, nl, de\n'
    + 'Sales and listings on the northern Costa Blanca.';
  const base = { type: 'FACTUAL_MATERIAL', research: RESEARCH, agencyEvidence: EVIDENCE, uncovered: [] as string[] };

  it('rescues the exact false positive that motivated this', () => {
    // A stochastic verifier called this UNSUPPORTED. Every town and the service are the agency's own.
    expect(adjudicate({ ...base, type: 'AGENCY_FACT',
      text: 'Mediterráneo Costa Homes handles sales and listings in Jávea, Moraira, Dénia and Teulada.' }))
      .toBe('SUPPORTED_BY_AGENCY_PROFILE');
  });

  it('keeps what the research actually established', () => {
    expect(adjudicate({ ...base,
      text: 'The buyer withholds 3% of the price and pays it to the Treasury.' }))
      .toBe('SUPPORTED_BY_RESEARCH');
  });

  it('never lets past performance hide behind a service promise', () => {
    // Christian's loophole. An offer is fine; a record of results is not.
    expect(adjudicate({ ...base, type: 'AGENCY_FACT',
      text: "We've seen how the accountable-team approach plays out on this coast." }))
      .toBe('NEEDS_REPAIR');
    expect(adjudicate({ ...base, type: 'AGENCY_FACT', text: 'Our sellers achieve more on average.' }))
      .toBe('NEEDS_REPAIR');
    expect(adjudicate({ ...base, type: 'AGENCY_FACT', text: 'We are the leading agency on the coast.' }))
      .toBe('NEEDS_REPAIR');
    // But a deliverable offer stands.
    expect(adjudicate({ ...base, type: 'AGENCY_FACT',
      text: "Comment COAST and we'll send you the full breakdown." }))
      .toBe('SERVICE_PROMISE_ALLOWED');
  });

  it('a claim leaning on an unestablished requirement cannot be rescued by sounding reasonable', () => {
    expect(adjudicate({ ...base, type: 'LOCAL_FACT',
      uncovered: ['Year-round versus seasonal population for each'],
      text: 'Both towns are known to have a busier summer season and a quieter off-season population.' }))
      .toBe('USES_UNESTABLISHED_REQUIREMENT');
  });

  it('a deterministic contradiction outranks everything', () => {
    expect(adjudicate({ ...base, deterministic: true,
      text: 'Squatters are evicted in 15 days under the reform.' }))
      .toBe('DETERMINISTIC_CONTRADICTION');
  });

  it('leaves marketing and positioning alone', () => {
    expect(adjudicate({ ...base, type: 'MARKETING_PUFFERY',
      text: 'Buyers scroll fast and judge in seconds.' })).toBe('MARKETING_PUFFERY');
    expect(adjudicate({ ...base, type: 'OPINION_POSITIONING',
      text: 'We would rather have one accountable agent than five.' })).toBe('OPINION_POSITIONING');
  });

  it('still sends a genuinely unsupported factual claim for repair', () => {
    expect(adjudicate({ ...base,
      text: 'Exclusive mandates typically carry a commission two points lower than open ones.' }))
      .toBe('NEEDS_REPAIR');
  });

  it('classifies every hard fail and every pass into the right bucket', () => {
    expect(RESOLVED_HARD_FAIL.has('DETERMINISTIC_CONTRADICTION')).toBe(true);
    expect(RESOLVED_HARD_FAIL.has('USES_UNESTABLISHED_REQUIREMENT')).toBe(true);
    expect(RESOLVED_OK.has('SUPPORTED_BY_AGENCY_PROFILE')).toBe(true);
    expect(RESOLVED_OK.has('NEEDS_REPAIR' as never)).toBe(false);
  });
});
