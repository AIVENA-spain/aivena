import { describe, it, expect } from 'vitest';
import { classifyRecoverySend } from './voice';

describe('classifyRecoverySend', () => {
  it('maps each known reason to friendly copy + status (Law-2: no raw token)', () => {
    expect(classifyRecoverySend('call_not_found').status).toBe(404);
    expect(classifyRecoverySend('not_missed').status).toBe(422);
    expect(classifyRecoverySend('already_sent').status).toBe(409);
    expect(classifyRecoverySend('no_contact').status).toBe(422);
    expect(classifyRecoverySend('opted_out').status).toBe(422);
    expect(classifyRecoverySend('no_whatsapp_provider').status).toBe(422);
    expect(classifyRecoverySend('no_template').status).toBe(422);
    for (const r of ['call_not_found', 'no_whatsapp_provider', 'no_template', 'opted_out']) {
      const { error } = classifyRecoverySend(r);
      expect(error).not.toContain(r); // the raw token never leaks
      expect(error.length).toBeGreaterThan(0);
    }
  });

  it('the not-yet-ready reasons reassure it will send once fixed', () => {
    expect(classifyRecoverySend('no_whatsapp_provider').error.toLowerCase()).toContain('once it is');
    expect(classifyRecoverySend('no_template').error.toLowerCase()).toContain('once it is');
  });

  it('unknown / undefined reason → calm generic 500', () => {
    expect(classifyRecoverySend('something_new').status).toBe(500);
    expect(classifyRecoverySend(undefined).status).toBe(500);
    expect(classifyRecoverySend(null).status).toBe(500);
  });
});
