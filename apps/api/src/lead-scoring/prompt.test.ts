import { describe, it, expect } from 'vitest';
import { SCORING_FIXTURES } from './fixtures';
import { leadMessagesOf } from './lead-messages';
import { SYSTEM_PROMPT, buildUserContent } from './prompt';

type Shown = {
  conversation: Array<{ id?: string; from: string; text: string }>;
  earlier_lead_messages?: Array<{ id: string; text: string }>;
  lead_messages: Array<{ id: string; text: string }>;
};

describe('what the AI is shown uses the same lead-message numbers as the quote check (v1.4)', () => {
  it.each(SCORING_FIXTURES)('#$id', (fx) => {
    const shown = JSON.parse(buildUserContent(fx.input)) as Shown;
    const numbered = leadMessagesOf(fx.input).map((text, i) => ({ id: `L${i + 1}`, text }));
    // The one list it may quote from…
    expect(shown.lead_messages).toEqual(numbered);
    // …and the same numbers where each message sits in the conversation.
    const inline = [...(shown.earlier_lead_messages ?? []), ...shown.conversation.filter((m) => m.from === 'lead')];
    expect(inline.map((m) => ({ id: m.id, text: m.text }))).toEqual(numbered);
    // Agency messages carry no number, so there is nothing of theirs to cite.
    expect(shown.conversation.filter((m) => m.from === 'agency').every((m) => m.id === undefined)).toBe(true);
  });
});

describe('the quoting examples in the instructions are made up', () => {
  it("none appears in any practice conversation, so the check is never shown its own answers", () => {
    const quoted = [...SYSTEM_PROMPT.matchAll(/"([^"]{6,})"/g)].map((m) => m[1].trim().toLowerCase());
    const examples = [
      ...[...SYSTEM_PROMPT.matchAll(/L\d+: ([^"|]+)/g)].map((m) => m[1].trim().toLowerCase()),
      // Every quoted phrase of three words or more: the wording examples in the definitions.
      ...quoted.filter((q) => q.split(/\s+/).length >= 3),
    ];
    expect(examples.length).toBeGreaterThan(0);
    const everything = SCORING_FIXTURES.flatMap((f) => [...f.input.conversation, ...(f.input.earlierLeadMessages ?? [])].map((m) => m.text))
      .join('\n')
      .toLowerCase();
    for (const ex of examples) expect(everything).not.toContain(ex);
  });
});
