/**
 * THE LAST PASS BEFORE PUBLICATION.
 *
 * Pure of the environment on purpose. studio-claim-gate.ts imports packages/config/env, which calls
 * process.exit(1) on a missing variable, so nothing in that file can be reached by a test — and
 * `finishCopy` lived there. It is the pass that decides what the reader actually sees, it had zero
 * test coverage for exactly that reason, and a live deck published a slide it had reported as
 * removed. It lives here now, where a test can run it with no environment at all.
 */
import { checkCta } from './studio-evidence';
import {
  capFor, checkHashtags, ctaKeyword, endsMidThought, fieldPolicy, fitCtaKeyword, incompleteBody,
  planFields, readField, settleDeck, shortenToBoundary, writeField, type PlanLike,
} from './studio-copy-gate';

/**
 * What a publication pass writes down. Structural on purpose: GateReport satisfies it, and this
 * module must not import the file GateReport lives in.
 */
export interface CopyReport {
  dropped: number;
  blocked: Array<{ field: string; text: string; verdict: string; problem: string; outcome: string }>;
}

/**
 * The very last thing that touches the copy — caps, complete sentences, no dangling word.
 *
 * This used to live at the end of gatePlan, which meant the editor (and the final deterministic
 * pass) ran AFTER it and could reintroduce exactly what it had cleaned. A live post shipped a card
 * titled "Borrowing is getting more expensive, not" for precisely that reason: the check that
 * catches it had already run. Exported so the orchestrator can call it after everything else.
 */
export function finishCopy<T extends PlanLike>(
  plan: T, report?: CopyReport, markets = '', capabilities = markets,
): T {
  let current = plan;
  // A keyword the reader cannot connect to the post they just read is a leftover. "Comment ROUTE"
  // closed a deck about new build versus resale.
  const subject = `${readField(current, 'hook_title')} ${readField(current, 'eyebrow')} `
    + `${readField(current, 'slide2_title')}`;
  for (const f of planFields(current)) {
    if (fieldPolicy(f.field) !== 'cta') continue;
    const fitted = fitCtaKeyword(f.text, subject);
    if (fitted !== f.text) {
      current = writeField(current, f.field, fitted);
      report?.blocked.push({ field: f.field, text: f.text, verdict: 'UNSUPPORTED',
        problem: `the comment keyword "${ctaKeyword(f.text)}" has nothing to do with the post`,
        outcome: `keyword changed to "${ctaKeyword(fitted)}"` });
    }
  }

  // A CTA that promises a deliverable the agency has not said it produces is rewritten into the
  // conversation it should have been. It never fails a post: the marketing survives, the invented
  // service does not.
  for (const f of planFields(current)) {
    if (fieldPolicy(f.field) !== 'cta') continue;
    const d = checkCta(f.text, capabilities);
    if (d.ok) continue;
    current = writeField(current, f.field, d.rewrite);
    report?.blocked.push({ field: f.field, text: f.text, verdict: 'UNSUPPORTED',
      problem: d.why, outcome: `rewritten as a conversation: "${d.rewrite}"` });
  }
  // Hashtags publish with every post and nothing walked them until now. Structural and brand
  // sanity only — the factual verifier has no business reading the word "Desliza".
  const tagged = current as unknown as { hashtags?: string[] };
  if (Array.isArray(tagged.hashtags)) {
    const { tags, removed } = checkHashtags(tagged.hashtags, markets);
    if (removed.length) {
      current = { ...current, hashtags: tags } as T;
      for (const r of removed) {
        report?.blocked.push({ field: 'hashtags', text: r.tag, verdict: 'UNSUPPORTED',
          problem: r.why, outcome: 'hashtag removed' });
      }
    }
  }
  // Slides whose over-long field cannot be cut anywhere. Collected, then removed in ONE pass after
  // the loop: `planFields` was read off the deck as it stood, so splicing mid-loop would leave every
  // later tips[i] address pointing at the wrong slide.
  const unshippable = new Set<number>();
  for (const f of planFields(current)) {
    const cap = capFor(f.field);
    if (cap && f.text.length > cap) {
      const whole = shortenToBoundary(f.text, cap);
      if (whole !== null) current = writeField(current, f.field, whole);
      else if (/^tips\[\d+\]\./.test(f.field)) {
        // No boundary to cut at. A slide is droppable; a fragment is not shippable.
        //
        // This used to blank the slide's BODY — even when the over-cap field was its TITLE, which
        // punished the wrong half and left the offending headline standing. A live deck published a
        // 113-character title over an empty card, reported as "slide removed". It goes now.
        unshippable.add(Number(/^tips\[(\d+)\]/.exec(f.field)?.[1] ?? -1));
        report?.blocked.push({ field: f.field, text: f.text, verdict: 'OVER_CAP',
          problem: `${f.text.length} characters against a cap of ${cap}, with no sentence or clause `
            + `boundary inside it`, outcome: 'slide removed — cutting it would have shipped a fragment' });
      } else {
        // Left long and reported. A field that renders slightly over is a layout problem; a field
        // cut mid-phrase is a lie about what the writer said.
        report?.blocked.push({ field: f.field, text: f.text, verdict: 'OVER_CAP',
          problem: `${f.text.length} characters against a cap of ${cap}, with no boundary to shorten at`,
          outcome: 'left whole — never cut mid-phrase' });
      }
    }
  }
  if (unshippable.size) {
    const tips = (current.tips ?? []).filter((_, i) => !unshippable.has(i));
    current = { ...current, tips } as T;
    if (report) report.dropped += unshippable.size;
  }
  // A prose card still stopping mid-sentence is cut back to its last complete sentence. Losing a
  // clause beats publishing a fragment; this only runs when a rewrite could not fit the point.
  for (const f of planFields(current)) {
    if (incompleteBody(f.field, f.text)) {
      const whole = f.text.replace(/\s*[^.!?…]*$/, '').trim();
      if (whole.length >= 40) {
        current = writeField(current, f.field, whole);
        if (report) report.dropped++;
      }
    }
  }
  for (const f of planFields(current)) {
    if (endsMidThought(f.text)) {
      current = writeField(current, f.field,
        f.text.replace(/\s+\S+$/, '').replace(/[\s,;:—–-]+$/, ''));
    }
  }
  // THE LAST THING THAT TOUCHES THE DECK. finishCopy is the only pass the orchestrator runs after
  // everything else, so the structural invariant is enforced here: what leaves this function is
  // what is stored and what is rendered.
  return settleDeck(current, report);
}
