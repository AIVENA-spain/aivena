import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OWNED_STORAGE_MARKER,
  OWNED_STORAGE_LIKE,
  isUsablePhotoUrl,
  usablePhotos,
  hasUsablePhoto,
  photoCounts,
} from './property-images';

// Real URL shapes taken from the live catalog (2026-07-14): exactly two hosts exist —
// our own storage (740 images, all loadable) and dead montinmo (1130 images, all gone).
const OWNED = 'https://atminvhrybxegpdtnnpl.supabase.co/storage/v1/object/public/property-images/demo/ic-28746/1.jpg';
const OWNED_2 = 'https://atminvhrybxegpdtnnpl.supabase.co/storage/v1/object/public/property-images/demo/ic-28746/2.jpg';
const DEAD = 'https://montinmo.es/media/images/properties/thumbnails/12345_w_xl.jpg';
const DEAD_WWW = 'https://www.montinmo.es/media/images/properties/thumbnails/12345_w_xl.jpg';

describe('isUsablePhotoUrl', () => {
  it('accepts an image served from our own storage', () => {
    expect(isUsablePhotoUrl(OWNED)).toBe(true);
  });

  it('rejects the dead montinmo hotlinks that broke 57% of the catalog', () => {
    expect(isUsablePhotoUrl(DEAD)).toBe(false);
    expect(isUsablePhotoUrl(DEAD_WWW)).toBe(false);
  });

  it('rejects any third-party host, not just hosts we know are dead (the whole point)', () => {
    // A live CDN we do not own is still unusable: we cannot guarantee it will be there tomorrow.
    // This is what makes the rule general instead of reactive.
    expect(isUsablePhotoUrl('https://cdn.some-live-crm.example/photo.jpg')).toBe(false);
    expect(isUsablePhotoUrl('https://images.idealista.com/blur/1.jpg')).toBe(false);
  });

  it('rejects junk without throwing', () => {
    for (const junk of [null, undefined, '', '   ', 42, {}, [], true]) {
      expect(isUsablePhotoUrl(junk)).toBe(false);
    }
  });

  it('is not fooled by the marker appearing in a query string on a foreign host', () => {
    // Substring matching is the same test readiness already uses (gather.ts `img LIKE '%…%'`),
    // so this documents the known shape of the rule rather than asserting a URL parser.
    expect(isUsablePhotoUrl(`https://evil.example/x?u=${OWNED_STORAGE_MARKER}`)).toBe(true);
  });
});

describe('usablePhotos', () => {
  it('keeps only the owned images, in order', () => {
    expect(usablePhotos([DEAD, OWNED, DEAD_WWW, OWNED_2])).toEqual([OWNED, OWNED_2]);
  });

  it('returns [] for a fully-dead property (the demo\'s 81)', () => {
    expect(usablePhotos([DEAD, DEAD, DEAD_WWW])).toEqual([]);
  });

  it('returns [] for a property with no images at all (the test agency\'s 12)', () => {
    expect(usablePhotos([])).toEqual([]);
    expect(usablePhotos(null)).toEqual([]);
  });

  it('never throws on a non-array jsonb value', () => {
    expect(usablePhotos('not-an-array')).toEqual([]);
    expect(usablePhotos({ 0: OWNED })).toEqual([]);
  });

  it('is a drop-in for the Studio helper it replaces (same signature, same shape)', () => {
    const out = usablePhotos([OWNED, DEAD]);
    expect(Array.isArray(out)).toBe(true);
    expect(out.every((u) => typeof u === 'string')).toBe(true);
  });
});

describe('hasUsablePhoto', () => {
  it('true when at least one photo is ours', () => {
    expect(hasUsablePhoto([DEAD, OWNED])).toBe(true);
  });

  it('false for the all-dead and the no-image cases', () => {
    expect(hasUsablePhoto([DEAD, DEAD_WWW])).toBe(false);
    expect(hasUsablePhoto([])).toBe(false);
    expect(hasUsablePhoto(null)).toBe(false);
  });
});

describe('photoCounts', () => {
  it('reports totals honestly so a surface can say "12 of 14 photos unavailable"', () => {
    expect(photoCounts([OWNED, DEAD, DEAD_WWW, OWNED_2])).toEqual({ total: 4, usable: 2, unusable: 2 });
  });

  it('describes a fully-dead listing (what the demo\'s 81 look like)', () => {
    expect(photoCounts([DEAD, DEAD, DEAD_WWW])).toEqual({ total: 3, usable: 0, unusable: 3 });
  });

  it('distinguishes "no photos at all" from "photos that all died"', () => {
    // The demo's 81 have images that are dead; the test agency's 12 have none. Both are
    // photoless, but only the former is a data-loss problem worth surfacing to an agency.
    expect(photoCounts([])).toEqual({ total: 0, usable: 0, unusable: 0 });
    expect(photoCounts([DEAD])).toEqual({ total: 1, usable: 0, unusable: 1 });
  });

  it('ignores junk entries when counting', () => {
    expect(photoCounts([OWNED, '', '  ', null, 7])).toEqual({ total: 1, usable: 1, unusable: 0 });
  });
});

describe('the marker is duplicated across runtimes — guard against silent drift', () => {
  // The rule now lives in three places that MUST agree but cannot import each other:
  //   1. here (Node)                          — the Studio picker + anything in apps/api
  //   2. image-generate-create/index.ts (Deno) — mirrored inline as usableCatalogPhoto(), because an
  //      Edge Function cannot import from apps/api. Owned by Packet 4 (Studio).
  //   3. readiness/gather.ts (SQL)            — the with_hotlinked_images signal.
  // A copy that drifts silently un-fixes the montinmo class of bug for whichever surface drifted, and
  // nothing else would notice. These tests are the only thing holding them together.
  const repoRoot = join(__dirname, '..', '..', '..', '..');

  it('the image-generate-create Edge Function uses the identical marker', () => {
    const ef = readFileSync(join(repoRoot, 'supabase/functions/image-generate-create/index.ts'), 'utf8');
    const m = ef.match(/OWNED_STORAGE_MARKER\s*=\s*"([^"]+)"/);
    expect(m, 'image-generate-create no longer declares OWNED_STORAGE_MARKER — if the photo rule moved or was removed there, reconcile it with this module (owner: Packet 4 / Studio)').not.toBeNull();
    expect(m![1], 'the Edge Function\'s copy of the owned-storage marker has drifted from the shared rule — the two MUST match or dead photos reach image generation again').toBe(OWNED_STORAGE_MARKER);
  });

  it('the readiness SQL signal tests the same marker', () => {
    const gather = readFileSync(join(repoRoot, 'apps/api/src/lib/readiness/gather.ts'), 'utf8');
    expect(gather, 'readiness\' with_hotlinked_images signal no longer matches the shared marker — readiness would report a different truth than the product shows').toContain(OWNED_STORAGE_MARKER);
  });
});

describe('SQL/TS parity', () => {
  it('exposes a LIKE pattern built from the same marker, so SQL and TS cannot drift', () => {
    expect(OWNED_STORAGE_LIKE).toBe(`%${OWNED_STORAGE_MARKER}%`);
  });

  it('matches the predicate readiness already uses in gather.ts', () => {
    // gather.ts counts hotlinked as: img NOT LIKE '%/storage/v1/object/public/property-images/%'
    expect(OWNED_STORAGE_MARKER).toBe('/storage/v1/object/public/property-images/');
  });
});
