import { describe, expect, it } from 'vitest';

/**
 * A model returning `tips` as a string has now killed three posts in twenty generations — A in the
 * calibration run, H1 in one smoke run, H4 in the next. The schema error it produced,
 * "tips: Too big: expected string to have <=7 characters", is zod checking the ARRAY's .max(7)
 * against a STRING's length, and it told the model nothing it could act on.
 *
 * This is the recovery, lifted out of the retry loop so it can be tested without the network.
 */
function recoverTips(value: unknown): { tips: unknown; recovered: boolean; stillAString: boolean } {
  if (typeof value !== 'string') return { tips: value, recovered: false, stillAString: false };
  const raw = value.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  for (const candidate of [raw, raw.replace(/'/g, '"'), `[${raw}]`]) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed) && parsed.length
          && parsed.every((x) => !!x && typeof x === 'object' && !Array.isArray(x))) {
        return { tips: parsed, recovered: true, stillAString: false };
      }
    } catch { /* next shape */ }
  }
  return { tips: value, recovered: false, stillAString: true };
}

const TIP = { title: 'A price is not a contract', body: 'Agreeing a figure changes nothing by itself.', teaser: '' };

describe('a string-shaped tips array is recovered, not lost', () => {
  it('leaves a real array exactly as it is', () => {
    const r = recoverTips([TIP]);
    expect(r.recovered).toBe(false);
    expect(r.stillAString).toBe(false);
    expect(r.tips).toEqual([TIP]);
  });

  it('parses a JSON array that arrived as a string', () => {
    const r = recoverTips(JSON.stringify([TIP, TIP]));
    expect(r.recovered).toBe(true);
    expect(r.tips).toHaveLength(2);
  });

  it('parses one inside a markdown fence', () => {
    const r = recoverTips('```json\n' + JSON.stringify([TIP]) + '\n```');
    expect(r.recovered).toBe(true);
    expect((r.tips as unknown[])[0]).toEqual(TIP);
  });

  it('parses single-quoted JSON', () => {
    const r = recoverTips("[{'title': 'A price is not a contract', 'body': 'x', 'teaser': ''}]");
    expect(r.recovered).toBe(true);
  });

  it('wraps a single bare object', () => {
    const r = recoverTips(JSON.stringify(TIP));
    expect(r.recovered).toBe(true);
    expect(r.tips).toHaveLength(1);
  });

  // MUST NOT silently accept nonsense — a string of prose has to be reported, not coerced
  it('refuses prose and says the string could not be parsed', () => {
    const r = recoverTips('Five tips about buying on the Costa Blanca');
    expect(r.recovered).toBe(false);
    expect(r.stillAString).toBe(true);
  });

  it('refuses an array of strings, which is not a slide list', () => {
    const r = recoverTips(JSON.stringify(['tip one', 'tip two']));
    expect(r.stillAString).toBe(true);
  });
});
