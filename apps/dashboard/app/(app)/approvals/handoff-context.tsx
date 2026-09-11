"use client";

/**
 * Shares the Needs-a-human queue with the conversation list.
 *
 * The banner (HandoffQueue) loads and live-updates the queue itself; the list (InboxWorkspace) is a
 * sibling that never saw it, so on 2026-09-11 the list labelled a lead "Auto-handled" while the banner
 * above it said the same lead needed a human. This context hands the list the SAME data the banner
 * already has — no second fetch, no second source of truth.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const EMPTY: ReadonlySet<string> = new Set();

type HandoffLeads = {
  leadIds: ReadonlySet<string>;
  publish: (ids: ReadonlySet<string>) => void;
};

const HandoffLeadsContext = createContext<HandoffLeads>({ leadIds: EMPTY, publish: () => {} });

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function HandoffLeadsProvider({ children }: { children: ReactNode }) {
  const [leadIds, setLeadIds] = useState<ReadonlySet<string>>(EMPTY);
  // The banner polls every 60s; only re-render the list when the queue actually changes.
  const publish = useCallback((next: ReadonlySet<string>) => {
    setLeadIds((prev) => (sameSet(prev, next) ? prev : next));
  }, []);
  const value = useMemo(() => ({ leadIds, publish }), [leadIds, publish]);
  return <HandoffLeadsContext.Provider value={value}>{children}</HandoffLeadsContext.Provider>;
}

/** Lead ids currently in the Needs-a-human queue. */
export function useHandoffLeadIds(): ReadonlySet<string> {
  return useContext(HandoffLeadsContext).leadIds;
}

/** Used by the banner to publish who is in the queue. */
export function usePublishHandoffLeadIds(): (ids: ReadonlySet<string>) => void {
  return useContext(HandoffLeadsContext).publish;
}
