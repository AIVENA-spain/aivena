/**
 * Pure text gates for generated Studio copy — no env, no network, no imports from the engine.
 *
 * This module exists so the gates are unit-testable. studio-carousel-plan.ts imports
 * packages/config/env, which calls process.exit(1) on a missing variable; anything that has to be
 * proven by a test therefore cannot live in that file. Everything here is a plain function over
 * strings, so vitest can run it with no environment at all.
 */

/**
 * Trailing connectives and prepositions in the post languages we ship. A body that ends on one of
 * these was cut, and a reader who cannot see the character cap just sees a broken product.
 */
const DANGLING = /\s+(?:and|or|but|so|because|since|while|when|if|although|though|with|without|for|from|to|of|in|on|at|by|as|that|which|than|per|into|onto|about|after|before|y|e|o|u|pero|porque|mientras|cuando|si|aunque|con|sin|para|de|del|en|por|como|que|a|al|sobre|entre|hasta|desde)$/i;

/**
 * Trim a generated field to its cap without ending mid-thought.
 *
 * REGRESSION: a card shipped ending "timelines still vary by court and". The previous version cut at
 * a word boundary, which is not a thought boundary. Order of preference: the last complete sentence
 * inside the budget, then a word cut with any dangling connective removed.
 *
 * Cosmetic failures trim and send — they never fail a generation. Only truth and safety failures
 * escalate, so this has to always return something publishable.
 */
export function trimWords(v: unknown, max: number): unknown {
  if (typeof v !== 'string' || v.length <= max) return v;
  const cut = v.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (end > max * 0.5) return cut.slice(0, end + 1);
  const sp = cut.lastIndexOf(' ');
  let out = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '');
  while (DANGLING.test(out)) out = out.replace(DANGLING, '');
  return out.replace(/[\s,;:—–-]+$/, '');
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * THE DETERMINISTIC CLAIM GATE
 *
 * An LLM validator is probabilistic. These assertions must be caught EVERY time, so they are
 * matched here, offline, with no model and no environment.
 *
 * Two severities, because the ten permanent regression cases are not all the same kind of wrong:
 *   'block'     — verified false against a primary source. No research can rescue it.
 *   'challenge' — may not stand unless THIS generation's research or the agency's own evidence
 *                 supports it. Plausible, unverified, and exactly the kind of thing a confident
 *                 writer invents.
 *
 * NEGATION, AND WHY IT IS DELIBERATELY LENIENT: a post that says "there is no 48-hour rule" is
 * correct and must pass; "you have 48 hours to act" must fail. This project has shipped a
 * negation-blind matcher twice, so the rule here errs the other way. A cue anywhere in the same
 * CLAUSE clears the match, even after it — "48 hours is not a real deadline" is a debunk and the
 * cue trails the phrase. That lets a rare false pass through ("you have 48 hours, no exceptions"),
 * which is the right trade: the LLM validator behind this catches recall misses, while a false
 * block silently deletes a true sentence and nobody ever sees why.
 *
 * Clauses split only on strong boundaries (";", "—", and a comma before a coordinator). Subordinate
 * clauses stay attached, so "There's no rule THAT a squatter becomes unremovable after 48 hours"
 * remains one clause and its negation still reaches the phrase.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type GateSeverity = 'block' | 'challenge';

export interface GateRule {
  id: string;
  severity: GateSeverity;
  /** what the writer did wrong, in words a repair prompt can act on */
  problem: string;
  /** the authority. Internal only — this never reaches the post. */
  authority: string;
  /** all must be present in the same sentence for the rule to fire */
  all: RegExp[];
  /** when true, no negation cue can clear it — the assertion is wrong in either polarity */
  negationImmune?: boolean;
  /** challenge rules pass when the research brief contains any of these */
  supportedBy?: RegExp[];
}

const NEG = /\b(?:no|not|never|isn'?t|aren'?t|wasn'?t|doesn'?t|don'?t|cannot|can'?t|nothing|none|nor|myth|mistaken|untrue|false|neither|ningun[oa]?|ningún|nunca|jamás|mito|falso|tampoco|sin)\b/i;

/** Strong clause boundaries only. Subordinators ("that", "which") deliberately do not split. */
function clauses(sentence: string): string[] {
  return sentence.split(/;|—|–|,\s+(?=(?:and|but|so|or|yet|while|whereas|y|pero|o|mientras)\b)/i);
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 0);
}

