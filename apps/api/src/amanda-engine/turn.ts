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
import { runGates, classifyDraft, type Verifier } from './gates';
import { validateDraft, screenLanguageDrift } from './validators';
import { detectConfirmation } from './confirmation';
import { runActionTool, type AmandaMode } from './modes';
import { buildSystemPrompt, buildUserContext, type TurnContext, PROMPT_VERSION } from './prompt';
import { normalizeLeadLanguage, isShapeOnly, trimToBudget, SHORT_MAX_WORDS, MEDIUM_MAX_WORDS, LONG_MAX_WORDS } from './validators';
import type { ToolBackends } from './tools';

// Dead-air law (live demo 2026-08-28: a gate-blocked reply left the buyer in
// SILENCE): when the draft dies at the gates and a human-review task exists,
// the buyer still gets an honest, deterministic holding line — office-framed,
// number-free, pre-vetted, so it needs no gate pass. 13 locales.
export const GATE_FALLBACK: Record<string, string> = {
  en: 'Good question — I want to be completely sure of the details here, so a colleague at the office is double-checking. We will get back to you shortly.',
  es: 'Buena pregunta. Quiero estar totalmente segura de los detalles, así que un compañero de la oficina lo está comprobando. Te respondemos en breve.',
  de: 'Gute Frage — ich möchte bei den Details ganz sicher sein, deshalb prüft das gerade eine Kollegin im Büro. Wir melden uns in Kürze bei dir.',
  nl: 'Goede vraag — ik wil helemaal zeker zijn van de details, dus een collega op kantoor kijkt het even na. We komen er snel bij je op terug.',
  fr: 'Bonne question — je veux être totalement sûre des détails, donc un collègue du bureau vérifie. Nous revenons vers vous très vite.',
  it: 'Bella domanda — voglio essere del tutto sicura dei dettagli, quindi un collega in ufficio sta verificando. Ti rispondiamo a breve.',
  pt: 'Boa pergunta — quero ter a certeza absoluta dos detalhes, por isso um colega do escritório está a verificar. Voltamos já ao contacto.',
  pl: 'Dobre pytanie — chcę mieć całkowitą pewność co do szczegółów, więc kolega z biura to sprawdza. Wkrótce wracamy z odpowiedzią.',
  sv: 'Bra fråga — jag vill vara helt säker på detaljerna, så en kollega på kontoret dubbelkollar. Vi återkommer strax.',
  nb: 'Godt spørsmål — jeg vil være helt sikker på detaljene her, så en kollega på kontoret dobbeltsjekker. Vi kommer tilbake til deg snart.',
  da: 'Godt spørgsmål — jeg vil være helt sikker på detaljerne, så en kollega på kontoret dobbelttjekker. Vi vender snart tilbage.',
  fi: 'Hyvä kysymys — haluan olla täysin varma yksityiskohdista, joten kollega toimistolla tarkistaa asian. Palaamme pian.',
  ru: 'Хороший вопрос — я хочу быть полностью уверенной в деталях, поэтому коллега в офисе всё проверяет. Мы скоро вернёмся с ответом.',
};

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
  turnClass: 'social' | 'fact_bearing' | null;   // §2 false-block budget telemetry
  promptVersion: string;
}

