// Amanda engine — the ProcessTurn implementation the outbox worker runs per
// queue row: load the conversation world in one short transaction, run the
// turn (no tx held across model IO), execute effects in their own short
// transactions, record telemetry. Every skip reason is explicit — a skipped
// row is a decision, never a silent drop.

import { sql } from 'drizzle-orm';
import { withAgency } from '../../../../packages/db/client';
import { runTurn, type TurnDeps, type PendingActionView } from './turn';
import { parseAmandaMode } from './modes';
import { makeDbBackends, parseAmandaSettings, slotLabel, type AmandaAgencySettings } from './backends-db';
import { upcomingCalendarNotes } from './availability-lib';
import { productionModelCall, productionVerifier, ENGINE_MODEL } from './llm';
import { turnId } from './turn-id';
import { narrowPendingByText } from './pending-select';
import { sendTypingIndicator } from './typing';
import { executeBookingFromPendingAction } from './booking-exec';
import { nudgeCalendarSync } from '../routes/calendar-worker';
import type { QueueRow, TurnOutcome } from './outbox-lib';
import type { TurnContext } from './prompt';
import type { LeadStateData } from './lead-state-lib';

interface LoadedWorld {
  mode: ReturnType<typeof parseAmandaMode>;
  agencyName: string;
  settings: AmandaAgencySettings;
  leadFirstName: string | null;
  leadLanguage: string;
  leadPhone: string | null;
  leadFullName: string | null;
  leadState: LeadStateData;
  aiMuted: boolean;
  optedOut: boolean;
  recentTurns: TurnContext['recentTurns'];
  /** Whole days since the newest PRIOR message (null = no history). */
  gapDays: number | null;
  mirrorTargetWords: number | null;
  pendingActions: Array<{ id: string; label: string; expiresAtMs: number }>;
  openTicketNote: string | null;
  humanAnsweredTicketIds: string[];
  agencyKnowledge: string[];
}

