// Materially-used sources for the Studio "what this post was built on" panel.
//
// The panel used to render the raw research briefing (meta.research) verbatim, which showed the agent
// research the post never used — e.g. off-topic legal sources that were fetched and then dropped by the
// claim gate (gen 63917aad: 33 sources fetched, 0 cited by a surviving claim). This computes the
// sources the PUBLISHED copy actually rests on: a research source is materially used ONLY when a
// SURVIVING, SUPPORTED material claim cites its id (claim_qa.supports[].sourceIds, verdict='supported',
// and not later blocked). A deck whose surviving claims are ordinary reasoning ('general_mechanism',
// empty sourceIds) returns [] — the panel then shows nothing rather than a research dump. This truth
// rule applies to every Studio post, legal or not.
//
// Pure and read-side: it reads only what result_metadata already stores, so it works for existing
// decks with no regeneration.

export interface UsedSource { title: string; url: string; domain: string }

interface SupportLike { field?: unknown; claim?: unknown; verdict?: unknown; sourceIds?: unknown }
interface BlockedLike { field?: unknown; text?: unknown }
interface LedgerLike { source_id?: unknown; url?: unknown; title?: unknown; domain?: unknown }

export function materiallyUsedSources(meta: unknown): UsedSource[] {
  const m = (meta ?? {}) as Record<string, unknown>;
  const claimQa = (m.claim_qa ?? {}) as Record<string, unknown>;
  const supports: SupportLike[] = Array.isArray(claimQa.supports) ? (claimQa.supports as SupportLike[]) : [];
  const blocked: BlockedLike[] = Array.isArray(claimQa.blocked) ? (claimQa.blocked as BlockedLike[]) : [];
  const ledger: LedgerLike[] = Array.isArray(m.research_sources) ? (m.research_sources as LedgerLike[]) : [];
  if (!supports.length || !ledger.length) return [];

  // A claim removed later (dropped/blocked) did not reach the reader, so its source is not "built on".
  const isBlocked = (field: unknown, claim: unknown) =>
    blocked.some((b) => b?.field === field && b?.text === claim);

  const usedIds = new Set<string>();
  for (const s of supports) {
    if (s?.verdict !== 'supported') continue;
    if (isBlocked(s.field, s.claim)) continue;
    if (Array.isArray(s.sourceIds)) {
      for (const id of s.sourceIds) if (typeof id === 'string') usedIds.add(id);
    }
  }
  if (!usedIds.size) return [];

  const seen = new Set<string>();
  const out: UsedSource[] = [];
  for (const src of ledger) {
    const id = src?.source_id;
    if (typeof id !== 'string' || !usedIds.has(id)) continue;
    const url = typeof src?.url === 'string' ? src.url : '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const domain = typeof src?.domain === 'string' ? src.domain : '';
    const title = typeof src?.title === 'string' && src.title ? src.title : (domain || url);
    out.push({ title, url, domain });
  }
  return out;
}
