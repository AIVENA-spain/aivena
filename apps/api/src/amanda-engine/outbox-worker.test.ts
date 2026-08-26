import { describe, it, expect } from 'vitest';
import { backoffSeconds, engineEnabled } from './outbox-lib';

describe('engineEnabled — off unless explicitly flagged', () => {
  it('is false when the env var is unset or anything but "true"', () => {
    const prev = process.env.AMANDA_ENGINE_ENABLED;
    try {
      delete process.env.AMANDA_ENGINE_ENABLED;
      expect(engineEnabled()).toBe(false);
      process.env.AMANDA_ENGINE_ENABLED = '1';
      expect(engineEnabled()).toBe(false);
      process.env.AMANDA_ENGINE_ENABLED = 'true';
      expect(engineEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AMANDA_ENGINE_ENABLED;
      else process.env.AMANDA_ENGINE_ENABLED = prev;
    }
  });
});

describe('backoffSeconds — bounded exponential', () => {
  it('grows 30s → 2m → 8m → 32m and caps at 1h', () => {
    expect(backoffSeconds(1)).toBe(30);
    expect(backoffSeconds(2)).toBe(120);
    expect(backoffSeconds(3)).toBe(480);
    expect(backoffSeconds(4)).toBe(1920);
    expect(backoffSeconds(5)).toBe(3600);
    expect(backoffSeconds(50)).toBe(3600);
  });
  it('tolerates a zero/negative attempts count', () => {
    expect(backoffSeconds(0)).toBe(30);
    expect(backoffSeconds(-3)).toBe(30);
  });
});
