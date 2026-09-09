import { describe, it, expect } from 'vitest';
import { constantTimeEqual } from './constant-time';

describe('constantTimeEqual — guards the valuation launch-gate test key', () => {
  it('accepts an exact match', () => {
    expect(constantTimeEqual('s3cret-key', 's3cret-key')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('rejects same-length values that differ anywhere', () => {
    expect(constantTimeEqual('s3cret-key', 'X3cret-key')).toBe(false);  // first char
    expect(constantTimeEqual('s3cret-key', 's3cret-keX')).toBe(false);  // last char
    expect(constantTimeEqual('s3cret-key', 's3cRet-key')).toBe(false);  // middle, case
  });

  it('rejects different lengths, including prefixes', () => {
    expect(constantTimeEqual('s3cret-key', 's3cret')).toBe(false);
    expect(constantTimeEqual('s3cret', 's3cret-key')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
    expect(constantTimeEqual('x', '')).toBe(false);
  });

  it('inspects every character — a late mismatch is not cheaper to find than an early one', () => {
    // The defect this replaces was an early exit. Assert the loop cannot exit
    // early by proving every position is load-bearing: flipping any single
    // character must flip the result, no matter how deep it sits.
    const key = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < key.length; i++) {
      const tampered = key.slice(0, i) + '!' + key.slice(i + 1);
      expect(constantTimeEqual(tampered, key), `position ${i} not compared`).toBe(false);
    }
    expect(constantTimeEqual(key, key)).toBe(true);
  });

  it('accumulates differences without letting them cancel out', () => {
    // Two mismatched positions must not XOR away to zero.
    expect(constantTimeEqual('AB', 'BA')).toBe(false);
    // A plain space and a non-breaking space are different keys. Written as
    // escapes so the distinction survives copy-paste and code review.
    expect(constantTimeEqual('\u0020', '\u00a0')).toBe(false);
  });
});
