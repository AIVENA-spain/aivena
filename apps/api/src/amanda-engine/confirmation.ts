// Amanda engine — deterministic booking-confirmation detection (design §4:
// "book executes only when exactly ONE unexpired pending action exists, the
// inbound affirms it, and no newer inbound modifies it; multiple/expired/
// unclear → re-ask, never guess"). Buttons are the preferred path (postback =
// pending_action_id); this text fallback is deliberately CONSERVATIVE — a miss
// re-asks, which is annoying; a false positive books the wrong Saturday.

const AFFIRMATIVES: Record<string, string[]> = {
  en: ['yes', 'yes please', 'ok', 'okay', 'sure', 'perfect', 'sounds good', 'confirm', 'confirmed', 'that works', 'deal', 'great'],
  es: ['si', 'sí', 'vale', 'ok', 'perfecto', 'confirmo', 'confirmado', 'de acuerdo', 'me va bien', 'genial', 'claro'],
  de: ['ja', 'ok', 'passt', 'perfekt', 'einverstanden', 'gerne', 'bestätigt'],
  nl: ['ja', 'ok', 'prima', 'perfect', 'akkoord', 'graag', 'is goed'],
  fr: ['oui', 'ok', 'parfait', 'd\'accord', 'je confirme', 'ça marche'],
  it: ['si', 'sì', 'ok', 'perfetto', 'va bene', 'confermo', 'd\'accordo'],
  pt: ['sim', 'ok', 'perfeito', 'confirmo', 'combinado', 'está bem', 'esta bem'],
  sv: ['ja', 'ok', 'perfekt', 'det funkar', 'absolut', 'gärna'],
  nb: ['ja', 'ok', 'perfekt', 'det passer', 'gjerne', 'greit'],
  da: ['ja', 'ok', 'perfekt', 'det passer', 'gerne', 'fint'],
  fi: ['kyllä', 'kylla', 'joo', 'ok', 'sopii', 'täydellistä', 'taydellista'],
  pl: ['tak', 'ok', 'pasuje', 'świetnie', 'swietnie', 'potwierdzam', 'zgoda'],
  ru: ['да', 'ок', 'хорошо', 'подтверждаю', 'отлично', 'договорились'],
};

const NEGATIVES = [
  'no', 'not', 'nope', 'can\'t', 'cannot', 'cant', 'rather', 'instead', 'other', 'change', 'different',
  'mejor', 'otro', 'otra', 'cambiar', 'nein', 'lieber', 'anders', 'nee', 'liever', 'non', 'plutot', 'plutôt',
  'nej', 'nei', 'heller', 'ei', 'nie', 'inny', 'нет', 'лучше', 'другое',
];

// A time/date fragment inside an "affirmation" means the buyer is MODIFYING,
// not confirming ("yes but Sunday", "ok at 18 instead") — re-ask, never guess.
const MODIFIER_RE = /\d{1,2}[:.h]\d{0,2}|\b(am|pm)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b|\b(tomorrow|manana|mañana|today|hoy|next week|otra semana)\b/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[!.…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ConfirmationVerdict = 'affirm' | 'decline' | 'unclear';

/**
 * Conservative text-affirmation check. Only 'affirm' may execute a pending
 * action, and only when the deterministic caller has verified there is exactly
 * ONE unexpired pending action and no newer modifying inbound.
 */
export function detectConfirmation(text: string, lang: string | null): ConfirmationVerdict {
  const t = normalize(text);
  if (!t || t.length > 60) return 'unclear';           // long messages are never bare confirmations
  if (MODIFIER_RE.test(t)) return 'unclear';           // "yes but Sunday" modifies
  const words = t.split(/\s+/);
  if (words.some((w) => NEGATIVES.includes(w))) return 'decline';
  const lexicons = lang && AFFIRMATIVES[lang] ? [AFFIRMATIVES[lang], AFFIRMATIVES.en] : Object.values(AFFIRMATIVES);
  for (const lex of lexicons) {
    if (lex.includes(t)) return 'affirm';
    // "yes please!" / "vale genial" — every word affirmative-ish, max 3 words
    if (words.length <= 3 && words.every((w) => lex.includes(w) || ['please', 'por', 'favor', 'thanks', 'gracias'].includes(w)) && words.some((w) => lex.includes(w))) {
      return 'affirm';
    }
  }
  return 'unclear';
}
