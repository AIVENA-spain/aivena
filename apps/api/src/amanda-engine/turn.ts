// Amanda engine — the turn orchestrator (design §4). One inbound message in,
// one governed outcome out:
//
//   1. DETERMINISTIC PRE-STEP — booking confirmation is code, never the model:
//      a button postback (pending_action_id) or a conservative text affirmation
//      against exactly ONE unexpired pending action executes the booking; a
//      decline releases it; anything unclear falls through to the model with
//      the pending proposal in context (re-ask, never guess).
//   2. THE LOOP — agentic tool loop under the mode law (tools.ts/modes.ts).
//   3. THE LAW — validators (§10) + grounding gates (§2). One constrained
//      regeneration with explicit feedback; still failing → human queue, the
//      draft never leaves.
//   4. DISPATCH — the reply itself goes through runActionTool('reply'):
//      shadow simulates, approval queues a draft, assisted/full send.
//
// Every effect is behind TurnDeps so golden scenarios run the ENTIRE machine
// scripted — no network, no database.

import { runAgentLoop, type ModelCall, type LoopResult } from './agent-loop';
import { runGates, type Verifier } from './gates';
import { validateDraft } from './validators';
import { detectConfirmation } from './confirmation';
import { runActionTool, type AmandaMode } from './modes';
import { buildSystemPrompt, buildUserContext, type TurnContext, PROMPT_VERSION } from './prompt';
import type { ToolBackends } from './tools';

export interface PendingActionView {
  id: string;
  echo: string;                       // "Friday 28 August, 17:00 · Chalet IC-28746"
  expiresAtMs: number;
}

export interface InboundMessage {
  text: string;
  buttonPayload: string | null;       // WhatsApp interactive reply → pending_action_id
  providerMessageId: string;
  atMs: number;
}

export interface TurnDeps {
  callModel: ModelCall;
  backends: ToolBackends;
  verifier: Verifier | null;
  /** Deterministic booking execution from a CONFIRMED pending action — the only
   *  path that creates a booking. slot_taken = the EXCLUDE constraint (or a
   *  validity check) refused: the turn continues and offers alternatives. */
  executeBooking(pendingActionId: string): Promise<
    { ok: true; bookingId: string; echo: string } | { ok: false; reason: 'slot_taken' | 'action_invalid' }
  >;
  releasePendingAction(pendingActionId: string, reason: 'declined' | 'superseded'): Promise<void>;
  /** Queue a booking confirmation for agent approval — its OWN task type,
   *  never a 'suggested_reply' (the live approve RPC sends those verbatim to
   *  the buyer — reviewer-confirmed placeholder-to-buyer bug). */
  queueBookingConfirm(pendingActionId: string, echo: string): Promise<void>;
  /** Reply dispatch effects per mode. */
  sendReply(text: string): Promise<{ providerMessageId: string | null }>;
  queueDraft(text: string, kind: 'draft' | 'one_tap'): Promise<void>;
  escalateToHuman(reason: string, detail: string): Promise<void>;
}

export type TurnOutcomeKind =
  | 'sent'                 // reply went out (assisted/full)
  | 'drafted'              // reply queued for approval (approval mode)
  | 'simulated'            // shadow: nothing left the building
  | 'booked_and_sent' | 'booked_and_drafted' | 'booked_and_simulated'
  | 'escalated'            // gates failed twice / handoff — human queue
  | 'refused';             // mode off / kill

export interface TurnResult {
  outcome: TurnOutcomeKind;
  replyText: string | null;
  gateFailures: string[];
  loop: LoopResult | null;
  bookingId: string | null;
  bookingQueued: boolean;      // approval/assisted: a booking-confirm task was filed
  promptVersion: string;
}

