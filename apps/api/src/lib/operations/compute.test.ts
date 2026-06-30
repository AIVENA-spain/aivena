import { describe, it, expect } from 'vitest';
import {
  computeOperations,
  classifyLead,
  dedupeLifecycleByLead,
  isFailedDelivery,
  taskLabel,
  ageHours,
  STUCK_HOURS,
  type OperationsSignals,
  type LifecycleRow,
} from './compute';

// Fixed "now" so age maths are deterministic (2026-06-27T12:00:00Z).
const NOW = Date.parse('2026-06-27T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

// Fixture seeded from LIVE demo reads (demo-costa-homes-pilot01, 2026-06-27):
// 1 outbound/undelivered send; open tasks = human_review_needed, send_issue,
// viewing_booking_needed (pending) + super_hot_alert (open); WhatsApp readiness
// RPC NOT deployed → whatsapp signal = null (degrades, never faked).
function demoSignals(over: Partial<OperationsSignals> = {}): OperationsSignals {
  const lifecycle: LifecycleRow[] = [
    // at_risk via failed send (lead-A is in failedSends below)
    { lead_id: 'lead-A', lead_name: 'Ana', channel: 'whatsapp', temperature: 'warm', task_status: 'pending', age_seconds: 3600, latest_inbound_at: hoursAgo(1), last_outbound_at: hoursAgo(2), lead_status: 'active' },
    // at_risk via hot + pending
    { lead_id: 'lead-B', lead_name: 'Ben', channel: 'whatsapp', temperature: 'super_hot', task_status: 'pending', age_seconds: 3600, latest_inbound_at: hoursAgo(1), last_outbound_at: null, lead_status: 'active' },
    // stuck (pending aged past STUCK_HOURS)
    { lead_id: 'lead-C', lead_name: 'Cara', channel: 'email', temperature: 'warm', task_status: 'pending', age_seconds: 30 * 3600, latest_inbound_at: hoursAgo(30), last_outbound_at: null, lead_status: 'active' },
    // waiting_on_you (pending, fresh)
    { lead_id: 'lead-D', lead_name: 'Dan', channel: 'whatsapp', temperature: 'cold', task_status: 'pending', age_seconds: 2 * 3600, latest_inbound_at: hoursAgo(2), last_outbound_at: null, lead_status: 'active' },
    // awaiting_reply (no task; buyer messaged last)
    { lead_id: 'lead-E', lead_name: 'Eve', channel: 'whatsapp', temperature: 'warm', task_status: null, age_seconds: null, latest_inbound_at: hoursAgo(3), last_outbound_at: hoursAgo(10), lead_status: 'engaged' },
    // healthy (no task; we replied last)
    { lead_id: 'lead-F', lead_name: 'Fin', channel: 'whatsapp', temperature: 'cold', task_status: null, age_seconds: null, latest_inbound_at: hoursAgo(10), last_outbound_at: hoursAgo(3), lead_status: 'active' },
  ];
  return {
    failedSends: [
      { message_id: 'm1', lead_id: 'lead-A', lead_name: 'Ana', channel: 'whatsapp', status: 'undelivered', at: hoursAgo(5), preview: 'x'.repeat(300) },
    ],
    openTasks: [
      { task_id: 't1', lead_id: 'lead-B', lead_name: 'Ben', task_type: 'human_review_needed', status: 'pending', priority: 'high', temperature: 'super_hot', title: 'Review', created_at: hoursAgo(1) },
      { task_id: 't2', lead_id: 'lead-A', lead_name: 'Ana', task_type: 'send_issue', status: 'pending', priority: 'high', temperature: 'warm', title: 'Send failed', created_at: hoursAgo(5) },
      { task_id: 't3', lead_id: 'lead-G', lead_name: 'Gio', task_type: 'viewing_booking_needed', status: 'pending', priority: 'normal', temperature: 'hot', title: 'Book viewing', created_at: hoursAgo(2) },
      { task_id: 't4', lead_id: 'lead-B', lead_name: 'Ben', task_type: 'super_hot_alert', status: 'open', priority: 'high', temperature: 'super_hot', title: 'Hot lead', created_at: hoursAgo(1) },
    ],
    lifecycle,
    whatsapp: null,
    email: { from_email: 'costahomes@send.aivena.es', domain_verified: null },
    nowMs: NOW,
    ...over,
  };
}

const nullSignals: OperationsSignals = {
  failedSends: null,
  openTasks: null,
  lifecycle: null,
  whatsapp: null,
  email: null,
  nowMs: NOW,
};

describe('pure helpers', () => {
  it('isFailedDelivery only for non-delivered statuses', () => {
    for (const s of ['undelivered', 'failed', 'cancelled']) expect(isFailedDelivery(s)).toBe(true);
    for (const s of ['sent', 'read', 'queued', 'received', '', null, undefined]) expect(isFailedDelivery(s)).toBe(false);
  });
  it('taskLabel maps known types and humanises unknowns', () => {
    expect(taskLabel('send_issue')).toBe('Send failed — needs attention');
    expect(taskLabel('suggested_reply')).toBe('Reply to approve');
    expect(taskLabel('super_hot_alert')).toBe('Hot-lead alert');
    expect(taskLabel('some_new_type')).toBe('Some new type');
  });
  it('ageHours is null-safe and rounds', () => {
    expect(ageHours(null, NOW)).toBeNull();
    expect(ageHours('not-a-date', NOW)).toBeNull();
    expect(ageHours(hoursAgo(5), NOW)).toBe(5);
  });
});

describe('classifyLead — lifecycle truth table', () => {
  const base: LifecycleRow = {
    lead_id: 'L', lead_name: null, channel: null, temperature: null,
    task_status: null, age_seconds: null, latest_inbound_at: null, last_outbound_at: null, lead_status: null,
  };
  const failed = new Map<string, { at: string | null; count: number }>([['L', { at: hoursAgo(100), count: 1 }]]);
  const none = new Map<string, { at: string | null; count: number }>();

  it('failed send → at_risk (highest priority)', () => {
    expect(classifyLead({ ...base, task_status: 'pending' }, failed, NOW).bucket).toBe('at_risk');
  });
  it('hot + pending → at_risk', () => {
    expect(classifyLead({ ...base, task_status: 'pending', temperature: 'hot' }, none, NOW).bucket).toBe('at_risk');
  });
  it('pending aged past STUCK_HOURS → stuck', () => {
    expect(classifyLead({ ...base, task_status: 'pending', age_seconds: (STUCK_HOURS + 1) * 3600 }, none, NOW).bucket).toBe('stuck');
  });
  it('fresh pending → waiting_on_you', () => {
    expect(classifyLead({ ...base, task_status: 'pending', age_seconds: 3600 }, none, NOW).bucket).toBe('waiting_on_you');
  });
  it('no task, buyer messaged last → awaiting_reply', () => {
    expect(classifyLead({ ...base, latest_inbound_at: hoursAgo(1), last_outbound_at: hoursAgo(5) }, none, NOW).bucket).toBe('awaiting_reply');
  });
  it('no task, we replied last → healthy', () => {
    expect(classifyLead({ ...base, latest_inbound_at: hoursAgo(5), last_outbound_at: hoursAgo(1) }, none, NOW).bucket).toBe('healthy');
  });
});

describe('computeOperations — demo live fixture', () => {
  const res = computeOperations('demo-costa-homes-pilot01', demoSignals());

  it('passes through the agency id', () => {
    expect(res.agencyId).toBe('demo-costa-homes-pilot01');
  });

  it('attention headline counts are correct', () => {
    expect(res.attention.failedSends).toBe(1);
    expect(res.attention.openTasks).toBe(4);
    expect(res.attention.atRiskLeads).toBe(3); // at_risk (A,B) + stuck (C)
    expect(res.attention.providerIssues).toBe(0); // whatsapp unavailable ≠ issue; email unknown ≠ issue
    expect(res.attention.openActionItems).toBe(5); // 4 tasks + 1 failed send
  });

  it('failed sends are read live, truncated, with age', () => {
    expect(res.failedSends.count).toBe(1);
    expect(res.failedSends.available).toBe(true);
    const f = res.failedSends.items[0];
    expect(f.status).toBe('undelivered');
    expect(f.ageHours).toBe(5);
    expect(f.preview!.length).toBeLessThanOrEqual(160);
    expect(res.failedSends.note.toLowerCase()).toContain('f3');
  });

  it('action queue groups by type with friendly labels', () => {
    const types = Object.fromEntries(res.actionQueue.byType.map((t) => [t.type, t]));
    expect(res.actionQueue.total).toBe(4);
    expect(types['send_issue'].label).toBe('Send failed — needs attention');
    expect(types['super_hot_alert'].count).toBe(1);
    expect(res.actionQueue.items.every((i) => i.label.length > 0)).toBe(true);
  });

  it('NO FAKE STATE: WhatsApp degrades to unavailable, email is unknown', () => {
    const wa = res.providers.find((p) => p.provider === 'whatsapp')!;
    const em = res.providers.find((p) => p.provider === 'email')!;
    expect(wa.state).toBe('unavailable');
    expect(wa.state).not.toBe('ready');
    expect(wa.state).not.toBe('disconnected'); // unavailable ≠ asserting disconnected
    expect(em.state).toBe('unknown');
    expect(em.state).not.toBe('ready');
    // every provider cites a source
    for (const p of res.providers) expect(p.source.length).toBeGreaterThan(0);
  });

  it('lifecycle buckets + at-risk list (sorted by age desc) are derived honestly', () => {
    const counts = Object.fromEntries(res.lifecycle.buckets.map((b) => [b.key, b.count]));
    expect(counts['at_risk']).toBe(2);
    expect(counts['stuck']).toBe(1);
    expect(counts['waiting_on_you']).toBe(1);
    expect(counts['awaiting_reply']).toBe(1);
    expect(counts['healthy']).toBe(1);
    // at-risk surface = at_risk + stuck, most-aged first (Cara 30h leads)
    expect(res.lifecycle.atRisk.map((r) => r.leadId)).toEqual(['lead-C', 'lead-A', 'lead-B']);
    expect(res.lifecycle.atRisk[0].reason).toContain('Pending for');
  });

  it('signalHealth reports the WhatsApp read as degraded', () => {
    const wa = res.signalHealth.find((s) => s.signal === 'whatsapp')!;
    expect(wa.ok).toBe(false);
    expect(res.signalHealth.find((s) => s.signal === 'failedSends')!.ok).toBe(true);
  });
});

describe('computeOperations — all signals null (full degradation, no throw, no fake)', () => {
  const res = computeOperations('x', nullSignals);
  it('every section degrades to available:false with zero counts, never fake', () => {
    expect(res.failedSends.available).toBe(false);
    expect(res.failedSends.count).toBe(0);
    expect(res.actionQueue.available).toBe(false);
    expect(res.actionQueue.total).toBe(0);
    expect(res.lifecycle.available).toBe(false);
    expect(res.lifecycle.buckets.length).toBe(0);
    expect(res.attention.openActionItems).toBe(0);
    expect(res.providers.find((p) => p.provider === 'whatsapp')!.state).toBe('unavailable');
    expect(res.providers.find((p) => p.provider === 'email')!.state).toBe('unavailable');
  });
  it('all signalHealth entries report not-ok', () => {
    expect(res.signalHealth.every((s) => s.ok === false)).toBe(true);
  });
});

describe('computeOperations — WhatsApp present (consumed) flips provider state', () => {
  it('disconnected sender → disconnected (a real issue)', () => {
    const res = computeOperations('x', demoSignals({
      whatsapp: { whatsapp_sender_ready: false, whatsapp_channel_enabled: false, template_send_path_proven: false, last_provider_sync_at: null },
    }));
    const wa = res.providers.find((p) => p.provider === 'whatsapp')!;
    expect(wa.state).toBe('disconnected');
    expect(res.attention.providerIssues).toBe(1);
  });
  it('connected but send-path unproven → degraded, never ready', () => {
    const res = computeOperations('x', demoSignals({
      whatsapp: { whatsapp_sender_ready: true, whatsapp_channel_enabled: true, template_send_path_proven: false, last_provider_sync_at: '2026-06-24T10:00:00Z' },
    }));
    expect(res.providers.find((p) => p.provider === 'whatsapp')!.state).toBe('degraded');
  });
});

// Regression: the live Marte Brenno bug — dashboard_inbox returns one row per
// actionable inbox item, so a single lead with many items must NOT repeat once
// per item in the at-risk list. Lifecycle/at-risk is per-LEAD.
const lc = (over: Partial<LifecycleRow> = {}): LifecycleRow => ({
  lead_id: 'L',
  lead_name: 'L',
  channel: 'whatsapp',
  temperature: null,
  task_status: null,
  age_seconds: null,
  latest_inbound_at: null,
  last_outbound_at: null,
  lead_status: 'active',
  ...over,
});

describe('dedupeLifecycleByLead — per-lead collapse', () => {
  it('many inbox rows for the SAME lead collapse to one entry (failed send → at_risk)', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      lc({ lead_id: 'marte', lead_name: 'Marte Brenno', latest_inbound_at: hoursAgo(i + 1) }));
    const out = dedupeLifecycleByLead(rows, new Map([['marte', { at: hoursAgo(120), count: 1 }]]), NOW);
    expect(out.length).toBe(1);
    expect(out[0].row.lead_id).toBe('marte');
    expect(out[0].bucket).toBe('at_risk');
  });

  it('different leads stay separate', () => {
    const rows = [lc({ lead_id: 'a' }), lc({ lead_id: 'b' }), lc({ lead_id: 'c' })];
    expect(dedupeLifecycleByLead(rows, new Map(), NOW).map((h) => h.row.lead_id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the MOST URGENT bucket across a lead\'s rows', () => {
    const rows = [
      lc({ lead_id: 'x', latest_inbound_at: hoursAgo(10), last_outbound_at: hoursAgo(1) }), // healthy
      lc({ lead_id: 'x', task_status: 'pending', age_seconds: 2 * 3600 }), // waiting_on_you
      lc({ lead_id: 'x', task_status: 'pending', age_seconds: 30 * 3600 }), // stuck
    ];
    const out = dedupeLifecycleByLead(rows, new Map(), NOW);
    expect(out.length).toBe(1);
    expect(out[0].bucket).toBe('stuck');
  });

  it('ties on bucket break to the most recent activity', () => {
    const older = lc({ lead_id: 'y', task_status: 'pending', age_seconds: 30 * 3600, latest_inbound_at: hoursAgo(40) });
    const newer = lc({ lead_id: 'y', task_status: 'pending', age_seconds: 25 * 3600, latest_inbound_at: hoursAgo(2) });
    const out = dedupeLifecycleByLead([older, newer], new Map(), NOW);
    expect(out.length).toBe(1);
    expect(out[0].bucket).toBe('stuck');
    expect(out[0].row.latest_inbound_at).toBe(hoursAgo(2)); // newer wins the tie
  });
});

describe('computeOperations — dedupe keeps Operations honest (integration)', () => {
  it('15 inbox rows for one lead with a failed send → ONE at-risk row + count 1, send still visible', () => {
    const lifecycle = Array.from({ length: 15 }, (_, i) =>
      lc({ lead_id: 'marte', lead_name: 'Marte Brenno', latest_inbound_at: hoursAgo(i + 1) }));
    const res = computeOperations('demo', {
      failedSends: [{ message_id: 'm', lead_id: 'marte', lead_name: 'Marte Brenno', channel: 'whatsapp', status: 'undelivered', at: hoursAgo(3), preview: null }],
      openTasks: [],
      lifecycle,
      whatsapp: null,
      email: null,
      nowMs: NOW,
    });
    expect(res.lifecycle.atRisk.length).toBe(1);
    expect(res.lifecycle.atRisk[0].leadId).toBe('marte');
    expect(res.lifecycle.buckets.find((b) => b.key === 'at_risk')?.count).toBe(1);
    expect(res.attention.atRiskLeads).toBe(1);
    expect(res.failedSends.count).toBe(1); // real failure still visible — not hidden
  });

  it('multiple leads still appear separately with honest per-lead bucket counts', () => {
    const res = computeOperations('demo', {
      failedSends: [{ message_id: 'm', lead_id: 'a', lead_name: 'A', channel: 'whatsapp', status: 'failed', at: hoursAgo(2), preview: null }],
      openTasks: [],
      lifecycle: [
        lc({ lead_id: 'a', lead_name: 'A' }),
        lc({ lead_id: 'a', lead_name: 'A' }), // dup of A → collapses (at_risk via failed send)
        lc({ lead_id: 'b', lead_name: 'B', task_status: 'pending', age_seconds: 30 * 3600 }), // stuck
        lc({ lead_id: 'c', lead_name: 'C', latest_inbound_at: hoursAgo(10), last_outbound_at: hoursAgo(1) }), // healthy
      ],
      whatsapp: null,
      email: null,
      nowMs: NOW,
    });
    const counts = Object.fromEntries(res.lifecycle.buckets.map((b) => [b.key, b.count]));
    expect(counts['at_risk']).toBe(1); // lead A counted once
    expect(counts['stuck']).toBe(1); // lead B
    expect(counts['healthy']).toBe(1); // lead C
    expect(res.lifecycle.atRisk.map((r) => r.leadId).sort()).toEqual(['a', 'b']);
  });
});

// Regression: a failed-send-driven at-risk row must age from the FAILURE, not
// the lead's latest activity — the live Marte case showed "...did not reach
// them · 2h" where 2h was a fresh reply and the real failure was 12 days old.
describe('computeOperations — failed-send at-risk uses the FAILURE age + clear wording', () => {
  it('ages from the failed send (not the latest reply) and rewords the reason', () => {
    const res = computeOperations('demo', {
      failedSends: [{ message_id: 'm', lead_id: 'marte', lead_name: 'Marte Brenno', channel: 'whatsapp', status: 'undelivered', at: hoursAgo(288), preview: null }],
      openTasks: [],
      lifecycle: [lc({ lead_id: 'marte', lead_name: 'Marte Brenno', latest_inbound_at: hoursAgo(2), last_outbound_at: hoursAgo(2) })],
      whatsapp: null,
      email: null,
      nowMs: NOW,
    });
    expect(res.lifecycle.atRisk).toHaveLength(1);
    const r = res.lifecycle.atRisk[0];
    expect(r.reason).toBe('Has an unresolved failed send');
    expect(r.reason).not.toMatch(/last send/i); // no longer implies the LATEST send failed
    expect(r.ageHours).toBe(288); // 12d — the failure, NOT the 2h reply
    expect(r.lastActivityAt).toBe(hoursAgo(288));
  });

  it('multiple failures → pluralised reason + most-recent failure age', () => {
    const res = computeOperations('demo', {
      failedSends: [
        { message_id: 'm1', lead_id: 'x', lead_name: 'X', channel: 'whatsapp', status: 'failed', at: hoursAgo(5), preview: null },
        { message_id: 'm2', lead_id: 'x', lead_name: 'X', channel: 'whatsapp', status: 'undelivered', at: hoursAgo(50), preview: null },
      ],
      openTasks: [],
      lifecycle: [lc({ lead_id: 'x', lead_name: 'X', latest_inbound_at: hoursAgo(1) })],
      whatsapp: null,
      email: null,
      nowMs: NOW,
    });
    const r = res.lifecycle.atRisk[0];
    expect(r.reason).toBe('Has 2 unresolved failed sends');
    expect(r.ageHours).toBe(5); // most-recent failure (failedRows are newest-first)
  });

  it('a NON-failed at-risk (hot lead) still ages from its pending task, not a failure', () => {
    const res = computeOperations('demo', {
      failedSends: [],
      openTasks: [],
      lifecycle: [lc({ lead_id: 'hot', lead_name: 'Hot', task_status: 'pending', temperature: 'super_hot', age_seconds: 3 * 3600 })],
      whatsapp: null,
      email: null,
      nowMs: NOW,
    });
    const r = res.lifecycle.atRisk[0];
    expect(r.reason).toBe('Hot lead waiting on a decision');
    expect(r.ageHours).toBe(3);
  });
});

// Regression: the Katarzyna case — a task whose lead has NO conversation isn't in
// dashboard_inbox, so it must be marked inInbox:false (no Inbox home to open).
describe('computeOperations — inInbox marks Inbox-openable vs pipeline-only', () => {
  it('task lead present in lifecycle → inInbox true; absent → inInbox false', () => {
    const res = computeOperations('demo', {
      failedSends: null,
      openTasks: [
        { task_id: 't-marte', lead_id: 'marte', lead_name: 'Marte', task_type: 'suggested_reply', status: 'pending', priority: null, temperature: 'warm', title: null, created_at: hoursAgo(2) },
        { task_id: 't-kat', lead_id: 'kat', lead_name: 'Katarzyna', task_type: 'super_hot_alert', status: 'open', priority: 'high', temperature: 'super_hot', title: null, created_at: hoursAgo(8) },
      ],
      // Only Marte has a dashboard_inbox row (a conversation); Katarzyna does not.
      lifecycle: [lc({ lead_id: 'marte', lead_name: 'Marte', latest_inbound_at: hoursAgo(2) })],
      whatsapp: null,
      email: null,
      nowMs: NOW,
    });
    const byLead = Object.fromEntries(res.actionQueue.items.map((i) => [i.leadId, i.inInbox]));
    expect(byLead['marte']).toBe(true);
    expect(byLead['kat']).toBe(false);
  });
});
