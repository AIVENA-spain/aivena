// whatsapp-send-execute — Twilio config helpers.
//
// BOTH Twilio credentials come from ONE place: the platform secret vault, read via
// the _get_platform_secret RPC. The auth token has always been read that way; the
// account SID was a source literal in production v20, and briefly a Deno.env var in
// an undeployed revision. An env var would have made the SID a SECOND source of
// truth, configured separately from the token it is used with — so a correct-looking
// deploy could still fail every send because one of the pair was set in the other
// store. One store, one failure mode, one thing to check.
//
// These helpers are pure (no Deno / npm / env / network) so the same code runs in the
// edge runtime and under vitest, and every failure path can be tested deterministically.

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

/** Why a Twilio configuration was rejected. A CATEGORY, never a value — safe to log. */
export type TwilioConfigError = "sid_missing" | "sid_malformed" | "token_missing";

export type TwilioConfigResult =
  | { ok: true; accountSid: string; authToken: string }
  | { ok: false; reason: TwilioConfigError };

/**
 * Resolve the two vault values into a usable Twilio configuration, or fail closed.
 *
 * Fails closed on purpose: if anything is missing or misshapen the caller must
 * return before building a Twilio request, so a misconfiguration cannot turn into
 * a half-formed send. The returned reason names the category only — it never
 * contains, and must never be made to contain, any part of a credential.
 */
export function resolveTwilioConfig(
  sid: string | null | undefined,
  token: string | null | undefined,
): TwilioConfigResult {
  if (sid == null || String(sid).trim() === "") return { ok: false, reason: "sid_missing" };
  if (!isValidTwilioAccountSid(sid)) return { ok: false, reason: "sid_malformed" };
  if (token == null || String(token).trim() === "") return { ok: false, reason: "token_missing" };
  return { ok: true, accountSid: sid, authToken: token };
}
