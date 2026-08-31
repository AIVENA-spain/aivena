import { describe, it, expect } from 'vitest';

/**
 * Christian 2026-08-31: re-entering an agent who already existed failed with
 * "Something went wrong saving that". Two faults, both pinned here in spirit:
 * the number is the agent's IDENTITY inside an agency (so a repeat entry is an
 * update, not a collision), and a Postgres SQLSTATE lives on err.cause — the
 * old duplicate check regexed err.message and therefore never matched, so every
 * duplicate fell through to a generic 500.
 */
describe('pg error shape — SQLSTATE is on cause, not the message', () => {
  const readCode = (err: unknown): string | undefined => {
    const cause = (err as { cause?: { code?: string } })?.cause;
    return cause?.code ?? (err as { code?: string })?.code;
  };

  it('finds 23505 when the driver error is wrapped (the drizzle shape)', () => {
    const wrapped = Object.assign(new Error('Failed query: insert into agency_agents ...'), {
      cause: { code: '23505', constraint: 'agency_agents_agency_id_whatsapp_e164_key' },
    });
    expect(readCode(wrapped)).toBe('23505');
    // The message alone never carries it — this is exactly why the old check missed.
    expect(/23505/.test(wrapped.message)).toBe(false);
  });

  it('still finds the code on a bare driver error', () => {
    expect(readCode(Object.assign(new Error('dup'), { code: '23505' }))).toBe('23505');
  });

  it('returns undefined for an ordinary error rather than guessing', () => {
    expect(readCode(new Error('network blip'))).toBeUndefined();
  });
});
