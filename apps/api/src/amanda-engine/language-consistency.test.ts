import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LANGUAGES, isCanonicalLanguage, normalizeLeadLanguage } from './validators';
import { GATE_FALLBACK } from './turn';

/**
 * ONE language vocabulary for the whole product.
 *
 * Christian 2026-08-31: "we need to make sure that the language codes stay the
 * same through the whole aivena system and doesnt get names wrong ever."
 *
 * These are structural: they compare the actual sets shipped in different parts
 * of the codebase, so adding a language in one place and forgetting the others
 * fails HERE instead of silently in a buyer's chat — which is exactly how the
 * 'no' vs 'nb' split reached production twice.
 */
describe('language codes are one vocabulary across the system', () => {
  it('the dead-air line exists in EVERY supported language', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(GATE_FALLBACK[lang], `missing dead-air line for ${lang}`).toBeTruthy();
    }
  });

  it('the dead-air table contains NO language outside the canonical set', () => {
    for (const key of Object.keys(GATE_FALLBACK)) {
      expect(isCanonicalLanguage(key), `${key} is not a canonical code`).toBe(true);
    }
  });

  it('the agent roster picker offers exactly the canonical set', () => {
    // Read the dashboard source rather than importing it — this is the point of
    // the test: the two lists live in different apps and must not drift.
    const src = readFileSync(
      join(__dirname, '../../../dashboard/app/(app)/settings/sections/agents-section.tsx'),
      'utf8',
    );
    const line = src.split('\n').find((l) => l.includes('const LANGS ='));
    expect(line, 'LANGS not found in agents-section').toBeTruthy();
    const codes = [...(line ?? '').matchAll(/"([a-z]{2})"/g)].map((m) => m[1]);
    expect([...codes].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('no ALIAS is ever a canonical code — that is the whole bug', () => {
    for (const alias of ['no', 'nn', 'se', 'dk']) {
      expect(isCanonicalLanguage(alias), `${alias} must normalise, not be stored`).toBe(false);
      expect(isCanonicalLanguage(normalizeLeadLanguage(alias)!)).toBe(true);
    }
  });

  it("normalising is idempotent — a canonical code survives the round trip", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(normalizeLeadLanguage(lang)).toBe(lang);
    }
  });

  it('every dashboard locale file normalises INTO the canonical set', () => {
    // The dashboard ships Norwegian as no.json while the engine keys 'nb'.
    // That is tolerable — a filename is a UI detail — but ONLY because
    // normalisation makes them the same language. This asserts the two sets
    // agree once normalised, so a new locale file that maps to nothing (or to
    // an unsupported code) fails here.
    const dir = join(__dirname, '../../../dashboard/messages');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const normalised = files.map((f) => normalizeLeadLanguage(f.replace('.json', ''))!);
    for (const code of normalised) {
      expect(isCanonicalLanguage(code), `locale file maps to unsupported ${code}`).toBe(true);
    }
    expect([...new Set(normalised)].sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });
});
