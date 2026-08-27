// Amanda engine — deterministic send-path validators (design §10: "the prompt
// is aspiration; the validators are law"). Every outbound draft passes these
// before it can send or even queue as a draft; failures regenerate with feedback
// (max 2 retries) and then fall to the human queue. Pure — no db, fully tested.

export interface LintOptions {
  allowLongForm?: boolean;      // broad question / re-engagement / property summary / relay-with-context
  mirrorTargetWords?: number;   // rolling median of the buyer's last messages (optional)
}

export interface LintResult {
  ok: boolean;
  violations: string[];
}

const SHORT_MAX_SENTENCES = 3;
const SHORT_MAX_WORDS = 35;
const LONG_MAX_WORDS = 120;

/** Sentence split that survives multilingual punctuation (., !, ?, ¿…). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Interrogative SENTENCES (not '?' characters — "17:00?" mid-list is one). */
export function countQuestionSentences(text: string): number {
  return splitSentences(text).filter((s) => /[?？]\s*$/.test(s) || /^[¿]/.test(s)).length;
}

/** The length law (§10 B1) + question discipline (§10 B2). */
export function lintDraft(draft: string, opts: LintOptions = {}): LintResult {
  const violations: string[] = [];
  const sentences = splitSentences(draft);
  const words = countWords(draft);

  if (opts.allowLongForm) {
    if (words > LONG_MAX_WORDS) violations.push(`too_long:${words}w>${LONG_MAX_WORDS}w`);
  } else {
    if (sentences.length > SHORT_MAX_SENTENCES) violations.push(`too_many_sentences:${sentences.length}>${SHORT_MAX_SENTENCES}`);
    if (words > SHORT_MAX_WORDS) violations.push(`too_long:${words}w>${SHORT_MAX_WORDS}w`);
  }
  // Mirroring band: never more than 1.5x the buyer's own typical length
  // (floor of one short sentence always allowed).
  if (opts.mirrorTargetWords && opts.mirrorTargetWords >= 8 && words > Math.ceil(opts.mirrorTargetWords * 1.5) && !opts.allowLongForm) {
    violations.push(`mirror_band:${words}w>${Math.ceil(opts.mirrorTargetWords * 1.5)}w`);
  }
  if (countQuestionSentences(draft) > 1) violations.push('multiple_questions');
  return { ok: violations.length === 0, violations };
}

