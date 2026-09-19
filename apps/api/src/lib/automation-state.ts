import { parseAmandaMode, type AmandaMode } from '../amanda-engine/modes';

/**
 * What automation actually does for an agency — the ONE reading every status
 * screen uses (D-54a). The engine obeys agency_settings.amanda_mode and nothing
 * else. The older fields (reply_handling_mode, human_approval_required,
 * reply_rules.default_lane, channels_enabled, whatsapp_automation_enabled) gate
 * no send path: on 2026-09-18 the demo agency held amanda_mode=full beside
 * channels_enabled=['email'] and whatsapp_automation_enabled=false, Amanda's
 * replies were delivered, and five screens said "Approval-first", "replies off",
 * "automation off" or "the WhatsApp channel is off". No screen may derive an
 * automation claim from those fields again.
 *
 * Agency-facing copy: no field names, no build jargon.
 */
export type AutomationPosture = {
  mode: AmandaMode;
  /** assisted/full: messages reach buyers with no person reviewing them first. */
  sendsWithoutReview: boolean;
  /** Safety gate: full automation needs its own go-live gates, so it is never simply "ready". */
  status: 'ready' | 'live_but_unproven';
  label: string;
  copy: string;
};

const POSTURE: Record<AmandaMode, { label: string; copy: string }> = {
  off: { label: 'Off', copy: 'Amanda is off — nothing is sent automatically; every message waits for your team' },
  shadow: { label: 'Watching', copy: 'Watching only — Amanda drafts silently and nothing is sent' },
  approval: { label: 'Approval-first', copy: 'Approval-first — your team reviews before anything sends' },
  assisted: { label: 'Assisted', copy: 'Assisted — Amanda sends replies herself; bookings wait for your team' },
  full: { label: 'Full automation', copy: 'Full automation — Amanda replies and books without review' },
};

/** `rawMode` null means the mode could not be read: the caller shows "unavailable", never a guess. */
export function resolveAutomationPosture(rawMode: unknown): AutomationPosture | null {
  if (rawMode === null || rawMode === undefined) return null;
  const mode = parseAmandaMode(rawMode);
  const sendsWithoutReview = mode === 'assisted' || mode === 'full';
  return { mode, sendsWithoutReview, status: sendsWithoutReview ? 'live_but_unproven' : 'ready', ...POSTURE[mode] };
}

export type WhatsAppProviderView = {
  status: 'ready' | 'live_but_unproven' | 'missing';
  /** Short line for the readiness checklist. */
  uiCopy: string;
  /** Sentence printed verbatim on Settings and Operations. */
  detail: string;
};

/**
 * WhatsApp provider health = is the number connected, and has a message been
 * delivered through it. Whether Amanda sends on her own is the automation
 * level's job (above); the detail only names it so the two never contradict.
 */
export function whatsappProviderView(
  wa: { whatsapp_sender_ready: boolean; template_send_path_proven: boolean },
  posture: AutomationPosture | null,
): WhatsAppProviderView {
  if (!wa.whatsapp_sender_ready) {
    return { status: 'missing', uiCopy: 'WhatsApp not connected', detail: 'Not connected yet.' };
  }
  if (!wa.template_send_path_proven) {
    return {
      status: 'live_but_unproven',
      uiCopy: 'Sender connected — no message delivered yet',
      detail: 'Your number is connected. No message has been delivered through it yet.',
    };
  }
  const detail =
    posture === null
      ? 'Connected — messages have been delivered through this number.'
      : posture.mode === 'off' || posture.mode === 'shadow'
        ? 'Connected. Nothing is sent automatically at your current automation level.'
        : posture.mode === 'approval'
          ? 'Connected. Replies are sent once your team approves them.'
          : 'Connected and sending.';
  return { status: 'ready', uiCopy: 'WhatsApp connected — messages delivered', detail };
}
