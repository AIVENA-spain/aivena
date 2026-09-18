import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pauseReason } from './pause-lib';

// D-56 (2026-09-18): escalation flagged the lead needs_human_since and the
// dashboard said "the assistant is paused", but the engine never read that flag,
// so Amanda kept replying to a lead that was waiting for a person.
const none = { convMutedAt: null, convClaimedAt: null, leadClaimedAt: null, leadNeedsHumanSince: null };

describe('pauseReason — any of the four stops pauses Amanda', () => {
  it('no flag set: not paused', () => {
    expect(pauseReason(none)).toBeNull();
  });

  it('an escalated lead (needs_human_since) is paused', () => {
    expect(pauseReason({ ...none, leadNeedsHumanSince: '2026-08-31T15:07:15Z' })).toBe('lead_needs_human');
  });

  it.each([
    ['conversation muted', { convMutedAt: '2026-09-18T10:00:00Z' }],
    ['conversation claimed', { convClaimedAt: '2026-09-18T10:00:00Z' }],
    ['lead claimed', { leadClaimedAt: '2026-09-18T10:00:00Z' }],
  ])('%s is paused', (_label, flag) => {
    expect(pauseReason({ ...none, ...flag })).toBe('ai_muted_or_human_claimed');
  });
});

describe('the engine and the hand-back paths use the same flags', () => {
  const engine = readFileSync(join(__dirname, 'process-turn-db.ts'), 'utf8');
  const admin = readFileSync(join(__dirname, '../routes/amanda-admin.ts'), 'utf8');

  it('the engine loads needs_human_since and decides through pauseReason', () => {
    expect(engine).toMatch(/SELECT[^`]*needs_human_since[^`]*FROM leads/);
    expect(engine).toMatch(/pauseReason\(/);
  });

  it('handing a conversation back to Amanda also releases the lead-level handoff', () => {
    expect(admin).toMatch(/release_human_handoff\(/);
  });

  it('the per-conversation switch reports an escalated lead as paused', () => {
    expect(admin).toMatch(/needs_human_since/);
  });
});