export const GATE_RULES: readonly GateRule[] = [
  {
    id: 'squatter-15-days',
    severity: 'block',
    problem: 'States or implies that Spain resolves or evicts an occupation case in about 15 days. '
      + 'There is no 15-day eviction deadline. Drop the timeline entirely and make the point another way.',
    authority: 'Fiscalía General del Estado Circular 1/2025 (BOE-A-2025-17153). The fifteen days in '
      + 'LECrim art. 800.3 is the window for SETTING the trial date and art. 802.2 the window for '
      + 'RE-LISTING a hearing that could not be held. Neither is an eviction deadline. Bank card B12.',
    all: [/\b(?:15|fifteen|quince)\s*(?:-|\s)?\s*(?:days?|días?)\b/i,
          /\b(?:evict|eviction|desaloj\w*|resolv\w*|remov\w*|okupa|squatter|usurpaci|allanamiento|deadline|plazo)\w*/i],
  },
  {
    id: 'squatter-fixed-hours',
    severity: 'block',
    problem: 'Presents a fixed number of hours as the legal window for removing an occupier. Spanish '
      + 'law attaches no fixed-hour rule to it — what matters is flagrancy, which is about evidence.',
    authority: 'LECrim art. 795.1.1ª defines flagrancy with no fixed-hour threshold. Bank card B12.',
    all: [/\b(?:24|48|72)\s*(?:-|\s)?\s*(?:hours?|horas?|hour|hr)\b/i,
          /\b(?:okupa|squatter|occupa|ocupa|evict|desaloj|police|policía|guardia civil|rule|regla|law|ley)\w*/i],
  },
  {
    id: 'usurpacion-fast-track',
    severity: 'block',
    problem: 'Says non-violent occupation of an empty property takes the fast-track criminal route. '
      + 'It does not — it stays on the minor-offence track. Say what is actually true instead.',
    authority: 'FGE Circular 1/2025 §4.3: art. 245.2 CP carries multa de tres a seis meses, making it '
      + 'a delito leve under CP arts. 33.4.g and 13.4, tramitado under LECrim arts. 964 ff — NOT the '
      + 'juicio rápido. LO 1/2025 added arts. 202 and 245 to the art. 795.1.2ª catalogue, but the '
      + 'delito-leve classification governs. Bank card B12.',
    all: [/\b(?:245\.?2|usurpaci\w*|non-?violent occupation|empty (?:second )?home)\b/i,
          /\b(?:juicios? r[áa]pidos?|fast[- ]track\w*|expedited|express trial)\b/i],
  },
  {
    id: 'golden-visa',
    severity: 'block',
    negationImmune: false,
    problem: 'Refers to the golden visa as an available route. Buying property in Spain has granted '
      + 'no residence route since 3 April 2025.',
    authority: 'Ley Orgánica 1/2025, disposición final, abolished the residence-by-investment scheme '
      + 'with effect from 3 April 2025.',
    all: [/\bgolden visa\b/i, /\b(?:buy|purchase|invest\w*|property|residen\w*|obtain|get|apply)\b/i],
  },
  {
    id: 'legal-timeline-approximate',
    severity: 'challenge',
    problem: 'Attaches an approximate duration to a legal or court step. A timeline this specific has '
      + 'to come from the research or not appear at all.',
    authority: 'Court timelines vary by jurisdiction and are published per procedure; an invented '
      + '"about a month" reads as authority the post does not have.',
    all: [/\b(?:about|roughly|around|approximately|some|unos|unas|cerca de|aproximadamente)\s+(?:a |an |one |two |three |four |\d+\s*)?(?:month|week|day|meses?|mes|semanas?|días?)\w*/i,
          /\b(?:court|filing|filed|judge|juzgado|tribunal|demanda|procedur\w*|hearing|juicio|case|lawyer|abogado|proceso)\b/i],
    supportedBy: [/\b(?:about|roughly|around|approximately)\s+\w*\s*(?:month|week|day)/i, /\b\d+\s*(?:months?|weeks?|days?)\b/i],
  },
  {
    id: 'commission-pattern',
    severity: 'challenge',
    problem: 'Asserts a pattern in what agencies charge. This agency has supplied no commission, and '
      + 'no source establishes the pattern. Make the argument without the pricing claim.',
    authority: 'Agency commission is agency evidence: it exists only when the agency states it.',
    all: [/\b(?:commission|comisi[óo]n|fee|honorarios)\b/i,
          /\b(?:lower|higher|less|more|cheaper|expensive|typically|usually|often|tend|average|menor|mayor|suele|normalmente)\b/i],
    supportedBy: [/\bcommission\b[^.]{0,80}\b\d/i],
  },
  {
    id: 'mandate-mechanics',
    severity: 'challenge',
    problem: 'States how a mandate works as though every contract worked that way — who gets paid, '
      + 'what the other agents may do, how long it runs. Those are terms of a particular contract. '
      + 'Argue from accountability, one point of contact and consistent presentation instead.',
    authority: 'Nota de encargo terms vary by contract; the agency profile is the only source for '
      + 'this agency\'s. Spanish Supreme Court case law requires an exclusivity clause to be clearly '
      + 'worded to bind the owner at all.',
    all: [/\b(?:exclusive|exclusiva|non-?exclusive|open|multi-?agen\w*|mandate|nota de encargo|listing agreement)\b/i,
          /\b(?:only the agent|gets paid|no other agent|cannot market|may not market|three to six months|tres a seis meses|set period|for a set)\b/i],
  },
  {
    id: 'obligation-upgraded',
    severity: 'challenge',
    problem: 'Turns a legal obligation into a hard stop — "you cannot sell without it". The source '
      + 'establishes a duty and a sanction, not a blocked sale. Say the seller is required to provide '
      + 'it, and stop there.',
    authority: 'Energy certificate: RD 390/2021 with the sanctions regime in RDL 7/2015. The notary '
      + 'warns of that regime; exoneration cases exist. An obligation is not an impossibility.',
    // "required" and "need" deliberately absent: "the certificate the seller is required to
    // provide" is the CORRECT wording. Only hard-stop phrasing fires.
    all: [/\b(?:energy certificate|certificado (?:de )?(?:eficiencia )?energ[ée]tic\w*|licence of occupation|c[ée]dula de habitabilidad)\b/i,
          /(?:\b(?:cannot|can'?t|impossible|unable|no puedes?|imprescindible)\b|to sell at all|without (?:it|which)|sin (?:el|la) cual)/i],
    supportedBy: [/\b(?:cannot|may not|prohibit\w*|void|null)\b[^.]{0,60}\b(?:sell|sale|complet\w*|escritura)/i],
  },
  {
    id: 'causal-inference',
    severity: 'challenge',
    problem: 'Draws a cause from two observations. Falling transactions do not by themselves prove '
      + 'tight supply rather than weaker demand. State what was observed, and drop the "because".',
    authority: 'Two co-occurring observations do not establish which caused which. The research has '
      + 'to establish the mechanism separately before a post may assert it.',
    negationImmune: true,
    all: [/\b(?:transactions?|sales|ventas|operaciones|prices?|precios?|demand|demanda|supply|oferta|stock|inventory)\b/i,
          /(?:\bnot\s+[\w\s]{1,30}?,?\s*(?:that'?s|that is|it'?s)|(?:that'?s|that is|it'?s)\s+[\w\s]{1,30}?,\s*not\b|\b(?:because of|due to|driven by|means that|proves|therefore|so it'?s|se debe a)\b)/i],
    supportedBy: [/\b(?:because|driven by|caused by|due to|attributabl\w*|explains?)\b/i],
  },
];

export interface GateHit {
  rule: GateRule;
  /** the field the offending sentence came from, e.g. "tips[3].body" */
  field: string;
  sentence: string;
}

/** Does a negation cue govern this match inside its own clause? */
function negated(sentence: string, pattern: RegExp): boolean {
  for (const clause of clauses(sentence)) {
    if (pattern.test(clause)) return NEG.test(clause);
  }
  return NEG.test(sentence);
}

/**
 * Run the deterministic table over one field's text.
 *
 * `research` is this generation's brief. A 'challenge' rule clears when the research visibly
 * supports the claim; with no research at all, every challenge stands — which is the answer to a
 * lifestyle post whose local premises were written from memory.
 */
export function gateField(field: string, text: string, research = ''): GateHit[] {
  const hits: GateHit[] = [];
  if (!text?.trim()) return hits;
  for (const sentence of sentences(text)) {
    for (const rule of GATE_RULES) {
      if (!rule.all.every((re) => re.test(sentence))) continue;
      if (!rule.negationImmune && negated(sentence, rule.all[0])) continue;
      if (rule.severity === 'challenge' && rule.supportedBy?.some((re) => re.test(research))) continue;
      hits.push({ rule, field, sentence: sentence.trim() });
    }
  }
  return hits;
}

/** A field that was cut mid-thought. Defence in depth behind trimWords. */
export function endsMidThought(text: string): boolean {
  return typeof text === 'string' && DANGLING.test(text.replace(/[.!?"'”’)]+$/, ''));
}
