// Amanda engine — deterministic send-path validators (design §10: "the prompt
// is aspiration; the validators are law"). Every outbound draft passes these
// before it can send or even queue as a draft; failures regenerate with feedback
// (max 2 retries) and then fall to the human queue. Pure — no db, fully tested.

export interface LintOptions {
  allowLongForm?: boolean;      // broad question / re-engagement / property summary / relay-with-context
  longFormBudget?: number;      // word cap for THIS long-form turn (medium vs full)
  mirrorTargetWords?: number;   // rolling median of the buyer's last messages (optional)
  /** Lead's language code (raw, e.g. 'no'/'nb'/'pt-BR') — when set and not
   *  English, an English-drift draft is a violation (live demo 2026-08-27:
   *  the prompt fell back to English on the unmapped 'no' and the model
   *  eventually obeyed it mid-conversation). */
  expectedLanguage?: string;
  /** Office-promise law: 'I'll check with the office' is legal ONLY when the
   *  machinery will keep the promise — an ask_agency call succeeded this turn,
   *  a ticket is already open, or an office answer is being relayed. Pass
   *  false to enforce; undefined skips (pure-lint callers/tests). */
  officeContextPresent?: boolean;
}

export interface LintResult {
  ok: boolean;
  violations: string[];
}

const SHORT_MAX_SENTENCES = 3;
export const SHORT_MAX_WORDS = 35;
export const LONG_MAX_WORDS = 120;
/**
 * The MIDDLE budget (Christian 2026-08-29: "she answered way too long and not
 * really confident warm"). Widening long-form to cover research and search was
 * right — but it handed those turns the full 120-word property-summary budget,
 * and she wrote a report with bullet points. A researched answer with a couple
 * of matches is a chat message, not a brochure: room for the answer, two homes
 * and one next step, and no more.
 */
export const MEDIUM_MAX_WORDS = 65;
const MEDIUM_MAX_SENTENCES = 5;

/** Sentence split that survives multilingual punctuation (., !, ?, ¿…).
 *  A full stop after a number or a common abbreviation is NOT a sentence end
 *  when the text carries on in lower case or digits: Nordic, German and Finnish
 *  dates and times ("fredag 28. august kl. 17:00", "21.9. klo 11.00") used to
 *  count as three or four sentences and trip the shape law — which, once
 *  proposed times had to be shown with their day (2026-09-19), would have
 *  punished exactly the replies that get it right. */
