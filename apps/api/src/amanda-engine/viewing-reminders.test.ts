import { describe, it, expect } from 'vitest';
import { reminderDateParts } from './viewing-reminders-lib';

describe('reminderDateParts — explicit tz-correct template strings', () => {
  it('renders Madrid summer time correctly', () => {
    // 2026-08-28T15:00Z = 17:00 Madrid (CEST)
    const p = reminderDateParts(Date.UTC(2026, 7, 28, 15, 0), 'Europe/Madrid');
    expect(p).toEqual({ date: '28 August', time: '17:00' });
  });
  it('renders Madrid winter time and pads minutes', () => {
    // 2026-12-15T16:05Z = 17:05 Madrid (CET)
    const p = reminderDateParts(Date.UTC(2026, 11, 15, 16, 5), 'Europe/Madrid');
    expect(p).toEqual({ date: '15 December', time: '17:05' });
  });
});
