/**
 * The lead's own messages, numbered L1…Ln (v1.4, 2026-09-11). ONE numbering, shared by what the AI is shown (prompt.ts)
 * and what the quote check reads (evidence.ts): if the two ever disagreed, real quotes would be thrown away. The first
 * Scoring check found the AI quoting the agency's words as the lead's; now every quote piece names the lead message it
 * comes from, and it is checked inside that one message only.
 */
import type { ScoringInput } from './types';

/** Every message the lead wrote: the earlier ones first, then the lead's side of the conversation. */
export function leadMessagesOf(input: ScoringInput): string[] {
  return [
    ...(input.earlierLeadMessages ?? []).map((m) => m.text),
    ...input.conversation.filter((m) => m.from === 'lead').map((m) => m.text),
  ];
}

export const leadLabel = (index: number): string => `L${index + 1}`;

export type QuotePiece = { index: number | null; text: string };

/**
 * "L4: max 350k | L9: Sounds good" → [{ index: 3, text: 'max 350k' }, { index: 8, text: 'Sounds good' }].
 * A piece that names no message gets index null; quotation marks around the words are dropped.
 */
export function parseQuote(quote: unknown): QuotePiece[] {
  return String(quote ?? '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((piece) => {
      const m = /^L(\d{1,4})\s*:\s*([\s\S]*)$/i.exec(piece);
      const text = (m ? m[2] : piece).trim().replace(/^["“”'«»]+|["“”'«»]+$/g, '').trim();
      return { index: m ? Number(m[1]) - 1 : null, text };
    });
}
