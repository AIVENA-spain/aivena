import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inboxChannelFor } from './inbox-channel';

const none = { conversationChannel: null, leadChannel: null, hasEmail: false, hasPhone: false };

describe('inboxChannelFor — the channel comes from the named lead', () => {
  it('a manual lead with only an email is answered by email', () => {
    expect(inboxChannelFor({ ...none, leadChannel: 'manual', hasEmail: true })).toBe('email');
  });

  it("an existing WhatsApp conversation wins over the lead's email", () => {
    expect(inboxChannelFor({ conversationChannel: 'whatsapp', leadChannel: 'whatsapp', hasEmail: true, hasPhone: true })).toBe('whatsapp');
  });

  it('an existing email conversation wins over a phone number', () => {
    expect(inboxChannelFor({ conversationChannel: 'email', leadChannel: 'form', hasEmail: true, hasPhone: true })).toBe('email');
  });

  it('a WhatsApp lead with a number and no conversation yet is WhatsApp', () => {
    expect(inboxChannelFor({ ...none, leadChannel: 'whatsapp', hasPhone: true, hasEmail: true })).toBe('whatsapp');
  });

  it('a form lead with both prefers email', () => {
    expect(inboxChannelFor({ ...none, leadChannel: 'form', hasPhone: true, hasEmail: true })).toBe('email');
  });

  it('a conversation channel the lead can no longer be reached on is not used', () => {
    expect(inboxChannelFor({ ...none, conversationChannel: 'whatsapp', hasEmail: true })).toBe('email');
  });

  it('no email and no number means no channel, never a guess', () => {
    expect(inboxChannelFor(none)).toBeNull();
    expect(inboxChannelFor({ ...none, conversationChannel: 'whatsapp', leadChannel: 'whatsapp' })).toBeNull();
  });
});

describe('the inbox-entry route is fenced to the caller agency and uses this rule', () => {
  const src = readFileSync(join(__dirname, '../routes/leads.ts'), 'utf8');
  const route = src.slice(src.indexOf("route.get('/:leadId/inbox-entry'"));

  it('exists and derives the channel with inboxChannelFor', () => {
    expect(route.length).toBeGreaterThan(0);
    expect(route).toMatch(/inboxChannelFor\(/);
  });

  it("filters the lead on the agency GUC (a lead id from another agency finds nothing)", () => {
    expect(route).toMatch(/l\.agency_id = current_setting\('app\.current_agency_id', true\)/);
  });
});