// German capitalises months: "21. September" continues the sentence.
const GERMAN_MONTH_RE = /^(?:Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?![\p{L}])/u;
const SOFT_STOP_RE = /(?:\d|(?:^|[\s(])(?:kl|klo|ca|cca|nr|bl\.a|f\.eks|osv|mv|dvs|evt|inkl|st|dr|mr|mrs|ms|z\.b|u\.a|ggf|bzw|usw|etc|vs|approx|sr|sra|p\.ex|n[ºo]))\.$/iu;
export function splitSentences(text: string): string[] {
  const parts = text.split(/(\n+|(?<=[.!?…])\s+)/u);
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < parts.length; i += 2) {
    cur += parts[i] ?? '';
    const sep = parts[i + 1];
    const next = parts[i + 2] ?? '';
    const continues = /^[\p{Ll}\p{N}]/u.test(next) || (/\d\.$/.test(cur) && GERMAN_MONTH_RE.test(next));
    if (sep !== undefined && !/\n/.test(sep) && SOFT_STOP_RE.test(cur) && continues) {
      cur += sep;
      continue;
    }
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Interrogative SENTENCES (not '?' characters — "17:00?" mid-list is one). */
export function countQuestionSentences(text: string): number {
  return splitSentences(text).filter((s) => /[?？]\s*$/.test(s) || /^[¿]/.test(s)).length;
}

/**
 * SHAPE vs TRUTH (Christian 2026-08-29, live: "she should have been able to
 * just make a search and find this out herself").
 *
 * She DID. She researched the Norwegian school, wrote a correct 42-word answer,
 * and the 35-word cap binned it — so the buyer got "a colleague will
 * double-check" and Christian got a take-over card for a question Amanda had
 * already answered. A correct answer was destroyed for being seven words long.
 *
 * These violations are about SHAPE. They are fixable by trimming, and a draft
 * that fails ONLY these must never be escalated to a human — it must be cut to
 * length and sent. Everything NOT on this list (ungrounded numbers, verifier
 * rejection, wrong language, banned patterns, payment floor, unfiled office
 * promise) is about TRUTH or SAFETY, where killing the draft is correct.
 */
const SHAPE_ONLY_PREFIXES = ['too_long:', 'too_many_sentences:', 'mirror_band:', 'multiple_questions'];

export function isShapeOnly(violations: string[]): boolean {
  return violations.length > 0 && violations.every((v) => SHAPE_ONLY_PREFIXES.some((p) => v.startsWith(p)));
}

/**
 * Deterministic trim to a word budget. Keeps WHOLE sentences from the front —
 * Amanda answers first, so the front is the substance — and never emits a
 * truncated fragment: if even the first sentence is over budget it is kept
 * intact. Removes text only; it can never introduce a fact.
 */
export function trimToBudget(text: string, maxWords: number): string {
  if (countWords(text) <= maxWords) return text;
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text;
  const kept: string[] = [];
  let used = 0;
  for (const sentence of sentences) {
    const w = countWords(sentence);
    if (kept.length > 0 && used + w > maxWords) break;
    kept.push(sentence);
    used += w;
  }
  return kept.join(' ').trim();
}

/** The length law (§10 B1) + question discipline (§10 B2). */
export function lintDraft(draft: string, opts: LintOptions = {}): LintResult {
  const violations: string[] = [];
  const sentences = splitSentences(draft);
  const words = countWords(draft);

  if (opts.allowLongForm) {
    const cap = opts.longFormBudget ?? LONG_MAX_WORDS;
    if (words > cap) violations.push(`too_long:${words}w>${cap}w`);
    // The middle tier keeps its sentence discipline too — 65 words spread over
    // nine clipped lines still reads as a report, not a person.
    if (cap <= MEDIUM_MAX_WORDS && sentences.length > MEDIUM_MAX_SENTENCES) {
      violations.push(`too_many_sentences:${sentences.length}>${MEDIUM_MAX_SENTENCES}`);
    }
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

// ── Deliver-now law: Amanda may not promise HER OWN future action ("I'll come
// right back with options", "let me check and get back to you") — nothing in the
// system can perform it (no follow-up engine is scheduled; Christian 2026-09-19:
// "offer now or don't promise"). She acts inside this reply, or offers and asks.
// A promise made on behalf of the OFFICE is legitimate only when the ticket
// machinery will keep it (§3b; the office-promise law checks that a ticket
// exists), so a sentence that names the office/team is judged by that law.
//
// 2026-09-19 live miss: the old fixed-word-order list caught 2 of 9 natural
// phrasings. "…så kommer JEG straks tilbake med tider" slipped because Norwegian
// puts the verb before the subject after "så". These patterns allow the subject
// on either side of the verb, a few words in between, and subject-dropped
// sentence starts, across all 13 supported languages. First person only: "a
// colleague will reply to you" (a human action) and "when you come back to
// Spain" (the buyer) are not promises by Amanda.
const UW = String.raw`[\p{L}\p{N}_]`;
// \b is ASCII-only in JS; these edges work next to ø, ę, ü, Cyrillic.
const uni = (src: string): RegExp =>
  new RegExp(src.replace(/\\b/g, String.raw`(?:(?<!${UW})(?=${UW})|(?<=${UW})(?!${UW}))`), 'iu');
const GAP = String.raw`(?:\s+[^\s.!?]+){0,3}?`;           // up to 3 words
const SPAN = String.raw`[^.!?\n]{0,50}?`;                  // same sentence, short reach
const FUTURE_PROMISE: Record<string, RegExp[]> = {
  en: [
    uni(String.raw`\b(?:i'll|i will|i shall|we'll|we will|let me|i'm going to|i am going to)\b${SPAN}\b(?:come|get|circle|be|report|write|return)\s+(?:(?:straight|right|directly)\s+)?back\b`),
    uni(String.raw`\bget back to you\b|\breturn to you\b`),
    uni(String.raw`\b(?:come|get|circle|report|write)\s+(?:(?:straight|right)\s+)?back\s+to\s+you\b`),
    uni(String.raw`\b(?:i'm|i am|we're|we are)\s+(?:coming|getting)\s+(?:(?:straight|right)\s+)?back\b`),
    uni(String.raw`\b(?:i'll|i will|we'll|we will)${GAP}\s+(?:let you know|update you|keep you posted|follow up|reach out|be in touch|drop you a line|revert)\b`),
    uni(String.raw`\b(?:i'll|i will|we'll|we will)${GAP}\s+(?:send|text|message|email)\b${SPAN}\b(?:later|shortly|soon|in a (?:bit|moment|minute|while)|as soon as|once i)\b`),
  ],
  es: [
    uni(String.raw`\b(?:vuelvo|volveré|regreso)\b${SPAN}\b(?:contigo|con usted|con (?:la|las|los|el|una|unos|unas)\b|a escribirte|a contactarte|enseguida|en seguida|pronto)`),
    uni(String.raw`\b(?:te|le|os|les)\s+(?:escribiré|avisaré|responderé|contestaré|contactaré|diré|confirmaré)\b`),
    uni(String.raw`\bme pondré en contacto\b|\b(?:me pongo|nos ponemos) en contacto\b${SPAN}\b(?:enseguida|pronto|luego|más tarde)\b`),
    uni(String.raw`\b(?:te|le|os|les)\s+(?:respondo|contesto|escribo|aviso|confirmo|digo algo|cuento)\b${SPAN}\b(?:enseguida|en seguida|luego|más tarde|pronto|en breve|en un (?:momento|rato)|cuanto antes)\b`),
    uni(String.raw`\b(?:te|le|os|les)\s+(?:envío|mando|paso|enviaré|mandaré|pasaré)\b${SPAN}\b(?:enseguida|en seguida|luego|más tarde|pronto|en breve|en un (?:momento|rato))\b`),
  ],
  de: [
    uni(String.raw`\b(?:ich|wir)\b${GAP}\s+(?:melde|melden)\s+(?:mich|uns)\b|\b(?:melde|melden)\s+(?:ich|wir)\s+(?:mich|uns)\b`),
    uni(String.raw`\b(?:ich|wir)\b${GAP}\s+(?:komme|kommen)\b${SPAN}\bzurück\b|\b(?:komme|kommen)\s+(?:ich|wir)\b${SPAN}\bzurück\b`),
    uni(String.raw`\b(?:gebe|geben|sage|sagen)\s+(?:ich\s+|wir\s+)?(?:dir|ihnen|euch)\b${GAP}\s+bescheid\b`),
    uni(String.raw`\b(?:schicke|sende|schicken|senden)\s+(?:ich\s+|wir\s+)?(?:dir|ihnen|euch)\b${SPAN}\b(?:gleich|bald|später|nachher|in kürze)\b`),
    uni(String.raw`\b(?:rückmeldung|antwort)\s+von\s+(?:mir|uns)\b|\bvon\s+(?:mir|uns)\b${GAP}\s+(?:rückmeldung|antwort)\b`),
    uni(String.raw`\b(?:komme|kommen)\b${SPAN}\bauf\s+(?:dich|sie|euch)\s+zurück\b`),
  ],
  nl: [
    uni(String.raw`\b(?:kom|komen)\s+(?:ik|we|wij)\b${SPAN}\bterug\b|\b(?:ik|we|wij)\b${GAP}\s+(?:kom|komen)\b${SPAN}\bterug\b`),
    uni(String.raw`\b(?:laat|laten)\s+(?:ik\s+|we\s+|wij\s+)?(?:het\s+)?(?:je|jou|u|jullie)\b${GAP}\s+(?:weten|horen)\b|\b(?:ik|we|wij)\s+laat\b${SPAN}\b(?:weten|horen)\b`),
    uni(String.raw`\b(?:stuur|sturen)\s+(?:ik\s+|we\s+|wij\s+)?(?:je|jou|u|jullie)\b${SPAN}\b(?:zo|straks|later|zo snel mogelijk|zo spoedig mogelijk)\b`),
    uni(String.raw`\b(?:ik|we|wij)\s+neem\w*\b${SPAN}\bcontact\b|\bneem\s+(?:ik|we)\b${SPAN}\bcontact\b`),
    uni(String.raw`\bkom\w*\b${SPAN}\bbij\s+(?:je|jou|u|jullie)\s+(?:op\s+)?terug\b`),
  ],
  fr: [
    uni(String.raw`\bje\s+(?:vous|te)\s+(?:recontacte|recontacterai|rappelle|rappellerai|réécris|réécrirai|redis|redirai|fais signe|ferai signe|tiens (?:au courant|informée?)|tiendrai (?:au courant|informée?))\b`),
    uni(String.raw`\bje\s+(?:reviens|reviendrai|repasse)\s+vers\s+(?:vous|toi)\b|\bje\s+(?:reviens|reviendrai)\b${SPAN}\b(?:rapidement|tout de suite|très vite|vite|bientôt|avec)\b`),
    uni(String.raw`\b(?:je|nous)\s+(?:vous|te)\s+(?:envoie|enverrai|envoyons|enverrons|transmets|transmettrai)\b${SPAN}\b(?:rapidement|tout de suite|très vite|plus tard|bientôt|dans (?:la journée|un instant|un moment))\b`),
  ],
  it: [
    uni(String.raw`\b(?:ti|le|vi)\s+(?:faccio|farò|facciamo|faremo)\s+sapere\b`),
    uni(String.raw`\b(?:ti|la|vi)\s+(?:ricontatto|ricontatterò|richiamo|richiamerò|riscrivo|riscriverò|aggiorno|aggiornerò)\b`),
    uni(String.raw`\b(?:ti|le|vi)\s+(?:rispondo|risponderò|scrivo|scriverò|mando|manderò|invio|invierò)\b${SPAN}\b(?:subito|a breve|appena|presto|più tardi|dopo|tra poco)\b`),
    uni(String.raw`\btorno\s+(?:da te|da lei|subito|a breve|con)\b|\bmi faccio (?:vivo|viva|sentire)\b`),
  ],
  pt: [
    uni(String.raw`\b(?:volto|voltarei|regresso)\b${SPAN}\b(?:já|logo|em breve|com|contigo|a falar|a escrever)\b`),
    uni(String.raw`\b(?:entro|entrarei|entramos|entraremos)\s+em\s+(?:contacto|contato)\b`),
    uni(String.raw`\b(?:te|lhe|vos)\s+(?:digo|direi|aviso|avisarei|informo|informarei|respondo|responderei|escrevo|escreverei|envio|enviarei|mando|mandarei)\b${SPAN}\b(?:já|logo|em breve|mais tarde|depois|assim que)\b`),
    uni(String.raw`\bdou-?(?:te|lhe)\s+notícias\b|\bdarei notícias\b`),
    uni(String.raw`\b(?:aviso|avisarei|digo|direi|informo|informarei|respondo|responderei|escrevo|escreverei)-(?:te|lhe|vos)\b|\b(?:envio|enviarei|mando|mandarei)-(?:te|lhe|vos)\b${SPAN}\b(?:já|logo|em breve|mais tarde|depois|assim que)\b`),
  ],
  pl: [
    uni(String.raw`\bwrócę\b|\bwracam\s+(?:z|do|niedługo|zaraz|za chwilę)\b`),
    uni(String.raw`\bodezwę się\b|\bodpiszę\b|\bskontaktuję się\b|\bdam\s+(?:ci\s+|pani\s+|panu\s+|państwu\s+)?znać\b`),
    uni(String.raw`\b(?:prześlę|wyślę|podeślę)\b${SPAN}\b(?:później|zaraz|wkrótce|niedługo|za chwilę)\b`),
  ],
  sv: [
    uni(String.raw`\båterkommer\b(?!\s+(?:du|ni)\b)`),
    uni(String.raw`\b(?:kommer|återvänder)\b${SPAN}\btillbaka\s+till\s+(?:dig|er)\b`),
    uni(String.raw`\b(?:kommer|återvänder)\s+(?:jag|vi)\b${SPAN}\btillbaka\b|\b(?:jag|vi)\b${GAP}\s+(?:kommer|återvänder)\b${SPAN}\btillbaka\b|^\s*kommer\s+(?:tillbaka|strax|snart)\b`),
    uni(String.raw`\bhör\s+(?:jag\s+|vi\s+)?av\s+(?:mig|oss)\b|\b(?:ger|meddelar)\s+(?:jag\s+|vi\s+)?(?:dig|er)\s+(?:besked|veta)\b|\b(?:jag|vi)\s+(?:ger|meddelar)\s+(?:dig|er)\b`),
    uni(String.raw`\b(?:skickar|mejlar)\s+(?:jag\s+|vi\s+)?(?:dig|er)?\b${SPAN}\b(?:strax|snart|senare|om en stund)\b|\b(?:jag|vi)\s+tar\s+kontakt\b|\btar\s+(?:jag|vi)\s+kontakt\b`),
  ],
  nb: [
    uni(String.raw`\b(?:kommer|vender)\s+(?:jeg|vi)\b${SPAN}\btilbake\b|\b(?:jeg|vi)\b${GAP}\s+(?:kommer|vender)\b${SPAN}\btilbake\b|^\s*(?:kommer|vender)\s+(?:straks\s+|snart\s+)?tilbake\b`),
    uni(String.raw`\b(?:gir|sender)\s+(?:jeg\s+|vi\s+)?(?:deg|dere)\s+(?:\S+\s+)?(?:beskjed|svar)\b|\b(?:jeg|vi)\s+(?:gir|sender)\s+(?:deg|dere)\s+(?:\S+\s+)?(?:beskjed|svar)\b`),
    uni(String.raw`\b(?:sender|mailer)\s+(?:jeg\s+|vi\s+)?(?:deg\s+|dere\s+)?${SPAN}\b(?:straks|snart|senere|om litt|etterpå)\b`),
    uni(String.raw`\bhører\s+fra\s+(?:meg|oss)\b|\bmelder\s+(?:jeg|vi)\b${GAP}\s+tilbake\b|\b(?:jeg|vi)\b${GAP}\s+melder\b${GAP}\s+tilbake\b|\b(?:jeg|vi)\s+tar\s+kontakt\b|\btar\s+(?:jeg|vi)\s+kontakt\b`),
    uni(String.raw`\b(?:kommer|vender)\b${SPAN}\btilbake\s+til\s+(?:deg|dere)\b`),
  ],
  da: [
    uni(String.raw`\b(?:vender|kommer)\s+(?:jeg|vi)\b${SPAN}\btilbage\b|\b(?:jeg|vi)\b${GAP}\s+(?:vender|kommer)\b${SPAN}\btilbage\b|^\s*(?:vender|kommer)\s+(?:straks\s+|snart\s+)?tilbage\b`),
    uni(String.raw`\b(?:giver|sender)\s+(?:jeg\s+|vi\s+)?(?:dig|jer)\s+(?:\S+\s+)?(?:besked|svar)\b|\b(?:jeg|vi)\s+(?:giver|sender)\s+(?:dig|jer)\s+(?:\S+\s+)?(?:besked|svar)\b`),
    uni(String.raw`\b(?:sender|mailer)\s+(?:jeg\s+|vi\s+)?(?:dig\s+|jer\s+)?${SPAN}\b(?:straks|snart|senere|om lidt|bagefter)\b`),
    uni(String.raw`\bhører\s+fra\s+(?:mig|os)\b|\bmelder\s+(?:jeg|vi)\b${GAP}\s+tilbage\b|\b(?:jeg|vi)\s+tager\s+kontakt\b|\btager\s+(?:jeg|vi)\s+kontakt\b`),
    uni(String.raw`\b(?:kommer|vender)\b${SPAN}\btilbage\s+til\s+(?:dig|jer)\b`),
  ],
  fi: [
    uni(String.raw`\bpalaan\b|\bpalaamme\b|\bilmoitan\b|\bilmoitamme\b`),
    uni(String.raw`\b(?:otan|otamme)\s+(?:sinuun\s+|teihin\s+)?yhteyttä\b`),
    uni(String.raw`\b(?:lähetän|lähetämme|kerron|kerromme)\b${SPAN}\b(?:myöhemmin|pian|kohta|hetken päästä)\b`),
  ],
  ru: [
    uni(String.raw`\b(?:вернусь|вернёмся|вернемся)\b`),
    uni(String.raw`\b(?:сообщу|сообщим|напишу|напишем|отвечу|ответим|свяжусь|свяжемся|перезвоню|отпишусь)\b|\bдам\s+(?:вам\s+|тебе\s+)?знать\b`),
    uni(String.raw`\b(?:пришлю|пришлём|пришлем|отправлю|отправим)\b${SPAN}\b(?:позже|скоро|чуть позже|вскоре)\b`),
  ],
};

/** Languages the deliver-now law covers — every supported language (13). */
export const FUTURE_PROMISE_LANGUAGES = Object.keys(FUTURE_PROMISE);

/**
 * True when a sentence of the draft promises Amanda's own future action. A
 * sentence naming the office/team is left to the office-promise law — except
 * when the caller knows NO ticket exists (officeContextPresent === false):
 * then nothing is keeping that promise either, and it is flagged here too.
 */
export function screenFuturePromise(draft: string, officeContextPresent?: boolean): { ok: boolean; sentence: string | null } {
  const normalized = draft.replace(/[’‘]/g, "'");
  for (const sentence of splitSentences(normalized)) {
    const namesOffice = OFFICE_EXEMPT_RE.test(sentence) || OFFICE_WORD_RE.test(sentence);
    if (namesOffice && officeContextPresent !== false) continue;
    for (const res of Object.values(FUTURE_PROMISE)) {
      if (res.some((re) => re.test(sentence))) return { ok: false, sentence };
    }
  }
  return { ok: true, sentence: null };
}
const OFFICE_EXEMPT_RE = /\b(office|team|kontoret?|oficina|equipo|b[üu]ro|kantoor|the agency|byr[åa]et)\b/i;

// ── Language law: normalize a lead's language code before ANY table lookup —
// the 2026-08-27 live bug: leads store 'no' but the prompt table keyed 'nb',
// so the lookup silently fell back to "Reply in English. Always." Base-code +
// alias handling; unknown codes must NEVER silently become English.
// Aliases may ONLY map to languages AIVENA actually supports. 'cz' → 'cs' and
// 'gr' → 'el' used to live here and were removed: they produced a code that
// passed normalisation but had no dead-air line, no template and no locale
// behind it — a silent fallback to English wearing the costume of a handled
// language, which is the same shape as the bug this table exists to prevent.
// MUST stay identical to the DB trigger normalize_lead_language() (migration
// leads_language_canonical_nb). language-consistency.test.ts asserts they agree —
// 'nob' was added here after that test caught the DB normalising it and this not.
const LANG_ALIASES: Record<string, string> = { no: 'nb', nn: 'nb', nob: 'nb', se: 'sv', dk: 'da' };

/**
 * THE canonical language set for the whole product — the codes AIVENA stores,
 * keys prompts by, names templates with, and offers in the agent roster.
 *
 * Christian 2026-08-31: "we need to make sure that the language codes stay the
 * same through the whole aivena system and doesnt get names wrong ever."
 *
 * The failure this guards is not theoretical. Older tables store Norwegian as
 * 'no' while everything Amanda touches uses 'nb'; that split once sent a
 * Norwegian lead English replies, and it resurfaced in agent selection. The
 * rule is: STORE canonical, and normalise ANY code arriving from a table, a
 * form or a provider through normalizeLeadLanguage before comparing it.
 *
 * A structural test asserts this set matches the dead-air table and the roster
 * picker, so adding a language to one place and forgetting the others fails in
 * CI rather than silently in a buyer's chat.
 */
export const SUPPORTED_LANGUAGES = [
  'en', 'es', 'de', 'nl', 'fr', 'it', 'pt', 'pl', 'sv', 'nb', 'da', 'fi', 'ru',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** True when a code is already canonical (an alias like 'no' is NOT). */
export function isCanonicalLanguage(code: string): code is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code);
}

export function normalizeLeadLanguage(code: string | null | undefined): string | null {
  const base = (code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!base) return null;
  return LANG_ALIASES[base] ?? base;
}

// English-drift detector (deterministic): models drift TO English, so one
// collision-safe marker set suffices. Markers avoid words that are also words
// in our other 12 locales — review-verified prune: no 'will'/'also' (de),
// 'want' (nl), 'just' (sv), 'details'/'apartment'/'bungalow'/'bed'/'double'
// (shared European listing vocabulary).
const ENGLISH_MARKERS = new Set([
  'the', 'you', 'your', 'are', 'with', 'here', 'what', 'would',
  'can', 'not', 'but', 'these', 'both', 'either', 'more', 'keep', 'looking',
  'should', 'about', 'they', 'there', 'which', 'when', 'right',
  'very', 'within', 'listed', 'check', 'currently', 'available',
  'promise', 'newest', 'bath', 'beach', 'quiet',
  'office', 'back', 'their', 'answer', 'shortly', 'again', 'today',
]);

// The 13 supported locales — the drift gate runs only for a KNOWN non-English
// code (an unknown code means we cannot rule out an English-writing buyer).
const KNOWN_LANGS = new Set(['en', 'es', 'de', 'nl', 'fr', 'it', 'pt', 'pl', 'sv', 'nb', 'da', 'fi', 'ru']);

/** Violation when the expected language is NOT English but the draft reads as
 *  English. Thresholds (≥5 distinct markers AND ≥15% marker density) sit far
 *  above any real cross-language collision rate and far below any real English
 *  sentence pair. Short drafts ("Ok!") are skipped. */
export function screenLanguageDrift(draft: string, expectedLanguage?: string): { ok: boolean; expected: string | null } {
  const expected = normalizeLeadLanguage(expectedLanguage);
  if (!expected || expected === 'en' || !KNOWN_LANGS.has(expected)) return { ok: true, expected };
  // Tokenizer keeps Latin (incl. Extended-A for pl) AND Cyrillic word chars —
  // a Russian draft must count its own words in the denominator, or quoted
  // Latin catalogue names alone would trip the gate (review-verified).
  const words = draft.toLowerCase().split(/[^a-zà-ÿßĀ-ſа-яё']+/).filter((w) => w.length > 0);
  if (words.length < 8) return { ok: true, expected };
  const distinct = new Set(words.filter((w) => ENGLISH_MARKERS.has(w)));
  const hits = words.filter((w) => ENGLISH_MARKERS.has(w)).length;
  const drifted = distinct.size >= 5 && hits / words.length >= 0.15;
  return { ok: !drifted, expected };
}

// ── Office-promise law: a sentence that promises checking/confirming with the
// office is legal ONLY when the ticket machinery will keep that promise.
// All 13 locales' office words; 'home office'/'post office' are room/place
// vocabulary, not the agency. Cyrillic alternatives sit OUTSIDE \b — the ASCII
// word boundary never matches next to Cyrillic letters (review-verified).
const OFFICE_WORD_RE = /\b(?:(?<!home )(?<!post )office|kontoret?|oficina|bureau|ufficio|biur\w*|toimisto\w*|escrit[óo]rio|b[üu]ro|kantoor|byr[åa]et|the team|el equipo)\b|офис|бюро|агентств/i;
const CHECK_VERB_RE = /\b(?:check|confirm|ask|verif|v[ée]rif|controll?|chied|pergunt|sprawdz|tarkist|double[-\s]?check|dobbelt?sjekk|dobbelt?tjek|sjekk|bekreft|h[øo]r|sp[øo]r|kollar?\b|dubbelkoll|st[äa]m|tjek|frag|nachfrag|pr[üu]f|kl[äa]re|vraag|navraag|consult|pregunt|comprueb|verific)|провер|уточн|спрош|спрос/i;

export function screenOfficePromise(draft: string, officeContextPresent: boolean): { ok: boolean } {
  if (officeContextPresent) return { ok: true };
  // Questions are OFFERS ("want me to check with the office?") — always legal;
  // only a declarative promise needs the ticket machinery behind it.
  const promised = splitSentences(draft).some(
    (s) => !/[?？]\s*$/.test(s) && !/^[¿]/.test(s) && OFFICE_WORD_RE.test(s) && CHECK_VERB_RE.test(s),
  );
  return { ok: !promised };
}

// ── Tourist-rental legality floor (buyer-research 2026-08-28, "do first"):
// asserting rentability is a LEGAL claim in the Valencia region (2025 rule
// change — the community can veto tourist lets). Amanda may RELAY the office's
// written answer (office-named sentences exempt, §3b) but never assert it
// herself. The prompt carries the routing law; this is the belt for the worst
// assertive phrasings across the main demo locales.
const RENTAL_CLAIM_RE: RegExp[] = [
  /\byou can (?:definitely |certainly |easily |of course )?(?:rent (?:it|this) out|airbnb (?:it|this))\b/i,
  /\bairbnb is (?:allowed|fine|permitted|no problem)\b|\btourist licen[cs]e (?:transfers?|is valid|comes with|is included)\b/i,
  /\bholiday.?let(?:ting)? is (?:allowed|fine|permitted|no problem)\b/i,
  /\bse puede alquilar (?:sin problema|tranquilamente|sin licencia)\b|\bpuedes alquilarlo\b/i,
  /\bdu kan (?:helt sikkert |trygt |enkelt )?leie (?:den|det) ut\b/i,                 // no
  /\bdu kan (?:enkelt )?hyra ut (?:den|det)\b/i,                                      // sv
  /\bdu kannst (?:es|sie) (?:problemlos |einfach )?vermieten\b/i,                     // de
  /\bje kunt het (?:gewoon |zonder problemen )?verhuren\b/i,                          // nl
];

export function screenBannedPatterns(draft: string, officeContextPresent?: boolean): { ok: boolean; matched: string[] } {
  // Curly apostrophes (what phones actually type) must match the ASCII patterns.
  const normalized = draft.replace(/[’‘]/g, "'");
  const matched = BANNED_PATTERNS.filter((p) => p.re.test(normalized)).map((p) => p.id);
  if (!screenFuturePromise(normalized, officeContextPresent).ok) {
    matched.push('self_future_promise_PRESENT_YOUR_RESULTS_NOW_instead');
  }
  if (!OFFICE_EXEMPT_RE.test(normalized) && RENTAL_CLAIM_RE.some((re) => re.test(normalized))) {
    matched.push('rental_legality_claim_ROUTE_TO_ask_agency_never_assert_rentability');
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
  const banned = screenBannedPatterns(draft, opts.officeContextPresent);
  if (!banned.ok) violations.push(...banned.matched.map((m) => `banned:${m}`));
  const pay = screenPaymentDetails(draft);
  if (!pay.ok) violations.push(`payment_floor:${pay.reason}`);
  const lang = screenLanguageDrift(draft, opts.expectedLanguage);
  if (!lang.ok) violations.push(`wrong_language_WRITE_THE_WHOLE_REPLY_IN_${lang.expected}_not_English`);
  if (opts.officeContextPresent === false && !screenOfficePromise(draft, false).ok) {
    violations.push('office_promise_without_filed_question_CALL_ask_agency_or_DROP_the_promise');
  }
  return { ok: violations.length === 0, violations };
}
