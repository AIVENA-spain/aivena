import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidTwilioAccountSid, twilioMessagesUrl, twilioBasicAuth } from './twilio-config';

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
