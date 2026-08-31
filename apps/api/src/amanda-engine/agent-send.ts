// Staff WhatsApp sender.
//
// WHY THIS EXISTS RATHER THAN REUSING send_queue: that table is lead_id NOT
// NULL and its executor enforces buyer consent, opt-out and the 24h window —
// every one of them a LEAD concept. Agents are deliberately not leads (the
// clear line, 2026-08-28); routing staff traffic through the buyer lane would
// put them back in the funnel, which is the exact thing that line prevents.
//
// Credentials come from the platform vault via the same SECURITY DEFINER getter
// the Edge Functions use, and are NEVER logged — presence only, exactly as
// typing.ts does it. Failures are recorded on the message row, never thrown at
// the caller: a ping that cannot go out must not take a worker down with it.

import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';

const MESSAGES_URL = (sid: string) => `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
const CRED_TTL_MS = 5 * 60_000;

let cached: { sid: string; token: string } | null | undefined;
let cachedAt = 0;

async function getTwilioCreds(): Promise<{ sid: string; token: string } | null> {
  const now = Date.now();
  if (cached !== undefined && now - cachedAt < CRED_TTL_MS) return cached;
  try {
    const rows = (await db.execute(sql`
      SELECT public._get_platform_secret('TWILIO_ACCOUNT_SID') AS sid,
             public._get_platform_secret('TWILIO_AUTH_TOKEN') AS token
    `)) as unknown as Array<{ sid: string | null; token: string | null }>;
    const r = rows[0];
    cached = r?.sid && r?.token ? { sid: r.sid, token: r.token } : null;
  } catch {
    cached = null;
  }
  cachedAt = now;
  if (cached === null) console.error('[agent-send] Twilio credentials unavailable (presence check) — staff sends disabled');
  return cached;
}

export interface StaffSendResult {
  ok: boolean;
  providerMessageId: string | null;
  /** Short, safe reason. Never contains a body, a number, or a credential. */
  failure: string | null;
}

/**
 * Send one WhatsApp message to a staff number.
 *
 * `fromNumber` is the agency's own WhatsApp sender — the SAME number buyers
 * message — because the agent is meant to recognise AIVENA, and because the
 * inbound router identifies them by THEIR number, not by ours.
 */
export async function sendToAgent(opts: {
  toE164: string;
  fromE164: string;
  body: string;
}): Promise<StaffSendResult> {
  if (!/^\+[1-9]\d{6,14}$/.test(opts.toE164)) {
    return { ok: false, providerMessageId: null, failure: 'bad_to_number' };
  }
  if (!opts.body.trim()) {
    return { ok: false, providerMessageId: null, failure: 'empty_body' };
  }
  const creds = await getTwilioCreds();
  if (!creds) return { ok: false, providerMessageId: null, failure: 'no_credentials' };

  const form = new URLSearchParams({
    To: `whatsapp:${opts.toE164}`,
    From: `whatsapp:${opts.fromE164}`,
    Body: opts.body.slice(0, 1500),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch(MESSAGES_URL(creds.sid), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${creds.sid}:${creds.token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!resp.ok) {
      // STATUS ONLY. A Twilio error body echoes the To/From numbers and can
      // carry account identifiers; it must never reach a log line.
      console.error('[agent-send] rejected, status', resp.status);
      return { ok: false, providerMessageId: null, failure: `provider_${resp.status}` };
    }
    const data = (await resp.json()) as { sid?: string };
    return { ok: true, providerMessageId: data?.sid ?? null, failure: null };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error';
    console.error('[agent-send] send failed', name);
    return { ok: false, providerMessageId: null, failure: name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
