import { describe, expect, it } from 'vitest';
import { materiallyUsedSources } from './studio-sources-used';

/**
 * The "what this post was built on" panel must show only the sources the PUBLISHED copy actually rests
 * on — a source cited by a surviving, supported material claim — never the raw research briefing. This
 * is the truth rule for every Studio post (Christian, 2026-09-19).
 */
describe('materiallyUsedSources', () => {
  const ledger = [
    { source_id: 'S1', url: 'https://ine.es/x', title: 'INE table', domain: 'ine.es' },
    { source_id: 'S2', url: 'https://boe.es/y', title: 'BOE decree', domain: 'boe.es' },
    { source_id: 'S3', url: 'https://ine.es/x', title: 'INE dup url', domain: 'ine.es' },
  ];

  it('returns [] when surviving claims cite no source (general_mechanism) — the 63917aad case', () => {
    const meta = {
      research_sources: [
        { source_id: 'S1', url: 'https://boe.es/epc', title: 'EPC', domain: 'boe.es' },
      ],
      claim_qa: {
        supports: [
          { field: 'tips[0].body', claim: 'Dark photos make buyers suspicious.', verdict: 'unsupported', sourceIds: [] },
          { field: 'slide2_body', claim: 'Price badly and a home sits.', verdict: 'supported', sourceIds: [] },
        ],
        blocked: [],
      },
    };
    expect(materiallyUsedSources(meta)).toEqual([]);
  });

  it('returns only the sources cited by a surviving SUPPORTED claim', () => {
    const meta = {
      research_sources: ledger,
      claim_qa: {
        supports: [
          { field: 'slide2_body', claim: 'X', verdict: 'supported', sourceIds: ['S1'] },
          { field: 'tips[1].body', claim: 'Y', verdict: 'unsupported', sourceIds: ['S2'] }, // dropped source
        ],
        blocked: [],
      },
    };
    expect(materiallyUsedSources(meta)).toEqual([
      { title: 'INE table', url: 'https://ine.es/x', domain: 'ine.es' },
    ]);
  });

  it('excludes a source whose supported claim was later blocked/dropped', () => {
    const meta = {
      research_sources: ledger,
      claim_qa: {
        supports: [
          { field: 'slide2_body', claim: 'X', verdict: 'supported', sourceIds: ['S1'] },
        ],
        blocked: [
          { field: 'slide2_body', text: 'X' },
        ],
      },
    };
    expect(materiallyUsedSources(meta)).toEqual([]);
  });

  it('dedups by url', () => {
    const meta = {
      research_sources: ledger,
      claim_qa: {
        supports: [
          { field: 'a', claim: 'X', verdict: 'supported', sourceIds: ['S1', 'S3'] },
        ],
        blocked: [],
      },
    };
    // S1 and S3 share the same url — only one entry.
    expect(materiallyUsedSources(meta)).toEqual([
      { title: 'INE table', url: 'https://ine.es/x', domain: 'ine.es' },
    ]);
  });

  it('is safe on missing / malformed meta', () => {
    expect(materiallyUsedSources(null)).toEqual([]);
    expect(materiallyUsedSources({})).toEqual([]);
    expect(materiallyUsedSources({ research_sources: [], claim_qa: {} })).toEqual([]);
    expect(materiallyUsedSources({ claim_qa: { supports: 'nope' } })).toEqual([]);
  });
});
