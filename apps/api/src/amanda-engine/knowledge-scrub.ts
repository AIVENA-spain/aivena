// Amanda engine — save-time knowledge scrubber (design §5: "agency knowledge
// screened at SAVE time … reject with reason"). Deterministic v1; the LLM
// review tier rides P2. Everything an agency saves here lands VERBATIM in
// Amanda's prompt as semi-trusted context — so the floor is hard:
//   · housing-discrimination content is refused (platform floor, non-negotiable)
//   · bank details / payment coordinates are refused (§11.5 payments floor —
//     Amanda must never be able to quote an IBAN, so one may never be stored)
//   · URLs are refused (Amanda's no-links law would leak or break them)
//   · prompt-injection shapes are refused (imperatives aimed at the assistant)
//   · length-capped; empty rejected.
// Rejections return a REASON the settings UI shows — never a silent drop.

import { screenPaymentDetails } from './validators';

export interface ScrubResult {
  ok: boolean;
  reason:
    | null
    | 'empty'
    | 'too_long'
    | 'payment_details'
    | 'discriminatory'
    | 'url'
    | 'instruction_injection';
}

export const KNOWLEDGE_MAX_CHARS = 800;

// Housing-discrimination floor — protected-class exclusions an agency might
// naively type ("no foreigners", "solo españoles"…). ES/EN core; the P2 LLM
// tier broadens language coverage. Deliberately narrow patterns: they must
// catch exclusionary RULES, not any mention of a nationality.
const DISCRIMINATION_RE: RegExp[] = [
  /\bno\s+(foreigners|immigrants|arabs?|muslims?|jews?|blacks?|gypsies|gitanos?|moros?|extranjeros?|inmigrantes?)\b/i,
  /\b(solo|sólo|only)\s+(espa[nñ]oles?|spaniards?|europe[ao]ns?|locals?|nacionales?)\b/i,
  /\b(?:no|not|don'?t|do\s+not|never)\s+(?:rent|sell|show)\w*\s+to\s+(?:foreigners|immigrants|arabs?|muslims?|jews?|blacks?)\b/i,
  /\bno\s+(alquilamos|vendemos|ense[nñ]amos)\s+a\s+(extranjeros?|inmigrantes?|moros?|gitanos?)\b/i,
];

const URL_RE = /https?:\/\/|www\./i;

// Imperatives aimed at the assistant = prompt-poisoning channel (§5).
const INJECTION_RE: RegExp[] = [
  /\b(ignore|disregard|forget)\b.{0,40}\b(instructions?|rules?|prompt)\b/i,
  /\byou\s+are\s+(now|no\s+longer)\b/i,
  /\b(system\s*prompt|jailbreak)\b/i,
  /\balways\s+(say|claim|tell)\b.{0,60}\b(human|not\s+an?\s+ai)\b/i,
];

export function scrubKnowledge(raw: string): ScrubResult {
  const content = raw.trim();
  if (!content) return { ok: false, reason: 'empty' };
  if (content.length > KNOWLEDGE_MAX_CHARS) return { ok: false, reason: 'too_long' };
  if (!screenPaymentDetails(content).ok) return { ok: false, reason: 'payment_details' };
  if (DISCRIMINATION_RE.some((re) => re.test(content))) return { ok: false, reason: 'discriminatory' };
  if (URL_RE.test(content)) return { ok: false, reason: 'url' };
  if (INJECTION_RE.some((re) => re.test(content))) return { ok: false, reason: 'instruction_injection' };
  return { ok: true, reason: null };
}
