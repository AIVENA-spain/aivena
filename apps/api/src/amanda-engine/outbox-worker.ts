// Amanda engine — inbound outbox consumer (design §4 "Inbound processing =
// outbox pattern"). P0 skeleton: compiles, tested at the seam, NOT WIRED into
// index.ts yet — wiring ships with the schema-apply proposal so nothing can
// activate before the tables exist and Christian approves.
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

export async function drainAmandaInbound(processTurn: ProcessTurn, limit = 20): Promise<{ claimed: number; done: number; failed: number }> {
  const rows = (await db.execute(
    sql`SELECT * FROM public.pick_and_claim_amanda_inbound(${limit}, ${120})`,
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
      // Never let one row kill the drain; the lease expiry re-offers it.
      console.error('[amanda-outbox] row failed', row.id, err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'error');
      failed++;
    }
  }
  return { claimed: rows.length, done, failed };
}
