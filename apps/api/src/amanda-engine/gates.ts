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

// TYPED grounding (reviewer-hardened): each property-fact number class grounds
// ONLY against its authoritative STRUCTURED fields across everything fetched
// this turn — never against arbitrary digits in listing prose, or an injected
// "now dropped to 199000" inside a description would launder a fake price.
const FIELD_KEYS: Record<'price' | 'size' | 'rooms', RegExp> = {
  price: /^(price|price_currency|min_price|max_price)$/i,
  size:  /^(area_sqm|area_built_sqm|area_plot_sqm|size_sqm)$/i,
  rooms: /^(bedrooms|bathrooms|min_bedrooms)$/i,
};

function harvest(value: unknown, keyClass: RegExp, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) harvest(v, keyClass, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keyClass.test(k) && (typeof v === 'number' || typeof v === 'string')) {
        const s = String(v);
        for (const m of s.match(/\d+/g) ?? []) out.add(m);
        const collapsed = s.replace(/[.,\s]/g, '');
        if (/^\d+$/.test(collapsed)) out.add(collapsed);
      }
      harvest(v, keyClass, out);
    }
  }
}

/** Structured tokens per fact class from everything fetched this turn. */
export function fetchedFieldTokens(toolEvents: ToolEvent[]): Record<'price' | 'size' | 'rooms', Set<string>> {
  const sets = { price: new Set<string>(), size: new Set<string>(), rooms: new Set<string>() };
  for (const ev of toolEvents) {
    if (ev.result.refused || ev.result.data == null) continue;
    for (const cls of ['price', 'size', 'rooms'] as const) harvest(ev.result.data, FIELD_KEYS[cls], sets[cls]);
  }
  return sets;
}

// Times/dates are NOT gated — the slot echo is authoritative via pending-action
// state, and "17:00" never appears in listing fields.
const PROPERTY_NUMBER_PATTERNS: Array<{ cls: 'price' | 'size' | 'rooms'; re: RegExp }> = [
  { cls: 'price', re: /(?:€|£|\$)\s?(\d[\d.,]*)/gi },
  { cls: 'price', re: /(\d[\d.,]*)\s?(?:€|£|euros?|eur\b)/gi },
  { cls: 'size',  re: /(\d[\d.,]*)\s?(?:m²|m2\b|sqm|square\s?met\w*)/gi },
  { cls: 'rooms', re: /(\d+)\s?(?:\+\s?)?(?:bed|bedroom|bath|bathroom|dormitor|habitac|slaapkamer|schlafzimmer|soverom|sovrum|makuuhuone)/gi },
];

/** Deterministic numeric grounding: a stated property-fact number must exist in
 *  the matching STRUCTURED field of something fetched this turn. No tool data +
 *  a property number stated = ungrounded by definition. */
export function draftNumbersGrounded(draft: string, toolEvents: ToolEvent[]): { ok: boolean; offending: string[] } {
  const sets = fetchedFieldTokens(toolEvents);
  const offending: string[] = [];
  for (const { cls, re } of PROPERTY_NUMBER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(draft)) !== null) {
      const raw = m[1];
      const clean = raw.replace(/[.,]/g, '');
      if (!sets[cls].has(raw) && !sets[cls].has(clean)) offending.push(raw);
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
