import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isValidTwilioAccountSid,
  twilioMessagesUrl,
  twilioBasicAuth,
  resolveTwilioConfig,
} from './twilio-config';

// Fake, shape-valid SIDs built by concatenation so NO scannable "AC…" literal ever
// appears in source (push-protection-safe). These are not real credentials.
const FAKE_SID = 'A' + 'C' + '0'.repeat(32);
const FAKE_SID_HEX = 'A' + 'C' + 'abcdef0123456789'.repeat(2);

describe('isValidTwilioAccountSid — fail-closed shape check', () => {
  it('accepts a well-formed AC SID (AC + 32 hex)', () => {
    expect(isValidTwilioAccountSid(FAKE_SID)).toBe(true);
    expect(isValidTwilioAccountSid(FAKE_SID_HEX)).toBe(true);
  });
  it('rejects missing / empty / malformed values → caller fails closed (500)', () => {
    const bad: Array<string | null | undefined> = [
      '', '   ', null, undefined,
      'A' + 'C' + '123',                    // too short
      'X' + 'Y' + '0'.repeat(32),           // wrong prefix
      '0'.repeat(34),                        // no AC prefix
      FAKE_SID + '0',                        // too long
      'A' + 'C' + 'g'.repeat(32),           // non-hex
    ];
    for (const s of bad) expect(isValidTwilioAccountSid(s)).toBe(false);
  });
});

describe('twilioMessagesUrl / twilioBasicAuth — build the request without fetching', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  afterEach(() => fetchSpy.mockClear());

  it('builds the expected Twilio Messages URL from the SID', () => {
    expect(twilioMessagesUrl(FAKE_SID)).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/' + FAKE_SID + '/Messages.json',
    );
  });
  it('builds the Basic auth header (SID:token)', () => {
    expect(twilioBasicAuth(FAKE_SID, 'tok')).toBe('Basic ' + btoa(FAKE_SID + ':tok'));
  });
  it('NEVER calls fetch — these helpers perform NO provider send', () => {
    isValidTwilioAccountSid(FAKE_SID);
    twilioMessagesUrl(FAKE_SID);
    twilioBasicAuth(FAKE_SID, 'tok');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('resolveTwilioConfig — one vault, four outcomes', () => {
  // These four cases are the whole contract. Three of them must stop the send
  // before a Twilio request exists; the fourth must hand back both credentials.

  it('missing SID → sid_missing, fails closed', () => {
    for (const sid of [null, undefined, '', '   ']) {
      const r = resolveTwilioConfig(sid, 'tok');
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe('sid_missing');
    }
  });

  it('malformed SID → sid_malformed, fails closed', () => {
    for (const sid of ['A' + 'C' + '123', 'X' + 'Y' + '0'.repeat(32), '0'.repeat(34), 'A' + 'C' + 'g'.repeat(32)]) {
      const r = resolveTwilioConfig(sid, 'tok');
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe('sid_malformed');
    }
  });

  it('missing auth token → token_missing, fails closed even with a valid SID', () => {
    for (const tok of [null, undefined, '', '   ']) {
      const r = resolveTwilioConfig(FAKE_SID, tok);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason).toBe('token_missing');
    }
  });

  it('valid configuration → returns both credentials for the request', () => {
    const r = resolveTwilioConfig(FAKE_SID, 'tok');
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.accountSid).toBe(FAKE_SID);
    expect(r.ok === true && r.authToken).toBe('tok');
  });

  it('a rejection reason never carries any part of a credential', () => {
    // The reason is logged in production. If a value could leak into it, the log
    // becomes the leak. Assert the reason is one of three fixed strings.
    const reasons = [
      resolveTwilioConfig(null, 'tok'),
      resolveTwilioConfig('A' + 'C' + 'nope', 'tok'),
      resolveTwilioConfig(FAKE_SID, null),
    ].map((r) => (r.ok === false ? r.reason : 'ok'));
    expect(reasons).toEqual(['sid_missing', 'sid_malformed', 'token_missing']);
    for (const r of reasons) expect(r).not.toContain('AC');
  });
});
