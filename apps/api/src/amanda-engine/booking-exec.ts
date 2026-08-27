// Amanda engine — the ONE deterministic booking execution path (design §4).
// Used by BOTH callers: the engine's FULL-mode confirmation pre-step and the
// agent's one-tap "Confirm booking" on an amanda_booking_confirm task. Takes an
// agency-scoped transaction executor so each caller brings its own context; the
// engine's worker tx has no role GUC (setRoleGuc: true claims aivena_staff —
// create_manual_viewing PERFORMs require_role), while the HTTP path already
// carries the operator's role from agencyContextMiddleware.

import { sql } from 'drizzle-orm';

export interface TxLike {
  execute(query: unknown): Promise<unknown>;
}

export type BookingExecResult =
  | { ok: true; bookingId: string; echo: string; propertyId: string | null }
  | { ok: false; reason: 'slot_taken' | 'action_invalid' };

export async function executeBookingFromPendingAction(
  tx: TxLike,
  args: { pendingActionId: string; conversationId: string; leadId: string; agencyId: string; setRoleGuc: boolean; bookedBy: string },
): Promise<BookingExecResult> {
  const paRows = await tx.execute(sql`
    SELECT property_id, lower(slot) AS start_at,
           (extract(epoch FROM upper(slot) - lower(slot)) / 60)::int AS duration_min,
           payload->>'label' AS label
      FROM amanda_pending_actions
     WHERE id = ${args.pendingActionId}::uuid AND status = 'pending' AND expires_at > now()
     LIMIT 1
  `);
  const pa = (paRows as unknown as Array<Record<string, unknown>>)[0];
  if (!pa) return { ok: false, reason: 'action_invalid' };

  try {
    if (args.setRoleGuc) {
      // Worker path: withAgency sets only the agency GUC; claim the staff role
      // (explicit require_role bypass) + an audit identity for created_by.
      await tx.execute(sql`
        SELECT set_config('app.current_user_role', 'aivena_staff', true),
               set_config('app.current_user_id', ${args.bookedBy}, true)
      `);
    }
    const created = await tx.execute(sql`
      SELECT * FROM create_manual_viewing(
        ${args.leadId}::uuid, ${String(pa.start_at)}::timestamptz, ${Number(pa.duration_min) || 60}::int,
        ${String(pa.property_id)}::uuid, ${null}, ${'Booked by Amanda (auto-mode)'}, ${null}, false
      )
    `);
    const bookingId = String((created as unknown as Array<{ booking_id: string }>)[0]?.booking_id ?? '');
    await tx.execute(sql`
      UPDATE amanda_pending_actions
         SET status = 'executed', resolved_at = now(), executed_booking_id = ${bookingId}::uuid
       WHERE id = ${args.pendingActionId}::uuid
    `);
    await tx.execute(sql`DELETE FROM viewing_slot_holds WHERE pending_action_id = ${args.pendingActionId}::uuid`);
    await tx.execute(sql`
      DELETE FROM viewing_slot_holds WHERE pending_action_id IN (
        SELECT id FROM amanda_pending_actions
         WHERE conversation_id = ${args.conversationId}::uuid AND status = 'pending'
      )
    `);
    await tx.execute(sql`
      UPDATE amanda_pending_actions SET status = 'superseded', resolved_at = now()
       WHERE conversation_id = ${args.conversationId}::uuid AND status = 'pending'
    `);
    await tx.execute(sql`
      INSERT INTO amanda_funnel_events (agency_id, lead_id, conversation_id, property_id, event_type, amanda_attributed, metadata)
      VALUES (${args.agencyId}, ${args.leadId}::uuid, ${args.conversationId}::uuid, ${String(pa.property_id)}::uuid, 'viewing_booked', true, jsonb_build_object('booking_id', ${bookingId}::uuid, 'booked_by', ${args.bookedBy}::text))
    `);
    return { ok: true, bookingId, echo: String(pa.label ?? 'the proposed time'), propertyId: pa.property_id ? String(pa.property_id) : null };
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const code = cause?.code ?? (err as { code?: string })?.code;
    if (code === '23P01') return { ok: false, reason: 'slot_taken' };   // EXCLUDE arbiter
    if (code === 'P0001') {
      // RPC validation refusals (viewing_time_in_past, lead_not_found …) —
      // message token only, never bind params.
      console.error('[amanda-engine] booking refused by RPC:', cause?.message?.split('\n')[0].slice(0, 80) ?? 'P0001');
      return { ok: false, reason: 'action_invalid' };
    }
    throw err;
  }
}
