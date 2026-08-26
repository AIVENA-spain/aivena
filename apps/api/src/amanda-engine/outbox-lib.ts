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