async function loadWorld(row: QueueRow): Promise<LoadedWorld | { skip: string }> {
  return withAgency(row.agency_id, async (tx) => {
    const agencyRows = await tx.execute(sql`
      SELECT COALESCE(a.trading_name, a.legal_name, a.slug) AS agency_name, s.amanda_mode, s.amanda_settings
        FROM agency_settings s
        JOIN agencies a ON a.id = s.agency_id
       WHERE s.agency_id = current_setting('app.current_agency_id', true)
       LIMIT 1
    `);
    const agency = (agencyRows as unknown as Array<Record<string, unknown>>)[0];
    if (!agency) return { skip: 'agency_settings_missing' };
    const mode = parseAmandaMode(agency.amanda_mode);
    if (mode === 'off') return { skip: 'amanda_mode_off' };

    const leadRows = await tx.execute(sql`
      SELECT full_name, phone, language, opt_in_status FROM leads WHERE id = ${row.lead_id}::uuid LIMIT 1
    `);
    const lead = (leadRows as unknown as Array<Record<string, unknown>>)[0];
    if (!lead) return { skip: 'lead_missing' };

    const convRows = await tx.execute(sql`
      SELECT ai_muted_at, human_claimed_at, status FROM conversations WHERE id = ${row.conversation_id}::uuid LIMIT 1
    `);
    const conv = (convRows as unknown as Array<Record<string, unknown>>)[0];
    if (!conv) return { skip: 'conversation_missing' };

    const msgRows = await tx.execute(sql`
      SELECT direction, content, sent_at, sent_by FROM conversation_messages
       WHERE conversation_id = ${row.conversation_id}::uuid
         AND provider_message_id IS DISTINCT FROM ${row.provider_message_id}
       ORDER BY sent_at DESC NULLS LAST LIMIT 20
    `);
    const messages = (msgRows as unknown as Array<{ direction: string; content: string | null; sent_at: string; sent_by: string | null }>).reverse();

    const stateRows = await tx.execute(sql`
      SELECT state FROM amanda_lead_state WHERE lead_id = ${row.lead_id}::uuid LIMIT 1
    `);
    const leadState = ((stateRows as unknown as Array<{ state: LeadStateData }>)[0]?.state ?? {}) as LeadStateData;

    const paRows = await tx.execute(sql`
      SELECT id, payload->>'label' AS label, extract(epoch FROM expires_at) * 1000 AS expires_ms
        FROM amanda_pending_actions
       WHERE conversation_id = ${row.conversation_id}::uuid AND status = 'pending' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 5
    `);

    // Tickets a HUMAN already answered directly in the chat must not keep the
    // "still waiting on the office" note alive (P0 has no relay — conformance
    // audit): compare against the last agent-authored outbound.
    const ticketRows = await tx.execute(sql`
      SELECT id, short_code, question_text, created_at FROM amanda_questions
       WHERE conversation_id = ${row.conversation_id}::uuid AND status IN ('open', 'clarifying', 'escalated')
       ORDER BY created_at DESC LIMIT 3
    `);

    // NEWEST first + 50 (matches the settings listing): under ASC, entries
    // taught past the cap silently never reached the prompt while the teach
    // flow reported success (review-caught); DESC also means the freshest
    // facts survive the prompt's char truncation.
    const knowledgeRows = await tx.execute(sql`
      SELECT content FROM agency_amanda_knowledge
       WHERE agency_id = current_setting('app.current_agency_id', true) AND status = 'active'
       ORDER BY created_at DESC LIMIT 50
    `);

    const inboundWordCounts = messages
      .filter((m) => m.direction === 'inbound' && m.content)
      .slice(-5)
      .map((m) => (m.content as string).trim().split(/\s+/).length)
      .sort((a, b) => a - b);
    const mirror = inboundWordCounts.length >= 3 ? inboundWordCounts[Math.floor(inboundWordCounts.length / 2)] : null;

    return {
      mode,
      agencyName: String(agency.agency_name ?? 'the agency'),
      settings: parseAmandaSettings(agency.amanda_settings),
      leadFirstName: lead.full_name ? String(lead.full_name).split(/\s+/)[0] : null,
      leadFullName: (lead.full_name as string) ?? null,
      leadPhone: (lead.phone as string) ?? null,
      leadLanguage: (lead.language as string) || 'en',
      leadState,
      aiMuted: Boolean(conv.ai_muted_at) || Boolean(conv.human_claimed_at),
      optedOut: lead.opt_in_status === 'opted_out',
      recentTurns: messages.map((m) => ({
        // Human-sent outbound (operator approvals carry sent_by) is 'agent' —
        // hand-back ground truth must not read as Amanda's own words.
        role: m.direction === 'inbound'
          ? ('buyer' as const)
          : m.sent_by && !/amanda|engine|system/i.test(m.sent_by) ? ('agent' as const) : ('amanda' as const),
        text: m.content ?? '', at: m.sent_at,
      })),
      gapDays: (() => {
        const newestPrior = messages.length ? messages[messages.length - 1].sent_at : null;
        if (!newestPrior) return null;
        const ms = Date.now() - Date.parse(newestPrior);
        return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : null;
      })(),
      mirrorTargetWords: mirror,
      pendingActions: (paRows as unknown as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id), label: String(r.label ?? 'proposed viewing'), expiresAtMs: Number(r.expires_ms),
      })),
      openTicketNote: (() => {
        const lastAgentReplyAt = messages
          .filter((m) => m.direction !== 'inbound' && m.sent_by && !/amanda|engine|system/i.test(m.sent_by))
          .map((m) => m.sent_at).sort().pop() ?? null;
        return (ticketRows as unknown as Array<{ id: string; short_code: number; question_text: string; created_at: string }>)
          .filter((tk) => !(lastAgentReplyAt && lastAgentReplyAt > tk.created_at))
          .map((tk) => `Q${tk.short_code} to the office: "${tk.question_text}" — still waiting`)
          .join('; ') || null;
      })(),
      humanAnsweredTicketIds: (() => {
        const lastAgentReplyAt = messages
          .filter((m) => m.direction !== 'inbound' && m.sent_by && !/amanda|engine|system/i.test(m.sent_by))
          .map((m) => m.sent_at).sort().pop() ?? null;
        return (ticketRows as unknown as Array<{ id: string; created_at: string }>)
          .filter((tk) => lastAgentReplyAt && lastAgentReplyAt > tk.created_at)
          .map((tk) => String(tk.id));
      })(),
      agencyKnowledge: (knowledgeRows as unknown as Array<{ content: string }>).map((k) => k.content),
    };
  });
}

