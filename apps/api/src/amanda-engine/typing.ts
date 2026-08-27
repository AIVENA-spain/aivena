// Amanda engine — WhatsApp typing indicator + read receipt (Twilio Typing
// Indicators API, GA'd 2026: POST /v3/Indicators/Typing.json marks the
// referenced inbound message READ — blue ticks — and shows "typing…" for up to
// 25s or until our reply lands). Fired fire-and-forget the moment a buyer turn
// starts in an AUTO-REPLY mode (assisted/full) — in approval/shadow no reply is
// coming, so signalling "typing" would be a lie and reading receipts would leak
// shadow's presence. Credentials come from the platform vault via the same
// SECURITY DEFINER getter the EFs use; values are NEVER logged (presence only).

import { sql } from 'drizzle-orm';
import { db } from '../../../../packages/db/client';

const TYPING_URL = 'https://messaging.twilio.com/v3/Indicators/Typing.json';
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
  if (cached === null) console.error('[amanda-typing] Twilio credentials unavailable (presence check) — typing indicators off');
  return cached;
}

/** Fire-and-forget: never throws, never blocks the turn. */
export function sendTypingIndicator(inboundMessageSid: string): void {
  if (!/^(SM|MM)[0-9a-f]{32}$/i.test(inboundMessageSid)) return;   // Twilio SIDs only
  void (async () => {
    const creds = await getTwilioCreds();
    if (!creds) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(TYPING_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${creds.sid}:${creds.token}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: 'WHATSAPP', messageId: inboundMessageSid }),
      });
      if (!resp.ok) {
        // Status only — bodies could echo identifiers; never log them.
        console.error('[amanda-typing] indicator rejected, status', resp.status);
      }
    } catch (err) {
      console.error('[amanda-typing] indicator failed', err instanceof Error ? err.name : 'error');
    } finally {
      clearTimeout(timer);
    }
  })();
}
