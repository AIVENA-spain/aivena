// The ping worker: take an open question, decide who should answer it, and put
// it on that person's phone.
//
// Before this, Amanda filed a good question — with the property stamped on it —
// and it sat in the dashboard until somebody happened to look. Christian, over
// two days: "where can i see this office question tho, i havent gotten anything
// notification" and then "yes for the sending agent pings, we have to find the
// best solution for us."
//
// Deliberate limits, each one a promise the product already made:
//   · ON SHIFT ONLY. Nobody is texted outside their hours, and an agent with no
//     hours set is never texted at all.
//   · WINDOW ONLY, FOR NOW. Outside WhatsApp's 24h service window a template is
//     required, and the question-ping template is still pending Meta review. So
//     a cold agent is NOT texted: the question stays in the dashboard and the
//     reason is recorded. Silence beats a send that would fail or, worse, one
//     that reaches them in a shape Meta never approved.
//   · ONE PING PER AGENT PER QUESTION, enforced by a unique key in the database
//     rather than by careful bookkeeping here.

import { sql } from 'drizzle-orm';
import { db, withAgency } from '../../../../packages/db/client';
import { pickAgent, windowOpen, buildPingBody, type PingableAgent } from './agent-ping-lib';
import { sendToAgent } from './agent-send';

const AGENCY_TZ = 'Europe/Madrid';
/** Re-offer a question to (possibly) another agent after this long unanswered. */
const REPING_AFTER_MIN = 45;
const MAX_PINGS_PER_QUESTION = 3;

export interface PingOutcome {
  questionId: string;
  shortCode: number;
  sent: boolean;
  reason: string;
}

async function agencyPingContext(agencyId: string): Promise<{
  fromNumber: string | null;
  agencyName: string | null;
  agents: PingableAgent[];
}> {
  return withAgency(agencyId, async (tx) => {
    const setRows = (await tx.execute(sql`
      SELECT s.whatsapp_from_number AS from_number,
             COALESCE(a.trading_name, a.legal_name, a.slug) AS agency_name
        FROM agency_settings s
        JOIN agencies a ON a.id = s.agency_id
       WHERE s.agency_id = current_setting('app.current_agency_id', true)
       LIMIT 1
    `)) as unknown as Array<{ from_number: string | null; agency_name: string | null }>;
    const agentRows = (await tx.execute(sql`
      SELECT id, full_name, whatsapp_e164, languages, work_hours,
             receives_pings, status, last_checkin_at
        FROM agency_agents
       WHERE agency_id = current_setting('app.current_agency_id', true)
    `)) as unknown as Array<Record<string, unknown>>;
    return {
      fromNumber: setRows[0]?.from_number ?? null,
      agencyName: setRows[0]?.agency_name ?? null,
      agents: agentRows.map((r) => ({
        id: String(r.id),
        full_name: String(r.full_name ?? ''),
        whatsapp_e164: String(r.whatsapp_e164 ?? ''),
        languages: Array.isArray(r.languages) ? (r.languages as string[]) : [],
        work_hours: (r.work_hours as Record<string, number[]> | null) ?? null,
        receives_pings: r.receives_pings === true,
        status: String(r.status ?? ''),
        last_checkin_at: r.last_checkin_at ? String(r.last_checkin_at) : null,
      })),
    };
  });
}

