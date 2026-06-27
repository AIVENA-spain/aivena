/**
 * Command-center / operations model (F1 + F2 + F4) — PURE compute. No I/O, no
 * DB, no Date.now() (the route passes `nowMs` so age maths stay deterministic
 * and unit-testable, mirroring lib/readiness/compute.ts).
 *
 * The route gathers raw live signals (each in its own savepoint so a missing
 * table / RPC degrades that one signal instead of aborting the request) and
 * hands them here. This module shapes them into the ops surface the dashboard
 * renders: what needs attention, failed sends, the open action queue, provider
 * health, and lead-lifecycle health.
 *
 * Hard honesty rules (mirror the workboard Safety/proof checklist):
 *  - No fake states. Every provider/signal carries a `source`; a null signal →
 *    `unavailable` / `unknown`, never an invented "connected"/"ready".
 *  - Failed sends are read straight from the live delivery `status`
 *    (undelivered|failed|cancelled = "did NOT reach the buyer") — never inferred.
 *  - WhatsApp provider health is CONSUMED from Chat 3's readiness RPC; a null
 *    signal (RPC not deployed yet — Phase 1c) → `unavailable`, never faked.
 *  - Lead-lifecycle "health" is DERIVED from real timestamps/statuses and each
 *    at-risk row states the concrete reason; there is no lifecycle column yet.
 *  - This endpoint is READ-ONLY. It surfaces work; it never creates tasks or
 *    sends. Fallback-task CREATION on send failure is F3 (Chat 3).
 */

// --- delivery-status vocab (live `conversation_messages.status`) -------------
// received | queued | sent | read | undelivered | failed | cancelled.
// The last three mean the message did NOT reach the buyer.
export const FAILED_DELIVERY_STATUSES: ReadonlySet<string> = new Set([
  'undelivered',
  'failed',
  'cancelled',
]);

export function isFailedDelivery(status: string | null | undefined): boolean {
  return !!status && FAILED_DELIVERY_STATUSES.has(status);
}

// --- open-task vocab (live `dashboard_tasks.status`) -------------------------
// A task needs a human while it is pending/open; approved/dismissed/handled are done.
export const OPEN_TASK_STATUSES: ReadonlySet<string> = new Set(['pending', 'open']);

/**
 * Human label per task_type (live vocab seen in dashboard_tasks). Unknown types
 * fall back to a humanised form so a new backend task type never renders raw.
 */
const TASK_LABELS: Record<string, string> = {
  suggested_reply: 'Reply to approve',
  human_review_needed: 'Needs your review',
  send_issue: 'Send failed — needs attention',
  super_hot_alert: 'Hot-lead alert',
  viewing_booking_needed: 'Viewing to book',
  scoring_failed: 'Lead scoring failed',
  manual_follow_up: 'Manual follow-up',
};

export function taskLabel(type: string): string {
  return (
    TASK_LABELS[type] ??
    type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  );
}

// Lead-lifecycle health buckets (derived; ordered most→least urgent for display).
export type HealthBucket =
  | 'at_risk' // last send failed, or hot lead waiting
  | 'stuck' // a pending task has aged past the threshold
  | 'waiting_on_you' // a pending task awaits a human decision
  | 'awaiting_reply' // buyer messaged last; no outbound since
  | 'healthy';

const HEALTH_LABELS: Record<HealthBucket, string> = {
  at_risk: 'At risk',
  stuck: 'Stuck',
  waiting_on_you: 'Waiting on you',
  awaiting_reply: 'Awaiting your reply',
  healthy: 'Healthy',
};

/** A pending task older than this many hours is "stuck", not merely "waiting". */
export const STUCK_HOURS = 24;
const HOT_TEMPS: ReadonlySet<string> = new Set(['hot', 'super_hot']);

// --- raw signal row shapes (what the route gathers) -------------------------

export type FailedSendRow = {
  message_id: string;
  lead_id: string | null;
  lead_name: string | null;
  channel: string | null; // conversation_messages.message_type
  status: string; // undelivered | failed | cancelled
  at: string | null; // sent_at ?? created_at (ISO)
  preview: string | null;
};

