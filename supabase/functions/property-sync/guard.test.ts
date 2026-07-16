import { describe, it, expect } from 'vitest';
import {
  evaluateWithdrawalGuard, isOwnedImageUrl, imageExt, storagePathFor, ownedUrlFor,
  OWNED_STORAGE_MARKER,
} from './guard';

describe('evaluateWithdrawalGuard — the mass-withdraw safety catch', () => {
  it('BLOCKS the catastrophic cases (truncated feed / full re-key / wrong agency)', () => {
    expect(evaluateWithdrawalGuard(140, 141).blocked).toBe(true);   // feed truncated to 1 of 141
    expect(evaluateWithdrawalGuard(141, 141).blocked).toBe(true);   // CRM re-keys every id
    expect(evaluateWithdrawalGuard(12, 12).blocked).toBe(true);     // wrong agency_id, 100% of a 12-catalogue
    expect(evaluateWithdrawalGuard(30, 141).blocked).toBe(true);    // 21% — over the cap
  });

  it('ALLOWS normal churn', () => {
    expect(evaluateWithdrawalGuard(3, 141).blocked).toBe(false);    // 3 sold overnight
    expect(evaluateWithdrawalGuard(0, 141).blocked).toBe(false);    // nothing vanished
    expect(evaluateWithdrawalGuard(28, 141).blocked).toBe(false);   // 19.9% — just under the cap
  });

  it('the FLOOR of 5 keeps small catalogues working even past the percentage', () => {
    // A 12-listing agency selling 4 = 33%, which a bare 20% rule would wrongly block. The floor saves it.
    expect(evaluateWithdrawalGuard(4, 12).blocked).toBe(false);
    expect(evaluateWithdrawalGuard(5, 12).blocked).toBe(false);     // 5 is not > floor(5)
    expect(evaluateWithdrawalGuard(6, 12).blocked).toBe(true);      // 6 > 5 and 6 > 2.4 → blocked
  });

  it('allowMassWithdraw is the human override — never blocks', () => {
    const d = evaluateWithdrawalGuard(141, 141, true);
    expect(d.blocked).toBe(false);
    expect(d.reason).toMatch(/override_mass_withdraw/);
  });

  it('a zero/empty catalogue never blocks and reports honestly', () => {
    expect(evaluateWithdrawalGuard(0, 0)).toMatchObject({ blocked: false, reason: 'nothing_to_withdraw' });
    // first-ever sync: nothing active yet, nothing to withdraw
    expect(evaluateWithdrawalGuard(0, 0, false).blocked).toBe(false);
  });

  it('a blocked decision carries the exact numbers for the run log', () => {
    const d = evaluateWithdrawalGuard(140, 141);
    expect(d.reason).toContain('140_of_141');
    expect(d.pct).toBeCloseTo(140 / 141, 5);
  });

  it('respects tunable floor/pctCap', () => {
    expect(evaluateWithdrawalGuard(10, 100, false, { pctCap: 0.05, floor: 5 }).blocked).toBe(true); // 10% > 5%
    expect(evaluateWithdrawalGuard(10, 100, false, { pctCap: 0.5, floor: 5 }).blocked).toBe(false); // 10% < 50%
  });
});

describe('image storage helpers — mirrored urls must be OWNED (the montinmo lesson)', () => {
  it('ownedUrlFor always contains the owned-storage marker the usable-photo rule checks', () => {
    const url = ownedUrlFor('https://ref.supabase.co', 'demo/ic-1/0.jpg');
    expect(url).toContain(OWNED_STORAGE_MARKER);
    expect(isOwnedImageUrl(url)).toBe(true);
    expect(url).toBe('https://ref.supabase.co/storage/v1/object/public/property-images/demo/ic-1/0.jpg');
  });

  it('tolerates a trailing slash on the base url', () => {
    expect(ownedUrlFor('https://ref.supabase.co/', 'a/b/0.jpg'))
      .toBe('https://ref.supabase.co/storage/v1/object/public/property-images/a/b/0.jpg');
  });

  it('isOwnedImageUrl distinguishes ours from a feed link (so a re-sync skips re-downloading ours)', () => {
    expect(isOwnedImageUrl('https://ref.supabase.co/storage/v1/object/public/property-images/x/y/0.jpg')).toBe(true);
    expect(isOwnedImageUrl('https://images.kyero.com/12345_large.jpg')).toBe(false);
    expect(isOwnedImageUrl('https://montinmo.es/x.jpg')).toBe(false);
    expect(isOwnedImageUrl(null)).toBe(false);
    expect(isOwnedImageUrl(42)).toBe(false);
  });

  it('imageExt derives a sane extension, strips query strings, normalises jpeg→jpg', () => {
    expect(imageExt('https://x/photo.JPG')).toBe('jpg');
    expect(imageExt('https://x/photo.jpeg?w=1200')).toBe('jpg');
    expect(imageExt('https://x/photo.webp')).toBe('webp');
    expect(imageExt('https://x/photo.png')).toBe('png');
    expect(imageExt('https://x/image-no-extension')).toBe('jpg'); // safe default
  });

  it('storagePathFor is deterministic + path-safe', () => {
    expect(storagePathFor('demo-costa', 'IC-28746', 3, 'jpg')).toBe('demo-costa/IC-28746/3.jpg');
    // unsafe characters in ids are neutralised, never passed through
    expect(storagePathFor('a/b', '../evil', 0, 'png')).toBe('a_b/.._evil/0.png');
  });
});
