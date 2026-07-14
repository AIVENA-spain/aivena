import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeKyero, normalizeFeed, langMap, area, txt, deriveTitle, MAX_IMAGES,
  type KyeroProperty,
} from './kyero';

// Fixtures are REAL Kyero v3 feeds from OpenEstate-IO (Apache-2.0), pre-parsed with the exact
// XMLParser options index.ts uses ({ignoreAttributes:false, attributeNamePrefix:"@_",
// trimValues:true, parseTagValue:false}) so the shapes here are byte-for-byte what production sees.
// See __fixtures__/README.md for provenance + how to regenerate.
// NOTE parseTagValue:false ⇒ every scalar arrives as a STRING ("150", not 150). That is load-bearing.
const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
const CLEAN = fx('openestate-kyero-v3.parsed.json');
const MESSY = fx('openestate-kyero-v3-messy.parsed.json');

const firstProp = (doc: any): KyeroProperty => [].concat(doc.root.property)[0];

describe('the feed really does keep built and plot apart', () => {
  it('proves the format separates them — so our collapsing them was our own bug', () => {
    expect(firstProp(CLEAN).surface_area).toEqual({ built: '150', plot: '500' });
  });
});

describe('FIX 1 — built vs plot must never be conflated', () => {
  it('lands built and plot in their own fields', () => {
    const n = normalizeKyero(firstProp(CLEAN))!;
    expect(n.area_built_sqm).toBe(150);
    expect(n.area_plot_sqm).toBe(500);
  });

  it('sets the generic area from BUILT, not plot', () => {
    const n = normalizeKyero(firstProp(CLEAN))!;
    expect(n.area_sqm).toBe(150);
  });

  it('THE BUG: a plot size must never become the headline area', () => {
    // Old behaviour: `area_sqm: num(built) ?? num(plot)` → 3000 here, which the Studio renders as
    // "3000 m² built". A 3000 m² plot sold as a 3000 m² house is a misrepresentation.
    const plotOnly: KyeroProperty = { id: '9', type: 'villa', town: 'Javea', surface_area: { plot: '3000' } };
    const n = normalizeKyero(plotOnly)!;
    expect(n.area_plot_sqm).toBe(3000);
    expect(n.area_sqm).toBeNull();      // honest gap, not a wrong number
    expect(n.area_built_sqm).toBeNull();
  });

  it('keeps built when only built is given', () => {
    const n = normalizeKyero({ id: '9', surface_area: { built: '120' } })!;
    expect(n.area_sqm).toBe(120);
    expect(n.area_built_sqm).toBe(120);
    expect(n.area_plot_sqm).toBeNull();
  });
});

describe('FIX 2 — every language is kept', () => {
  it('keeps ALL languages the feed supplied, not just one', () => {
    const n = normalizeKyero(firstProp(CLEAN))!;
    const langs = Object.keys(n.descriptions);
    // This fixture carries 33 locales; the old code kept exactly one of them.
    expect(langs.length).toBeGreaterThan(12);
    expect(langs).toEqual(expect.arrayContaining(['en', 'es', 'de', 'fr', 'nl', 'sv', 'no']));
  });

  it('still exposes a preferred single description for the existing column', () => {
    const n = normalizeKyero(firstProp(CLEAN))!;
    expect(n.description).toBeTruthy();
    expect(n.description).toBe(n.descriptions.en);
  });

  it('langMap skips xml attributes, #text and empty values', () => {
    expect(langMap({ en: 'hello', es: '  ', de: 'hallo', '@_id': '3', '#text': 'x' }))
      .toEqual({ en: 'hello', de: 'hallo' });
  });

  it('langMap is safe on a missing or scalar node', () => {
    expect(langMap(undefined)).toEqual({});
    expect(langMap(null)).toEqual({});
    expect(langMap('just a string')).toEqual({});
    expect(langMap(['a'])).toEqual({});
  });
});

describe('FIX 3 — "0" and empty mean unknown, per the V3.8 spec', () => {
  it('treats 0 as unknown rather than a real measurement', () => {
    expect(area('0')).toBeNull();
    expect(area(0)).toBeNull();
    expect(area('')).toBeNull();
    expect(area(undefined)).toBeNull();
    expect(area('-5')).toBeNull();
  });

  it('accepts a genuine measurement', () => {
    expect(area('150')).toBe(150);
    expect(area('99.5')).toBe(99.5);
  });

  it('a property whose sizes are all 0 reports no area at all', () => {
    const n = normalizeKyero({ id: '9', surface_area: { built: '0', plot: '0' } })!;
    expect(n.area_sqm).toBeNull();
    expect(n.area_built_sqm).toBeNull();
    expect(n.area_plot_sqm).toBeNull();
  });
});

