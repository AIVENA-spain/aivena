import { describe, expect, it } from 'vitest';
import { SOURCE_POLICY_BRIEF, NEUTRAL_LEGAL_BRIEF, enforcesOfficialSources } from './studio-evidence';

/**
 * Legal/tax research RETIRED (Christian, 2026-09-19). Studio must not research or state specific
 * Spanish legal/tax rules on a public post — a regional rule stated wrong is real legal exposure.
 * These lock the retire: a legal_tax topic now gets the neutral "confirm with your gestor" brief
 * (never boe.es / agenciatributaria), and the official-primary-source enforcement that used to force
 * BOE fetches no longer applies to it. market_statistics / local_fact are unchanged.
 */
describe('legal/tax research retire', () => {
  it('legal_tax returns the neutral brief, not the boe.es research brief', () => {
    const brief = SOURCE_POLICY_BRIEF('legal_tax');
    expect(brief).toBe(NEUTRAL_LEGAL_BRIEF);
    expect(brief.toLowerCase()).not.toContain('boe.es');
    expect(brief.toLowerCase()).not.toContain('agenciatributaria');
    expect(brief.toLowerCase()).toContain('gestor');
    expect(brief.toLowerCase()).toContain('do not state any specific legal or tax');
  });

  it('the neutral brief forbids stating any specific legal/tax figure, rate or deadline', () => {
    expect(NEUTRAL_LEGAL_BRIEF.toLowerCase()).toContain('do not');
    expect(NEUTRAL_LEGAL_BRIEF.toLowerCase()).toMatch(/deadline|prescription|percentage|rate|amount/);
  });

  it('market_statistics and local_fact keep their official-source briefs; none is empty', () => {
    expect(SOURCE_POLICY_BRIEF('market_statistics').toLowerCase()).toContain('ine.es');
    expect(SOURCE_POLICY_BRIEF('local_fact').toLowerCase()).toContain('ayuntamiento');
    expect(SOURCE_POLICY_BRIEF('none')).toBe('');
  });

  it('official-source enforcement no longer applies to legal_tax (retired); still applies to stats/local', () => {
    expect(enforcesOfficialSources('legal_tax')).toBe(false);
    expect(enforcesOfficialSources('market_statistics')).toBe(true);
    expect(enforcesOfficialSources('local_fact')).toBe(true);
    expect(enforcesOfficialSources('none')).toBe(false);
  });
});