/** One pass over every agency with questions due a ping. */
export async function pingTick(nowMs: number = Date.now()): Promise<PingOutcome[]> {
  const due = (await db.execute(sql`
    SELECT q.id, q.agency_id, q.short_code, q.question_text, q.question_lang,
           q.pings_sent, l.full_name AS lead_name
      FROM amanda_questions q
      LEFT JOIN leads l ON l.id = q.lead_id
     WHERE q.status IN ('open', 'clarifying')
       AND COALESCE(q.pings_sent, 0) < ${MAX_PINGS_PER_QUESTION}
       AND (q.next_ping_at IS NULL OR q.next_ping_at <= now())
     ORDER BY q.created_at ASC
     LIMIT 20
  `)) as unknown as Array<Record<string, unknown>>;

  const outcomes: PingOutcome[] = [];
  const contextCache = new Map<string, Awaited<ReturnType<typeof agencyPingContext>>>();

  for (const row of due) {
    const questionId = String(row.id);
    const agencyId = String(row.agency_id);
    const shortCode = Number(row.short_code ?? 0);

    const note = async (reason: string, sent: boolean) => {
      outcomes.push({ questionId, shortCode, sent, reason });
      // Always push the next attempt out, even on a miss, so a question that
      // cannot be delivered does not spin the worker every tick.
      await withAgency(agencyId, async (tx) => {
        await tx.execute(sql`
          UPDATE amanda_questions
             SET next_ping_at = now() + (${REPING_AFTER_MIN} || ' minutes')::interval
           WHERE id = ${questionId}::uuid
        `);
      }).catch(() => { /* a bookkeeping miss must not stop the pass */ });
    };

    try {
      if (!contextCache.has(agencyId)) contextCache.set(agencyId, await agencyPingContext(agencyId));
      const ctx = contextCache.get(agencyId)!;
      if (!ctx.fromNumber) { await note('agency_has_no_whatsapp_sender', false); continue; }

      const pick = pickAgent(ctx.agents, (row.question_lang as string) ?? null, nowMs, AGENCY_TZ);
      if (!pick.agent) { await note(pick.reason, false); continue; }
      const agent = pick.agent;

      // The template for a cold ping is still pending Meta; inside the window
      // no template is needed. Outside it we deliberately do nothing.
      if (!windowOpen(agent, nowMs)) { await note('agent_window_closed_template_pending', false); continue; }

      const body = buildPingBody({
        shortCode,
        question: String(row.question_text ?? ''),
        leadName: (row.lead_name as string) ?? null,
        agencyName: ctx.agencyName,
      });
      const idem = `ping:${questionId}:${agent.id}`;

      // Claim the send FIRST. The unique index makes a duplicate ping
      // impossible even if two workers run this question at the same moment.
      const claimed = await withAgency(agencyId, async (tx) => {
        const r = (await tx.execute(sql`
          INSERT INTO agent_messages (agency_id, agent_id, direction, kind, body, question_id, idempotency_key, status)
          VALUES (${agencyId}, ${agent.id}::uuid, 'outbound', 'question_ping', ${body}, ${questionId}::uuid, ${idem}, 'sent')
          ON CONFLICT (agency_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        return r[0]?.id ?? null;
      });
      if (!claimed) { await note('already_pinged_this_agent', false); continue; }

      const res = await sendToAgent({ toE164: agent.whatsapp_e164, fromE164: ctx.fromNumber, body });

      await withAgency(agencyId, async (tx) => {
        await tx.execute(sql`
          UPDATE agent_messages
             SET status = ${res.ok ? 'sent' : 'failed'},
                 provider_message_id = ${res.providerMessageId},
                 failure_reason = ${res.failure}
           WHERE id = ${claimed}::uuid
        `);
        if (res.ok) {
          await tx.execute(sql`
            UPDATE amanda_questions
               SET pings_sent = COALESCE(pings_sent, 0) + 1,
                   assigned_staff = ${agent.full_name}
             WHERE id = ${questionId}::uuid
          `);
          await tx.execute(sql`
            INSERT INTO amanda_question_events (agency_id, question_id, event_type, detail)
            VALUES (${agencyId}, ${questionId}::uuid, 'pinged',
                    jsonb_build_object('agent', ${agent.full_name}::text,
                                       'language_match', ${!pick.languageCompromise}))
          `);
        }
      });

      await note(res.ok ? 'sent' : (res.failure ?? 'send_failed'), res.ok);
    } catch (err) {
      console.error('[agent-ping] question failed', err instanceof Error ? err.name : 'error');
      await note('worker_error', false);
    }
  }
  return outcomes;
}