// ── Banned-pattern screen (§10 B5) — deterministic ES/EN core; other languages
// go through the LLM-judge tier at P1+ (a 13-language regex lexicon is
// unmaintainable false confidence — v1.2 review). Patterns are urgency/scarcity/
// guilt/fake-deadline classes; matching is case-insensitive on normalized text.
const BANNED_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'urgency_last_chance',   re: /\b(last chance|final chance|now or never|última oportunidad|ultima oportunidad)\b/i },
  { id: 'scarcity_wont_last',    re: /\b(won'?t last|will be gone|no durar[áa]|va a volar|se va a ir r[áa]pido)\b/i },
  { id: 'scarcity_other_buyers', re: /\b(many (other )?interested (buyers|people)|lots of interest|otros interesados|mucha gente interesada|muchos compradores)\b/i },
  { id: 'pressure_act_now',      re: /\b(act now|buy now|decide today|reserve today|act[úu]a ya|compra ya|decide hoy|reserva hoy)\b/i },
  { id: 'guilt_no_reply',        re: /\b(you (still )?haven'?t (replied|responded|answered)|no (me )?has (respondido|contestado))\b/i },
  { id: 'fake_deadline',         re: /\b(offer (ends|expires)|only (today|this week)|price goes up|solo (hoy|esta semana)|la oferta (termina|caduca)|el precio subir[áa])\b/i },
];

// ── Deliver-now law: Amanda may not promise HER OWN future delivery ("I'll come
// right back with options") — she acts inside this reply or offers and asks.
// The OFFICE promising to come back is legitimate (§3b — the ticket machinery
// keeps that promise), so drafts naming the office/team are exempt.
const SELF_FUTURE_PROMISE: RegExp[] = [
  /\b(i(?:'ll| will)|let me)\s+(?:get|come|be|circle)\s+(?:right\s+)?back(?:\s+to\s+you)?[^.!?]{0,40}\bwith\b/i,
  /\b(?:kommer|er)\s+(?:straks|snart)\s+tilbake(?:\s+til\s+deg)?\s+med\b/i,                    // no/da
  /\bsender\s+(?:deg|dere)\b[^.!?]{0,50}\b(?:straks|snart|om litt)\b/i,                          // no/da
  /\bkommer\s+tillbaka\s+(?:strax|snart)\s+med\b|\bskickar\s+(?:dig|er)\b[^.!?]{0,40}\b(?:strax|snart)\b/i, // sv
  /\b(?:te|os)\s+(?:env[ií]o|mando|paso)\b[^.!?]{0,50}\b(?:enseguida|ahora mismo|en un momento|pronto)\b/i,     // es
  /\bmelde mich\s+(?:gleich|bald)\s+mit\b|\bschicke dir\s+(?:gleich|bald)\b/i,                 // de
  /\bkom\s+(?:zo|straks)\s+(?:bij je\s+)?terug\s+met\b|\bstuur je\s+(?:zo|straks)\b/i,       // nl
  /\b(?:coming|getting)\s+(?:right\s+)?back\s+(?:to you\s+)?(?:shortly|soon|right away)\s+with\b/i,
];
const OFFICE_EXEMPT_RE = /\b(office|team|kontoret?|oficina|equipo|b[üu]ro|kantoor|the agency|byr[åa]et)\b/i;

export function screenBannedPatterns(draft: string): { ok: boolean; matched: string[] } {
  // Curly apostrophes (what phones actually type) must match the ASCII patterns.
  const normalized = draft.replace(/[’‘]/g, "'");
  const matched = BANNED_PATTERNS.filter((p) => p.re.test(normalized)).map((p) => p.id);
  if (!OFFICE_EXEMPT_RE.test(normalized) && SELF_FUTURE_PROMISE.some((re) => re.test(normalized))) {
    matched.push('self_future_promise_PRESENT_YOUR_RESULTS_NOW_instead');
  }
  return { ok: matched.length === 0, matched };
}

// ── Payments/IBAN platform floor (§11.5) — Amanda NEVER transmits bank details.
// IBANs are structurally detectable in every language; also catch long account-
// number runs next to transfer/payment/deposit vocabulary. Existential guard —
// one spoofed "here's the IBAN" ends the product. Blocks OUTBOUND drafts.
const IBAN_RE = /\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]{4}){3,8}(?:\s?[A-Z0-9]{1,3})?\b/;
const PAYMENT_WORDS_RE = /\b(iban|transfer|transferencia|deposit|dep[óo]sito|bizum|swift|bic|account number|n[úu]mero de cuenta|wire|pago por adelantado|überweisung|overboeking|payment to)\b/i;
const LONG_DIGIT_RUN_RE = /\d[\d\s-]{14,}\d/;

export function screenPaymentDetails(draft: string): { ok: boolean; reason: string | null } {
  const compact = draft.replace(/[ ]/g, ' ');
  if (IBAN_RE.test(compact.toUpperCase())) return { ok: false, reason: 'iban_detected' };
  if (PAYMENT_WORDS_RE.test(compact) && LONG_DIGIT_RUN_RE.test(compact)) {
    return { ok: false, reason: 'account_number_near_payment_words' };
  }
  return { ok: true, reason: null };
}

// ── Cooldown clock (§10 B5): refuse uninvited sends within the window of the
// last outbound. Invited = replying to a fresh inbound, delivering a promised
// office answer, correcting an error, or finishing a deliberately split message.
export const COOLDOWN_MS = 20 * 60_000;

export function cooldownOk(lastOutboundAtMs: number | null, nowMs: number, invited: boolean): boolean {
  if (invited) return true;
  if (lastOutboundAtMs === null) return true;
  return nowMs - lastOutboundAtMs >= COOLDOWN_MS;
}

/** The combined send-path law: everything a draft must clear (§10 B7). */
export function validateDraft(draft: string, opts: LintOptions = {}): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const lint = lintDraft(draft, opts);
  violations.push(...lint.violations);
  const banned = screenBannedPatterns(draft);
  if (!banned.ok) violations.push(...banned.matched.map((m) => `banned:${m}`));
  const pay = screenPaymentDetails(draft);
  if (!pay.ok) violations.push(`payment_floor:${pay.reason}`);
  return { ok: violations.length === 0, violations };
}
