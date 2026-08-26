// Amanda engine — grounding gates for the WhatsApp draft (design §2, rebuilt
// for chat): a deterministic turn classifier decides WHICH gates run (social
// turns are never fact-checked into evasiveness), numeric grounding checks
// property-fact numbers against the tool data the model actually fetched, and
// the independent verifier (injected — Haiku in production, scripted in tests)
// runs only on fact-bearing turns. Fail → ONE constrained regeneration → human.

import type { ToolEvent } from './tools';

export type TurnClass = 'social' | 'fact_bearing';

// Fact-bearing: any digits, currency, size units, or a listing-ref shape.
// Everything else — greetings, warmth, scheduling chatter without numbers —
// bypasses the verifier (design §2 false-block budget).
const FACT_RE = /\d|€|m²|m2\b|sqm/i;

export function classifyDraft(draft: string): TurnClass {
  return FACT_RE.test(draft) ? 'fact_bearing' : 'social';
}

/** Every number token in the corpus of everything the model fetched this turn. */
export function fetchedNumberTokens(toolEvents: ToolEvent[]): Set<string> {
  const set = new Set<string>();
  for (const ev of toolEvents) {
    if (ev.result.refused || ev.result.data == null) continue;
    const corpus = JSON.stringify(ev.result.data);
    for (const m of corpus.match(/\d+/g) ?? []) set.add(m);
    for (const m of corpus.match(/\d[\d.,]*\d/g) ?? []) set.add(m.replace(/[.,]/g, ''));
  }
  return set;
}

// Property-fact number patterns (mirrors the proven web-Amanda guard): prices,
// sizes, room counts. Times/dates are NOT gated — the slot echo is authoritative
// via pending-action state, and "17:00" would never be in listing data.
const PROPERTY_NUMBER_PATTERNS = [
  /(?:€|£|\$)\s?(\d[\d.,]*)/gi,
  /(\d[\d.,]*)\s?(?:€|£|euros?|eur\b)/gi,
  /(\d[\d.,]*)\s?(?:m²|m2\b|sqm|square\s?met\w*)/gi,
  /(\d+)\s?(?:\+\s?)?(?:bed|bedroom|bath|bathroom|dormitor|habitac|slaapkamer|schlafzimmer|soverom|sovrum|makuuhuone)/gi,
];

/** Deterministic numeric grounding: a stated property-fact number must exist in
 *  something the model actually fetched this turn. No tool data + a property
 *  number stated = ungrounded by definition. */
export function draftNumbersGrounded(draft: string, toolEvents: ToolEvent[]): { ok: boolean; offending: string[] } {
  const tokens = fetchedNumberTokens(toolEvents);
  const offending: string[] = [];
  for (const re of PROPERTY_NUMBER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(draft)) !== null) {
      const raw = m[1];
      const clean = raw.replace(/[.,]/g, '');
      if (!tokens.has(raw) && !tokens.has(clean)) offending.push(raw);
    }
  }
  return { ok: offending.length === 0, offending };
}

/** The independent verifier seam: production wires Haiku, tests script it.
 *  Returning false (or throwing) BLOCKS — gates fail closed (design §4). */
export type Verifier = (draft: string, toolEvents: ToolEvent[]) => Promise<boolean>;

export interface GateResult {
  ok: boolean;
  turnClass: TurnClass;
  failures: string[];
}

export async function runGates(draft: string, toolEvents: ToolEvent[], verifier: Verifier | null): Promise<GateResult> {
  const turnClass = classifyDraft(draft);
  const failures: string[] = [];
  if (turnClass === 'social') return { ok: true, turnClass, failures };

  const numeric = draftNumbersGrounded(draft, toolEvents);
  if (!numeric.ok) failures.push(`ungrounded_numbers:${numeric.offending.join('|')}`);

  if (verifier) {
    try {
      if (!(await verifier(draft, toolEvents))) failures.push('verifier_rejected');
    } catch {
      failures.push('verifier_unavailable');   // fail closed: no verifier, no fact-bearing send
    }
  }
  return { ok: failures.length === 0, turnClass, failures };
}