export type OpenTaskRow = {
  task_id: string;
  lead_id: string | null;
  lead_name: string | null;
  task_type: string;
  status: string;
  priority: string | null;
  temperature: string | null;
  title: string | null;
  created_at: string | null; // ISO
};

export type LifecycleRow = {
  lead_id: string;
  lead_name: string | null;
  channel: string | null;
  temperature: string | null;
  task_status: string | null; // pending | handled | null
  age_seconds: number | null; // age of the pending task (from dashboard_inbox)
  latest_inbound_at: string | null; // ISO
  last_outbound_at: string | null; // ISO
  lead_status: string | null;
};

/** WhatsApp provider health — CONSUMED from Chat 3's RPC; null = not deployed. */
export type WhatsAppOpsSignal = {
  whatsapp_sender_ready: boolean;
  whatsapp_channel_enabled: boolean;
  template_send_path_proven: boolean;
  last_provider_sync_at: string | null;
} | null;

export type OperationsSignals = {
  failedSends: FailedSendRow[] | null;
  openTasks: OpenTaskRow[] | null;
  lifecycle: LifecycleRow[] | null;
  whatsapp: WhatsAppOpsSignal;
  /** Optional email-config presence; email is NEVER reported "connected"/"verified". */
  email: { from_email: string | null; domain_verified: boolean | null } | null;
  nowMs: number;
};

// --- output shapes -----------------------------------------------------------

export type OpsProviderState =
  | 'ready'
  | 'degraded'
  | 'disconnected'
  | 'unavailable' // signal could not be read (e.g. RPC not deployed) — NOT "disconnected"
  | 'unknown'; // no verification mechanism exists yet — never faked as ready

export type OperationsResponse = {
  agencyId: string;
  attention: {
    failedSends: number;
    openTasks: number;
    atRiskLeads: number;
    providerIssues: number; // disconnected/degraded only — "unavailable"/"unknown" are not counted as issues
    /** Concrete open action items = open tasks + undelivered sends (a headline, may overlap a lead). */
    openActionItems: number;
  };
  failedSends: {
    count: number;
    items: Array<{
      messageId: string;
      leadId: string | null;
      leadName: string | null;
      channel: string | null;
      status: string;
      at: string | null;
      ageHours: number | null;
      preview: string | null;
    }>;
    /** Honest note about automatic fallback-task creation (F3, Chat 3). */
    note: string;
    available: boolean; // false when the signal degraded (could not be read)
  };
  actionQueue: {
    total: number;
    byType: Array<{ type: string; label: string; count: number }>;
    items: Array<{
      taskId: string;
      leadId: string | null;
      leadName: string | null;
      type: string;
      label: string;
      status: string;
      priority: string | null;
      temperature: string | null;
      title: string | null;
      createdAt: string | null;
      ageHours: number | null;
    }>;
    available: boolean;
  };
  providers: Array<{
    provider: 'whatsapp' | 'email';
    state: OpsProviderState;
    detail: string;
    source: string;
  }>;
  lifecycle: {
    buckets: Array<{ key: HealthBucket; label: string; count: number }>;
    atRisk: Array<{
      leadId: string;
      leadName: string | null;
      bucket: HealthBucket;
      reason: string;
      temperature: string | null;
      ageHours: number | null;
      lastActivityAt: string | null;
    }>;
    available: boolean;
  };
  /** Per-signal read health, so the UI can show "couldn't load X" honestly. */
  signalHealth: Array<{ signal: string; ok: boolean; source: string }>;
};

// --- helpers -----------------------------------------------------------------

export function ageHours(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const h = (nowMs - t) / 3_600_000;
  return Math.max(0, Math.round(h * 10) / 10);
}

function firstNonNull(...vals: Array<string | null | undefined>): string | null {
  for (const v of vals) if (v) return v;
  return null;
}

/**
 * Derive a lead's lifecycle-health bucket + a concrete reason from real signals.
 * `failedLeadIds` = leads with at least one undelivered send (cross-signal).
 */