export async function processTurnDb(row: QueueRow): Promise<TurnOutcome> {
  if (row.kind !== 'message' && row.kind !== 'media' && row.kind !== 'ticket_answered' && row.kind !== 'system') return { result: 'skip', reason: `kind_${row.kind}_not_engine_v1` };

  // Stale-row guard (reviewer): a retried row from many hours ago must not fire
  // a reply into a conversation that has long moved on (and freeform would fail
  // the 24h window anyway).
  const world = await loadWorld(row);
  if ('skip' in world) return { result: 'skip', reason: world.skip };
  if (world.aiMuted) return { result: 'skip', reason: 'ai_muted_or_human_claimed' };
  if (world.optedOut) return { result: 'skip', reason: 'lead_opted_out' };

  // Typing indicator + read receipt (fire-and-forget): only when a reply is
  // actually coming (assisted/full) and only for real buyer messages — in
  // approval/shadow "typing…" would be a lie and blue ticks would leak shadow.
  if ((world.mode === 'assisted' || world.mode === 'full') && (row.kind === 'message' || row.kind === 'media')) {
    sendTypingIndicator(row.provider_message_id);
  }

  // Tickets a human agent answered directly in the chat close as 'handoff'
  // (P0 has no relay — see GO_LIVE_PACK deferrals). Live modes only: shadow
  // stays zero-write beyond telemetry.
  if (world.humanAnsweredTicketIds.length > 0 && world.mode !== 'shadow') {
    const idsCsv = world.humanAnsweredTicketIds.join(',');
    await withAgency(row.agency_id, async (tx) => {
      await tx.execute(sql`
        UPDATE amanda_questions SET status = 'handoff', answered_by = 'human_direct_reply', answered_at = now()
         WHERE id = ANY(string_to_array(${idsCsv}, ',')::uuid[]) AND status IN ('open', 'clarifying', 'escalated')
      `);
    }).catch((err) => console.error('[amanda-engine] ticket close failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'error'));
  }

  const rowAgeMs = Date.now() - Date.parse(row.created_at ?? '') || 0;
  if (Number.isFinite(rowAgeMs) && rowAgeMs > 24 * 3600_000) return { result: 'skip', reason: 'stale_inbound' };

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const inboundText = typeof payload.body === 'string' ? payload.body : '';
  const buttonPayload = typeof payload.button_payload === 'string' ? payload.button_payload : null;

  // Office-answer relay (§3b step 3): the agent answered a ticket in the
  // dashboard — this turn RELAYS it, warmly attributed, in the buyer's language.
  // The answer text is agency-authored → authoritative for the grounding gates.
  const officeAnswer = row.kind === 'ticket_answered' && typeof payload.answer === 'string' && payload.answer.trim()
    ? payload.answer.trim().slice(0, 1200)
    : null;
  const relayNote = officeAnswer
    ? `[OFFICE ANSWER for Q${String(payload.short_code ?? '?')} — the buyer had asked: "${String(payload.question ?? '').slice(0, 300)}". The office answers: "${officeAnswer}". Relay this to the buyer NOW, warmly and with attribution (vary the opener — never the same phrasing twice), in their language. Add NOTHING beyond the office's answer, then offer to keep helping.]`
    : null;
  if (row.kind === 'ticket_answered' && !relayNote) return { result: 'skip', reason: 'ticket_answer_empty' };

  // System events: today only booking_executed (the agent one-tapped a queued
  // booking confirm) — Amanda tells the buyer it's locked in, restating the slot.
  const systemNote = row.kind === 'system' && payload.event === 'booking_executed' && typeof payload.echo === 'string'
    ? `[SYSTEM: the office just approved and BOOKED the viewing the buyer confirmed earlier: ${String(payload.echo).slice(0, 200)}. Tell the buyer warmly it is now confirmed, explicitly restating day and time. Nothing else happened.]`
    : null;
  if (row.kind === 'system' && !systemNote) return { result: 'skip', reason: 'system_event_unknown' };

  // Media Law v0 (design §11b): never auto-act on unparsed media — the model is
  // told a media message arrived and asks the buyer to type it. STT/vision = P2.
  const effectiveText = relayNote ?? systemNote ?? (row.kind === 'media' && !inboundText.trim()
    ? '[the buyer sent a voice note or image that could not be read — warmly ask them to type it out]'
    : inboundText);
  if (!effectiveText.trim() && !buttonPayload) return { result: 'skip', reason: 'empty_inbound' };

  // Pending-action selection (§4): a button pinpoints its action; otherwise
  // exactly ONE unexpired action may be auto-considered; several → the model
  // re-asks which (never guess).
  let pending: PendingActionView | null = null;
  let pendingNote: string | null = null;
  const byButton = buttonPayload ? world.pendingActions.find((p) => p.id === buttonPayload) : undefined;
  if (byButton) {
    pending = { id: byButton.id, echo: byButton.label, expiresAtMs: byButton.expiresAtMs };
  } else if (world.pendingActions.length === 1) {
    const p = world.pendingActions[0];
    pending = { id: p.id, echo: p.label, expiresAtMs: p.expiresAtMs };
  } else if (world.pendingActions.length > 1) {
    // Deterministic narrowing (reviewer): two slots are always proposed, so
    // "the Friday one" / "el 28 a las 17" must be resolvable without a button.
    // Match on the label's unambiguous numeric tokens (day-of-month, HH:MM) —
    // exactly ONE match narrows to that slot; anything else → the model re-asks.
    const narrowed = narrowPendingByText(world.pendingActions, effectiveText);
    if (narrowed) {
      pending = { id: narrowed.id, echo: narrowed.label, expiresAtMs: narrowed.expiresAtMs };
    } else {
      pendingNote = `Proposed viewing slots awaiting the buyer's pick: ${world.pendingActions.map((p) => p.label).join(' OR ')} — if they choose one, restate it explicitly and ask them to confirm that exact slot.`;
    }
  }

  const ctx: TurnContext = {
    agencyName: world.agencyName,
    // Tapped-in calendar notes ride the same agency-authored context lane —
    // upcoming 14 days only, so Amanda knows "Tuesday 12-14 is the team
    // meeting" without the note blocking anything by itself.
    agencyKnowledge: [...world.agencyKnowledge, ...upcomingCalendarNotes(world.settings, Date.now())],
    workingHoursLine: `Viewings: weekdays 11:00/17:00, Saturday 11:00 (${world.settings.timezone})`,
    leadFirstName: world.leadFirstName,
    leadLanguage: world.leadLanguage,
    leadState: world.leadState,
    recentTurns: world.recentTurns,
    episodicSummary: null,                         // layer-3 memory: trigger-ledger item
    pendingActionEcho: pendingNote,
    openTicketNote: world.openTicketNote,
    officeAnswerText: officeAnswer,
    gapNote: world.gapDays !== null && world.gapDays >= 2
      ? `The buyer's previous exchange was ${world.gapDays} days ago. Treat this as a FRESH conversation opening: greet warmly, do NOT resume their old requests unless they bring them up, and ask what they need today.`
      : null,
    mirrorTargetWords: world.mirrorTargetWords,
  };

  const backends = makeDbBackends({
    agencyId: row.agency_id, leadId: row.lead_id, conversationId: row.conversation_id,
    leadLanguage: world.leadLanguage, rejectedPropertyIds: world.leadState.rejected_property_ids ?? [],
    settings: world.settings, nowMs: () => Date.now(),
  });

  const deps: TurnDeps = {
    callModel: productionModelCall,
    backends,
    verifier: productionVerifier,

    async executeBooking(pendingActionId) {
      return withAgency(row.agency_id, async (tx) => {
        const r = await executeBookingFromPendingAction(tx, {
          pendingActionId, conversationId: row.conversation_id, leadId: row.lead_id,
          agencyId: row.agency_id, setRoleGuc: true, bookedBy: 'amanda_engine',
        });
        if (r.ok) nudgeCalendarSync();
        return r.ok ? { ok: true as const, bookingId: r.bookingId, echo: r.echo } : { ok: false as const, reason: r.reason };
      });
    },

    async releasePendingAction(pendingActionId, reason) {
      await withAgency(row.agency_id, async (tx) => {
        await tx.execute(sql`
          UPDATE amanda_pending_actions
             SET status = ${reason === 'declined' ? 'cancelled' : 'superseded'}, resolved_at = now()
           WHERE id = ${pendingActionId}::uuid AND status = 'pending'
        `);
        await tx.execute(sql`DELETE FROM viewing_slot_holds WHERE pending_action_id = ${pendingActionId}::uuid`);
      });
    },

    async sendReply(text) {
      // Outbound rides send_queue freeform, drained by the live executor. The
      // executor enforces OPT-OUT law only (reviewer-verified) — the 24h-window
      // check is OURS, deterministic, before enqueue; the full atomic send gate
      // moves INTO the executor before P2 (design §4, go-live pack).
      if (!world.leadPhone) throw new Error('lead_has_no_phone');
      const key = `amanda-engine:${turnId(row.conversation_id, row.provider_message_id)}`;
      return withAgency(row.agency_id, async (tx) => {
        // LEASE FENCE (review-verified fold-zombie hole): the idempotency key
        // dedupes re-runs of the SAME inbound, but after a lease expiry the
        // fold path answers the NEWER message under a DIFFERENT key — so a
        // zombie turn finishing late must be stopped HERE, not at the queue
        // finalization. Only the current leaseholder with a live lease may
        // send; the row lock this takes (held to commit) also blocks a
        // concurrent claim/fold from stealing the row mid-send.
        const fence = await tx.execute(sql`
          UPDATE amanda_inbound_queue
          SET lease_expires_at = GREATEST(lease_expires_at, now() + interval '120 seconds')
          WHERE id = ${row.id}::uuid AND status = 'processing'
            AND leased_by = ${String((row as { leased_by?: unknown }).leased_by ?? '')}
            AND lease_expires_at >= now()
          RETURNING id
        `);
        if ((fence as unknown as unknown[]).length === 0) throw new Error('lease_lost_reply_suppressed');
        const windowRows = await tx.execute(sql`
          SELECT 1 FROM leads
           WHERE id = ${row.lead_id}::uuid
             AND last_inbound_whatsapp_at > now() - interval '23 hours'
        `);
        if ((windowRows as unknown as unknown[]).length === 0) throw new Error('window_closed');
        await tx.execute(sql`
          INSERT INTO send_queue (idempotency_key, agency_id, lead_id, channel, hub, template_key, template_variables, priority, requested_by, requested_at, expiry_at)
          VALUES (
            ${key}, ${row.agency_id}, ${row.lead_id}::uuid, 'whatsapp', 'twilio', 'freeform',
            jsonb_build_object('body', ${text}::text, 'full_name', ${world.leadFullName}::text, 'first_name', ${world.leadFirstName}::text, 'lead_phone', ${world.leadPhone}::text, 'agency_name', ${world.agencyName}::text),
            'high', 'amanda_engine', now(), now() + interval '30 minutes'
          )
          ON CONFLICT (idempotency_key) DO NOTHING
        `);
        // Auto-mode dashboard coherence (Christian, live demo 2026-08-27): the
        // moment Amanda ANSWERS a conversation herself, any pending human
        // suggested-reply draft for it is stale by construction — an agent
        // tapping Send on one would talk over her. sendReply only runs in
        // assisted/full (approval rides queueDraft), so sweep unconditionally,
        // same transaction as the send enqueue.
        await tx.execute(sql`
          UPDATE dashboard_tasks
             SET status = 'dismissed', updated_at = now(),
                 raw_payload = COALESCE(raw_payload, '{}'::jsonb)
                   || jsonb_build_object('auto_dismissed', 'amanda_auto_mode_answered', 'turn_id', ${turnId(row.conversation_id, row.provider_message_id)}::text)
           WHERE conversation_id = ${row.conversation_id}::text
             AND task_type = 'suggested_reply' AND status = 'pending'
        `);
        return { providerMessageId: null };
      });
    },

    async queueDraft(text, kind) {
      await withAgency(row.agency_id, async (tx) => {
        // message_body = THE DRAFT: the approvals UI prefills it and the live
        // approve RPC sends message_body verbatim (reviewer-verified live
        // convention — 13/18 existing tasks message_body == the AI draft).
        // The inbound text lives in raw_payload.inbound_body_text.
        await tx.execute(sql`
          INSERT INTO dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, description, message_body, channel, platform, priority, status, raw_payload)
          VALUES (
            ${row.agency_id}, ${row.lead_id}::uuid, ${row.conversation_id},
            'suggested_reply', 'WhatsApp from lead - review suggested reply',
            ${('Lead wrote: ' + String((row.payload as Record<string, unknown>)?.body ?? '')).slice(0, 500)},
            ${text},
            'whatsapp', 'twilio', 'high', 'pending',
            jsonb_build_object(
              'suggested_reply', ${text}::text,
              'lead_language', ${world.leadLanguage}::text,
              'inbound_body_text', ${(row.payload as Record<string, unknown>)?.body ?? ''}::text,
              'inbound_message_id', ${row.provider_message_id}::text,
              'inbound_profile_name', ${world.leadFullName}::text,
              'ai_draft_pending', false,
              'ai_failure_reason', null,
              'via', 'amanda_engine',
              'draft_kind', ${kind}::text
            )
          )
        `);
      });
    },

    async queueBookingConfirm(pendingActionId, echo) {
      // Own task type — NEVER 'suggested_reply' (the approve RPC would text the
      // placeholder to the buyer). No executor exists yet: the task surfaces on
      // /tasks for visibility; the one-tap execute endpoint is the P2 build,
      // and until then agencies below FULL simply don't auto-book (honest).
      await withAgency(row.agency_id, async (tx) => {
        await tx.execute(sql`
          INSERT INTO dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, message_body, channel, platform, priority, status, raw_payload)
          VALUES (
            ${row.agency_id}, ${row.lead_id}::uuid, ${row.conversation_id},
            'amanda_booking_confirm', ${'Buyer confirmed a viewing: ' + echo},
            ${'The buyer accepted ' + echo + '. Book it from the Viewings page (one-tap execute lands with P2).'},
            'whatsapp', 'twilio', 'high', 'pending',
            jsonb_build_object('pending_action_id', ${pendingActionId}::uuid, 'echo', ${echo}::text, 'via', 'amanda_engine')
          )
        `);
      });
    },

    async escalateToHuman(reason, detail) {
      await withAgency(row.agency_id, async (tx) => {
        await tx.execute(sql`
          INSERT INTO dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, message_body, channel, platform, priority, status, raw_payload)
          VALUES (
            ${row.agency_id}, ${row.lead_id}::uuid, ${row.conversation_id},
            'human_review_needed', 'Amanda needs a human on this reply', ${detail.slice(0, 800)},
            'whatsapp', 'twilio', 'high', 'pending',
            jsonb_build_object('reason', ${reason}::text, 'via', 'amanda_engine')
          )
        `);
      });
      // LIVE alert (Christian 2026-08-28: escalations produced no ping): flag
      // the lead for the "Needs a human" panel's poll AND fire the same
      // private realtime event the website handoff uses — chime + desktop
      // notification with zero new client code. Each rides its OWN
      // transaction so a failure can never roll back the task insert.
      await withAgency(row.agency_id, async (tx) => {
        await tx.execute(sql`
          UPDATE leads SET needs_human_since = COALESCE(needs_human_since, now())
           WHERE id = ${row.lead_id}::uuid
        `);
      }).catch(() => { /* panel poll still shows the task page */ });
      await withAgency(row.agency_id, async (tx) => {
        await tx.execute(sql`
          SELECT realtime.send(
            jsonb_build_object('lead_id', ${row.lead_id}::uuid, 'at', now()),
            'handoff_requested',
            'agency:' || ${row.agency_id} || ':handoffs',
            true
          )
        `);
      }).catch(() => { /* realtime hiccup must never fail the escalation */ });
    },
  };

  const started = Date.now();
  const result = await runTurn(world.mode, ctx, {
    text: effectiveText,
    buttonPayload,
    providerMessageId: row.provider_message_id,
    atMs: Date.now(),
  }, pending, deps);

  const relayText = result.replyText;
  if (officeAnswer && typeof payload.question_id === 'string' && relayText
      && (result.outcome === 'sent' || result.outcome === 'drafted')) {
    await withAgency(row.agency_id, async (tx) => {
      await tx.execute(sql`
        UPDATE amanda_questions
           SET answer_relay = ${relayText.slice(0, 1200)},
               relay_message_sid = NULL,
               relay_sent_at = ${result.outcome === 'sent' ? sql`now()` : sql`NULL`}
         WHERE id = ${payload.question_id}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO amanda_question_events (agency_id, question_id, event_type, detail)
        VALUES (${row.agency_id}, ${payload.question_id}::uuid, ${result.outcome === 'sent' ? 'relayed' : 'relay_drafted'}, jsonb_build_object('relay', ${relayText.slice(0, 1200)}::text))
      `);
    }).catch((err) => console.error('[amanda-engine] relay record failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'error'));
  }

  await withAgency(row.agency_id, async (tx) => {
    await tx.execute(sql`
      INSERT INTO amanda_turn_usage (agency_id, conversation_id, turn_id, mode, model, prompt_version, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tool_calls, latency_ms, outcome, turn_class, gate_failures, cannot_answer)
      VALUES (
        ${row.agency_id}, ${row.conversation_id}::uuid, ${turnId(row.conversation_id, row.provider_message_id)},
        ${world.mode}, ${ENGINE_MODEL()}, ${result.promptVersion},
        ${result.loop?.usage.inputTokens ?? 0}, ${result.loop?.usage.outputTokens ?? 0},
        ${result.loop?.usage.cacheReadTokens ?? 0}, ${result.loop?.usage.cacheWriteTokens ?? 0},
        ${result.loop?.toolEvents.length ?? 0}, ${Date.now() - started}, ${result.outcome},
        ${result.turnClass}, ${result.gateFailures.length ? result.gateFailures.join(',').slice(0, 500) : null},
        ${result.loop?.cannotAnswer?.slice(0, 200) ?? null}
      )
      ON CONFLICT (turn_id) DO NOTHING
    `);
  }).catch((err) => console.error('[amanda-engine] turn_usage write failed', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'error'));

  return { result: 'done' };
}

export { slotLabel };
