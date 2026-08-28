// Amanda engine — inbound outbox consumer (design §4 "Inbound processing =
// outbox pattern"). Wired into index.ts DOUBLY inert: the worker starts only
// with AMANDA_ENGINE_ENABLED=true, and even then every agency's amanda_mode
// defaults to 'off' — nothing can activate before the approval-gated schema
// apply and an explicit per-agency dial-up.
//
// Shape mirrors the calendar worker: a periodic tick claims due queue rows via
// the SECURITY DEFINER RPC (cross-agency drain — the 2026-08-25 FORCE-RLS
// lesson), then processes each row inside withAgency. processTurn is injected
// so the loop is testable without a database and the engine can grow behind a
// stable seam. Failure policy: transient errors reschedule with backoff and the
// row's lease expiry lets a crashed worker's rows be stolen; a row is marked
// failed permanently only after MAX_ATTEMPTS. The sweep alert on old unprocessed
// rows (design §7) lands with the P1 alerting spine.

import { sql } from 'drizzle-orm';
import { db, withAgency } from '../../../../packages/db/client';
import { AgencyCircuitBreaker, BREAKER_COOLDOWN_MS, MAX_ATTEMPTS, backoffSeconds, type ProcessTurn, type QueueRow } from './outbox-lib';

export { engineEnabled, backoffSeconds, type ProcessTurn, type QueueRow, type TurnOutcome } from './outbox-lib';

// One drain at a time per process: a turn can legitimately take minutes of
// model IO, and the tick must never stack drains (lease-steal mid-turn —
// reviewer-confirmed). Cross-instance overlap is handled by the lease itself.
let drainInFlight = false;
const breaker = new AgencyCircuitBreaker();

/** Graceful-shutdown seam: index.ts waits for the in-flight drain before exit
 *  so a deploy never orphans a mid-turn row into a lease-length silence. */
export function drainBusy(): boolean {
  return drainInFlight;
}

// Shutdown stop: after SIGTERM the drain must FINISH its current turn but not
// START the rest of the claimed batch — unstarted rows are released back to
// pending immediately so the new instance picks them up in seconds instead of
// waiting out their leases (review-verified batch-orphan gap).
let stopRequested = false;
export function requestDrainStop(): void {
  stopRequested = true;
}

// Instance-unique lease identity: with a shared tag, a rolling deploy's old and
// new processes are indistinguishable in leased_by and no one can reason about
// whose lease is whose (the 2026-08-27 15-minute demo stall).
const WORKER_ID = `api-${Math.random().toString(36).slice(2, 10)}`;

// Per-ROW lease (re-upped before each turn below): must outlive one worst-case
// turn (a few 45s model calls + verifier + retry), NOT the whole batch. The
// old whole-batch 900s lease meant a killed worker silenced a conversation for
// 15 minutes; 300s per row caps that at 5 — and graceful shutdown makes the
// orphan case rare (hard kill only).
const LEASE_SECONDS = 300;

