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
const DANGLING = /\s+(?:and|or|but|so|because|since|while|when|if|although|though|with|without|for|from|to|of|in|on|at|by|as|that|which|than|per|into|onto|about|after|before|not|no|nor|the|an|its|their|our|your|my|his|her|these|those|very|more|most|less|fewer|only|just|also|even|still|both|such|other|another|same|either|neither|any|every|each|several|certain|various|y|e|o|u|pero|porque|mientras|cuando|si|aunque|con|sin|para|de|del|en|por|como|que|a|al|sobre|entre|hasta|desde|el|la|los|las|un|una|su|sus|muy|m[áa]s|menos|s[óo]lo|tambi[ée]n)$/i;

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
 * Shorten to a boundary a sentence actually has, or refuse.
 *
 * trimWords is word-aware truncation, and word-aware truncation is still truncation: it shipped
 * "…a bigger problem than other", "…residency status, among other", "Moraira vs Calpe, for people
 * who actually" and "Practitioner consensus holds that a stale listing makes" in a single run, all
 * four inside three characters of their cap. Cutting on a word boundary only guarantees the result
 * is words. This cuts at a boundary the writing itself provides — the end of a sentence, else the
 * end of a clause — and returns null when there is none, because the honest move then is to rewrite
 * the field, not to hand the reader half a thought.
 */
