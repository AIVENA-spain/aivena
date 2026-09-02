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

/**
 * The Edge Functions are the OTHER half of the vocabulary, and until 2026-09-01
 * their source lived only in production so nothing could check them. Now that
 * they are captured in the repo, these read the captured source the same way the
 * test above reads the dashboard's picker.
 */
describe('edge functions speak the same language vocabulary', () => {
  const efPath = join(__dirname, '../../../../supabase/functions/translate-text/index.ts');

  /** Legacy codes the DB trigger (migration leads_language_canonical_nb)
   *  rewrites on write. A writer may emit these; storage still ends canonical. */
  const NORMALISED_BY_DB: Record<string, string> = {
    no: 'nb', nn: 'nb', nob: 'nb', dk: 'da', se: 'sv',
  };

  it('every code translate-text can WRITE to leads.language ends up canonical', () => {
    const src = readFileSync(efPath, 'utf8');
    // Anchor on the declaration: the file's header comment also names the map.
    const block = src.slice(src.indexOf('const DETECTED_TO_AIVENA'));
    const body = block.slice(block.indexOf('{'), block.indexOf('}') + 1);
    const written = [...body.matchAll(/:\s*"([a-z]{2,3})"/g)].map((m) => m[1]);
    expect(written.length, 'no codes parsed — did the map shape change?').toBeGreaterThan(10);

    for (const code of written) {
      const settled = NORMALISED_BY_DB[code] ?? code;
      expect(
        isCanonicalLanguage(settled),
        `translate-text writes "${code}" which settles as "${settled}" — not canonical`,
      ).toBe(true);
    }
  });

  it('the DB normaliser and LANG_ALIASES agree, so storage and code cannot drift', () => {
    for (const [legacy, canonical] of Object.entries(NORMALISED_BY_DB)) {
      expect(normalizeLeadLanguage(legacy), `LANG_ALIASES disagrees on ${legacy}`).toBe(canonical);
    }
  });
});

