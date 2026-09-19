import { describe, it, expect } from 'vitest';
import { GATE_FALLBACK } from './turn';
import { screenFuturePromise, SUPPORTED_LANGUAGES } from './validators';

// The holding line skips the gates, so the rules are proven on it here.
// Christian 2026-09-19 (binding): it states what happened — the message was
// passed to a colleague for review — and promises NOTHING about the future:
// no reply, no time, no speed. It is only sent when the human task exists
// (turn.ts handOver; golden/never-silent-scenarios.test.ts).
const SPEED = /(straight|right away|immediately|straks|strax|enseguida|subito|tout de suite|gleich|sofort|zaraz|heti|сразу|med det samme|med en gang|(?<![\p{L}])já(?![\p{L}])|(?<![\p{L}])zo(?![\p{L}]))/iu;
// A future reply in any of the 13 languages ("will reply", "te responderá"…).
const FUTURE_REPLY = /(will (?:reply|answer|respond|get back)|reply to you|responderá|contestará|antwortet dir|antwoordt|répondra|risponderà|vai responder|responderá|odpowie|svarar dig|svarer (?:deg|dig)|vastaa sinulle|ответят|ответит)/iu;

const REPLACED: Record<string, string> = {
  en: 'Let me double-check that one properly and come straight back to you.',
  nb: 'La meg dobbeltsjekke det ordentlig, så kommer jeg straks tilbake til deg.',
  sv: 'Jag dubbelkollar det ordentligt och återkommer strax.',
  da: 'Lad mig lige tjekke det ordentligt, så vender jeg tilbage med det samme.',
  fi: 'Tarkistan sen kunnolla ja palaan asiaan heti.',
  ru: 'Уточню это как следует и сразу вернусь к вам с ответом.',
  fr: 'Je vérifie cela correctement et je reviens vers vous tout de suite.',
};

describe('holding line — states what happened, promises nothing', () => {
  it.each([...SUPPORTED_LANGUAGES])('%s: no self promise, no speed, no promised reply', (lang) => {
    const line = GATE_FALLBACK[lang];
    expect(line).toBeTruthy();
    expect(screenFuturePromise(line, false).ok).toBe(true);
    expect(line).not.toMatch(SPEED);
    expect(line).not.toMatch(FUTURE_REPLY);
  });

  it('English is exactly the approved wording', () => {
    expect(GATE_FALLBACK.en).toBe("I want to get this exactly right, so I've passed this to a colleague for review.");
  });

  it.each(Object.entries(REPLACED))('%s: the replaced line broke the rule', (_lang, line) => {
    expect(screenFuturePromise(line, false).ok).toBe(false);
  });
});
