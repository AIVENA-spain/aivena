/**
 * Turn any thrown value into something safe to write to a log.
 *
 * WHY THIS EXISTS: drizzle's DrizzleQueryError message is literally
 *   `Failed query: <sql>\nparams: <bind values>`
 * so `console.error(..., err.message)` writes the query's PARAMETERS into the
 * log. Depending on the statement those are Google OAuth access and refresh
 * tokens, a lead's phone and email, or a message body. A review on 2026-08-31
 * found exactly that live in the calendar worker: a failed
 * store_agency_oauth_credential would have logged a customer's live calendar
 * tokens.
 *
 * The codebase had the right instinct in three places (`.split('\n')[0]`) and
 * missed it in others. One helper, so the safe form is also the easy form.
 *
 * Keeps: the first line (the SQL shape — what you actually need to debug).
 * Drops: everything after the first newline, which is where params live.
 */
export function safeErr(err: unknown, max = 200): string {
  if (err instanceof Error) {
    // A driver `cause` carries the real Postgres message (constraint name,
    // SQLSTATE detail) WITHOUT the bind params — better signal, still safe.
    const cause = (err as { cause?: { message?: string } }).cause?.message;
    const chosen = cause ?? err.message;
    return chosen.split('\n')[0].slice(0, max);
  }
  return typeof err === 'string' ? err.split('\n')[0].slice(0, max) : 'error';
}