export async function runTurn(
  mode: AmandaMode,
  ctx: TurnContext,
  inbound: InboundMessage,
  pendingAction: PendingActionView | null,
  deps: TurnDeps,
): Promise<TurnResult> {
  const base: Omit<TurnResult, 'outcome' | 'bookingQueued' | 'turnClass'> & { turnClass: TurnResult['turnClass'] } = {
    replyText: null, gateFailures: [], loop: null, bookingId: null, turnClass: null, promptVersion: PROMPT_VERSION,
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
  base.turnClass = classifyDraft(draft);

  // ── 3. The law: validators + gates, one constrained regeneration ───────────
  // Long-form (≤120 words) is deterministically earned, never assumed: only a
  // turn that actually fetched full property details may run longer (§10 B1 —
  // "summarizing a property they requested"). Everything else stays short.
  // A turn that did REAL work earns room to report it. Previously only
  // get_property_details did, so "is there anything near the Norwegian school?"
  // — answered off research_area + search_properties — was held to 35 words and
  // died there (Christian, live 2026-08-29). Research and a genuine property
  // search are exactly the turns that need a sentence or two more.
  // TWO long-form tiers, not one. Fetching a specific property (or relaying an
  // office answer) is a summary and earns the full budget. Research and a
  // search earn the MIDDLE budget: enough for the answer, two homes and one
  // next step — Christian 2026-08-29 got a bullet-pointed report instead.
  const usedTool = (name: string) =>
    loop.toolEvents.some((ev) => ev.tool === name && ev.result.ok && !ev.result.refused);
  const fullFormTurn = usedTool('get_property_details');
  const mediumFormTurn = usedTool('research_area') || usedTool('search_properties');
  const allowLongForm = fullFormTurn || mediumFormTurn;
  const authoritative = ctx.officeAnswerText ? [ctx.officeAnswerText] : [];
  // Office-promise law input: the machinery keeps the promise only when an
  // ask_agency call succeeded THIS turn (simulated counts — shadow parity), a
  // ticket is already open, or an office answer is being relayed.
  const officeContextPresent =
    loop.toolEvents.some((ev) => ev.tool === 'ask_agency' && ev.result.ok && !ev.result.refused) ||
    Boolean(ctx.openTicketNote) || Boolean(ctx.officeAnswerText);
  // Language law yields when the BUYER writes English (a Norwegian lead
  // switching to English must get English back — mirroring beats the stored
  // code; review-verified gap). The same drift profile detects it.
  const buyerWroteEnglish = !screenLanguageDrift(inbound.text, ctx.leadLanguage).ok;
  const judge = async (text: string) => {
    // A relay turn may run long-form: the office answer needs attribution + context.
    const v = validateDraft(text, {
      allowLongForm: allowLongForm || authoritative.length > 0,
      longFormBudget: fullFormTurn || authoritative.length > 0 ? LONG_MAX_WORDS : MEDIUM_MAX_WORDS,
      mirrorTargetWords: ctx.mirrorTargetWords ?? undefined,
      expectedLanguage: buyerWroteEnglish ? undefined : ctx.leadLanguage,
      officeContextPresent,
    });
    // The buyer's own message grounds NUMBERS only (echoing "under 500 000€"
    // back is mirroring, not invention — live demo 2026-08-28); it is never
    // an "office answer" to the verifier and never earns long-form.
    // What Amanda and the agency have ALREADY said to this buyer. Those turns
    // passed these gates before they were sent and are sitting on the buyer's
    // phone, so restating them is continuity — not a fact appearing from
    // nowhere. Without this, answering a question a SECOND time (no tool calls,
    // because she already knows) is rejected as ungrounded (live 2026-08-30).
    const alreadyTold = ctx.recentTurns
      .filter((t) => t.role === 'amanda' || t.role === 'agent')
      .map((t) => t.text)
      .filter((t) => t.trim().length > 0);
    const g = await runGates(text, loop.toolEvents, deps.verifier, authoritative, [inbound.text], alreadyTold);
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
  // SHAPE-ONLY RESCUE. If everything still wrong with the draft is shape —
  // too long, too many sentences, over the mirror band — then the ANSWER is
  // sound and only its size is not. Cut it to the budget deterministically and
  // send. Escalating here is what produced the live failure: a researched,
  // correct reply replaced by "a colleague will double-check" plus a take-over
  // card. Truth and safety failures are untouched by this and still escalate.
  if (failures.length > 0 && isShapeOnly(failures)) {
    const budget = fullFormTurn || authoritative.length > 0
      ? LONG_MAX_WORDS
      : mediumFormTurn
        ? MEDIUM_MAX_WORDS
        : SHORT_MAX_WORDS;
    const trimmed = trimToBudget(draft, budget);
    // Only accept the trim if it actually resolved everything — a trim that
    // still breaks a rule must not sneak past the gates.
    if (trimmed && trimmed !== draft) {
      const afterTrim = await judge(trimmed);
      if (afterTrim.length === 0) {
        draft = trimmed;
        failures = [];
      }
    }
  }
  if (failures.length > 0) {
    await escalate('gates_failed', failures.join(', '));
    // Never dead air: the human-review task is real, so the office-framed
    // holding line is an honest promise. Deterministic, number-free,
    // pre-vetted — dispatched under the same mode law (shadow simulates,
    // approval drafts, assisted/full sends).
    const fallback = GATE_FALLBACK[normalizeLeadLanguage(ctx.leadLanguage) ?? 'en'] ?? GATE_FALLBACK.en;
    await runActionTool(mode, 'reply', async () => deps.sendReply(fallback), {
      simulatedData: { simulated: true },
      queue: async (kind) => deps.queueDraft(fallback, kind),
    }).catch(() => { /* the escalation task already covers the human path */ });
    return { ...base, bookingQueued, outcome: 'escalated', replyText: fallback, gateFailures: failures, loop, bookingId };
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
