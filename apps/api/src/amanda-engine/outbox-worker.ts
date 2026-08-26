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
import { MAX_ATTEMPTS, backoffSeconds, type ProcessTurn, type QueueRow } from './outbox-lib';

export { engineEnabled, backoffSeconds, type ProcessTurn, type QueueRow, type TurnOutcome } from './outbox-lib';

// One drain at a time per process: a turn can legitimately take minutes of
// model IO, and the 20s tick must never stack drains (lease-steal mid-turn —
// reviewer-confirmed). Cross-instance overlap is handled by the lease itself.
let drainInFlight = false;

export async function drainAmandaInbound(processTurn: ProcessTurn, limit = 5): Promise<{ claimed: number; done: number; failed: number }> {
  if (drainInFlight) return { claimed: 0, done: 0, failed: 0 };
  drainInFlight = true;
  try {
    // Small batches + a long lease: each turn may spend minutes in model IO and
    // the lease must outlive the WHOLE sequential batch, or another instance
    // steals rows mid-turn and re-runs the model loop (reviewer-confirmed).
    const rows = (await db.execute(
      sql`SELECT * FROM public.pick_and_claim_amanda_inbound(${limit}, ${900})`,
    )) as unknown as QueueRow[];

    let done = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const outcome = await processTurn(row);
        await withAgency(row.agency_id, async (tx) => {
          if (outcome.result === 'done' || outcome.result === 'skip') {
            await tx.execute(sql`
              UPDATE public.amanda_inbound_queue
              SET status = ${outcome.result === 'done' ? 'done' : 'skipped'},
                  processed_at = now(), lease_expires_at = NULL,
                  error_message = ${outcome.result === 'skip' ? outcome.reason : null}
              WHERE id = ${row.id}::uuid
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
            WHERE id = ${row.id}::uuid
            `);
            if (exhausted) failed++;
          }
        });
      } catch (err) {
        // A THROWN row must terminate like a retry — leaving it 'processing'
        // means the stale-lease steal re-runs it forever with no attempts cap
        // (reviewer-confirmed). Best-effort, fenced, and itself guarded.
        const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error';
        console.error('[amanda-outbox] row threw', row.id, msg);
        failed++;
        await withAgency(row.agency_id, async (tx) => {
          const exhausted = row.attempts >= MAX_ATTEMPTS;
          await tx.execute(sql`
            UPDATE public.amanda_inbound_queue
            SET status = ${exhausted ? 'failed' : 'pending'},
                next_attempt_at = now() + make_interval(secs => ${backoffSeconds(row.attempts)}),
                lease_expires_at = NULL,
                error_message = ${('threw: ' + msg).slice(0, 240)}
            WHERE id = ${row.id}::uuid AND status = 'processing'
          `);
        }).catch(() => { /* DB down — the lease expiry re-offers the row */ });
      }
    }
    return { claimed: rows.length, done, failed };
  } finally {
    drainInFlight = false;
  }
}
