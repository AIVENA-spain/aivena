/**
 * THE FACTUAL PALETTE — what the writer is allowed to treat as true, given to it BEFORE it writes.
 *
 * Four acceptance runs said the same thing in four different costumes. The engine researched well,
 * then handed the writer a prose briefing and a page of guardrails and let it write from memory —
 * so it wrote "the British still buy the most, province-wide" and "an oral agreement creates no
 * binding obligation" again and again, and the gate deleted a third of every deck. Twenty-two bank
 * contradictions in four posts, every one of them a correct catch of an error the writer should
 * never have been in a position to make.
 *
 * Christian, 2026-09-05: "research → usable factual palette → writer → gate verifies."
 *
 * The palette governs FACTS ONLY. Hooks, framing, opinion, analogy, provocation and every other
 * thing that makes a post worth reading stay free — the palette is the sandbox the marketing is
 * written inside, not the post.
 */
import type { SourceFact } from './studio-evidence';

export interface PaletteInput {
  facts: readonly SourceFact[];
  /** requirements the research did NOT establish — the writer must know what it may not conclude */
  unknown: readonly string[];
  /** verified guardrails: the conclusions this topic is known to invite and known to get wrong */
  forbidden: readonly string[];
  /** what the agency has told us about itself */
  agency: string;
  /** what the agency has told us about its market and its clients, where it has */
  agencyKnowledge?: string;
}

const line = (f: SourceFact) => {
  const tags = [f.metric, f.geography, f.period, f.sourceClass.replace(/_/g, ' ')]
    .filter(Boolean).join(' · ');
  return `  ${f.id}${tags ? ` [${tags}]` : ''} — ${f.canonical.replace(/\s+/g, ' ').trim()}`;
};

/**
 * The block the writer sees. Empty string when there is nothing to constrain — a pure marketing
 * topic gets no palette at all and is written exactly as it was before.
 */
export function buildPalette(input: PaletteInput): string {
  const { facts, unknown, forbidden, agency, agencyKnowledge } = input;
  if (!facts.length && !unknown.length && !forbidden.length) return '';

  const parts: string[] = [
    'WHAT YOU KNOW, AND WHAT YOU DO NOT',
    '',
    'These are the checked facts available for this post. Each one was read off a page that was',
    'actually opened. You may state anything here as fact, in your own words, in any language — you',
    'are writing marketing, not a citation. What you may NOT do is state a fact of this kind that is',
    'not on the list.',
  ];

  if (facts.length) {
    parts.push('', 'ESTABLISHED — you may rely on these:', ...facts.map(line));
  } else {
    parts.push('', 'ESTABLISHED — nothing. No page could be opened for this topic, so this post has',
      'no researched facts available at all. Write it from experience, judgement and position.');
  }

  if (unknown.length) {
    parts.push('', 'NOT ESTABLISHED — you may not assert or imply any of these, in any form:',
      ...unknown.map((u) => `  · ${u.replace(/\s+/g, ' ').trim().slice(0, 300)}`),
      '  Saying "nobody publishes this" is itself a claim about the world; if it is not on the',
      '  established list, write about something else instead.');
  }

  if (forbidden.length) {
    parts.push('', 'FORBIDDEN CONCLUSIONS — these are the specific mistakes this topic invites, and',
      'they have each been made before. They outrank anything you believe:',
      ...forbidden.map((f) => `  · ${f.replace(/\s+/g, ' ').trim().slice(0, 300)}`));
  }

  if (agency.trim()) parts.push('', 'THIS AGENCY:', ...agency.split('\n').map((l) => `  ${l.trim()}`).filter((l) => l.trim()));
  if (agencyKnowledge?.trim()) {
    parts.push('', 'WHAT THIS AGENCY HAS TOLD US ABOUT ITS MARKET:',
      ...agencyKnowledge.split('\n').map((l) => `  ${l.trim()}`).filter((l) => l.trim()));
  }

  parts.push('',
    'HOW TO USE THIS — and read this part carefully, because it decides whether the post is any good:',
    '',
    '· DO NOT WRITE FIVE FACTUAL SLIDES. A five-card deck does not need five laws. Two well-founded',
    '  facts, one practical explanation, one slide that helps the reader decide, and one that says',
    '  what you believe is a BETTER post than five citations. Use facts where facts matter.',
    '· EVERYTHING ELSE IS YOURS. Hooks, framing, analogies, provocations, questions, the voice, the',
    '  argument, the opinion, what the agency would rather do and why — none of that is on this list',
    '  because none of it needs to be. Write it the way you would write it anyway.',
    '· HOW SELLING WORKS IS NOT A FACT THAT NEEDS A SOURCE. "Launching too high can make buyers',
    '  hesitate", "a listing that sits starts to look like a problem", "five versions of one home',
    '  send five different messages" — write those freely. What needs to be on the list is a',
    '  specific claim about a real place, a real market, a real platform, a period of time, a legal',
    '  or tax rule, a ranking, or anything with a number in it.',
    '· IF YOU WANT TO SAY SOMETHING FACTUAL THAT IS NOT HERE: say the broader thing that is true,',
    '  make the point without the fact, or make it a position rather than a claim. Do not reach for',
    '  a number you remember. A figure you did not get from this list is an invention, and it is the',
    '  single way this post can hurt the agency that publishes it.',
  );
  return parts.join('\n');
}
