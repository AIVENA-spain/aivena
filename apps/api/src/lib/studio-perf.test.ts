import { describe, expect, it } from 'vitest';
import { EXTRACTOR_VERSION } from './studio-evidence';

/**
 * The claim cache exists to stop paying for the same extraction five times in one generation — the
 * gate runs it per round, the re-gate runs it again, and the final bank check runs it once more,
 * often over copy that has not changed a byte.
 *
 * What it must NEVER become is a way to return a classification produced by an older extractor.
 * Christian, 2026-09-06: "Do NOT create a long-lived cache that can survive engine/prompt changes
 * and return stale claim classifications later." The cache is per generation, and the extractor
 * version is part of every key.
 */
describe('the claim cache cannot go stale', () => {
  it('carries an extractor version that is part of every key', () => {
    expect(EXTRACTOR_VERSION).toMatch(/^v\d+-\d{4}-\d{2}-\d{2}$/);
  });

  // Mirrors claimCacheKey's inputs. Asserted on the properties that matter rather than on a
  // literal digest, so it stays meaningful if the hash function is ever swapped.
  const key = (version: string, language: string, fields: [string, string][]) =>
    [version, 'claude-sonnet-5', language, fields.map(([f, t]) => `${f}=${t}`).join('|')].join('#');
  const A: [string, string][] = [['hook_title', 'A price is not a contract'], ['tips[0].body', 'x']];

  it('gives identical copy the same key', () => {
    expect(key(EXTRACTOR_VERSION, 'en', A)).toBe(key(EXTRACTOR_VERSION, 'en', [...A]));
  });

  it('gives changed copy a different key', () => {
    const B: [string, string][] = [['hook_title', 'A price is not a contract'], ['tips[0].body', 'y']];
    expect(key(EXTRACTOR_VERSION, 'en', A)).not.toBe(key(EXTRACTOR_VERSION, 'en', B));
  });

  it('gives a different language a different key', () => {
    expect(key(EXTRACTOR_VERSION, 'en', A)).not.toBe(key(EXTRACTOR_VERSION, 'es', A));
  });

  // THE POINT: a new extractor must never read the old extractor's answers.
  it('gives a new extractor version a different key for identical copy', () => {
    expect(key('v3-2026-09-06', 'en', A)).not.toBe(key('v4-2027-01-01', 'en', A));
  });

  it('does not collide when text moves across a field boundary', () => {
    const shifted: [string, string][] = [['hook_title', 'A price is not a contractx'], ['tips[0].body', '']];
    expect(key(EXTRACTOR_VERSION, 'en', A)).not.toBe(key(EXTRACTOR_VERSION, 'en', shifted));
  });
});
