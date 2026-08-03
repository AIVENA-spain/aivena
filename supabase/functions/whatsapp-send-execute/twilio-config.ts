// whatsapp-send-execute — Twilio config helpers (P3 source-of-truth cleanup, 2026-07-31).
//
// The Twilio Account SID is read from the TWILIO_ACCOUNT_SID Edge Function env var
// (Deno.env) instead of a hardcoded literal — so the full function source can be
// versioned without a secret in git. These helpers are the shared, unit-tested
// source of truth for validating the SID and building the SID-dependent request
// pieces. Pure (no Deno / npm / env) so they run in the edge runtime AND in vitest.

/** A Twilio Account SID is "AC" + 32 hex chars. Anything else (missing / empty /
 *  wrong shape) is invalid → the caller must fail closed and NOT build a request. */
export function isValidTwilioAccountSid(sid: string | null | undefined): boolean {
  return typeof sid === 'string' && /^AC[0-9a-f]{32}$/i.test(sid);
}

/** The Twilio Messages endpoint for a given account. */
export function twilioMessagesUrl(accountSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
}

/** The HTTP Basic auth header value for Twilio (account SID : auth token). */
export function twilioBasicAuth(accountSid: string, token: string): string {
  return 'Basic ' + btoa(`${accountSid}:${token}`);
}
