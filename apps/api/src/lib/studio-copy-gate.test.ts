import { describe, expect, it } from 'vitest';

import { adjudicate, capFor, classifyAssertion, coverageGaps, gateField, requirementsFor, type RequirementCoverage, incompleteBody, trimWords, endsMidThought, RESOLVED_HARD_FAIL, RESOLVED_OK } from './studio-copy-gate';

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

  // SUPPORTED_BY_RESEARCH now means one thing: a support record survived verification against a
  // page that was actually opened. Resembling the briefing is not evidence and no longer resolves.
  it('keeps a claim a verified support record stands behind', () => {
    expect(adjudicate({ ...base, supported: true,
      text: 'The buyer withholds 3% of the price and pays it to the Treasury.' }))
      .toBe('SUPPORTED_BY_RESEARCH');
  });
  it('refuses to call a claim research-supported on word overlap alone', () => {
    expect(adjudicate({ ...base,
      text: 'The buyer withholds 3% of the price and pays it to the Treasury.' }))
      .not.toBe('SUPPORTED_BY_RESEARCH');
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
    // POLICY TIGHTENED 2026-09-04: a specific promised deliverable needs a capability source. The
    // carousel does not produce a "full breakdown", so this is a service Aivena would be inventing.
    expect(adjudicate({ ...base, type: 'AGENCY_FACT',
      text: "Comment COAST and we'll send you the full breakdown." }))
      .toBe('NEEDS_REPAIR');
    // A generic invitation to talk still stands on its own.
    expect(adjudicate({ ...base, type: 'AGENCY_FACT',
      text: 'Message us if you want to talk it through.' }))
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

describe('three defects the c631b64 run shipped', () => {
  it('1. a cap holds after a rewrite, not just at first parse', () => {
    // Real generated title: 161 chars against a 62-char cap, because the repair pass wrote whatever
    // the model returned and the caps had been applied once, back when the plan was first parsed.
    const title = "Xàbia's seasonal population grew 331% and Dénia's grew 431% over registered residents, "
      + 'per a 2019 Observatori Marina Alta study — not a simple tripling for both.';
    expect(title.length).toBeGreaterThan(62);
    expect(capFor('tips[1].title')).toBe(62);
    expect((trimWords(title, capFor('tips[1].title')!) as string).length).toBeLessThanOrEqual(62);
    expect(capFor('caption')).toBe(320);
    expect(capFor('tips[0].body')).toBe(250);
    expect(capFor('not_a_field')).toBeNull();
  });

  it('2. a citation is a shape, not a list of company names', () => {
    // "Observatori Marina Alta" was never going to be on a hand-written list of data providers.
    const fired = (t: string) => gateField('tips[1].body', t, '').map(h => h.rule.id);
    expect(fired("Xàbia's population grew 331% in the 2019 Observatori Marina Alta study."))
      .toContain('source-attributed');
    // Christian 2026-09-05: naming an OFFICIAL producer is a deliberate strengthening, not a leak.
    expect(fired('According to a Banco de España report, rates rose.')).toHaveLength(0);
    expect(fired('According to a Costa Blanca Property Guide report, rates rose.')).toContain('source-attributed');
    // Ordinary copy that merely mentions a portal for what it is stays untouched.
    expect(fired('The same home turns up on Idealista under three agencies.')).toHaveLength(0);
    expect(fired('Buyers scroll fast and judge in seconds.')).toHaveLength(0);
  });

  it('3. the mid-thought check has to be the last thing that runs', () => {
    // Real generated title. The check that catches it had already run before the editor rewrote it.
    expect(endsMidThought('Borrowing is getting more expensive, not')).toBe(true);
    expect(endsMidThought('Borrowing is getting more expensive, not cheaper')).toBe(false);
  });
});

describe('the writer never narrates its own checking', () => {
  const fired = (t: string) => gateField('tips[0].body', t, '').map(h => h.rule.id);

  it('blocks first-person verification talk', () => {
    // Real generated copy. The reader must never see the machinery, and this IS the machinery.
    expect(fired('Every current series I could verify on Alicante property points the same '
      + 'direction: up.')).toContain('research-narrated');
    expect(fired('I could not find a published figure for that.')).toContain('research-narrated');
    expect(fired('As far as I can tell, the rate has not changed.')).toContain('research-narrated');
  });

  it('leaves the same point alone when stated plainly', () => {
    expect(fired('Alicante prices rose again this quarter, on every measure that tracks them.'))
      .toHaveLength(0);
    expect(fired('No institution tracking the market is forecasting a fall.')).toHaveLength(0);
  });
});

describe('a chopped headline is the wrong headline', () => {
  it('a word-cut title ends on a content word the dangling list cannot see', () => {
    // Real generated title, cut at the 62-char cap. "reach" is a verb, not a function word, so no
    // dangling-word list will ever catch it — which is why the writer is asked to rewrite instead.
    const cut = 'Through a collaboration network, one mandate can still reach';
    expect(cut.length).toBeLessThanOrEqual(62);
    expect(endsMidThought(cut)).toBe(false);
    // The full version exceeds the cap, which is the signal to ask for a shorter one.
    expect('Through a collaboration network, one mandate can still reach more buyers'.length)
      .toBeGreaterThan(62);
  });
});

/**
 * Christian, 2026-09-04: "Do not identify factuality from how a sentence looks. Identify it from
 * what the sentence claims."
 *
 * Every FACTUAL case below contains zero figures and zero proper nouns, and every one of them is a
 * proposition an agency could be wrong about in public. The previous surface-feature test called
 * all of them positioning.
 */
describe('factual or positioning — decided by the claim, not the surface', () => {
  it('calls a market or behaviour generalisation factual, with no numbers and no names', () => {
    for (const t of [
      'Exclusive listings sell faster.',
      'Sea-view homes hold their value better.',
      'Buyers prefer south-facing terraces.',
      'Open mandates attract less serious buyers.',
      'Renovated homes sell quicker.',
      'Foreign buyers usually pay more.',
      'Buyers respond better to exclusive listings.',
      'Five agents produce conflicting prices.',
      'Properties launch strongest in their first weeks.',
    ]) expect(classifyAssertion(t), t).toBe('FACTUAL');
  });

  it('calls a stance, an exhortation or a reframing positioning', () => {
    for (const t of [
      'We think one accountable strategy beats five conflicting ones.',
      'Your home deserves better marketing.',
      'Stop selling square metres. Sell the life.',
      'Buying now means choosing certainty over trying to time the market.',
      "We'd rather be the one team you can hold to a result.",
      'Save this before you sign with a second agency.',
    ]) expect(classifyAssertion(t), t).toBe('POSITIONING');
  });

  it('does not let first-person framing launder an empirical claim', () => {
    // "we think X sells faster" still asserts that X sells faster.
    expect(classifyAssertion('We think exclusive listings sell faster.')).toBe('FACTUAL');
    expect(classifyAssertion('In our view, renovated homes attract more buyers.')).toBe('FACTUAL');
  });

  it('treats the genuinely ambiguous as factual', () => {
    // Cheaper to rewrite an opinion than to publish an unevidenced claim.
    expect(classifyAssertion('The paperwork starts the day you sign.')).toBe('FACTUAL');
  });

  it('feeds through adjudication the same way', () => {
    const base = { research: '', agencyEvidence: '', uncovered: [] as string[] };
    expect(adjudicate({ ...base, type: 'FACTUAL_MATERIAL', text: 'Exclusive listings sell faster.' }))
      .toBe('NEEDS_REPAIR');
    expect(adjudicate({ ...base, type: 'OPINION_POSITIONING', text: 'Your home deserves better marketing.' }))
      .toBe('OPINION_POSITIONING');
  });

  // A sentence the extractor typed as material has already been judged an assertion about the
  // world. Nothing about its WORDING may hand it back as a position — that door is how
  // "practitioner consensus holds that a stale listing makes buyers suspicious" published.
  it('will not let a material claim leave as an opinion because it reads like one', () => {
    for (const type of ['FACTUAL_MATERIAL', 'CAUSAL_INFERENCE', 'LOCAL_FACT', 'QUANTIFIED_CLAIM',
      'TIME_SENSITIVE_FACT', 'LEGAL_CONSEQUENCE', 'AGENCY_FACT']) {
      expect(adjudicate({ type, research: '', agencyEvidence: '', uncovered: [],
        text: 'We believe a stale listing makes buyers wonder what is wrong with it.' }))
        .toBe('NEEDS_REPAIR');
    }
  });
});

describe('a promised service needs a capability source', () => {
  const base = { type: 'AGENCY_FACT', research: '',
    agencyEvidence: 'Works in: Jávea, Moraira, Dénia, Teulada. Sales and listings. '
      + 'Staff speak es, en, nl, de. Mandate types: both.', uncovered: [] as string[] };

  it('lets a generic invitation to talk through', () => {
    for (const t of ['Message us and let\'s talk about your property.',
                     'Get in touch if you want to go through it.',
                     'Ask us about your street.'])
      expect(adjudicate({ ...base, text: t }), t).toBe('SERVICE_PROMISE_ALLOWED');
  });

  it('will not invent a capability the agency never claimed', () => {
    // Christian's list. Aivena does not get to offer these on an agency's behalf.
    for (const t of ["We'll send you our 20-page seller guide.",
                     'We provide professional drone photography.',
                     "We'll arrange your mortgage.",
                     "We'll manage your renovation.",
                     "We'll send you a valuation within 30 minutes."])
      expect(adjudicate({ ...base, text: t }), t).toBe('NEEDS_REPAIR');
  });

  it('allows a promise the profile actually supports', () => {
    expect(adjudicate({ ...base,
      text: 'We handle sales and listings in Jávea, Moraira, Dénia and Teulada.' }))
      .toBe('SUPPORTED_BY_AGENCY_PROFILE');
  });
});

describe('requirement identity replaces lexical overlap', () => {
  it('gives every requirement a stable id', () => {
    const reqs = requirementsFor('B12', ['Year-round versus seasonal population', 'Distance between centres']);
    expect(reqs).toEqual([
      { id: 'B12#1', text: 'Year-round versus seasonal population' },
      { id: 'B12#2', text: 'Distance between centres' },
    ]);
  });

  it('counts anything not explicitly established as a gap', () => {
    const reqs = requirementsFor('B12', ['A', 'B', 'C']);
    const gaps = coverageGaps(reqs, [
      { id: 'B12#1', status: 'established', evidence: 'x', sourceIds: ['S1'] },
      { id: 'B12#2', status: 'partial', evidence: '', sourceIds: [] },
      // B12#3 unassessed entirely
    ]);
    expect(gaps.map(g => g.id)).toEqual(['B12#2', 'B12#3']);
  });
});

describe('a requirement is established by evidence, not by similar wording', () => {
  it('carries the evidence and the sources that back it', () => {
    const cov: RequirementCoverage[] = [
      { id: 'S17#1', status: 'established', evidence: 'The buyer withholds 3%.', sourceIds: ['S2'] },
      { id: 'S17#2', status: 'partial', evidence: 'Rates vary.', sourceIds: ['S1', 'S3'] },
      { id: 'S17#3', status: 'not_established', evidence: '', sourceIds: [] },
    ];
    for (const c of cov.filter(x => x.status !== 'not_established')) {
      expect(c.evidence.length, c.id).toBeGreaterThan(0);
      expect(c.sourceIds.length, c.id).toBeGreaterThan(0);
    }
    expect(coverageGaps(requirementsFor('S17', ['a', 'b', 'c']), cov).map(g => g.id))
      .toEqual(['S17#2', 'S17#3']);
  });
});
