// Pure, Deno-free helpers for the twilio-template-sync Edge Function.
// Kept separate from index.ts so they can be unit-tested from the Node/vitest side
// (index.ts imports Deno + npm: and cannot run under vitest). No Deno/npm imports here.

export type SyncItem = {
  sid: string;
  provider_status: string;                                 // raw Twilio status, verbatim
  mapped_status: 'approved' | 'rejected' | 'pending';
  category: string;
  rejection_reason: string;
};

// approved -> approved, rejected -> rejected, everything else (received, pending,
// unsubmitted, draft, anything new) -> pending. Raw value is preserved in provider_status.
export function mapStatus(s: string): 'approved' | 'rejected' | 'pending' {
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  return 'pending';
}

// Build sync items from one parsed Twilio ContentAndApprovals page body.
// Skips any entry without a SID or without an approval status — never fabricates a row,
// so a failed/empty page yields [] and can never drive a downgrade.
export function extractItems(pageBody: unknown): SyncItem[] {
  const contents = (pageBody as { contents?: unknown } | null)?.contents;
  if (!Array.isArray(contents)) return [];
  const out: SyncItem[] = [];
  for (const c of contents) {
    const sid = (c as { sid?: unknown })?.sid;
    const ar = ((c as { approval_requests?: unknown })?.approval_requests ?? {}) as {
      status?: unknown;
      category?: unknown;
      rejection_reason?: unknown;
    };
    if (typeof sid !== 'string' || sid.length === 0 || ar.status == null) continue;
    out.push({
      sid,
      provider_status: String(ar.status),
      mapped_status: mapStatus(String(ar.status)),
      category: String(ar.category ?? ''),
      rejection_reason: String(ar.rejection_reason ?? ''),
    });
  }
  return out;
}

// DB SIDs not seen in the Twilio response (informational only; these rows are never
// downgraded). De-dupes and drops null/undefined provider_template_id values.
export function computeMissingSids(
  dbSids: Array<string | null | undefined>,
  seen: Set<string>,
): string[] {
  return [...new Set(dbSids.filter((s): s is string => !!s))].filter((s) => !seen.has(s));
}
