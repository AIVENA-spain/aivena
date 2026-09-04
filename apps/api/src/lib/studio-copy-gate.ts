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
// Connectives, prepositions, determiners and bare negators. A live post ended a card on "not" —
// "the 15-day figures people quote are hearing timelines, not" — because the first version of this
// list only knew connectives. Anything that cannot legitimately end a sentence belongs here.
const DANGLING = /\s+(?:and|or|but|so|because|since|while|when|if|although|though|with|without|for|from|to|of|in|on|at|by|as|that|which|than|per|into|onto|about|after|before|not|no|nor|the|an|its|their|our|your|my|his|her|these|those|very|more|most|less|only|just|also|even|still|both|such|y|e|o|u|pero|porque|mientras|cuando|si|aunque|con|sin|para|de|del|en|por|como|que|a|al|sobre|entre|hasta|desde|el|la|los|las|un|una|su|sus|muy|m[áa]s|menos|s[óo]lo|tambi[ée]n)$/i;

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
/** Abbreviations whose full stop is not the end of a sentence. */
const ABBREV = /\b(?:art|arts|no|núm|num|aprox|etc|ej|p|pp|pág|pag|vs|sr|sra|dr|dra|av|ctra|km|máx|min|ref|cf|ud|uds|s)$/i;

/**
 * The last position inside `s` where a sentence genuinely ends.
 *
 * Terminal punctuation is not enough on its own: "art. 245.2" and "3.404 €/m²" both contain full
 * stops, and cutting at one of those produces nonsense. A real ending is followed by whitespace or
 * the end of the string, and is not preceded by a known abbreviation.
 */
function lastSentenceEnd(s: string): number {
  let best = -1;
  const re = /[.!?…]["'”’)]?(?=\s|$)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const before = s.slice(0, m.index).split(/[\s(—–-]+/).pop() ?? '';
    if (ABBREV.test(before)) continue;
    best = m.index + m[0].length;
  }
  return best;
}

/**
 * Trim a generated field to its cap.
 *
 * Christian's hierarchy, 2026-09-03: prefer the last complete sentence within the limit; if none is
 * viable the card should be shortened by rewriting, not butchered; and never cut valid prose just
 * because its last word happens to be "on", "in" or "after".
 *
 * So the sentence boundary is now preferred wherever it falls, not only past half the budget — a
 * complete shorter card beats an incomplete longer one. A live card ended "...each with its own
 * tourist office" with no full stop because the only sentence end sat below that old floor. When no
 * viable boundary exists at all, the word cut still runs so nothing breaks, and `incompleteBody`
 * hands the card to the repair pass to be rewritten short and whole.
 */
export function trimWords(v: unknown, max: number): unknown {
  if (typeof v !== 'string' || v.length <= max) return v;
  const cut = v.slice(0, max);
  const end = lastSentenceEnd(cut);
  // A quarter of the budget is enough to be a real card; below that it is a stub, and rewriting
  // beats truncating.
  if (end > max * 0.25) return cut.slice(0, end).trim();
  const sp = cut.lastIndexOf(' ');
  let out = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '');
  // Bounded: stripping until nothing dangles can eat a real clause a word at a time.
  for (let i = 0; i < 2 && DANGLING.test(out); i++) out = out.replace(DANGLING, '');
  return out.replace(/[\s,;:—–-]+$/, '');
}

/**
 * The generated field length limits, and the re-application of them.
 *
 * These lived in the writer, applied once when the plan was first parsed. Every later rewrite — the
 * gate's repair pass and the editor — wrote whatever the model returned, so a repaired title shipped
 * at 161 characters against a 62-character cap, complete with a citation. A cap enforced once is a
 * cap that holds until the first rewrite.
 */
export const FIELD_CAPS: Readonly<Record<string, number>> = {
  eyebrow: 44, hook_title: 90, slide2_title: 80, slide2_body: 220, recap_title: 60,
  save_line: 70, cta_heading: 78, agency_line: 170, cta_action: 140, cta_keyword: 90,
  swipe_cue: 18, caption: 320,
};
const TIP_CAPS: Readonly<Record<string, number>> = { title: 62, body: 250, teaser: 70 };

