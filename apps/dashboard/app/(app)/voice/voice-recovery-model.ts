/**
 * Pure model for the missed-call text-back surface (P2-A). Turns the raw
 * prerequisite facts from GET /voice/recovery-status into (a) an overall readiness
 * headline + the exact missing pieces, and (b) a per-call recovery state. It mirrors
 * the gate order inside `prepare_voice_recovery` so the dashboard tells the same
 * truth the engine would act on — never claims "ready" when the engine would refuse.
 * Kept dependency-free so it unit-tests without React or the network.
 */

export type RecoveryFacts = {
  /** voice_recovery_whatsapp_enabled — the agency's master ON switch. */
  flag_enabled: boolean;
  template_key: string;
  /** reply_rules.dashboard_toggles.auto_whatsapp_recovery, as jsonb text ("true"/"false"/null). */
  auto_toggle: string | boolean | null;
  /** effective WhatsApp lane (by_channel.whatsapp → default_lane → 'review_first'). */
  whatsapp_lane: string;
  /** an approved `voice_recovery` template with a provider id exists. */
  template_approved: boolean;
  /** a non-disabled twilio_whatsapp provider exists. */
  provider_live: boolean;
};

/** The three prerequisites for the text-back to actually send. */
export type Prereq = "enable" | "template" | "provider";

export type RecoveryHeadline = "ready_auto" | "ready_approval" | "waiting" | "off";

export type RecoveryReadiness = {
  enabled: boolean;
  templateApproved: boolean;
  providerLive: boolean;
  /** K2 posture: the agency has authorized UNATTENDED auto-send. */
  autoSend: boolean;
  /** all three prerequisites met → the text-back can actually be sent. */
  canSend: boolean;
  /** the unmet prerequisites, in display order — the "ready except X". */
  missing: Prereq[];
  headline: RecoveryHeadline;
};

export function computeRecoveryReadiness(f: RecoveryFacts): RecoveryReadiness {
  const autoToggle = f.auto_toggle === true || f.auto_toggle === "true";
  // K2 safety gate: auto-send ONLY when the dedicated toggle is on AND the effective
  // WhatsApp lane is not review_first (strictest-wins). Otherwise it's approval-first.
  const autoSend = autoToggle && f.whatsapp_lane !== "review_first";

  const missing: Prereq[] = [];
  if (!f.flag_enabled) missing.push("enable");
  if (!f.template_approved) missing.push("template");
  if (!f.provider_live) missing.push("provider");

  const canSend = f.flag_enabled && f.template_approved && f.provider_live;

  let headline: RecoveryHeadline;
  if (canSend) headline = autoSend ? "ready_auto" : "ready_approval";
  else if (f.flag_enabled) headline = "waiting"; // switched on, but a prerequisite is missing
  else headline = "off";

  return {
    enabled: f.flag_enabled,
    templateApproved: f.template_approved,
    providerLive: f.provider_live,
    autoSend,
    canSend,
    missing,
    headline,
  };
}

export type VoiceCall = {
  id: string;
  status: string; // ringing | answered | no_answer | busy | failed | voicemail
  from_number: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_opt_in: string | null;
  recovery_sent: boolean;
};

/** A missed call is one the AI/line never picked up — the only recoverable kind. */
export function isMissed(status: string): boolean {
  return status === "no_answer" || status === "voicemail";
}

export type CallRecoveryState =
  | "not_applicable" // not a missed call — no recovery
  | "sent" // text-back already sent
  | "no_contact" // missed but no lead/number to reach
  | "opted_out" // lead opted out / blocked
  | "waiting_setup" // recoverable, but provider/template/flag missing
  | "pending_auto" // recoverable + ready → would auto-send
  | "pending_approval"; // recoverable + ready → awaits agent approval

export function callRecoveryState(
  call: VoiceCall,
  readiness: RecoveryReadiness,
): CallRecoveryState {
  if (!isMissed(call.status)) return "not_applicable";
  if (call.recovery_sent) return "sent";
  if (!call.lead_id || !(call.from_number ?? "").trim()) return "no_contact";
  if (call.lead_opt_in === "opted_out" || call.lead_opt_in === "blocked") return "opted_out";
  if (!readiness.canSend) return "waiting_setup";
  return readiness.autoSend ? "pending_auto" : "pending_approval";
}
