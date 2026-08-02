// whatsapp-send-execute — opt-out guard (P3 audit fix, 2026-07-31).
//
// Defense-in-depth: the final provider-calling Edge Function must refuse to send to
// a lead in ANY opt-out state. Before this fix it refused only 'blocked' and let
// 'opted_out' through. This single predicate is the source of truth, shared by the
// Edge Function (index.ts) and its unit test so the two can never drift.
//
// Pure (no Deno / npm / env) so it runs unchanged in the Deno edge runtime AND in
// the repo's vitest.
export function sendBlockedByOptIn(optInStatus: string | null | undefined): boolean {
  return optInStatus === 'blocked' || optInStatus === 'opted_out';
}
