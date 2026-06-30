import type { OperationsResponse } from "@/lib/api/types";

/**
 * AIVENA Assistant — deterministic, plain-language answers (NO LLM).
 *
 * The assistant is the primary agency-facing attention layer. These builders
 * turn the read-only `/api/v1/operations` aggregate into short, warm, guiding
 * answers — "what should I do today", "what's wrong", "explain these tasks",
 * "why is WhatsApp degraded". They work BEFORE the Anthropic-DPA gate (N1/N2).
 *
 * Style: short, scannable, tasteful emojis (not overdone), GUIDING (what · why ·
 * what to do · WHERE it lives). Honest:
 *  - Age-aware — an old failure reads "decide: retry / reply / mark resolved",
 *    never a permanent urgent red.
 *  - NEVER name a lead/task without a path. `/operations` spans ALL leads, but
 *    the Inbox only holds conversation-backed leads (`inInbox`). A lead that
 *    isn't in the Inbox (e.g. a hot lead with no conversation yet) is shown as a
 *    pipeline flag with honest "reach out directly", not "open it in the inbox".
 *  - Nothing invented; nothing claimed resolved that isn't.
 */

export type AssistantIntent = "today" | "wrong" | "tasks" | "whatsapp";

const RECENT_FAIL_HOURS = 72; // recent = urgent; older = "decide what to do"

// A task/flag for a lead that is NOT in the Inbox (no conversation) AND older than
// this is treated as a STALE flag with no agency-facing home — it must NOT be
// presented as an urgent "reach out today" item (that's the Katarzyna case: a
// "super-hot" lead silent for weeks with an un-actioned alert). It is still shown
// honestly, demoted, with the only real action it has: review / clear (resolve).
const STALE_NON_INBOX_HOURS = 168; // 7 days

const PROVIDER_LABEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

const TASK_EXPLAIN: Record<string, string> = {
  suggested_reply: "An AI-drafted reply is waiting for your approval before it sends.",
  send_issue: "A message didn't reach the buyer — retry, reply manually, or mark it resolved.",
  human_review_needed: "AIVENA wasn't sure how to handle something and is asking you to take a look.",
  super_hot_alert: "A lead is very engaged right now — worth contacting quickly.",
  viewing_booking_needed: "A buyer wants a viewing — a time still needs to be confirmed.",
  scoring_failed: "AIVENA couldn't score this lead automatically — review it manually.",
  manual_follow_up: "A follow-up AIVENA has left for a human to do.",
};

function taskExplain(type: string): string {
  return TASK_EXPLAIN[type] ?? "A task that needs a human to take a look.";
}