export async function runTurn(
  mode: AmandaMode,
  ctx: TurnContext,
  inbound: InboundMessage,
  pendingAction: PendingActionView | null,
  deps: TurnDeps,
): Promise<TurnResult> {
  const base: Omit<TurnResult, 'outcome' | 'bookingQueued'> = {
    replyText: null, gateFailures: [], loop: null, bookingId: null, promptVersion: PROMPT_VERSION,
  };
  if (mode === 'off') return { ...base, bookingQueued: false, outcome: 'refused' };

  // ── 1. Deterministic confirmation pre-step ─────────────────────────────────
  let bookingId: string | null = null;
  let bookingEcho: string | null = null;
  let wouldBook = false;                        // shadow: record what WOULD have booked
  let bookingQueued = false;                    // approval/assisted: confirm task filed
  let effectivePending = pendingAction;
  if (pendingAction && pendingAction.expiresAtMs > inbound.atMs) {
    const affirmedByButton = inbound.buttonPayload === pendingAction.id;
    const textVerdict = affirmedByButton ? 'affirm' : detectConfirmation(inbound.text, ctx.leadLanguage);
    if (textVerdict === 'affirm') {
      // Booking is commitment-class: the mode law governs it here exactly as it
      // would a tool call — shadow simulates, approval leaves it for the draft.
      const result = await runActionTool(mode, 'commitment', async () => deps.executeBooking(pendingAction.id), {
        simulatedData: { simulated: true },
        queue: async () => deps.queueBookingConfirm(pendingAction.id, pendingAction.echo),
      });
      if (result.ok && !result.simulated && !result.queued) {
        const data = result.data as Awaited<ReturnType<TurnDeps['executeBooking']>>;
        if (data.ok) {
          bookingId = data.bookingId;
          bookingEcho = data.echo;
          effectivePending = null;
        } else {
          // The DB arbiter refused (slot just taken / action no longer valid):
          // keep NOTHING booked; hand the model an honest note to offer options.
          await runActionTool(mode, 'internal_write', () => deps.releasePendingAction(pendingAction.id, 'superseded'));
          effectivePending = {
            ...pendingAction,
            echo: `${pendingAction.echo} — that slot was JUST TAKEN and is no longer available: apologize briefly and offer to line up new times (propose_viewing_slots)`,
          };
        }
      } else if (result.simulated) {
        bookingEcho = pendingAction.echo;      // shadow: phrase it, book nothing
        effectivePending = null;
        wouldBook = true;
      } else if (result.queued) {
        // approval/assisted: the confirm task is filed for the agent; the model
        // must tell the buyer it's being locked in — never re-ask.
        bookingQueued = true;
        bookingEcho = pendingAction.echo;
        effectivePending = null;
      }
    } else if (textVerdict === 'decline') {
      // internal_write class: real release in live modes, simulated in shadow —
      // shadow must stay zero-write beyond telemetry (reviewer-confirmed gap).
      await runActionTool(mode, 'internal_write', () => deps.releasePendingAction(pendingAction.id, 'declined'));
      effectivePending = null;
    }
    // 'unclear' → the proposal stays in context; the model re-asks explicitly.
  } else if (pendingAction) {
    effectivePending = null;                    // expired — never acted on
  }

  // ── 2. The loop ────────────────────────────────────────────────────────────
  const loopCtx: TurnContext = {
    ...ctx,
    pendingActionEcho: bookingEcho
      ? `CONFIRMED by the buyer just now: ${bookingEcho}${bookingId || wouldBook ? ' (the system HAS booked it — confirm it warmly, explicitly restating day and time)' : ' (awaiting a quick approval by the office — tell them it is being locked in and they will get the confirmation shortly; do NOT re-ask which time)'}`
      : effectivePending?.echo ?? null,
  };
  const system = buildSystemPrompt(loopCtx);
  const userContext = buildUserContext(loopCtx, inbound.text);
  const loop = await runAgentLoop(deps.callModel, mode, deps.backends, system, userContext);

  if (loop.handedOff) {
    // The model invoked handoff_to_human for real (live modes) — its final text
    // is the warm handover line; it still passes the law below.
  }

  // Escalation is an internal write: real task in live modes, SIMULATED in
  // shadow — shadow must never spawn agent-visible tasks (reviewer-confirmed).
  const escalate = (reason: string, detail: string) =>
    runActionTool(mode, 'internal_write', () => deps.escalateToHuman(reason, detail));

  let draft = loop.text?.trim() ?? '';
  if (!draft) {
    await escalate('empty_draft', 'engine produced no reply text');
    return { ...base, bookingQueued, outcome: 'escalated', loop, bookingId };
  }

  // ── 3. The law: validators + gates, one constrained regeneration ───────────
  // Long-form (≤120 words) is deterministically earned, never assumed: only a
  // turn that actually fetched full property details may run longer (§10 B1 —
  // "summarizing a property they requested"). Everything else stays short.
  const allowLongForm = loop.toolEvents.some((ev) => ev.tool === 'get_property_details' && ev.result.ok && !ev.result.refused);
  const judge = async (text: string) => {
    const v = validateDraft(text, { allowLongForm, mirrorTargetWords: ctx.mirrorTargetWords ?? undefined });
    const g = await runGates(text, loop.toolEvents, deps.verifier);
    return [...v.violations, ...g.failures];
  };
  let failures = await judge(draft);
  if (failures.length > 0) {
    const retry = await deps.callModel({
      system,
      messages: [
        { role: 'user', content: userContext },
        { role: 'assistant', content: [{ type: 'text', text: draft }] },
        { role: 'user', content: `Your reply was rejected by the safety layer: ${failures.join(', ')}. Rewrite it fixing exactly these problems. Keep it short, warm, in the buyer's language. Output ONLY the corrected reply text.` },
      ],
      tools: [],
    });
    const fixed = retry.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim();
    if (fixed) {
      const fixedFailures = await judge(fixed);
      if (fixedFailures.length === 0) {
        draft = fixed;
        failures = [];
      } else {
        failures = fixedFailures;
      }
    }
  }
  if (failures.length > 0) {
    await escalate('gates_failed', failures.join(', '));
    return { ...base, bookingQueued, outcome: 'escalated', replyText: null, gateFailures: failures, loop, bookingId };
  }

  // ── 4. Dispatch under the mode law ─────────────────────────────────────────
  const dispatch = await runActionTool(mode, 'reply', async () => deps.sendReply(draft), {
    simulatedData: { simulated: true },
    queue: async (kind) => deps.queueDraft(draft, kind),
  });
  const suffix = bookingId || wouldBook ? 'booked_and_' : '';
  if (dispatch.refused) return { ...base, bookingQueued, outcome: 'refused', replyText: draft, loop, bookingId };
  const outcome = (dispatch.simulated
    ? `${suffix}simulated`
    : dispatch.queued
      ? `${suffix}drafted`
      : `${suffix}sent`) as TurnOutcomeKind;
  return { ...base, bookingQueued, outcome, replyText: draft, gateFailures: [], loop, bookingId };
}