describe('real-world mess (the messy fixture) must not crash the run', () => {
  it('normalises every property in a multi-property feed', () => {
    const out = normalizeFeed(MESSY);
    expect(out.length).toBeGreaterThan(1);
  });

  it('survives a property with NO surface_area, desc, images or features', () => {
    // The first property of this real fixture genuinely has none of these — a throwaway script
    // written against the happy path crashed on exactly this.
    const bare = normalizeKyero({ id: '404', type: 'house', town: 'Denia' })!;
    expect(bare.area_sqm).toBeNull();
    expect(bare.area_built_sqm).toBeNull();
    expect(bare.area_plot_sqm).toBeNull();
    expect(bare.descriptions).toEqual({});
    expect(bare.description).toBeNull();
    expect(bare.images).toEqual([]);
    expect(bare.features).toEqual([]);
  });

  it('skips a property with no id rather than failing the whole sync', () => {
    const out = normalizeFeed({ root: { property: [{ type: 'villa' }, { id: '7', type: 'villa' }] } });
    expect(out.map((p) => p.external_id)).toEqual(['7']);
  });

  it('falls back to ref when id is absent', () => {
    expect(normalizeKyero({ ref: 'ABC-1' })!.external_id).toBe('ABC-1');
  });

  it('handles a single property not wrapped in an array', () => {
    expect(normalizeFeed({ root: { property: { id: '1' } } })).toHaveLength(1);
  });

  it('returns [] for an empty or shapeless document instead of throwing', () => {
    expect(normalizeFeed({})).toEqual([]);
    expect(normalizeFeed(null)).toEqual([]);
    expect(normalizeFeed({ root: {} })).toEqual([]);
  });
});

describe('format rules from the spec', () => {
  it('reads by NAME, so xs:all element order is irrelevant', () => {
    const a = normalizeKyero({ id: '1', type: 'villa', town: 'Nerja', beds: '3' })!;
    const b = normalizeKyero({ beds: '3', town: 'Nerja', type: 'villa', id: '1' })!;
    expect(b).toEqual(a);
  });

  it('derives a title, because Kyero v3 has no title element', () => {
    expect(deriveTitle('villa', 'Almunecar', 'V3TEST', '12367')).toBe('Villa in Almunecar');
    // Real feeds send lowercase towns; this string is the headline buyers see, so it must not
    // ship as "Villa in almunecar".
    expect(deriveTitle('villa', 'almunecar', 'V3TEST', '12367')).toBe('Villa in Almunecar');
    expect(deriveTitle('finca', 'san javier', null, '1')).toBe('Finca in San Javier');
    expect(deriveTitle(null, null, 'V3TEST', '12367')).toBe('V3TEST');
    expect(deriveTitle(null, null, null, '12367')).toBe('Property 12367');
  });

  it('derives the same title from the real fixture', () => {
    expect(normalizeKyero(firstProp(CLEAN))!.title).toBe('Villa in Almunecar');
  });

  it('caps images at the 50 the schema allows', () => {
    const many = { id: '1', images: { image: Array.from({ length: 80 }, (_, i) => ({ url: `https://x/${i}.jpg` })) } };
    expect(normalizeKyero(many)!.images).toHaveLength(MAX_IMAGES);
  });

  it('reads image urls out of the real fixture, ignoring the id attribute', () => {
    const n = normalizeKyero(firstProp(CLEAN))!;
    expect(n.images.length).toBeGreaterThan(0);
    expect(n.images.every((u) => typeof u === 'string' && u.startsWith('http'))).toBe(true);
  });

  it('defaults currency to EUR and country to Spain when absent', () => {
    const n = normalizeKyero({ id: '1' })!;
    expect(n.price_currency).toBe('EUR');
    expect(n.location_country).toBe('Spain');
  });

  it('does not require an <agent> block (absent from Kyero\'s own sample)', () => {
    expect(() => normalizeFeed({ root: { property: { id: '1' } } })).not.toThrow();
  });
});

describe('numbers arrive as strings (parseTagValue:false) — do not regress this', () => {
  it('parses string scalars from the real fixture', () => {
    const p = firstProp(CLEAN) as any;
    expect(typeof p.beds).toBe('string');
    const n = normalizeKyero(p)!;
    expect(n.bedrooms).toBe(Number(p.beds));
    expect(typeof n.bedrooms).toBe('number');
  });

  it('strips currency noise out of a price', () => {
    expect(normalizeKyero({ id: '1', price: '250000' })!.price).toBe(250000);
  });

  it('txt trims and nulls empty', () => {
    expect(txt('  x  ')).toBe('x');
    expect(txt('   ')).toBeNull();
    expect(txt(undefined)).toBeNull();
  });
});
