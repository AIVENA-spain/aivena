/**
 * Which channel a person replies on when they open ONE named lead in the Inbox
 * (Option A, 2026-09-18). Derived from that lead only, never from whatever row
 * happens to be first in the list: the old ?leadId= fallback opened another
 * buyer's WhatsApp conversation, where Send would have messaged the wrong person.
 *
 * Order: the lead's existing conversation wins (the thread you see is the one
 * you answer); then a WhatsApp lead with a number; then email (no 24-hour
 * window, no template needed); then any number. No route at all → null, and the
 * Inbox says so instead of opening a composer.
 */
export type InboxChannel = 'whatsapp' | 'email';

export function inboxChannelFor(lead: {
  conversationChannel: string | null;
  leadChannel: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
}): InboxChannel | null {
  const conv = (lead.conversationChannel ?? '').toLowerCase();
  if (conv === 'whatsapp' && lead.hasPhone) return 'whatsapp';
  if (conv === 'email' && lead.hasEmail) return 'email';
  if ((lead.leadChannel ?? '').toLowerCase() === 'whatsapp' && lead.hasPhone) return 'whatsapp';
  if (lead.hasEmail) return 'email';
  if (lead.hasPhone) return 'whatsapp';
  return null;
}
