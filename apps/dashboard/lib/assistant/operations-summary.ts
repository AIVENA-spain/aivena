import type { OperationsResponse } from "@/lib/api/types";

/**
 * Plain-language operational summary for the AIVENA Assistant (WAA).
 *
 * PURE + deterministic — NO LLM, NO new provider. It turns the already-live
 * read-only `/api/v1/operations` aggregate (the same data the Command Center
 * shows) into a short "what needs your attention" briefing. This is the
 * no-LLM slice of the assistant: it works today, before the Anthropic-DPA gate
 * (N1/N2) that the free-form chat reply still waits on.
 *
 * Honesty: every line is derived straight from live counts/fields; nothing is
 * invented. It names a lead only at the same level the Command Center already
 * does (at-risk name + reason) — it does NOT open a lead's private conversation
 * or detail (those are the gated `waa_get_*` deep reads, not used here).
 */

const PROVIDER_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
};

/**
 * True when a typed message is clearly asking for an operational status /
 * "what's wrong" summary — the one thing the assistant can answer without the
 * LLM. Everything else falls through to the honest "chat is being activated"
 * reply. Kept deliberately narrow so we never pretend to understand more than
 * we do.
 */
export function looksLikeAttentionAsk(text: string): boolean {
  return /\b(attention|wrong|status|summ(ary|arize|arise)|issues?|problems?|overview|what.{0,12}(need|happening|going on|up))\b/i.test(
    text,
  );
}

export function formatOperationsSummary(d: OperationsResponse): string {
  const a = d.attention;
  const allClear =
    a.openActionItems === 0 && a.atRiskLeads === 0 && a.providerIssues === 0;
  if (allClear) {
    return "Everything looks clear right now — no failed sends, open tasks, at-risk leads, or provider issues.";
  }

  const lines: string[] = ["Here's what needs your attention right now:"];

  if (d.failedSends.count > 0) {
    const top = d.failedSends.items[0];
    const who = top?.leadName ? ` (most recent: ${top.leadName})` : "";
    const n = d.failedSends.count;
    lines.push(`• ${n} failed send${n > 1 ? "s" : ""}${who} — message${n > 1 ? "s" : ""} that didn't reach the buyer.`);
  }

  if (d.actionQueue.total > 0) {
    const types = d.actionQueue.byType.map((t) => `${t.count} ${t.label.toLowerCase()}`).join(", ");
    const n = d.actionQueue.total;
    lines.push(`• ${n} open task${n > 1 ? "s" : ""}${types ? `: ${types}` : ""}.`);
  }

  if (d.lifecycle.atRisk.length > 0) {
    const top = d.lifecycle.atRisk[0];
    const n = d.lifecycle.atRisk.length;
    const more = n > 1 ? ` (+${n - 1} more)` : "";
    lines.push(`• ${n} at-risk lead${n > 1 ? "s" : ""}: ${top.leadName ?? "a lead"} — ${top.reason.toLowerCase()}${more}.`);
  }

  const providerIssues = d.providers.filter((p) => p.state === "disconnected" || p.state === "degraded");
  for (const p of providerIssues) {
    lines.push(`• ${PROVIDER_LABEL[p.provider] ?? p.provider} is ${p.state} — ${p.detail}`);
  }

  const degraded = d.signalHealth.filter((s) => !s.ok);
  if (degraded.length > 0) {
    lines.push(
      `Note: some live data couldn't be read just now (${degraded.map((s) => s.signal).join(", ")}), so this may be partial.`,
    );
  }

  lines.push("Open the Command center for the full list, or tap a lead in the inbox to act.");
  return lines.join("\n");
}