function ageWord(hours: number | null): string {
  if (hours === null) return "";
  if (hours < 1) return "just now";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function routeIntent(text: string): AssistantIntent | null {
  const t = text.toLowerCase();
  if (/(today|do first|fix first|priorit|where.*start|what.*do\b)/.test(t)) return "today";
  if (/(whatsapp|wa\b|channel|degraded|provider|not send)/.test(t)) return "whatsapp";
  if (/(explain|what.*mean|what.*task|these task|the task)/.test(t)) return "tasks";
  if (/(wrong|issue|problem|status|summary|overview|attention|anything|happening)/.test(t)) return "wrong";
  return null;
}

/** Honest "where to find / how to act" line for a named lead. */
function leadLocation(name: string, inInbox: boolean): string {
  return inInbox
    ? "👉 Open them in the Inbox."
    : `👉 Not in your Inbox yet (no conversation started) — reach out to ${name} directly.`;
}

// --- concern model (prioritised "today" plan) --------------------------------

type Concern = {
  priority: number;
  emoji: string;
  title: string;
  guidance: string;
  location: string | null;
  offTab: boolean;
  // A lead/task with no Inbox home (no conversation) AND stale — demoted out of the
  // urgent plan; surfaced honestly as "older flagged, review/clear" instead.
  staleFlag: boolean;
  leadName: string | null;
};

/** Is this an item the agency CANNOT open or act on in-app yet (no Inbox home) and stale? */
function isStaleNonInbox(inInbox: boolean, ageHours: number | null): boolean {
  return !inInbox && ageHours !== null && ageHours > STALE_NON_INBOX_HOURS;
}

function buildConcerns(d: OperationsResponse): Concern[] {
  const out: Concern[] = [];

  // Open tasks (skip send_issue — failures come from the richer failed-send signal).
  for (const item of d.actionQueue.items) {
    if (item.type === "send_issue") continue;
    const who = item.leadName ?? "a lead";
    const loc = leadLocation(who, item.inInbox);
    const offTab = !item.inInbox;
    const stale = isStaleNonInbox(item.inInbox, item.ageHours);
    const leadName = item.leadName ?? null;
    switch (item.type) {
      case "suggested_reply":
        out.push({ priority: 1, emoji: "💬", title: `Review ${who}'s reply`, guidance: "It may be holding up the buyer's response, so it's the most time-sensitive.", location: loc, offTab, staleFlag: stale, leadName });
        break;
      case "super_hot_alert":
        out.push({ priority: 2, emoji: "🔥", title: `Hot lead: ${who}`, guidance: "Very engaged right now — reach out while they're warm.", location: loc, offTab, staleFlag: stale, leadName });
        break;
      case "viewing_booking_needed":
        out.push({ priority: 3, emoji: "📅", title: `Viewing to book: ${who}`, guidance: "Confirm a time with the buyer.", location: loc, offTab, staleFlag: stale, leadName });
        break;
      case "human_review_needed":
        out.push({ priority: 5, emoji: "⚠️", title: `Needs your review: ${who}`, guidance: "AIVENA flagged something it wasn't sure about.", location: loc, offTab, staleFlag: stale, leadName });
        break;
      default:
        out.push({ priority: 6, emoji: "⚠️", title: `${item.label}: ${who}`, guidance: "Take a look when you can.", location: loc, offTab, staleFlag: stale, leadName });
    }
  }

  // Failed sends — age-aware.
  for (const f of d.failedSends.items) {
    const who = f.leadName ?? "a lead";
    const recent = f.ageHours !== null && f.ageHours < RECENT_FAIL_HOURS;
    const loc = f.inInbox ? "👉 Open them in the Inbox to retry or reply." : `👉 Reach out to ${who} directly.`;
    const stale = isStaleNonInbox(f.inInbox, f.ageHours);
    const leadName = f.leadName ?? null;
    if (recent) {
      out.push({ priority: 2, emoji: "⚠️", title: `Failed message to ${who} (${ageWord(f.ageHours)})`, guidance: "It's recent — retry or reply manually so they're not left waiting.", location: loc, offTab: !f.inInbox, staleFlag: stale, leadName });
    } else {
      out.push({ priority: 6, emoji: "⚠️", title: `Old failed message to ${who} (${ageWord(f.ageHours)})`, guidance: "It's old, so probably not urgent — retry, reply manually, or mark it resolved if it no longer matters.", location: loc, offTab: !f.inInbox, staleFlag: stale, leadName });
    }
  }

  // Provider health (always has a home — Settings → Channels).
  for (const p of d.providers) {
    const label = PROVIDER_LABEL[p.provider] ?? p.provider;
    if (p.state === "disconnected") {
      out.push({ priority: 2, emoji: "🛠️", title: `${label} isn't connected`, guidance: "Reconnect it so AIVENA can message buyers.", location: "👉 Open Settings → Channels.", offTab: false, staleFlag: false, leadName: null });
    } else if (p.state === "degraded") {
      out.push({ priority: 7, emoji: "🛠️", title: `${label} channel is off`, guidance: `${p.detail} AIVENA may not send automatically.`, location: "👉 Open Settings → Channels.", offTab: false, staleFlag: false, leadName: null });
    }
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/** Honest one-liner for the demoted "no Inbox home" flags — names up to 2 leads. */
function staleFooter(stale: Concern[]): string {
  const names = Array.from(new Set(stale.map((c) => c.leadName).filter((n): n is string => !!n)));
  const shown = names.slice(0, 2).join(", ");
  const extra = names.length > 2 ? ` +${names.length - 2} more` : "";
  const who = shown ? ` (${shown}${extra})` : "";
  const n = stale.length;
  return (
    `🧹 Plus ${n} older flagged item${n > 1 ? "s" : ""}${who} for lead${names.length > 1 ? "s" : ""} with no conversation yet — ` +
    "not urgent, and there's no Inbox thread to open. Review or clear them in your Tasks list when you can."
  );
}

const SCOPE_NOTE = "ℹ️ I check across all your leads, not just the tab you're viewing.";
const MAX_TODAY = 3;

// --- public builders ---------------------------------------------------------

export function buildTodayPlan(d: OperationsResponse): string {
  const concerns = buildConcerns(d);
  const live = concerns.filter((c) => !c.staleFlag); // actionable now (Inbox / fresh / Settings)
  const stale = concerns.filter((c) => c.staleFlag); // no Inbox home, demoted

  if (live.length === 0 && stale.length === 0) {
    return "✅ You're all caught up — nothing needs your attention right now. 🎉";
  }

  const lines: string[] = [];
  if (live.length === 0) {
    // Only stale, no-home flags remain — never present these as "do today".
    lines.push("✅ Nothing urgent needs you right now.", "");
    lines.push(staleFooter(stale));
    return lines.join("\n");
  }

  const top = live.slice(0, MAX_TODAY);
  lines.push("Here's what I'd do first today 👇", "");
  top.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.emoji} ${c.title}`);
    lines.push(`   ${c.guidance}`);
    if (c.location) lines.push(`   ${c.location}`);
    lines.push("");
  });
  const rest = live.length - top.length;
  lines.push(rest > 0 ? `👉 Plus ${rest} more lower-priority item${rest > 1 ? "s" : ""} — nothing else looks urgent.` : "✅ Nothing else looks urgent right now.");
  if (stale.length > 0) lines.push(`\n${staleFooter(stale)}`);
  if (top.some((c) => c.offTab)) lines.push(`\n${SCOPE_NOTE}`);
  return lines.join("\n");
}

export function buildWhatsWrong(d: OperationsResponse): string {
  const a = d.attention;
  if (a.openActionItems === 0 && a.atRiskLeads === 0 && a.providerIssues === 0) {
    return "✅ Nothing's wrong right now — no failed sends, open tasks, at-risk leads, or provider issues.";
  }
  const lines = ["Here's what's currently off 👇", ""];
  if (d.failedSends.count > 0) {
    const recent = d.failedSends.items.filter((f) => f.ageHours !== null && f.ageHours < RECENT_FAIL_HOURS).length;
    const old = d.failedSends.count - recent;
    const bits = [recent ? `${recent} recent` : "", old ? `${old} older` : ""].filter(Boolean).join(", ");
    lines.push(`⚠️ ${d.failedSends.count} failed send${d.failedSends.count > 1 ? "s" : ""}${bits ? ` (${bits})` : ""} — message(s) that didn't reach the buyer.`);
  }
  if (d.actionQueue.total > 0) {
    const types = d.actionQueue.byType.map((t) => `${t.count} ${t.label.toLowerCase()}`).join(", ");
    lines.push(`💬 ${d.actionQueue.total} open task${d.actionQueue.total > 1 ? "s" : ""}${types ? `: ${types}` : ""}.`);
    const noHome = d.actionQueue.items.filter((i) => i.type !== "send_issue" && isStaleNonInbox(i.inInbox, i.ageHours)).length;
    if (noHome > 0) lines.push(`🧹 ${noHome} of these ${noHome > 1 ? "are" : "is"} an older flag for a lead with no conversation (no Inbox thread) — review or clear, not urgent.`);
  }
  for (const p of d.providers.filter((x) => x.state === "disconnected" || x.state === "degraded")) {
    lines.push(`🛠️ ${PROVIDER_LABEL[p.provider] ?? p.provider} is ${p.state} — ${p.detail}`);
  }
  const degraded = d.signalHealth.filter((s) => !s.ok);
  if (degraded.length > 0) lines.push(`ℹ️ Some live data couldn't be read just now (${degraded.map((s) => s.signal).join(", ")}) — this may be partial.`);
  lines.push("");
  lines.push('👉 Ask "What should I do today?" and I\'ll put these in order.');
  return lines.join("\n");
}

export function explainTasks(d: OperationsResponse): string {
  if (d.actionQueue.total === 0) return "✅ There are no open tasks right now.";
  const lines = ["Here's what each open task means 👇", ""];
  for (const t of d.actionQueue.byType) {
    lines.push(`• ${t.label} (${t.count}) — ${taskExplain(t.type)}`);
  }
  lines.push("");
  lines.push("👉 Open them in the Inbox to act, or mark one resolved once it's handled.");
  // If any open task's lead isn't in the Inbox, say so honestly — no dead-end "open it".
  if (d.actionQueue.items.some((i) => i.type !== "send_issue" && !i.inInbox)) {
    lines.push(`\n${SCOPE_NOTE} A few flagged leads have no conversation yet, so they aren't in the Inbox queue — there's nothing to open; you can review or clear those when you want.`);
  }
  return lines.join("\n");
}

export function explainWhatsApp(d: OperationsResponse): string {
  const wa = d.providers.find((p) => p.provider === "whatsapp");
  if (!wa) return "I couldn't read the WhatsApp status just now — try again in a moment.";
  switch (wa.state) {
    case "ready":
      return "✅ WhatsApp looks healthy — connected and able to send.";
    case "degraded":
      return [
        "🛠️ WhatsApp is degraded, not down:",
        "",
        `• ${wa.detail}`,
        "• In plain terms: the number is connected, but the channel isn't fully on — so AIVENA may not send WhatsApp messages automatically.",
        "👉 What to do: open Settings → Channels and turn the WhatsApp channel on (or contact AIVENA if it won't enable).",
      ].join("\n");
    case "disconnected":
      return [
        "🛠️ WhatsApp isn't connected right now:",
        "",
        `• ${wa.detail}`,
        "• Until it's reconnected, AIVENA can't send or receive WhatsApp messages.",
        "👉 What to do: reconnect WhatsApp in Settings, or contact AIVENA for help.",
      ].join("\n");
    default:
      return `WhatsApp status: ${wa.state}. ${wa.detail}`;
  }
}

export function answerFor(intent: AssistantIntent, d: OperationsResponse): string {
  switch (intent) {
    case "today":
      return buildTodayPlan(d);
    case "wrong":
      return buildWhatsWrong(d);
    case "tasks":
      return explainTasks(d);
    case "whatsapp":
      return explainWhatsApp(d);
  }
}