/** The cap for an addressed field, or null when the field is uncapped. */
export function capFor(field: string): number | null {
  const tip = /^tips\[\d+\]\.(title|body|teaser)$/.exec(field);
  if (tip) return TIP_CAPS[tip[1]] ?? null;
  return FIELD_CAPS[field] ?? null;
}

/** Fields that carry prose, where a missing full stop means the text was cut rather than styled. */
const PROSE_FIELD = /^(?:tips\[\d+\]\.body|slide2_body|caption)$/;

/**
 * A prose card that does not end on terminal punctuation was cut, whatever its last word is.
 *
 * This is deliberately NOT the dangling-word check. That one asks whether the last word can end a
 * thought and got it wrong on five correct sentences; this asks only whether the sentence was
 * finished. It applies to bodies and captions, never to titles, hooks or recap lines, where a
 * fragment like "One agency. One price. One story" is a style, not a defect.
 */
export function incompleteBody(field: string, text: string): boolean {
  if (!PROSE_FIELD.test(field) || !text?.trim()) return false;
  return !/[.!?…]["'”’)]?$/.test(text.trim());
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
  /** the rule does not fire when the sentence qualifies itself correctly */
  unless?: RegExp[];
  /**
   * Place names captured by this pattern must ALSO appear in the research, or the local premise
   * was written from memory. "Dream content may be creative. Its concrete local premises may not
   * be invented."
   */
  placesMustBeResearched?: RegExp;
  /** challenge rules pass when the research brief contains any of these */
  supportedBy?: RegExp[];
}

/**
 * REFUTATION, NOT "IS THERE A NEGATION SOMEWHERE".
 *
 * The first version tested for any negation cue in the clause, and it was wrong in both directions.
 * It MISSED "Squatters are evicted in 15 days, not months" — the "not" negates the months, not the
 * claim — and "An exclusive mandate runs three to six months and no other agency can market the
 * property", where a negation in a later clause cleared an assertion in an earlier one. Worse, it
 * could never fire on "Without a registered energy certificate you cannot sell", because "cannot"
 * is BOTH the rule's own trigger and a negation cue: the rule silently cleared itself. That is the
 * same dead-matcher family as the word boundary after "Art." in the bank linter.
 *
 * So: mask the spans the rule itself matched — a trigger word can never double as its own alibi —
 * then judge scope.
 *   STRONG   an explicit debunk framing. Clears the sentence from either side.
 *   VERB_NEG a negated verb, which governs its whole clause.
 *   WEAK     a bare "no"/"not", which only governs what follows it closely — at most four words
 *            before the claim, and never across a comma.
 * Plus a question answered in the next sentence, which is how a debunk post is usually written.
 */
const STRONG = /\b(?:myth|mito|bulo|urban legend|misconception|untrue|not real|isn'?t real|no such|mistaken|falso|forget what you (?:read|heard|were told)|contrary to (?:what|popular)|despite what|people fear|you may have heard|widely believed)\b/i;
const VERB_NEG = /\b(?:does ?n[o']t|do ?n[o']t|did ?n[o']t|can ?n[o']t|cannot|is ?n[o']t|is not|are ?n[o']t|are not|was ?n[o']t|were ?n[o']t|will ?n[o']t|won'?t|never|there(?:'s| is| are)? no|no rule|no such|nunca|no existe|no hay|jam[áa]s)\b/i;
const WEAK = /\b(?:no|not|ni|sin)\b/i;
/** A next sentence that answers a rhetorical question in the negative. */
const ANSWERS_NO = /^\s*(?:no\b|not\b|nope\b|never\b|it\s+is\s+not\b|that'?s\s+not\b|myth\b|wrong\b)/i;

/** Strong clause boundaries only. Subordinators ("that", "which") deliberately do not split. */
function clauses(sentence: string): string[] {
  return sentence.split(/;|—|–|,\s+(?=(?:and|but|so|or|yet|while|whereas|y|pero|o|mientras)\b)/i);
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 0);
}

/** Blank out every span the rule matched, preserving offsets. */
function maskMatches(sentence: string, patterns: readonly RegExp[]): { masked: string; anchor: number } {
  const chars = [...sentence];
  for (const p of patterns) {
    const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
    for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
      for (let i = m.index; i < m.index + m[0].length; i++) chars[i] = '·';
      if (m[0].length === 0) re.lastIndex++;   // a zero-width match would loop forever
    }
  }
  // The claim sits where the rule's primary pattern matched.
  const anchor = new RegExp(patterns[0].source, patterns[0].flags).exec(sentence)?.index ?? 0;
  return { masked: chars.join(''), anchor };
}

/** Is this rule's match refuted rather than asserted? */
function refuted(sentence: string, next: string, patterns: readonly RegExp[]): boolean {
  const { masked, anchor } = maskMatches(sentence, patterns);
  if (STRONG.test(masked)) return true;
  if (/\?\s*$/.test(sentence.trim()) && ANSWERS_NO.test(next)) return true;

  // the clause the claim sits in, located by offset in the masked copy
  let at = 0;
  let clause = masked;
  for (const c of clauses(masked)) {
    if (anchor >= at && anchor <= at + c.length) { clause = c; break; }
    at += c.length;
  }
  if (VERB_NEG.test(clause)) return true;

  // A bare "no"/"not" only reaches forward, and not across a comma.
  const before = masked.slice(0, anchor);
  const lastComma = before.lastIndexOf(',');
  const window = before.slice(lastComma + 1).trim().split(/\s+/).slice(-4).join(' ');
  return WEAK.test(window);
}

/**
 * Real municipalities only. Deliberately no generic quarter names — Arenal, Puerto, Centro
 * Histórico, La Marina all appear in ordinary sentences that assert nothing about a place, and a
 * rule that fires on those would start policing marketing copy.
 */
const TOWNS = /\b(J[áa]vea|X[àa]bia|D[ée]nia|Moraira|Teulada|Benissa|Calpe|Calp|Altea|Alfaz|Albir|Benidorm|Villajoyosa|Finestrat|Polop|Callosa|Guadalest|Pego|Ondara|Gata|Pedreguer|Benitachell|Poble Nou|Orba|Murla|Parcent|Jalon|Xal[óo]|Lliber|Senija|Alicante|Torrevieja|Orihuela|Guardamar|Santa Pola|Elche|Elx|Mutxamel|San Juan|Campello|Mor[óo]n)\b/gi;

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
    // The subject half has to recognise the offence DESCRIBED, not only the offence NAMED. A live
    // post said "non-violent break-ins into a lived-in home" and matched none of 245.2, usurpación
    // or "empty home", so the rule never got the chance to fire at all.
    all: [/\b(?:245\.?2|usurpaci\w*|non-?violent\s+(?:occupation|entry|break-?ins?|squatting|usurpation)|minor occupation|less serious offence|empty (?:second )?home)\b/i,
          /\b(?:juicios? r[áa]pidos?|fast[- ]track\w*|expedited|express trial)\b/i],
    // "allanamiento and VIOLENT usurpación can enter the fast track" is precise and true, and the
    // first version of this rule deleted it. Only the unqualified or explicitly non-violent claim
    // is wrong, so a sentence that names the violent branch is left alone.
    // The lookbehind matters: "violent" sits inside "non-violent", so without it the exception
    // swallowed the very sentence the rule exists to catch.
    // Only a qualifier that attaches to usurpación itself exempts the claim. Naming allanamiento
    // alongside does NOT — the original false sentence did exactly that ("moved usurpación AND
    // allanamiento de morada into juicios rápidos") and an earlier version of this list let it pass.
    // A writer describes the violent branch in plain English far more often than by article
    // number — "the more serious usurpación", "aggravated", "a break-in". A live post lost a TRUE
    // sentence because this list only knew "violent" and "245.1". Match the shape, not one
    // phrasing. Deliberately absent: "only" and "less serious", which appear in false sentences
    // that restrict the fast track to the WRONG branch.
    // The lookbehind has to guard EVERY alternative, not just "violent". A live post published
    // "non-violent break-ins into a lived-in home can move through the fast track" because
    // "break-ins" was its own unguarded alternative and exempted the whole sentence.
    unless: [/(?<!non-)(?<!no )(?<!non-violent )\b(?:violent|violenta|violencia|intimidaci[óo]n|intimidation|245\.?1|aggravated|agravad\w*|more serious|m[áa]s grave|break-?ins?|breaking in|forced entry|con violencia)\b/i],
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
    id: 'research-narrated',
    severity: 'block',
    problem: 'Narrates the research instead of using it. The reader must never feel they are '
      + 'reading the output of a fact-checking system. Say the thing you CAN say, plainly, and drop '
      + 'the part about what the data does or does not show.',
    authority: 'Christian, 2026-09-03: "Research and validation stay invisible. The customer sees '
      + 'confident marketing, not our compliance machinery."',
    negationImmune: true,
    all: [/\b(?:different metrics|not a single verdict|treat (?:them|it|these) as a direction|isn'?t published|does ?n[o']t publish|publishes? reliably|no official figure|no reliable data|no public data|no dataset|nobody publishes|no one publishes|isn'?t published anywhere|not published anywhere|the exact formula|I could (?:verify|find|confirm|establish|locate)|I (?:checked|verified|confirmed|could not find)|(?:we|I) (?:were|was) able to (?:verify|find|confirm)|as far as (?:I|we) can tell|the sources (?:I|we) |every (?:current )?series (?:I|we) |from what (?:I|we) (?:can|could)|data is unclear|evidence is unclear|sources? disagree|studies show|research shows|figures vary by method|depending on the method|not something (?:either|any)\w*[\w\s]{0,20}publish)/i,
      /./],
  },
  {
    id: 'source-attributed',
    severity: 'block',
    problem: 'Attributes a figure to a named data provider inside the post. That is a footnote, not '
      + 'a slide. State the point without the citation, or drop the figure.',
    authority: 'Same rule: the research is internal support, never subject matter. Naming a portal '
      + 'for what it IS ("your listing appears on Idealista") is fine — this is about attribution.',
    negationImmune: true,
    // Two shapes. A named data provider used as attribution, OR any "per a 2019 Somebody study"
    // construction — a live post cited "the 2019 Observatori Marina Alta study" and the fixed list
    // of provider names could never have caught it. A citation is a shape, not a vocabulary.
    all: [/(?:\b(?:Idealista|Fotocasa|Engel\s*(?:&|and)\s*V[öo]lkers|Tinsa|Registradores|Notariado|INE\b|Eurostat|Colegio de Registradores|MIVAU|CGPJ)\b|\b(?:per|according to|based on|cited (?:by|in)|from|in)\s+(?:a|the)?\s*\d{4}\s+[A-ZÀ-Ý][^,.;]{2,60}?\s+(?:study|report|index|survey|analysis)\b|\b(?:per|according to)\s+(?:a|the)\s+[A-ZÀ-Ý][^,.;]{2,60}?\s+(?:study|report|index|survey|analysis)\b)/i,
      /\b(?:listed|reported|reports|according to|says|said|data|figures?|index|averag\w*|recorded|published|study|grew|rose|fell|per)\b/i],
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
    // The duration half was written as one literal string and a live post walked straight past it
    // with "three, six or twelve months". Match the shape, not the phrasing.
    all: [/\b(?:exclusive|exclusiva|non-?exclusive|open|multi-?agen\w*|mandate|nota de encargo|listing agreement)\b/i,
          /(?:\b(?:only the agent|gets paid|no other agent\w*|cannot market|may not market|set period|for a set|auto-?renew\w*|penalty|penalizaci[óo]n)\b|\b(?:one|two|three|six|nine|twelve|\d{1,2})\b[\w\s,]{0,24}\bmonths?\b|\b(?:uno|dos|tres|seis|doce|\d{1,2})\b[\w\s,]{0,24}\bmeses\b)/i],
    // "Should not be universalised WITHOUT support" — research that actually establishes how these
    // contracts work on this coast is support. The agency profile is the other source.
    supportedBy: [/\b(?:exclusiva|nota de encargo|mandate|encargo|listing agreement)\b[^.]{0,160}\b(?:month|mes|term|plazo|duration|commission|comisi[óo]n|penalt|renew)/i],
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
    id: 'local-premise-unresearched',
    severity: 'challenge',
    problem: 'Makes a concrete claim about what daily life in a named town is actually like, and '
      + 'nothing was researched about that town. Write the feeling, not the premise, or research it.',
    authority: 'A lifestyle post may be creative about the feeling and never about the premise. '
      + 'Whether a town needs a car, what sits in its centre, and how busy it is are checkable facts.',
    all: [TOWNS,
      /\b(?:car|drive|driving|walk\w*|foot|cycle|bus|train|tram|ferry|centre|center|centro|quiet\w*|busy|busier|bus[ie]|crowd\w*|nightlife|market|school|supermarket|amenit\w*|population|residents?|expat\w*|foreigners?|locals?|commut\w*|traffic|parking)\b/i],
    placesMustBeResearched: TOWNS,
  },
  {
    id: 'causal-inference',
    severity: 'challenge',
    problem: 'Draws a cause from two observations. Falling transactions do not by themselves prove '
      + 'tight supply rather than weaker demand. State what was observed, and drop the "because".',
    authority: 'Two co-occurring observations do not establish which caused which. The research has '
      + 'to establish the mechanism separately before a post may assert it.',
    negationImmune: true,
    // "X, not Y" is an ordinary contrast, not an attribution — "it's calculated on price, not on
    // your actual profit" cost a live post a repair round for saying something perfectly plain. The
    // subject has to be a MARKET AGGREGATE for a causal reading to be possible at all, so a bare
    // singular "price" is out; "prices" as a series stays in.
    all: [/\b(?:transactions?|sales|ventas|operaciones|prices|precios|demand|demanda|supply|oferta|stock|inventory|market|mercado)\b/i,
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
  const parts = sentences(text);
  for (let i = 0; i < parts.length; i++) {
    const sentence = parts[i];
    for (const rule of GATE_RULES) {
      if (!rule.all.every((re) => re.test(sentence))) continue;
      if (rule.unless?.some((re) => re.test(sentence))) continue;
      // A QUESTION WITH NO ANSWER BEHIND IT ASSERTS NOTHING. A teaser reading "Does the '48-hour
      // rule' people mention actually exist?" is the open loop that sets up the debunk on the next
      // slide, and the first version of this table deleted it. Where a question IS followed by its
      // own answer, judge normally — "Evicted in 15 days? Yes, since the reform." still fails.
      if (/\?\s*$/.test(sentence.trim()) && i === parts.length - 1) continue;
      if (!rule.negationImmune && refuted(sentence, parts[i + 1] ?? '', rule.all)) continue;
      if (rule.severity === 'challenge' && rule.supportedBy?.some((re) => re.test(research))) continue;
      if (rule.placesMustBeResearched) {
        const named = sentence.match(new RegExp(rule.placesMustBeResearched.source, 'gi')) ?? [];
        // Fold accents so "Jávea" in the copy is recognised by "Javea" in the brief and vice versa.
        const brief = research.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const missing = named.filter((t) =>
          !brief.includes(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
        if (!missing.length) continue;
      }
      hits.push({ rule, field, sentence: sentence.trim() });
    }
  }
  return hits;
}

/**
 * A field that was CUT, as opposed to one that simply ends on a short word.
 *
 * The first version stripped the terminal punctuation and then looked for a dangling word, which
 * threw away the only reliable signal there is. Run over 156 real generated lines it flagged five
 * correct sentences — "what a buyer actually decides on.", "which of the three you want to live
 * in.", "set your asking price, not after." — because a phrasal verb or an adverb ends plenty of
 * good sentences. What it never does is end one WITHOUT punctuation.
 *
 * So the test is both together: no terminal punctuation AND a word that cannot end a thought. A
 * deliberate fragment ("One agency. One price. One story") ends on a noun and passes.
 */
export function endsMidThought(text: string): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  const t = text.trim();
  if (/[.!?…:]["'”’)]?$/.test(t)) return false;
  return DANGLING.test(t);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * ADDRESSING THE COPY
 *
 * A failed claim has to be traceable to the exact field that produced it, so a repair can rewrite
 * that field and nothing else. Kept pure and here rather than in the engine so it can be tested.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Structural shape of a plan. Deliberately no index signature: CarouselPlan is a closed type and
 * requiring one would force a cast at every call site. The named fields are read through a local
 * cast instead, which is contained to this module.
 */
export interface PlanLike {
  tips?: Array<{ title?: string; body?: string; teaser?: string } | undefined>;
}
const asRecord = (p: PlanLike): Record<string, unknown> => p as unknown as Record<string, unknown>;

/** Every piece of a plan a reader will actually see, addressed. */
export function planFields(plan: PlanLike): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  const push = (field: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push({ field, text: v });
  };
  for (const k of ['eyebrow', 'hook_title', 'slide2_title', 'slide2_body', 'recap_title',
    'save_line', 'cta_heading', 'cta_action', 'cta_keyword', 'agency_line', 'caption'] as const) {
    push(k, asRecord(plan)[k]);
  }
  (plan.tips ?? []).forEach((t, i) => {
    push(`tips[${i}].title`, t?.title);
    push(`tips[${i}].body`, t?.body);
    push(`tips[${i}].teaser`, t?.teaser);
  });
  return out;
}

/** Read one addressed field. */
export function readField(plan: PlanLike, field: string): string {
  const m = /^tips\[(\d+)\]\.(title|body|teaser)$/.exec(field);
  if (m) return String(plan.tips?.[Number(m[1])]?.[m[2] as 'title'] ?? '');
  return String(asRecord(plan)[field] ?? '');
}

/** Write one addressed field, returning a new plan. Unknown addresses are ignored, never thrown. */
export function writeField<T extends PlanLike>(plan: T, field: string, value: string): T {
  const m = /^tips\[(\d+)\]\.(title|body|teaser)$/.exec(field);
  if (m) {
    const i = Number(m[1]);
    const tips = [...(plan.tips ?? [])];
    if (!tips[i]) return plan;
    tips[i] = { ...tips[i], [m[2]]: value };
    return { ...plan, tips };
  }
  if (!(field in asRecord(plan))) return plan;
  return { ...plan, [field]: value };
}

/**
 * Remove one sentence from a field — the last-resort repair when the writer could not replace a
 * failed claim. Deleting a false sentence is always better than publishing it, and better than
 * failing the whole post over one line.
 */
export function dropSentence(text: string, sentence: string): string {
  const target = sentence.trim();
  if (!target) return text;
  const kept = sentences(text).filter((s) => s.trim() !== target);
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * DID THE RESEARCH ANSWER WHAT THE BANK ASKED?
 *
 * The bank card names what must be established before a topic can be written truthfully. A live
 * post asserted which town is busier in summer — bank card B20 requires "year-round versus seasonal
 * population for each" and forbids asserting it "without checking" — and the research for that run
 * came back without it. The writer said it anyway, the gate flagged it twice, and it still shipped.
 *
 * Requirements are prose, so this is a coverage heuristic, not a proof: it asks whether the
 * distinctive words of a requirement appear in the brief at all. Being wrong in the cautious
 * direction only adds a "do not assert this" line, which the writer can always route around.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const REQ_STOP = new Set(`the a an and or of for to in on at by with from that which what who how
this these those must may can not do does is are was were be been being it its their there any all
each per use used using state stated establish established confirm confirmed check checked exact
current do not never always without figures figure number numbers source sources cite`.split(/\s+/));

/** Which of the card's requirements the brief does not appear to answer. */
export function uncoveredRequirements(must: readonly string[], research: string): string[] {
  if (!research.trim()) return [...must];
  const brief = research.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return must.filter((m) => {
    const terms = [...new Set(m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !REQ_STOP.has(w)))];
    if (terms.length < 3) return false;          // too vague to judge — do not cry wolf
    const hits = terms.filter((t) => brief.includes(t)).length;
    return hits / terms.length < 0.34;
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * ADJUDICATION — the second opinion is evidence, not a judge.
 *
 * Christian, 2026-09-03: a stochastic verifier called "Mediterráneo Costa Homes handles sales and
 * listings in Jávea, Moraira, Dénia and Teulada" UNSUPPORTED when all four towns and the service
 * were supplied by the agency. Chasing that raw number to zero is what removed twelve sentences in
 * one run and left a card with a blank title. So a flag no longer deletes anything by itself.
 *
 * Every flagged claim is resolved against the evidence that already exists, in this order:
 *   1. does a deterministic rule contradict it?            → hard fail
 *   2. does it lean on a required point research missed?    → hard fail
 *   3. is it supported by THIS generation's research?       → keep
 *   4. is it supported by the agency's own evidence?        → keep
 *   5. is it puffery, positioning, or a deliverable offer?  → keep
 *   6. otherwise                                            → repair
 *
 * Only 1 and 2 can force removal. Everything else either stands on evidence or gets rewritten.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type Resolution =
  | 'DETERMINISTIC_CONTRADICTION'
  | 'USES_UNESTABLISHED_REQUIREMENT'
  | 'SUPPORTED_BY_RESEARCH'
  | 'SUPPORTED_BY_AGENCY_PROFILE'
  | 'OPINION_POSITIONING'
  | 'MARKETING_PUFFERY'
  | 'SERVICE_PROMISE_ALLOWED'
  | 'FALSE_POSITIVE_VERIFIER'
  | 'NEEDS_REPAIR';

/** Resolutions that publish as they stand. */
export const RESOLVED_OK: ReadonlySet<Resolution> = new Set<Resolution>([
  'SUPPORTED_BY_RESEARCH', 'SUPPORTED_BY_AGENCY_PROFILE', 'OPINION_POSITIONING',
  'MARKETING_PUFFERY', 'SERVICE_PROMISE_ALLOWED', 'FALSE_POSITIVE_VERIFIER',
]);
/** Resolutions that may never publish. */
export const RESOLVED_HARD_FAIL: ReadonlySet<Resolution> = new Set<Resolution>([
  'DETERMINISTIC_CONTRADICTION', 'USES_UNESTABLISHED_REQUIREMENT',
]);

const CLAIM_STOP = new Set(`the a an and or of for to in on at by with from that which is are was
were be been it its their there any all this these those you your our we us not no can may will
what how who when where than then so if but as into onto about after before over under more most
less least only just also even still both such per each every other same own`.split(/\s+/));

const distinctive = (s: string) => [...new Set(
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9€%]+/).filter((w) => w.length > 3 && !CLAIM_STOP.has(w)))];

/**
 * Share of a claim's distinctive words that appear in a source text.
 *
 * Matched on a five-character prefix, because "seasonal" and "season" are the same fact and exact
 * matching missed exactly that: a claim about off-season population failed to connect to the
 * requirement "year-round versus seasonal population", which is the failure this whole check exists
 * to catch.
 */
export function evidenceOverlap(claim: string, source: string): number {
  if (!source?.trim()) return 0;
  const terms = distinctive(claim);
  if (!terms.length) return 0;
  const hay = source.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return terms.filter((t) => hay.includes(t.length > 5 ? t.slice(0, 5) : t)).length / terms.length;
}

/** A claim that is an OFFER rather than a record of what the agency has achieved. */
const SERVICE_PROMISE = /\b(?:we(?:'| a)?(?:ll| will| can| do| work|'re)|comment|send you|dm|message us|get in touch|book|ask us|talk (?:to|through)|walk you|we handle|we offer|available)\b/i;
/** A claim about what the agency HAS DONE. Never a service promise, always needs evidence. */
const PAST_PERFORMANCE = /\b(?:we(?:'| ha)?ve (?:seen|sold|helped|achieved|closed|delivered)|our (?:sellers|clients|listings|sales|buyers|properties|track record|average)|sold \d|in our experience|over the (?:years|past)|award|accredited|certified|rated|ranked|no\.? ?1|leading|largest|fastest)\b/i;

export interface AdjudicationInput {
  text: string;
  /** the extraction's claim type */
  type: string;
  /** true when a deterministic rule fired on this sentence */
  deterministic?: boolean;
  research: string;
  agencyEvidence: string;
  uncovered: readonly string[];
}

/**
 * Terms that give a sentence something an outsider could check: a quantity, a named thing, a rule,
 * a procedure, a market series. Absent all of them, the sentence is an argument.
 */
const CHECKABLE = /\b(?:law|legal|court|judge|tribunal|notary|notari\w*|deed|escritura|registry|registro|tax|taxed|taxable|rate|rates|percent|per cent|deadline|withhold\w*|licen[cs]e|permit|planning|contract|mandate|mandato|commission|clause|evict\w*|prosecut\w*|fine[sd]?|oblig\w*|entitl\w*|guarantee\w*|required|requires|must|cannot|forbid\w*|allowed|statute|article|reform|census|padr[óo]n|population|statistic\w*|average|median|typically|usually|always|never|forecast\w*|index|survey|study|ferry|airport|school|hospital|market data|transactions?)\b/i;

/** Does anything in this sentence have an external truth to be wrong about? */
export function hasCheckableAnchor(text: string): boolean {
  if (/\d/.test(text)) return true;                                    // any figure or year
  if (/(?!^)\b[A-ZÀ-Ý][a-zà-ÿ]{2,}/.test(text.replace(/^[^A-Za-zÀ-ÿ]*/, '').slice(1))) return true; // a proper noun
  return CHECKABLE.test(text);
}

export function adjudicate(input: AdjudicationInput): Resolution {
  if (input.deterministic) return 'DETERMINISTIC_CONTRADICTION';

  // A claim resting on something the bank required and the research did not establish cannot be
  // rescued by sounding reasonable. This is the B20 seasonality failure, encoded.
  // A requirement is terse and a claim is prose, so the bar is lower here than for support: sharing
  // a third of a requirement's distinctive words means the claim is talking about that requirement.
  for (const req of input.uncovered) {
    if (evidenceOverlap(req, input.text) >= 0.35 || evidenceOverlap(input.text, req) >= 0.5) {
      return 'USES_UNESTABLISHED_REQUIREMENT';
    }
  }

  // Past performance is never a service promise, and it always needs the agency's own evidence.
  if (PAST_PERFORMANCE.test(input.text)) {
    return evidenceOverlap(input.text, input.agencyEvidence) >= 0.7
      ? 'SUPPORTED_BY_AGENCY_PROFILE' : 'NEEDS_REPAIR';
  }

  if (evidenceOverlap(input.text, input.agencyEvidence) >= 0.6) return 'SUPPORTED_BY_AGENCY_PROFILE';
  if (evidenceOverlap(input.text, input.research) >= 0.55) return 'SUPPORTED_BY_RESEARCH';

  if (input.type === 'MARKETING_PUFFERY') return 'MARKETING_PUFFERY';
  if (input.type === 'OPINION_POSITIONING' || input.type === 'CREATIVE_HOOK') return 'OPINION_POSITIONING';
  if (SERVICE_PROMISE.test(input.text) && !/\d/.test(input.text)) return 'SERVICE_PROMISE_ALLOWED';

  // A sentence with nothing checkable in it cannot be factually wrong about the world, whatever the
  // extractor labelled it. "Buying now locks in today's cost instead of tomorrow's guess" was sent
  // for repair as a policed claim; it names no number, no institution and no rule — it is the
  // argument. Deciding this here rather than trusting the label is the difference between resolving
  // a mislabelled opinion and deleting the sales case.
  if (!hasCheckableAnchor(input.text)) return 'OPINION_POSITIONING';

  return 'NEEDS_REPAIR';
}
