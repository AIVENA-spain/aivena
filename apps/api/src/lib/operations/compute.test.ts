import { describe, it, expect } from 'vitest';
import {
  computeOperations,
  classifyLead,
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
  const failed = new Set<string>(['L']);
  const none = new Set<string>();

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
