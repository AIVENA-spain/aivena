import { describe, it, expect } from 'vitest';
import { AgencyCircuitBreaker, BREAKER_THRESHOLD, BREAKER_WINDOW_MS, BREAKER_COOLDOWN_MS } from './outbox-lib';

const T0 = 1_000_000;

describe('AgencyCircuitBreaker — §4 degradation v1', () => {
  it('trips after N consecutive failures inside the window, alerting exactly once', () => {
    const b = new AgencyCircuitBreaker();
    let tripped = 0;
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      if (b.recordFailure('a1', T0 + i * 1000)) tripped++;
    }
    expect(tripped).toBe(1);
    expect(b.isOpen('a1', T0 + BREAKER_THRESHOLD * 1000)).toBe(true);
    // further failures while open never re-alert
    expect(b.recordFailure('a1', T0 + 6000)).toBe(false);
  });

  it('stays closed below the threshold and after a success reset', () => {
    const b = new AgencyCircuitBreaker();
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) b.recordFailure('a1', T0 + i * 1000);
    expect(b.isOpen('a1', T0 + 5000)).toBe(false);
    b.recordSuccess('a1');
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) b.recordFailure('a1', T0 + 10_000 + i * 1000);
    expect(b.isOpen('a1', T0 + 20_000)).toBe(false);
  });

  it('failures outside the window start a fresh count (no slow-drip trip)', () => {
    const b = new AgencyCircuitBreaker();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      // each failure 11 minutes apart — never trips
      expect(b.recordFailure('a1', T0 + i * (BREAKER_WINDOW_MS + 60_000))).toBe(false);
    }
    expect(b.isOpen('a1', T0 + 10 * BREAKER_WINDOW_MS)).toBe(false);
  });

  it('re-closes after the cooldown', () => {
    const b = new AgencyCircuitBreaker();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) b.recordFailure('a1', T0 + i * 1000);
    expect(b.isOpen('a1', T0 + 10_000)).toBe(true);
    expect(b.isOpen('a1', T0 + 5000 + BREAKER_COOLDOWN_MS)).toBe(false);
  });

  it('agencies are independent', () => {
    const b = new AgencyCircuitBreaker();
    for (let i = 0; i < BREAKER_THRESHOLD; i++) b.recordFailure('a1', T0 + i * 1000);
    expect(b.isOpen('a1', T0 + 9000)).toBe(true);
    expect(b.isOpen('a2', T0 + 9000)).toBe(false);
  });
});