export function shortenToBoundary(text: string, cap: number): string | null {
  const t = (text ?? '').trim();
  if (t.length <= cap) return t;
  const window = t.slice(0, cap + 1);
  // Twelve characters is the floor for either boundary: below that the result is a stub, not a
  // shorter version of the line, and rewriting is the honest move.
  const FLOOR = 12;
  const end = lastSentenceEnd(window);
  if (end >= FLOOR) {
    const out = window.slice(0, end).trim();
    if (out.length <= cap) return out;
  }
  // A clause boundary: a comma, semicolon, colon or dash that a complete phrase ends at. "Moraira
  // vs Calpe, for people who actually" becomes "Moraira vs Calpe" — shorter, and whole.
  const clause = /[,;:—–-]\s/g;
  let cut = -1;
  for (let m = clause.exec(window); m; m = clause.exec(window)) {
    if (m.index >= FLOOR && m.index <= cap) cut = m.index;
  }
  if (cut > 0) {
    const out = window.slice(0, cut).replace(/[\s,;:—–-]+$/, '').trim();
    if (out.length >= FLOOR) return out;
  }
  return null;
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
  /** decided by what the sentence does, not by what it contains */
  semantic?: (text: string) => boolean;
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
    // H1, 5dfb1c3: published twice, in a tip body and in the caption. Two adversarial checks
    // against the consolidated Código Civil confirmed it is the opposite of the law.
    id: 'binding-only-on-signature',
    severity: 'block',
    problem: 'Says nothing is binding until a document is signed. Código Civil art. 1450: a sale is '
      + 'perfected and binding on both parties once they agree on the thing and the price, even '
      + 'before either is delivered; arts. 1254, 1258 and 1278 say the same about contracts '
      + 'generally. Do NOT replace this with the opposite absolute either — "any accepted offer is '
      + 'automatically binding" is also wrong. Write that agreement on the property and the price '
      + 'CAN already bind, that whether a particular exchange did depends on what was actually '
      + 'agreed and on proof, and that what you sign next decides the remedies.',
    authority: 'BOE-A-1889-4763, Código Civil arts. 1450, 1254, 1258, 1278. Christian, 2026-09-05.',
    negationImmune: true,
    all: [/\b(?:nothing|no(?:thing)? is|not binding|isn'?t binding|no obligation|creates no obligation|binds nobody|non-binding)\b/i,
      /\b(?:until|before|unless)\b[^.]{0,44}?\b(?:sign|signed|signs|signing|in writing|notaris\w*|escritura)\b|\bverbal\b|\bby phone or email\b|\bhandshake\b/i],
  },
  {
    // H2, 5dfb1c3. Orden EHA/3316/2010: a refund autoliquidación may be filed within FOUR YEARS
    // of the end of the retention period. Missing the filing window costs surcharges, not the money.
    id: 'late-filing-forfeits-refund',
    severity: 'block',
    problem: 'Says a late filing forfeits the right to reclaim. It does not: the refund claim '
      + 'prescribes on its own four-year clock (Orden EHA/3316/2010, and the general four-year '
      + 'prescription in the Ley General Tributaria), and filing late costs surcharges and interest '
      + 'rather than the money itself. Keep the distinction the reader needs — the statutory filing '
      + 'period is one clock, the period in which the right prescribes is another — and do not '
      + 'replace it with a different absolute.',
    authority: 'Orden EHA/3316/2010 (Modelo 210); LGT arts. 66, 27. Christian, 2026-09-05.',
    negationImmune: true,
    all: [/\b(?:modelo\s?210|the (?:3|three)\s?%|withhold\w*|retenci[oó]n|refund|reclaim|claim (?:it )?back)\b/i,
      /\b(?:forfeit\w*|lose|loses|losing|lost|never (?:get|see)|no longer (?:able|entitled)|gives? up|write it off)\b[^.]{0,60}\b(?:right|refund|money|reclaim|anything)\b|\b(?:late|missing|miss)\b[^.]{0,40}\b(?:forfeit\w*|lose|loses)\b/i],
  },
  {
    // B, 5dfb1c3. Furniture and connected utilities are EVIDENCE that a place is someone's morada;
    // they are not a switch that makes it one.
    id: 'morada-by-checklist',
    severity: 'challenge',
    problem: 'Treats furniture and connected utilities as automatically making a second home a '
      + 'morada. They are evidence of actual private use, not a checklist that decides the '
      + 'category: a second or seasonal residence CAN constitute morada where its lawful occupier '
      + 'genuinely uses it for private life, even occasionally. Write "can constitute" and say what '
      + 'the courts actually weigh, rather than presenting a test that returns a yes.',
    authority: 'CP art. 202 and the case law on morada; Christian, 2026-09-05.',
    negationImmune: false,
    all: [/\b(?:morada|residence|dwelling|home)\b/i,
      /\b(?:counts as|is treated as|qualifies as|becomes|makes it|automatically)\b[^.]{0,50}\b(?:occupied|morada|residence|dwelling)\b|\b(?:furnished|furniture|electricity|water|gas|utilities)\b[^.]{0,60}\b(?:counts?|qualifies|means it is|is (?:therefore )?(?:an? )?(?:occupied|morada))\b/i],
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
    id: 'palette-id-leaked',
    severity: 'block',
    problem: 'Contains an internal fact or source identifier (F3, S7) or first-person talk about '
      + 'our sources. Those are the engine\'s own bookkeeping and the reader must never see them. '
      + 'State the fact plainly instead.',
    authority: 'The palette is the first thing to put fact ids in front of the writer, so it is the '
      + 'first thing that could put one on a slide.',
    negationImmune: true,
    // An id USED AS A REFERENCE — in brackets, or next to a reporting verb or a citing preposition.
    // A bare "F1" is Formula 1 as often as it is a fact id, and this rule deletes what it matches.
    all: [/[([][FS]\d{1,2}[)\]]|\b[FS]\d{1,2}\s+(?:says?|shows?|states?|confirms?|establishes?|gives?|has|is from)\b|\b(?:per|see|from|according to|source:?|fact:?)\s+[FS]\d{1,2}\b|\b(?:our|nuestras|unsere|onze|vores|v[åa]re)\s+(?:sources?|fuentes|quellen|bronnen|kilder)\b/i,
      /./],
  },
  {
    id: 'evidence-narrated',
    severity: 'block',
    problem: 'Talks about our evidence — whether it exists, agrees, is published or was checked — '
      + 'rather than about the reader\'s world. Say the thing you CAN say, or say nothing.',
    authority: 'Christian: "Research and validation stay invisible. The customer sees confident '
      + 'marketing, not our compliance machinery."',
    negationImmune: true,
    all: [/.*/, /.*/],   // decided semantically below, not by these
    semantic: narratesEvidence,
  },
  {
    id: 'source-attributed',
    severity: 'block',
    problem: 'Attributes a figure to a named source inside the post. That is a footnote, not a '
      + 'slide. State the point without the citation, or drop the figure.',
    authority: 'Same rule: the research is internal support, never subject matter. Naming a portal '
      + 'for what it IS ("your listing appears on Idealista") is fine — this is about attribution.',
    negationImmune: true,
    all: [/.*/, /.*/],   // decided semantically below, not by a vocabulary of provider names
    semantic: attributesSource,
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
      if (rule.semantic) {
        if (!rule.semantic(sentence)) continue;
      } else if (!rule.all.every((re) => re.test(sentence))) continue;
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
 * REQUIREMENT IDENTITY
 *
 * Coverage used to be decided by lexical overlap, and it only worked at all once words were
 * compared on a five-character prefix — so "seasonal" matched "season" and, by the same rule,
 * anything else that happened to share five characters. Christian rejected that: the whole point of
 * must_establish is to stop plausible-but-unresearched claims, and it cannot rest on two words
 * looking alike.
 *
 * Each requirement now has a stable id, and coverage is a judgement about THAT requirement, made
 * once against the brief and carried as an object through the writer and the validator.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export interface Requirement { id: string; text: string }
export type CoverageStatus = 'established' | 'partial' | 'not_established';
export interface RequirementCoverage {
  id: string;
  status: CoverageStatus;
  /** the sentence of the brief that establishes it, empty when nothing does */
  evidence: string;
  /** ids of the pages the research actually opened that back it */
  sourceIds: string[];
}

/** Stable ids for a card's requirements: the card id and the requirement's position on it. */
export function requirementsFor(cardId: string, must: readonly string[]): Requirement[] {
  return must.map((text, i) => ({ id: `${cardId}#${i + 1}`, text }));
}

/** The requirements a coverage assessment did not find established. Anything unassessed counts. */
export function coverageGaps(
  requirements: readonly Requirement[], coverage: readonly RequirementCoverage[],
): Requirement[] {
  const byId = new Map(coverage.map((c) => [c.id, c]));
  return requirements.filter((r) => (byId.get(r.id)?.status ?? 'not_established') !== 'established');
}

/** Does a claim depend on a named requirement? Decided per requirement, not by word overlap. */
export function claimTouchesRequirement(claim: string, requirement: string): boolean {
  // Kept deliberately narrow: this is the last-resort deterministic guard behind the model's own
  // per-requirement judgement, not the primary mechanism.
  const terms = distinctive(requirement).filter((w) => w.length > 4);
  if (terms.length < 2) return false;
  const hay = claim.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return terms.filter((t) => hay.includes(t)).length >= 2;
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

/**
 * A GENERIC invitation to make contact — the agency offering to talk, nothing more.
 *
 * Deliberately narrow. "An offer the agency could plausibly deliver" was too loose: it would wave
 * through "we'll send you our 20-page seller guide", "we provide drone photography", "we'll arrange
 * your mortgage" — capabilities Aivena has no business inventing on an agency's behalf. A generic
 * "message us and let's talk" needs no evidence; a specific promised deliverable does.
 */
const GENERIC_CONTACT = /\b(?:message us|write to us|get in touch|talk to us|let'?s talk|ask us|contact us|send (?:us )?a (?:message|dm)|drop us|comment below|dm us|we'?re here|happy to (?:talk|help|chat))\b/i;

/** A specific thing being promised: a deliverable, a service, a turnaround. */
const PROMISED_DELIVERABLE = /\b(?:we(?:'ll| will| can| do| provide| offer| arrange| handle| manage| organise| organize| prepare| produce| send)|you'?ll (?:get|receive)|send you|we'?ll send)\b/i;
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
  /**
   * Whether a support record exists for this sentence that survived verification against the pages
   * the research actually opened. The ONLY thing that may produce SUPPORTED_BY_RESEARCH.
   */
  supported?: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * IS THIS A CLAIM ABOUT THE WORLD, OR A POSITION?
 *
 * The previous version asked whether a sentence contained a figure or a proper noun. Christian
 * rejected that, and he is right: "Exclusive listings sell faster", "Sea-view homes hold their
 * value better" and "Buyers prefer south-facing terraces" have neither, and every one of them is a
 * factual proposition an agency could be wrong about. Judging a sentence by how it LOOKS is the
 * exact mistake this whole layer exists to correct.
 *
 * The test is what the sentence CLAIMS. Does it assert how the world, the market, buyers, the law
 * or outcomes actually are? Then it is factual and it needs evidence, numbers or not. Does it
 * express a preference, a value, an exhortation or a framing? Then it is the agency's position and
 * it is theirs to hold.
 *
 * Anything genuinely ambiguous is treated as FACTUAL, because the cost of demanding evidence for an
 * opinion is a rewrite, and the cost of publishing an unevidenced claim is being wrong in public.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** First person taking a stance: the agency saying what it thinks, prefers or stands for. */
const STANCE = /\b(?:we|i)(?:'d|'ve| would| have| do)?\s+(?:think|believe|prefer|reckon|rather|feel|say|stand|back|like|love|want|choose|see it|would rather)\b|\bin our (?:view|opinion|experience of doing)\b|\bwe'?re the kind of\b/i;

/** Telling the reader what to do or what something deserves — exhortation, not description. */
const EXHORTATION = /\b(?:deserves?|should feel|worth doing|worth having|don'?t settle|stop\s+\w+ing|start\s+\w+ing|forget\s+\w+ing|ask yourself|choose|pick|decide)\b|^\s*(?:stop|start|forget|remember|think|imagine|picture|consider|save|send|book|ask)\b/i;

/** A framing move: recasting one thing as another rather than reporting how things are. */
const FRAMING = /\b(?:isn'?t (?:really )?about|is really about|means choosing|comes down to a choice|is a choice|is not a\b[^.]{0,40}\bit'?s a\b|call it what it is)\b/i;

/** Classes of thing whose behaviour is an empirical matter. */
const CLASS_SUBJECT = /\b(?:buyers?|sellers?|owners?|agents?|agencies|clients?|viewers?|homes?|houses?|villas?|properties|property|listings?|adverts?|mandates?|contracts?|terraces?|views?|prices?|markets?|photos?|photographs?|descriptions?|portals?|renovations?|kitchens?|gardens?|apartments?)\b/i;

/** Predicates that report behaviour or outcome — the things a class of thing empirically DOES. */
const OUTCOME = /\b(?:sells?|sold|selling|holds?|held|keeps?|kept|attracts?|draws?|prefers?|prefer|respond\w*|reacts?|pays?|paid|produces?|creates?|generates?|causes?|leads? to|results? in|takes? longer|lasts?|launch\w*|performs?|rises?|falls?|climbs?|drops?|gains?|loses?|earns?|achieves?|converts?|scrolls?|skips?|remembers?|forgets?|notices?|ignores?|values?|reads? as|comes? back|returns?)\b/i;

/** Comparative or frequency framing. Strengthens a claim; never makes one on its own. */
const GENERALISING = /\b(?:faster|slower|quicker|better|worse|more|less|higher|lower|stronger|weaker|longer|shorter|cheaper|dearer|usually|typically|often|generally|normally|commonly|always|never|most|tend to|tends to|on average|as a rule)\b/i;

/**
 * Is this sentence about the WORLD, or about the EVIDENCE?
 *
 * Narration was matched by phrasing, and phrasing always lags the model: it caught "I could not
 * find" and then shipped "we couldn't find", "none trace to a citable source", "route calculators
 * don't agree" and "hasn't been checked here". That is the same mistake as judging factuality by
 * surface features — the test has to be what the sentence is DOING.
 *
 * A sentence whose subject is the evidence itself, predicated on whether that evidence exists,
 * agrees, is published or was checked, is talking about our research rather than about the reader's
 * world. The reader must never see that.
 */
const EVIDENCE_SUBJECT = /\b(?:data|dataset|datasets|figures?|statistics?|stats?|numbers?|sources?|records?|stud(?:y|ies)|surveys?|calculators?|indexe?s?|series|estimates?|breakdowns?|reports?|evidence|research)\b/i;
const EVIDENCE_PREDICATE = /\b(?:don'?t agree|do not agree|disagree\w*|agree on|exists?|available|unavailable|published|unpublished|traceable|trace to|citable|verifiable|reliable|comparable|consistent|couldn'?t (?:find|verify|confirm)|could not (?:find|verify|confirm)|can'?t (?:find|verify|be found)|cannot be (?:found|verified)|wasn'?t (?:found|checked|verified)|hasn'?t been (?:checked|verified|published|found)|has not been (?:checked|verified|published)|not been (?:checked|verified)|nobody (?:publishes|can point)|no one (?:publishes|can point))\b/i;
/** Predicates that narrate the checking regardless of what the subject is. */
const NARRATION_ANY = /\b(?:we|i)\s+(?:couldn'?t|could not|can'?t|cannot|didn'?t|did not|haven'?t|have not)\s+(?:find|verify|confirm|establish|check|source)\b|\bhasn'?t been checked\b|\bhas not been checked\b|\bnot checked here\b|\bthis round\b|\bnobody can point to\b/i;

/**
 * Vague authority: a claim propped up by unnamed people who supposedly agree.
 *
 * "Practitioner consensus holds that…", "practitioners report that…", "commonly reported to…". This
 * is narration wearing a fact's clothes — it tells the reader the state of opinion instead of the
 * state of the world, and it is what a writer reaches for when the briefing gave it a soft finding.
 */
const VAGUE_AUTHORITY = /\b(?:practitioner\s+consensus|practitioners?\s+(?:report|say|agree|note|find)|experts?\s+(?:agree|say|report)|industry\s+consensus|commonly\s+(?:reported|held|believed|understood)|widely\s+(?:reported|believed|held)|reportedly|it is (?:said|believed|reported|understood)|is (?:said|believed|thought|reported) to\b|anecdotally|conventional wisdom|\b\w+s\s+(?:broadly|generally|widely|largely|mostly|commonly|typically)\s+(?:agree|report|say|hold|find))/i;

/** Hedging that reveals the checking rather than the subject. */
const PROCESS_HEDGE = /\b(?:depend\w*\s+on\s+which\s+\w+\s+you\s+(?:read|use|pick|choose)|which\s+\w+\s+you\s+read|sources?\s+(?:vary|differ)\s+by|varies?\s+by\s+(?:method|source|publisher)|what(?:'s| is)\s+(?:genuinely\s+)?established|what\s+(?:nobody|no\s?one)(?:'s| has)?\s+measured|the exact number shifts)\b/i;

/**
 * A source named inside the copy.
 *
 * Two shapes, and the second is the one that keeps getting through: "A regional study by the
 * Observatori Marina Alta found…" and "Visit Jávea puts the drive at 16km" put the provenance in
 * the sentence where the fact belongs. Attribution is a footnote; a slide is not a footnote.
 */
const ATTRIBUTION = [
  // "A regional study by the Observatori Marina Alta found…"
  /\b(?:[Aa]|[Aa]n|[Tt]he|[Oo]ne)\s+(?:\w+\s+){0,3}(?:stud(?:y|ies)|report|survey|index|analysis|research|dataset|figures?)\s+(?:by|from|published by)\s+(?:the\s+|el\s+|la\s+)?[A-ZÀ-Ý]/,
  // "…in the 2019 Observatori Marina Alta study"
  /\b(?:in|from|per)\s+(?:a|an|the)\s+(?:\d{4}\s+)?[A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ]*){0,3}\s+(?:stud(?:y|ies)|report|survey|index|analysis|series)\b/,
  // "Visit Jávea puts the drive at 16km", "Idealista listed Dénia at…" — handled below, because a
  // PLACE that recorded something is the subject of a fact, not the source of one.
  // "According to a Banco de España report…"
  /\b(?:[Aa]ccording to|[Pp]er|[Bb]ased on|[Cc]ited (?:by|in)|[Ss]ourced from|[Ff]igures? from|[Dd]ata from)\s+(?:a|an|the)?\s*[A-ZÀ-Ý]/,
  // "Official Interior figures for 2025 put…"
  /\b(?:official|government|national|regional|ministry|ministerial)\s+(?:\w+\s+){0,2}(?:figures?|data|statistics|series|records?)\s+(?:for|from|put|show|record|give)/i,
];

/** Does this sentence attribute its content to a source, inside the copy? */
/** A named organisation, followed by a reporting verb. Excludes places, which are subjects. */
const REPORTER = /\b([A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+(?:&|and|de|del|la|el|of)?\s*[A-ZÀ-Ý][\wÀ-ÿ]*){0,3})(?:\s+(?:data|figures?|report|reports|study|studies|survey|index|analysis|series|numbers))?\s+(?:puts|places|listed|lists|reports|reported|records|recorded|found|finds|shows|showed|says|said|estimates|estimated|publishes|published|gives|gave)\b/g;

/**
 * Producers whose name in the copy is a deliberate strengthening, not a leak.
 *
 * Christian, 2026-09-05: "INE figures show…" or "According to the latest Notariado data…" can
 * intentionally strengthen a data-led post. Naming the official producer of a figure is authority.
 * Naming whatever page the research happened to land on — Visit Jávea, a regional study, a portal —
 * is a footnote, and a slide is not a footnote.
 */
const AUTHORITY = /\b(?:INE\b|Instituto Nacional de Estad[íi]stica|AEAT\b|Agencia Tributaria|BOE\b|Bolet[íi]n Oficial|C[óo]digo Civil|C[óo]digo Penal|Registradores|Notariado|Consejo General del Notariado|Colegio Notarial|Ministerio del Interior|Ministerio de [A-ZÀ-Ý]\w+|Catastro|Generalitat|Banco de Espa[ñn]a|Eurostat|Tribunal Supremo|Supreme Court|Audiencia Provincial|Fiscal[íi]a|UNESCO)\b/i;

/** Is the source named here an official producer of the fact, rather than a page we happened on? */
export function intentionalAuthority(text: string): boolean {
  return AUTHORITY.test(text ?? '');
}

/** "<Publisher> data for 2025 shows…" — the name owns the data rather than the data being about it. */
const PUBLISHER_DATA = /\b([A-ZÀ-Ý][\wÀ-ÿ]*(?:\s+[A-ZÀ-Ý][\wÀ-ÿ]*){0,3})\s+(?:figures?|data|statistics|series|records?|index)\b[^.]{0,24}?\b(?:show|shows|showed|put|puts|record|records|give|gives|report|reports)\b/g;

/** Does this sentence footnote itself to a source that is not an official producer? */
export function attributesSource(text: string): boolean {
  const t = text ?? '';
  if (intentionalAuthority(t)) return false;
  if (ATTRIBUTION.some((r) => r.test(t))) return true;
  // A named organisation doing the reporting. A PLACE doing it is the subject of a fact — "Alicante
  // recorded the highest share" — and flagging that would delete a perfectly good sentence.
  for (const re of [REPORTER, PUBLISHER_DATA]) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      if (!isPlaceName(m[1])) return true;
    }
  }
  return false;
}

/**
 * Does this sentence talk about our evidence rather than about the world?
 *
 * The line that matters: narrating the PROCESS is leakage, stating a fact about what is PUBLISHED
 * is content. "We could not verify which nationality leads" is the machinery showing. "No municipal
 * nationality ranking is published" is a checkable fact about the world that the verified bank
 * itself asserts, and blocking it would delete the honest half of a good post.
 */
export function narratesEvidence(text: string): boolean {
  if (NARRATION_ANY.test(text)) return true;
  if (VAGUE_AUTHORITY.test(text)) return true;
  if (PROCESS_HEDGE.test(text)) return true;
  return EVIDENCE_SUBJECT.test(text) && EVIDENCE_PREDICATE.test(text);
}

export type Assertion = 'FACTUAL' | 'POSITIONING';

/**
 * What does this sentence claim?
 *
 * Positioning is recognised by the speaker taking a stance, telling the reader what to do, or
 * reframing — never by the absence of a number. A generalisation about how a class of thing behaves
 * is factual whether or not it carries a figure.
 */
export function classifyAssertion(text: string): Assertion {
  const t = text.trim();
  if (!t) return 'POSITIONING';

  // An empirical generalisation stays factual even when wrapped in first-person framing:
  // "we think exclusive listings sell faster" still asserts that they sell faster.
  //
  // It needs a predicate that REPORTS BEHAVIOUR, not merely a comparative. "Your home deserves
  // better marketing" has a class subject and a comparative, and it asserts nothing about the
  // world — "deserves" is a value, not an outcome.
  const empirical = CLASS_SUBJECT.test(t) && OUTCOME.test(t);

  if (!empirical && (STANCE.test(t) || EXHORTATION.test(t) || FRAMING.test(t))) return 'POSITIONING';
  if (empirical) return 'FACTUAL';

  // A bare stance, exhortation or framing with no empirical content is the agency's position.
  if (STANCE.test(t) || EXHORTATION.test(t) || FRAMING.test(t)) return 'POSITIONING';

  // Ambiguous: demanding evidence for an opinion costs a rewrite; publishing an unevidenced claim
  // costs being wrong in public. Treat it as factual.
  return 'FACTUAL';
}

/**
 * A material factual claim that has no verified support may not be resolved as an opinion.
 *
 * Without this, the chain has a door in it: a claim the support pass could not evidence falls
 * through to classifyAssertion, and any sentence that reads as a stance leaves as
 * OPINION_POSITIONING. "Practitioner consensus holds that a stale listing makes buyers suspicious"
 * is a claim about the world wearing an opinion's clothes.
 */
const MATERIAL_TYPES = new Set(['FACTUAL_MATERIAL', 'TIME_SENSITIVE_FACT', 'LOCAL_FACT',
  'CAUSAL_INFERENCE', 'QUANTIFIED_CLAIM', 'LEGAL_CONSEQUENCE', 'AGENCY_FACT']);

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

  // THE INVARIANT. SUPPORTED_BY_RESEARCH used to mean the sentence shared enough words with the
  // briefing — which is how a claim the verifier had just described as "no evidence establishes
  // this" came out the other side marked supported. It now means one thing only: a support record
  // exists for this sentence, naming a page that was actually opened, quoting words that are
  // actually on it. No record, no resolution.
  if (input.supported === true) return 'SUPPORTED_BY_RESEARCH';

  if (input.type === 'MARKETING_PUFFERY') return 'MARKETING_PUFFERY';
  if (input.type === 'OPINION_POSITIONING' || input.type === 'CREATIVE_HOOK') return 'OPINION_POSITIONING';
  // A generic invitation to talk needs nothing. A specific promised service or deliverable needs a
  // capability source — the agency's own profile — because Aivena does not get to invent what an
  // agency offers just because an estate agency could plausibly offer it.
  if (GENERIC_CONTACT.test(input.text) && !PROMISED_DELIVERABLE.test(input.text)) {
    return 'SERVICE_PROMISE_ALLOWED';
  }
  if (PROMISED_DELIVERABLE.test(input.text)) {
    return evidenceOverlap(input.text, input.agencyEvidence) >= 0.5
      ? 'SUPPORTED_BY_AGENCY_PROFILE' : 'NEEDS_REPAIR';
  }

  // What does the sentence CLAIM? Not what does it look like. A mislabelled opinion should not be
  // repaired away, and a claim about how the market behaves needs evidence with or without a figure.
  // A claim the extractor typed as material has already been judged an assertion about the world,
  // and no reading of its wording may downgrade that to a position.
  if (!MATERIAL_TYPES.has(input.type) && classifyAssertion(input.text) === 'POSITIONING') {
    return 'OPINION_POSITIONING';
  }

  return 'NEEDS_REPAIR';
}


/* ── PLACES ──────────────────────────────────────────────────────────────────────────────── */

// Towns, and the regions and countries a post can legitimately be about. Kept here, in the pure
// module, because two different checks need it: bank-card scope, and telling a PLACE that recorded
// something ("Alicante recorded the highest share") from a PUBLISHER that reported something
// ("Idealista listed Dénia at 3,404 €/m²"). Without that distinction the citation rule flags the
// subject of a perfectly good sentence.
const TOWN = /\b(J[áa]vea|X[àa]bia|D[ée]nia|Moraira|Teulada|Calpe|Calp|Benissa|Altea|Alt[ée]a|Benidorm|Torrevieja|Orihuela|Guardamar|Santa Pola|El Campello|Villajoyosa|Finestrat|Polop|La Nucia|Albir|Pego|Ondara|Pedreguer|Benitachell|Poble Nou|San Javier|Cartagena|Marbella|Estepona|Nerja|Sitges|Alicante city)\b/gi;
const REGION = /\b(?:Alicante|Valencia|Murcia|M[áa]laga|Barcelona|Madrid|Sevilla|Costa Blanca|Costa del Sol|Costa C[áa]lida|Marina Alta|Marina Baixa|Vega Baja|Comunidad Valenciana|Comunitat Valenciana|Andaluc[íi]a|Catalu[ñn]a|Catalonia|Baleares|Balearics|Canarias|Ibiza|Mallorca|Menorca|Spain|Espa[ñn]a|Europe|the EU)\b/gi;

const CANON = (p: string) => p.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/^xabia$/, 'javea').replace(/^calp$/, 'calpe').replace(/^altea$/, 'altea');
/** The distinct places a piece of text names, canonicalised so Xàbia and Jávea are one place. */
export function placesIn(text: string): Set<string> {
  return new Set(Array.from((text ?? '').matchAll(TOWN), (m) => CANON(m[1])));
}

/** Towns AND the regions and countries a fact can belong to — for checking geography drift. */
export function placesOrRegionsIn(text: string): Set<string> {
  const out = placesIn(text);
  REGION.lastIndex = 0;
  for (const m of (text ?? '').matchAll(REGION)) out.add(CANON(m[0]));
  return out;
}

/** Is this capitalised token a place rather than an organisation that could report something? */
export function isPlaceName(name: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  TOWN.lastIndex = 0; REGION.lastIndex = 0;
  return new RegExp(`^(?:${TOWN.source}|${REGION.source})$`, 'i').test(n);
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT EACH PUBLISHED FIELD IS FOR
 *
 * The schema publishes twenty text fields and the factual gate walked fourteen of them. Hashtags
 * and the swipe cue reach every reader and nothing looked at either. They do not all need the same
 * treatment — running claim extraction on the literal word "Desliza" is waste — so each field gets
 * a policy and every published field has one.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type FieldPolicy = 'claim' | 'cta' | 'static' | 'hashtags';

/** What kind of checking this field gets. Unknown fields are treated as claim-bearing, not skipped. */
export function fieldPolicy(field: string): FieldPolicy {
  const base = field.replace(/^tips\[\d+\]\./, '').replace(/^quote_parts\[\d+\]$/, 'quote_parts');
  if (base === 'swipe_cue') return 'static';
  if (base === 'hashtags') return 'hashtags';
  // A call to action promises a conversation or a deliverable. That is a capability question, not
  // an evidence question, and it gets its own cheap rule rather than the whole pipeline.
  if (base === 'cta_action' || base === 'cta_keyword') return 'cta';
  return 'claim';
}

/** Every text field the plan publishes, in render order, with its policy. */
export const PUBLISHED_FIELDS: readonly { field: string; policy: FieldPolicy }[] = [
  'eyebrow', 'hook_title', 'slide2_title', 'slide2_body', 'tips[].title', 'tips[].body',
  'tips[].teaser', 'recap_title', 'save_line', 'quote_hook', 'quote_parts', 'quote_context',
  'attribution', 'cta_heading', 'cta_action', 'cta_keyword', 'agency_line', 'caption',
  'swipe_cue', 'hashtags',
].map((field) => ({ field, policy: fieldPolicy(field) }));

/**
 * Does this published field stop before it finishes saying something?
 *
 * Prose has to end on terminal punctuation — a body or a caption without one was cut. A headline
 * legitimately has none, so it is judged on whether its last word can end a phrase at all: "…than
 * other", "…among other", "…for people who actually" cannot. Applies to every claim-bearing field,
 * not only the three prose ones, which is how four cut headlines shipped while the counter read nil.
 */
export function fieldIncomplete(field: string, text: string): boolean {
  const policy = fieldPolicy(field);
  if (policy !== 'claim' && policy !== 'cta') return false;
  const t = (text ?? '').trim();
  if (!t) return false;
  if (PROSE_FIELD.test(field)) return !/[.!?…]["'”’)]?$/.test(t);
  return endsMidThought(t);
}


/* ── HASHTAGS ────────────────────────────────────────────────────────────────────────────── */

/** Superlatives and guarantees. A hashtag is short, but it is still the agency saying something. */
const TAG_CLAIM = /^(?:no1|number1|nº1|best|cheapest|fastest|top|leading|guaranteed|guarantee|riskfree|bestprices?|lowestprices?|topagent\w*|bestagent\w*|sellfast|quicksale|goldenvisa|visadoro|taxfree|notax|zerotax)$/i;

/**
 * Structural and brand sanity on the hashtags. Deliberately NOT the factual verifier — running
 * claim extraction over "#CostaBlanca" is waste — but they publish on every post and until now
 * nothing looked at them at all.
 *
 * Three things are removed: a tag that is not a usable hashtag, a tag that makes a claim the post
 * would have had to evidence in prose, and a tag naming a place this agency does not work in.
 */
export function checkHashtags(
  tags: readonly string[] | undefined, markets = '',
): { tags: string[]; removed: { tag: string; why: string }[] } {
  const out: string[] = [];
  const removed: { tag: string; why: string }[] = [];
  const known = placesIn(markets);
  const seen = new Set<string>();
  for (const raw of tags ?? []) {
    const tag = String(raw ?? '').replace(/[#\s]/g, '').trim();
    if (tag.length < 2 || tag.length > 40) { removed.push({ tag: String(raw), why: 'not a usable hashtag' }); continue; }
    const key = tag.toLowerCase();
    if (seen.has(key)) { removed.push({ tag, why: 'duplicate' }); continue; }
    if (TAG_CLAIM.test(key)) { removed.push({ tag, why: 'makes a claim the post would have to evidence' }); continue; }
    // A place in the tag that the agency does not work in: only checked when we know its markets,
    // and only for places we recognise, so an ordinary word is never mistaken for a town.
    if (known.size) {
      const inTag = placesIn(tag.replace(/([a-z])([A-Z])/g, '$1 $2'));
      const foreign = [...inTag].filter((pl) => !known.has(pl));
      if (foreign.length) { removed.push({ tag, why: `names ${foreign.join('/')}, where this agency does not work` }); continue; }
    }
    seen.add(key);
    out.push(tag);
    if (out.length === 5) break;   // Instagram's own cap since December 2025
  }
  return { tags: out, removed };
}


/**
 * Take one claim out of a plan, the same way everywhere.
 *
 * gatePlan learned this the hard way — deleting a sentence from a TITLE empties the card, and a
 * live run shipped "2. (blank)" over an orphan body. The post-editor bank check and the final
 * deterministic pass were then written as their own `dropSentence` calls with none of that
 * protection, so the lesson held in one place and not in the two that run last.
 *
 * Prose loses the sentence. A headline takes its whole slide with it. Anything else is left, and
 * reported, because a hole in the deck is worse than a sentence nobody could isolate.
 */
export function removeClaim<T extends PlanLike>(
  plan: T, field: string, text: string,
): { plan: T; outcome: 'sentence removed' | 'slide removed' | 'left' } {
  const before = readField(plan, field);
  const isProse = /(?:\.body|slide2_body|caption)$/.test(field);
  if (isProse) {
    const after = dropSentence(before, text);
    if (after !== before && after.trim().length >= 40) {
      return { plan: writeField(plan, field, after), outcome: 'sentence removed' };
    }
  }
  const tip = /^tips\[(\d+)\]\./.exec(field);
  if (tip) {
    const tips = [...(plan.tips ?? [])];
    const i = Number(tip[1]);
    if (tips[i]) {
      // Blank the body: the survival filter that runs at the end of the gate drops the slide.
      tips[i] = { ...tips[i], body: '' };
      return { plan: { ...plan, tips } as T, outcome: 'slide removed' };
    }
  }
  if (isProse) {
    const after = dropSentence(before, text);
    if (after !== before) return { plan: writeField(plan, field, after), outcome: 'sentence removed' };
  }
  return { plan, outcome: 'left' };
}


/* ── THE COMMENT KEYWORD ─────────────────────────────────────────────────────────────────── */

const foldWords = (t: string) => (t ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const KEYWORD_STOP = new Set(`the and for you your with what how why when this that from into
about which does can could should would actually really once after before more less than then
buying selling buy sell home homes house property properties costa blanca spain spanish`.split(/\s+/));

/** The SHOUTED word in a comment CTA — "Comment ARRAS and we'll…" → "ARRAS". */
export function ctaKeyword(text: string): string {
  const m = /\b([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9]{2,})\b/.exec(text ?? '');
  return m ? m[1] : '';
}

/**
 * A comment keyword the reader can connect to the post they just read.
 *
 * A live deck about new build versus resale closed with "Comment ROUTE" — a word from nowhere,
 * which reads as a leftover and gives the reader nothing to hold on to. The keyword has to come
 * from the post's own subject.
 */
export function keywordFitsTopic(keyword: string, subject: string): boolean {
  const k = foldWords(keyword);
  if (!k || k.length < 3) return false;
  const words = new Set<string>(foldWords(subject).split(' ').filter(Boolean));
  for (const w of words) {
    if (w === k || w.startsWith(k) || k.startsWith(w.slice(0, Math.max(4, k.length - 2)))) return true;
  }
  return false;
}

/** A keyword drawn from what the post is actually about. Empty when nothing suitable exists. */
export function keywordFromTopic(subject: string): string {
  const words = foldWords(subject).split(' ')
    .filter((w) => w.length >= 4 && w.length <= 10 && !KEYWORD_STOP.has(w) && !/^\d+$/.test(w));
  return words.length ? words[0].toUpperCase() : '';
}

/** Swap an unrelated keyword for one the post earns. Returns the text unchanged when it fits. */
export function fitCtaKeyword(text: string, subject: string): string {
  const current = ctaKeyword(text);
  if (!current || keywordFitsTopic(current, subject)) return text;
  const better = keywordFromTopic(subject);
  return better ? text.replace(current, better) : text;
}