export async function drainAmandaInbound(processTurn: ProcessTurn, limit = 5): Promise<{ claimed: number; done: number; failed: number }> {
  if (drainInFlight) return { claimed: 0, done: 0, failed: 0 };
  drainInFlight = true;
  try {
    const rows = (await db.execute(
      sql`SELECT * FROM public.pick_and_claim_amanda_inbound(${limit}, ${LEASE_SECONDS}, ${WORKER_ID})`,
    )) as unknown as QueueRow[];

    let done = 0;
    let failed = 0;
    for (const row of rows) {
      if (stopRequested) {
        // Shutting down: hand this unstarted row straight back (guarded — only
        // if we still hold it); the successor instance claims it on its next tick.
        await withAgency(row.agency_id, async (tx) => {
          await tx.execute(sql`
            UPDATE public.amanda_inbound_queue
            SET status = 'pending', lease_expires_at = NULL, leased_by = NULL, next_attempt_at = now()
            WHERE id = ${row.id}::uuid AND status = 'processing' AND leased_by = ${WORKER_ID}
          `);
        }).catch(() => { /* lease expiry re-offers it */ });
        continue;
      }
      // Re-up THIS row's lease as its turn starts: each row gets a full lease
      // from its own start instead of sharing the batch's claim-time window.
      // Guarded by leased_by = us: if the lease already expired and another
      // instance stole the row, we must not resurrect it under ourselves.
      const reup = await withAgency(row.agency_id, async (tx) =>
        tx.execute(sql`
          UPDATE public.amanda_inbound_queue
          SET lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS})
          WHERE id = ${row.id}::uuid AND status = 'processing' AND leased_by = ${WORKER_ID}
          RETURNING id
        `),
      ).catch(() => [] as unknown[]);
      if ((reup as unknown[]).length === 0) continue;   // stolen or resolved elsewhere — skip
      // Breaker open for this agency: put the row back with a cooldown-length
      // delay (durable, nothing lost) and move on.
      if (breaker.isOpen(row.agency_id, Date.now())) {
        await withAgency(row.agency_id, async (tx) => {
          await tx.execute(sql`
            UPDATE public.amanda_inbound_queue
            SET status = 'pending', lease_expires_at = NULL,
                next_attempt_at = now() + make_interval(secs => ${Math.round(BREAKER_COOLDOWN_MS / 1000)}),
                error_message = 'breaker_open: agency paused after repeated errors'
            WHERE id = ${row.id}::uuid AND status = 'processing' AND leased_by = ${WORKER_ID}
          `);
        }).catch(() => { /* lease expiry re-offers it */ });
        continue;
      }
      try {
        const outcome = await processTurn(row);
        breaker.recordSuccess(row.agency_id);
        await withAgency(row.agency_id, async (tx) => {
          if (outcome.result === 'done' || outcome.result === 'skip') {
            // Leaseholder guard on EVERY finalization: a zombie instance whose
            // row was folded/stolen must never overwrite the new owner's state.
            // (The fold-case zombie SEND is blocked by sendReply's lease fence —
            // the idempotency key alone only dedupes same-message re-runs.)
            await tx.execute(sql`
              UPDATE public.amanda_inbound_queue
              SET status = ${outcome.result === 'done' ? 'done' : 'skipped'},
                  processed_at = now(), lease_expires_at = NULL,
                  error_message = ${outcome.result === 'skip' ? outcome.reason : null}
              WHERE id = ${row.id}::uuid AND status = 'processing' AND leased_by = ${WORKER_ID}
            `);
            done++;
          } else {
            const exhausted = row.attempts >= MAX_ATTEMPTS;
            await tx.execute(sql`
              UPDATE public.amanda_inbound_queue
              SET status = ${exhausted ? 'failed' : 'pending'},
                  next_attempt_at = now() + make_interval(secs => ${backoffSeconds(row.attempts)}),
                  lease_expires_at = NULL,
                  error_message = ${outcome.reason.slice(0, 240)}
            WHERE id = ${row.id}::uuid AND status = 'processing' AND leased_by = ${WORKER_ID}
            `);
            if (exhausted) failed++;
          }
        });
      } catch (err) {
        // A THROWN row must terminate like a retry — leaving it 'processing'
        // means the stale-lease steal re-runs it forever with no attempts cap
        // (reviewer-confirmed). Best-effort, fenced, and itself guarded.
        // Walk the cause chain: drizzle's "Failed query" wrapper hides the real
        // driver/postgres error (and its first line can be blank) — but NEVER
        // include query params (token-leak law): message first lines only.
        const chain: string[] = [];
        let cur: unknown = err;
        for (let i = 0; i < 4 && cur; i++) {
          const m = (cur as { message?: unknown }).message;
          if (typeof m === 'string' && m.trim()) chain.push(m.split('\n')[0].slice(0, 120));
          cur = (cur as { cause?: unknown }).cause;
        }
        const msg = chain.join(' <- ') || 'error';
        console.error('[amanda-outbox] row threw', row.id, msg);
        failed++;
        // Circuit breaker: repeated errors pause the agency's drain and file ONE
        // alert task so a human sees it before P1's alerting spine exists.
        if (breaker.recordFailure(row.agency_id, Date.now())) {
          console.error('[amanda-outbox] BREAKER TRIPPED for agency', row.agency_id);
          await withAgency(row.agency_id, async (tx) => {
            await tx.execute(sql`
              INSERT INTO public.dashboard_tasks (agency_id, lead_id, conversation_id, task_type, title, message_body, channel, platform, priority, status, raw_payload)
              VALUES (
                ${row.agency_id}, ${row.lead_id}::uuid, ${row.conversation_id},
                'human_review_needed', 'Amanda paused herself after repeated errors',
                ${'Amanda hit repeated processing errors and paused this agency for ' + Math.round(BREAKER_COOLDOWN_MS / 60000) + ' minutes. Messages are safe in the queue; agents see everything in the Inbox. If this repeats, tell CC (see the incident runbook).'},
                'whatsapp', 'twilio', 'high', 'pending',
                jsonb_build_object('via', 'amanda_engine', 'kind', 'breaker_tripped', 'last_error', ${msg}::text)
              )
            `);
          }).catch(() => { /* alert is best-effort */ });
        }
        await withAgency(row.agency_id, async (tx) => {
          const exhausted = row.attempts >= MAX_ATTEMPTS;
          await tx.execute(sql`
            UPDATE public.amanda_inbound_queue
            SET status = ${exhausted ? 'failed' : 'pending'},
                next_attempt_at = now() + make_interval(secs => ${backoffSeconds(row.attempts)}),
                lease_expires_at = NULL,
                error_message = ${('threw: ' + msg).slice(0, 240)}
            WHERE id = ${row.id}::uuid AND status = 'processing' AND leased_by = ${WORKER_ID}
          `);
        }).catch(() => { /* DB down — the lease expiry re-offers the row */ });
      }
    }
    return { claimed: rows.length, done, failed };
  } finally {
    drainInFlight = false;
  }
}
