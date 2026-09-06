import { describe, expect, it } from 'vitest';

/**
 * A model returning `tips` as a string has now killed three posts in twenty generations — A in the
 * calibration run, H1 in one smoke run, H4 in the next. The schema error it produced,
 * "tips: Too big: expected string to have <=7 characters", is zod checking the ARRAY's .max(7)
 * against a STRING's length, and it told the model nothing it could act on.
 *
 * This is the recovery, lifted out of the retry loop so it can be tested without the network.
 */
function stripParameterTags(v: string): string {
  return v
    .replace(/<\/?parameter(?:\s+name="[^"]*")?\s*>/g, '')
    .replace(/<\/?(?:antml:)?(?:invoke|function_calls|parameter)[^>]*>/g, '')
    .trim();
}

function recoverTips(value: unknown): { tips: unknown; recovered: boolean; stillAString: boolean } {
  if (typeof value !== 'string') return { tips: value, recovered: false, stillAString: false };
  const raw = stripParameterTags(value).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
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

  // THE ACTUAL CAUSE, caught in a latency profile after four dead posts: the model emitted the
  // textual tool-call syntax INSIDE the tool input, so a good array arrived with a tag glued to the
  // front. It was never truncation.
  it('recovers an array the model wrapped in its own parameter tags', () => {
    const r = recoverTips('<parameter name="items">' + JSON.stringify([TIP]));
    expect(r.recovered).toBe(true);
    expect((r.tips as { title: string }[])[0].title).toBe(TIP.title);
  });
  it('recovers one wrapped and fenced at the same time', () => {
    const r = recoverTips('<parameter name="items">```json\n' + JSON.stringify([TIP, TIP]) + '\n```</parameter>');
    expect(r.recovered).toBe(true);
    expect(r.tips).toHaveLength(2);
  });

  it('refuses an array of strings, which is not a slide list', () => {
    const r = recoverTips(JSON.stringify(['tip one', 'tip two']));
    expect(r.stillAString).toBe(true);
  });
});
