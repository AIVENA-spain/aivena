import { describe, it, expect } from 'vitest';
import { isHumanSender } from './sender-lib';

// Live demo 2026-08-28: every outbound WhatsApp is stamped sent_by='send-pusher'
// (the executor's caller tag) whether Amanda or an agent triggered it. The old
// denylist therefore read Amanda's OWN replies as a human colleague's, which
// auto-closed her open office questions as "answered by a human" and left
// dashboard tasks nobody could answer.
describe('isHumanSender — positive, fail-closed', () => {
  it.each(['send-pusher', 'system', 'amanda_engine', 'engine', 'n8n', 'worker-3', 'api', null, undefined, ''])(
    'automation/unknown is NOT human: %s',
    (v) => expect(isHumanSender(v as string | null)).toBe(false),
  );

  it.each(['maria@mediterraneocosta.es', 'christian@aivena.es', 'agent:maria', 'operator-7', 'human review desk'])(
    'an explicit human identity IS human: %s',
    (v) => expect(isHumanSender(v)).toBe(true),
  );

  it('an automation tag containing an email-ish suffix still loses (automation wins)', () => {
    expect(isHumanSender('send-pusher@n8n')).toBe(false);
    expect(isHumanSender('system@aivena.es')).toBe(false);
  });
});
