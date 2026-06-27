import { describe, it, expect } from 'vitest';
import { WhatsAppReadinessSchema, READINESS_UNAVAILABLE } from './whatsapp';

// Shape the readiness RPC is expected to return for the demo agency after a sync
// (Phase 2 / T7). Uses a Postgres timestamptz jsonb serialization to prove the
// last_provider_sync_at datetime contract accepts what the DB actually emits.
// Demo, post-sync (B3): verified-approved English, sender ready → usable closed-window.
const demoReadiness = {
  ok: true,
  agency_id: 'demo-costa-homes-pilot01',
  whatsapp_sender_ready: true,
  whatsapp_channel_enabled: false,
  templates_provider_approved: {
    count: 8,
    items: [{ template_key: 'agency_followup_v1', language: 'en' }],
  },
  templates_provider_unknown: { count: 0, items: [] },
  languages_ready: ['en'],
  languages_pending: ['de', 'es', 'fr', 'nl', 'no', 'pl', 'sv'],
  closed_window_template_ready: true,
  provider_truth_verified: true,
  last_provider_sync_at: '2026-06-24T10:15:01.4855+00:00',
  template_send_path_proven: false,
};

// Test agency: NO sender → not usable even though platform-inherited templates are approved
// (B3 invariant: approved count is informational; the gate is closed_window_template_ready).
const testAgencyReadiness = {
  ...demoReadiness,
  agency_id: 'wf1v2-test-agency-aaaaaaaaaaaa',
  whatsapp_sender_ready: false,
  closed_window_template_ready: false,
  provider_truth_verified: false,
  last_provider_sync_at: null,
};

describe('WhatsAppReadinessSchema', () => {
  it('parses the demo-shaped object incl. Postgres timestamptz', () => {
    const r = WhatsAppReadinessSchema.safeParse(demoReadiness);
    expect(r.success).toBe(true);
  });

  it('parses a test-agency object with null last_provider_sync_at', () => {
    expect(WhatsAppReadinessSchema.safeParse(testAgencyReadiness).success).toBe(true);
  });

  it('rejects an ok:false RPC envelope so the handler maps it to the friendly error', () => {
    expect(
      WhatsAppReadinessSchema.safeParse({ ok: false, error: 'agency_context_unset' }).success,
    ).toBe(false);
  });

  it('rejects contract drift (a missing field)', () => {
    const { last_provider_sync_at, ...missing } = demoReadiness;
    void last_provider_sync_at;
    expect(WhatsAppReadinessSchema.safeParse(missing).success).toBe(false);
  });

  it('B3 invariant: a no-sender agency with approved templates is still not usable', () => {
    const p = WhatsAppReadinessSchema.safeParse(testAgencyReadiness);
    expect(p.success).toBe(true);
    if (p.success) {
      // approved count can be > 0 (platform inheritance) yet the usability gate is false.
      expect(p.data.whatsapp_sender_ready).toBe(false);
      expect(p.data.closed_window_template_ready).toBe(false);
      expect(p.data.provider_truth_verified).toBe(false);
    }
  });
});

describe('READINESS_UNAVAILABLE envelope', () => {
  it('is friendly and leaks no internals (Law-2)', () => {
    expect(READINESS_UNAVAILABLE.ok).toBe(false);
    expect(READINESS_UNAVAILABLE.error).toBe('whatsapp_readiness_unavailable');
    expect(READINESS_UNAVAILABLE.message).not.toMatch(/agency_context|table|twilio|sql|postgres/i);
  });
});
