// Amanda engine — pure outbox logic, importable without a database (house
// pattern: calendar-lib vs calendar-worker). The worker wires these to drizzle.

export interface QueueRow {
  id: string;
  agency_id: string;
  conversation_id: string;
  lead_id: string;
  provider_message_id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  created_at?: string;      // stale-row guard input (present on real rows)
}

export type TurnOutcome =
  | { result: 'done' }
  | { result: 'skip'; reason: string }
  | { result: 'retry'; reason: string };

export type ProcessTurn = (row: QueueRow) => Promise<TurnOutcome>;

export const MAX_ATTEMPTS = 5;

export function engineEnabled(): boolean {
  return process.env.AMANDA_ENGINE_ENABLED === 'true';
}

export function backoffSeconds(attempts: number): number {
  // 30s, 2m, 8m, 32m, then cap — attempts is the post-claim count (>= 1).
  return Math.min(30 * 4 ** Math.max(0, attempts - 1), 3600);
}

// ── Per-agency circuit breaker (design §4 degradation, v1 in-process) ─────────
// N consecutive turn errors for one agency within the window trips the breaker:
// that agency's rows are left alone for COOLDOWN (they stay durable in the
// queue) and ONE alert task is filed. Success resets. Deliberately in-process
// and mode-untouching: the breaker never writes amanda_mode — pausing drain is
// reversible and honest; auto-downgrade stays a P2 decision with the alerting
// spine. Pure — the worker owns the clock.

export const BREAKER_THRESHOLD = 5;
export const BREAKER_WINDOW_MS = 10 * 60_000;
export const BREAKER_COOLDOWN_MS = 15 * 60_000;

interface BreakerState {
  fails: number;
  firstFailAt: number;
  trippedUntil: number;
  alertFiled: boolean;
}

export class AgencyCircuitBreaker {
  private byAgency = new Map<string, BreakerState>();

  /** True = skip this agency's rows right now (breaker open). */
  isOpen(agencyId: string, nowMs: number): boolean {
    const s = this.byAgency.get(agencyId);
    return Boolean(s && s.trippedUntil > nowMs);
  }

  recordSuccess(agencyId: string): void {
    this.byAgency.delete(agencyId);
  }

  /** Returns true when THIS failure trips the breaker (caller files the alert once). */
  recordFailure(agencyId: string, nowMs: number): boolean {
    const s = this.byAgency.get(agencyId);
    if (!s || nowMs - s.firstFailAt > BREAKER_WINDOW_MS) {
      this.byAgency.set(agencyId, { fails: 1, firstFailAt: nowMs, trippedUntil: 0, alertFiled: false });
      return false;
    }
    s.fails += 1;
    if (s.fails >= BREAKER_THRESHOLD && s.trippedUntil <= nowMs) {
      s.trippedUntil = nowMs + BREAKER_COOLDOWN_MS;
      if (!s.alertFiled) {
        s.alertFiled = true;
        return true;
      }
    }
    return false;
  }
}
