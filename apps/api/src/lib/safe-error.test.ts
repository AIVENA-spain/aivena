import { describe, it, expect } from 'vitest';
import { safeErr } from './safe-error';

/**
 * The exact shape drizzle throws. A review on 2026-08-31 found the calendar
 * worker logging err.message in full, which would have written a customer's
 * live Google OAuth tokens into Railway's logs.
 */
function drizzleError(sql: string, params: string): Error {
  const e = new Error(`Failed query: ${sql}\nparams: ${params}`);
  return e;
}

describe('safeErr — bind params must never reach a log', () => {
  it('drops the params line entirely', () => {
    const err = drizzleError(
      'select * from store_agency_oauth_credential($1,$2,$3,$4)',
      'demo-agency,google,ya29.A0AVA9y1-REAL-ACCESS-TOKEN,1//04-REAL-REFRESH-TOKEN',
    );
    const out = safeErr(err);
    expect(out).not.toContain('ya29');
    expect(out).not.toContain('REFRESH');
    expect(out).not.toContain('params:');
    expect(out).toContain('Failed query');
  });

  it('keeps a lead\'s phone and email out of the log', () => {
    const out = safeErr(drizzleError('insert into leads ...', 'Marte,+4745105955,marte@example.com'));
    expect(out).not.toContain('+4745105955');
    expect(out).not.toContain('marte@example.com');
  });

  it('prefers the driver cause — better signal, and it carries no params', () => {
    const e = Object.assign(new Error('Failed query: insert ...\nparams: secret'), {
      cause: { message: 'duplicate key value violates unique constraint "agency_agents_agency_id_whatsapp_e164_key"' },
    });
    const out = safeErr(e);
    expect(out).toContain('duplicate key');
    expect(out).not.toContain('secret');
  });

  it('caps length so one error cannot flood the log', () => {
    expect(safeErr(new Error('x'.repeat(5000))).length).toBe(200);
  });

  it('survives non-Error throws', () => {
    expect(safeErr('boom')).toBe('boom');
    expect(safeErr(undefined)).toBe('error');
    expect(safeErr({ weird: true })).toBe('error');
  });
});
