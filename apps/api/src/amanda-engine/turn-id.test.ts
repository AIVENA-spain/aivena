import { describe, it, expect } from 'vitest';
import { turnId } from './turn-id';

describe('turnId — deterministic idempotency key', () => {
  it('is stable for the same (conversation, MessageSid)', () => {
    expect(turnId('c1', 'SM123')).toBe(turnId('c1', 'SM123'));
  });
  it('differs across conversations and across messages', () => {
    expect(turnId('c1', 'SM123')).not.toBe(turnId('c2', 'SM123'));
    expect(turnId('c1', 'SM123')).not.toBe(turnId('c1', 'SM124'));
  });
  it('is not confusable by concatenation collisions', () => {
    expect(turnId('ab', 'c')).not.toBe(turnId('a', 'bc'));
  });
  it('throws on missing parts instead of minting a shared id', () => {
    expect(() => turnId('', 'SM1')).toThrow();
    expect(() => turnId('c1', '')).toThrow();
  });
});