export function classifyLead(
  row: LifecycleRow,
  failedLeadIds: ReadonlySet<string>,
  nowMs: number,
): { bucket: HealthBucket; reason: string } {
  const pending = row.task_status === 'pending';
  const taskAgeH =
    typeof row.age_seconds === 'number' ? Math.max(0, Math.round((row.age_seconds / 3600) * 10) / 10) : null;

  if (row.lead_id && failedLeadIds.has(row.lead_id)) {
    return { bucket: 'at_risk', reason: 'Last send to this lead did not reach them' };
  }
  if (pending && row.temperature && HOT_TEMPS.has(row.temperature)) {
    return { bucket: 'at_risk', reason: 'Hot lead waiting on a decision' };
  }
  if (pending && taskAgeH !== null && taskAgeH >= STUCK_HOURS) {
    return { bucket: 'stuck', reason: `Pending for ${Math.round(taskAgeH)}h` };
  }
  if (pending) {
    return { bucket: 'waiting_on_you', reason: 'A reply/approval is waiting' };
  }
  // No pending task: is the buyer waiting on us?
  const inbound = row.latest_inbound_at ? Date.parse(row.latest_inbound_at) : NaN;
  const outbound = row.last_outbound_at ? Date.parse(row.last_outbound_at) : NaN;
  const buyerWaiting =
    !Number.isNaN(inbound) && (Number.isNaN(outbound) || inbound > outbound);
  if (buyerWaiting) {
    return { bucket: 'awaiting_reply', reason: 'They messaged last — no reply since' };
  }
  return { bucket: 'healthy', reason: 'No action needed' };
}

function whatsappState(wa: WhatsAppOpsSignal): { state: OpsProviderState; detail: string } {
  if (!wa) {
    return {
      state: 'unavailable',
      detail:
        'WhatsApp provider readiness not available yet (readiness RPC not deployed — Chat 3 H1/Phase 1c). Not reported as connected.',
    };
  }
  if (!wa.whatsapp_sender_ready) {
    return { state: 'disconnected', detail: 'WhatsApp sender is not connected.' };
  }
  if (!wa.whatsapp_channel_enabled) {
    return { state: 'degraded', detail: 'Sender connected but the WhatsApp channel is off.' };
  }
  if (!wa.template_send_path_proven) {
    return {
      state: 'degraded',
      detail: 'Connected, but the template-send path is not yet proven (no live template send to date).',
    };
  }
  return { state: 'ready', detail: 'WhatsApp connected and template-send proven.' };
}

// --- the compute -------------------------------------------------------------

