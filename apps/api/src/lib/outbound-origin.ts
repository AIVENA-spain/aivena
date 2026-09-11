/**
 * Who asked for an outbound message — read from send_queue.requested_by, the only column that
 * records it (conversation_messages.sent_by is 'send-pusher' for every message).
 *
 * WHY THIS EXISTS (2026-09-11): lead_events.followup_sent is written for EVERY WhatsApp message the
 * send path delivers ("whatsapp_sent via Twilio"), whoever asked for it. The Overview feed labelled
 * all of them "Auto-reply sent", and dashboard_inbox maps followup_sent to 'auto', so a reply a person
 * approved would read "Auto-handled". Measured that day, every recent send was Amanda's
 * (amanda_engine), so nothing false was on screen yet — but operator_approved and operator_reengage
 * sends exist in the queue, and the next one would have been mislabelled.
 */

export type OutboundOrigin = 'automatic' | 'person' | 'reminder' | 'unknown';

/** Never guesses: a value it does not recognise is 'unknown'. */
export function originOf(requestedBy: string | null | undefined): OutboundOrigin {
  const v = (requestedBy ?? '').trim().toLowerCase();
  if (!v) return 'unknown';
  if (v.startsWith('operator')) return 'person';
  if (v.includes('reminder')) return 'reminder';
  if (v.startsWith('amanda')) return 'automatic';
  return 'unknown';
}

/** The Recent Activity label for a delivered message: "Auto-reply sent" only for what Amanda sent. */
export function sentLabel(origin: OutboundOrigin): string {
  switch (origin) {
    case 'automatic':
      return 'Auto-reply sent';
    case 'person':
      return 'Sent by your team';
    case 'reminder':
      return 'Viewing reminder sent';
    default:
      return 'WhatsApp message sent';
  }
}

/**
 * The Inbox's last-outbound kind, corrected: a send a person asked for is never 'auto'. Only that one
 * change is made — what cannot be proven either way keeps the database's answer.
 */
export function correctedOutboundKind(
  rpcKind: string | null,
  origin: OutboundOrigin | undefined,
): string | null {
  if (rpcKind === 'auto' && origin === 'person') return 'operator';
  return rpcKind;
}
