/**
 * EVERY MODEL CALL ENDS.
 *
 * A live generation sat at "Creating your carousel" for over ten minutes and would have sat there
 * forever: the writer and the editor were the only two calls in Studio using a bare `fetch` with no
 * AbortController. Research calls take a millisecond budget, gate calls take one, the card matcher
 * aborts at thirty seconds — but the two calls that run on EVERY post could not be stopped. The row
 * was never updated again, and nothing existed to notice.
 *
 * Worse, `editPlan` already returned a `TIMED_OUT` outcome and the orchestrator already branched on
 * it. Nothing could ever produce it. A checker that cannot fire looks exactly like one that found
 * nothing — the bug class that has now bitten this codebase repeatedly.
 *
 * Two rules Christian set, 2026-09-08:
 *   · "normal success → bounded slow call → honest failure" matters more than shaving 20 seconds.
 *   · One retry, transient only. Never silently retry three times and triple the cost.
 *
 * Pure of the environment and of `fetch`, so a test can simulate a hang without waiting for one.
 */

/**
 * Why a call ended. Kept apart on purpose: a timeout, a dropped socket, a schema mismatch and a
 * rejected plan are four different problems, and collapsing them into "failed" is how a hang got
 * mistaken for a slow post.
 */
export type CallOutcome =
  | 'OK'
  /** the budget elapsed with no response — the failure that caused this module to exist */
  | 'TIMED_OUT'
  /** the socket died, DNS failed, the connection dropped */
  | 'NETWORK_FAILED'
  /** the API answered, but with an error status */
  | 'HTTP_ERROR'
  /** the API answered and the body was not the shape we asked for */
  | 'MALFORMED';

/** Failures worth trying once more. A 400 or a malformed body will not fix itself. */
export const isTransient = (o: CallOutcome, status?: number): boolean =>
  o === 'TIMED_OUT' || o === 'NETWORK_FAILED'
  || (o === 'HTTP_ERROR' && (status === 429 || (status ?? 0) >= 500));

export interface CallAttempt {
  ms: number;
  outcome: CallOutcome;
  status?: number;
  /** short, for the record — never the whole body */
  detail?: string;
}

export interface BoundedResult<T> {
  outcome: CallOutcome;
  data?: T;
  /** every attempt, with how long it took. The first attempt's elapsed time is kept even when a
   *  retry succeeds, so a call that is quietly getting slower is visible before it starts hanging. */
  attempts: CallAttempt[];
  detail?: string;
  /** total wall time across attempts */
  ms: number;
}

export interface BoundedCallOptions {
  label: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** the budget for ONE attempt, not for the whole call */
  timeoutMs: number;
  /** one more go, transient failures only. Default true. */
  retryTransient?: boolean;
  /** injected for tests; defaults to global fetch */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * One HTTP call to a model, with a hard ceiling and at most one transient retry.
 *
 * Returns an outcome rather than throwing, because the caller has to be able to tell a timeout from
 * a rejection and act differently — and because a throw is how the distinction got lost before.
 */
export async function boundedCall<T>(opts: BoundedCallOptions): Promise<BoundedResult<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const retry = opts.retryTransient !== false;
  const attempts: CallAttempt[] = [];
  const started = now();

  for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
    const t0 = now();
    try {
      const res = await doFetch(opts.url, {
        method: 'POST', signal: ctl.signal,
        headers: opts.headers, body: JSON.stringify(opts.body),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        attempts.push({ ms: now() - t0, outcome: 'HTTP_ERROR', status: res.status, detail });
        if (attempt === 0 && retry && isTransient('HTTP_ERROR', res.status)) continue;
        return { outcome: 'HTTP_ERROR', attempts, detail, ms: now() - started };
      }
      const data = await res.json().catch(() => null) as T | null;
      if (data === null) {
        attempts.push({ ms: now() - t0, outcome: 'MALFORMED', detail: 'body was not JSON' });
        return { outcome: 'MALFORMED', attempts, detail: 'body was not JSON', ms: now() - started };
      }
      attempts.push({ ms: now() - t0, outcome: 'OK' });
      return { outcome: 'OK', data, attempts, ms: now() - started };
    } catch (err) {
      // An aborted request and a dead socket both land here and are NOT the same problem: one means
      // the model is slow, the other means we never reached it.
      const aborted = (err as Error)?.name === 'AbortError' || ctl.signal.aborted;
      const outcome: CallOutcome = aborted ? 'TIMED_OUT' : 'NETWORK_FAILED';
      const detail = aborted
        ? `no response within ${(opts.timeoutMs / 1000).toFixed(0)}s`
        : String((err as Error)?.message ?? err).slice(0, 200);
      attempts.push({ ms: now() - t0, outcome, detail });
      if (attempt === 0 && retry) continue;
      return { outcome, attempts, detail, ms: now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
  // Only reachable when the first attempt was transient and the loop fell through.
  const last = attempts[attempts.length - 1];
  return { outcome: last?.outcome ?? 'NETWORK_FAILED', attempts, detail: last?.detail, ms: now() - started };
}

/**
 * A model call that ended badly, carrying WHY so the caller can tell a hang from a rejection.
 *
 * Thrown rather than returned only where the existing call site already threw — the outcome
 * survives on the error, so the orchestrator records TIMED_OUT rather than a generic failure.
 */
export class ModelCallError extends Error {
  constructor(
    readonly outcome: CallOutcome,
    readonly label: string,
    readonly attempts: CallAttempt[],
    readonly detail?: string,
  ) {
    super(`${label} ${outcome.toLowerCase().replace(/_/g, ' ')}${detail ? `: ${detail}` : ''}`);
    this.name = 'ModelCallError';
  }
}

/**
 * How long each call gets, chosen from what real generations actually take rather than from a
 * round number.
 *
 * The one fully measured run: the whole research + palette + write stage took 137.5s, and the
 * editor took 18.0s. Studio's existing ceiling for a large call is 150s. The writer produces the
 * biggest single output in the product (8,000 max_tokens, a whole deck), so it gets more room than
 * that ceiling; the editor rewrites existing copy and gets a wide multiple of its measured time.
 *
 * Deliberately generous. A flaky timeout on a working generation costs an agent their post; a slow
 * one that finishes costs three minutes. Christian, 2026-09-08: "I care more about normal success →
 * bounded slow call → honest failure than squeezing another 20 seconds off latency."
 */
export const CALL_BUDGET_MS = {
  /** ~7.5x the editor's measured time, above Studio's 150s ceiling for the largest output */
  WRITER: 180_000,
  /** ~6.7x its measured 18.0s */
  EDITOR: 120_000,
} as const;