export function computeOperations(agencyId: string, s: OperationsSignals): OperationsResponse {
  const now = s.nowMs;

  // ---- Failed sends (F2) ----------------------------------------------------
  const failedAvailable = s.failedSends !== null;
  const failedRows = s.failedSends ?? [];
  const failedLeadIds = new Set<string>();
  for (const r of failedRows) if (r.lead_id) failedLeadIds.add(r.lead_id);

  const failedItems = failedRows.map((r) => ({
    messageId: r.message_id,
    leadId: r.lead_id,
    leadName: r.lead_name,
    channel: r.channel,
    status: r.status,
    at: r.at,
    ageHours: ageHours(r.at, now),
    preview: r.preview ? r.preview.slice(0, 160) : null,
  }));

  // ---- Open action queue (F2 + F1) -----------------------------------------
  const tasksAvailable = s.openTasks !== null;
  const taskRows = s.openTasks ?? [];
  const byTypeMap = new Map<string, number>();
  for (const t of taskRows) byTypeMap.set(t.task_type, (byTypeMap.get(t.task_type) ?? 0) + 1);
  const byType = Array.from(byTypeMap.entries())
    .map(([type, count]) => ({ type, label: taskLabel(type), count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const queueItems = taskRows.map((t) => ({
    taskId: t.task_id,
    leadId: t.lead_id,
    leadName: t.lead_name,
    type: t.task_type,
    label: taskLabel(t.task_type),
    status: t.status,
    priority: t.priority,
    temperature: t.temperature,
    title: t.title,
    createdAt: t.created_at,
    ageHours: ageHours(t.created_at, now),
  }));

  // ---- Providers ------------------------------------------------------------
  const wa = whatsappState(s.whatsapp);
  const emailConfigured = !!s.email && !!s.email.from_email && s.email.from_email.trim().length > 0;
  const providers: OperationsResponse['providers'] = [
    {
      provider: 'whatsapp',
      state: wa.state,
      detail: wa.detail,
      source: 'get_whatsapp_provider_readiness() (consumed; Chat 3)',
    },
    {
      provider: 'email',
      // Email has NO real "verified sending" signal in the DB → never "ready".
      state: s.email === null ? 'unavailable' : 'unknown',
      detail:
        s.email === null
          ? 'Email config not read.'
          : emailConfigured
            ? 'Email configured; sending is not provider-proven (no verification signal exists yet).'
            : 'Email sending not configured.',
      source: 'agency email config presence (no verified-send signal exists)',
    },
  ];
  const providerIssues = providers.filter(
    (p) => p.state === 'disconnected' || p.state === 'degraded',
  ).length;

  // ---- Lifecycle health (F4) ------------------------------------------------
  const lifecycleAvailable = s.lifecycle !== null;
  const lifeRows = s.lifecycle ?? [];
  const bucketCounts = new Map<HealthBucket, number>();
  const atRisk: OperationsResponse['lifecycle']['atRisk'] = [];
  for (const row of lifeRows) {
    const { bucket, reason } = classifyLead(row, failedLeadIds, now);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    if (bucket === 'at_risk' || bucket === 'stuck') {
      const lastActivityAt = firstNonNull(row.latest_inbound_at, row.last_outbound_at);
      atRisk.push({
        leadId: row.lead_id,
        leadName: row.lead_name,
        bucket,
        reason,
        temperature: row.temperature,
        ageHours:
          typeof row.age_seconds === 'number'
            ? Math.max(0, Math.round((row.age_seconds / 3600) * 10) / 10)
            : ageHours(lastActivityAt, now),
        lastActivityAt,
      });
    }
  }
  atRisk.sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));

  const bucketOrder: HealthBucket[] = [
    'at_risk',
    'stuck',
    'waiting_on_you',
    'awaiting_reply',
    'healthy',
  ];
  const buckets = bucketOrder
    .map((key) => ({ key, label: HEALTH_LABELS[key], count: bucketCounts.get(key) ?? 0 }))
    .filter((b) => b.count > 0);

  // ---- Attention headline ---------------------------------------------------
  const attention = {
    failedSends: failedItems.length,
    openTasks: queueItems.length,
    atRiskLeads: (bucketCounts.get('at_risk') ?? 0) + (bucketCounts.get('stuck') ?? 0),
    providerIssues,
    openActionItems: queueItems.length + failedItems.length,
  };

  // ---- Signal health (honesty: which reads degraded) ------------------------
  const signalHealth = [
    { signal: 'failedSends', ok: failedAvailable, source: 'conversation_messages (outbound, non-delivered)' },
    { signal: 'actionQueue', ok: tasksAvailable, source: 'dashboard_tasks (status pending/open)' },
    { signal: 'lifecycle', ok: lifecycleAvailable, source: 'dashboard_inbox(limit, days)' },
    { signal: 'whatsapp', ok: s.whatsapp !== null, source: 'get_whatsapp_provider_readiness()' },
  ];

  return {
    agencyId,
    attention,
    failedSends: {
      count: failedItems.length,
      items: failedItems,
      note:
        'Undelivered sends are read live from message delivery status. Some failures also create a `send_issue` task (shown in the action queue); guaranteeing a fallback task on EVERY send failure is F3 (Chat 3).',
      available: failedAvailable,
    },
    actionQueue: { total: queueItems.length, byType, items: queueItems, available: tasksAvailable },
    providers,
    lifecycle: { buckets, atRisk, available: lifecycleAvailable },
    signalHealth,
  };
}
