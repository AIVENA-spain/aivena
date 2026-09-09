// property-valuation — constant-time comparison helper.
//
// Extracted from index.ts so it can be unit-tested. index.ts calls Deno.serve at
// import time, so nothing inside it is reachable from a test runner; a helper that
// guards a secret and cannot be tested is a helper nobody has checked.
//
// Pure (no Deno / npm / env / network) so the same code runs in the edge runtime
// and under vitest.

/**
 * Compare two strings without an early exit on the first differing character.
 *
 * A plain `===` returns as soon as it finds a mismatch, so the time taken reveals
 * how many leading characters were correct — enough, over many attempts, to
 * recover a key one character at a time. This always inspects every character of
 * an equal-length pair.
 *
 * Length is still compared up front and returns early. That leaks the key's
 * LENGTH, which is not the secret; comparing unequal-length strings character by
 * character would either read out of bounds or need padding, and length alone
 * does not narrow the key usefully.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
