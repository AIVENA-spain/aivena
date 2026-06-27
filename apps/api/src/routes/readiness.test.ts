import { describe, it, expect } from 'vitest';
import { canReadReadiness } from './readiness';
import {
  computeReadiness,
  type ReadinessSignals,
  type ReadinessItem,
  type WhatsAppSignal,
} from '../lib/readiness/compute';

// Fixture seeded from LIVE demo reads (demo-costa-homes-pilot01, 2026-06-27):
// legal_name NULL, trading name set, website = aivena.es placeholder, region NULL
// but primary_region set, 8 languages (both sources agree), tz mismatch
// (working_hours=Europe/Madrid vs column=UTC), approval-first, 2 owners, 8 EN
// templates / 0 non-EN, 141 properties, 1 consent row, no calendar OAuth, and the
// WhatsApp readiness RPC NOT deployed yet (Phase 1c) → whatsapp signal = null.
function demoSignals(over: Partial<ReadinessSignals> = {}): ReadinessSignals {
  return {
    agency: {
      legal_name: null,
      trading_name: 'Mediterráneo Costa Homes',
      status: 'active',
      primary_region: 'Costa Blanca',
      supported_languages: ['es', 'en', 'pl', 'de', 'nl', 'sv', 'no', 'fr'],
    },
    branding: {
      logo_url: 'https://example.supabase.co/storage/v1/object/public/agency-logos/demo/logo.png',
      primary_color: '#0B2545',
      accent_color: '#C9A45C',
      phone: '+34 600 999 066',
      website_url: 'https://aivena.es',
      city: 'Ciudad Quesada',
      region: null,
      country: 'Spain',
      branding_reviewed_at: '2026-06-25T13:14:27Z',
    },
    settings: {
      supported_languages: ['es', 'en', 'pl', 'de', 'nl', 'sv', 'no', 'fr'],
      timezone: 'UTC',
      working_hours: {
        monday: { start: '09:00', end: '18:00', enabled: true },
        saturday: { start: '09:00', end: '18:00', enabled: false },
        timezone: 'Europe/Madrid',
      },
      tone: 'formal',
      reply_rules: { default_lane: 'review_first' },
      human_approval_required: true,
      reply_handling_mode: 'manual',
    },
    email: { from_email: 'costahomes@send.aivena.es', domain_verified: true },
    team: { owners: 2, agents: 0 },
    templates: { enApproved: 8, nonEnApproved: 0 },
    properties: { count: 141 },
    consent: { count: 1 },
    calendar: { oauthCount: 0 },
    whatsapp: null,
    ...over,
  };
}

const nullSignals: ReadinessSignals = {
  agency: null, branding: null, settings: null, email: null, team: null,
  templates: null, properties: null, consent: null, calendar: null, whatsapp: null,
};

const byId = (items: ReadinessItem[]) => Object.fromEntries(items.map((i) => [i.id, i]));

describe('canReadReadiness (owner/aivena_staff read gate, method-agnostic)', () => {
  it('allows owner and aivena_staff', () => {
    expect(canReadReadiness('owner')).toBe(true);
    expect(canReadReadiness('aivena_staff')).toBe(true);
  });
  it('blocks agent/viewer/unknown/empty/null/undefined', () => {
    for (const r of ['agent', 'viewer', 'nonsense', '']) expect(canReadReadiness(r)).toBe(false);
    expect(canReadReadiness(null)).toBe(false);
    expect(canReadReadiness(undefined)).toBe(false);
  });
});

describe('computeReadiness — demo agency live fixture', () => {
  const res = computeReadiness('demo-costa-homes-pilot01', demoSignals());
  const items = byId(res.items);

  it('passes through the agency id (never the slug)', () => {
    expect(res.agencyId).toBe('demo-costa-homes-pilot01');
  });

  it('derives identity statuses from real signals', () => {
    expect(items['identity.name'].status).toBe('live_but_unproven'); // legal_name NULL
    expect(items['identity.logo'].status).toBe('ready');
    expect(items['identity.colors'].status).toBe('ready');
    expect(items['identity.phone'].status).toBe('ready');
    expect(items['identity.website'].status).toBe('needs_decision'); // aivena.es placeholder
    expect(items['identity.areas'].status).toBe('ready'); // city + primary_region
    expect(items['identity.languages'].status).toBe('ready'); // sources agree
    expect(items['identity.timezone'].status).toBe('live_but_unproven'); // Madrid vs UTC
    expect(items['identity.working_hours'].status).toBe('ready');
    expect(items['identity.tone'].status).toBe('ready');
    expect(items['posture.approval_first'].status).toBe('ready');
    expect(items['team.owner'].status).toBe('ready');
    expect(items['team.agents'].status).toBe('manual_fallback');
  });

  it('email is never ready/verified even with a verified domain (no send proven)', () => {
    expect(items['provider.email'].status).toBe('live_but_unproven');
    expect(items['provider.email'].status).not.toBe('ready');
  });

  it('WhatsApp degrades to unavailable when the RPC is not deployed (no fake state)', () => {
    expect(items['provider.whatsapp'].status).toBe('unavailable');
    const wa = res.providers.find((p) => p.provider === 'whatsapp')!;
    expect(wa.status).toBe('unavailable');
    expect(wa.detail.toLowerCase()).toContain('not deployed');
  });

  it('multilingual templates missing (English only)', () => {
    expect(items['provider.templates_multilang'].status).toBe('missing');
  });

  it('property catalog present → manual_fallback; calendar missing', () => {
    expect(items['provider.property_feed'].status).toBe('manual_fallback');
    expect(items['provider.calendar'].status).toBe('missing');
  });

  it('go-live is never eligible in Phase 1 and lifecycle is blocked', () => {
    expect(items['lifecycle.go_live'].status).toBe('blocked');
    expect(items['lifecycle.go_live'].adminApproved).toBe(false);
    expect(res.goLive.eligible).toBe(false);
    const g1 = res.gates.find((g) => g.gate === 'G1')!;
    expect(g1.status).toBe('blocked');
    expect(g1.blockedBy).toContain('lifecycle.go_live');
    expect(res.goLive.blockedBy).toContain('lifecycle.go_live');
  });

  it('NO FAKE STATE: every item carries a non-empty signal.source', () => {
    for (const it of res.items) {
      expect(it.signal.source, `item ${it.id} must cite a signal source`).toBeTruthy();
      expect(it.signal.source.length).toBeGreaterThan(0);
    }
  });
});

describe('computeReadiness — WhatsApp present (consumed from Chat 3 RPC)', () => {
  const wa: WhatsAppSignal = {
    whatsapp_sender_ready: true,
    whatsapp_channel_enabled: false,
    templates_provider_approved: { count: 8 },
    languages_ready: ['en'],
    template_send_path_proven: false,
    last_provider_sync_at: '2026-06-24T10:15:01.4855+00:00',
  };
  const res = computeReadiness('demo-costa-homes-pilot01', demoSignals({ whatsapp: wa }));
  const items = byId(res.items);

  it('sender connected but send unproven → live_but_unproven (not ready)', () => {
    expect(items['provider.whatsapp'].status).toBe('live_but_unproven');
  });
  it('languages_ready drives multilingual (en only → missing)', () => {
    expect(items['provider.templates_multilang'].status).toBe('missing');
  });
});

describe('computeReadiness — all signals null (full degradation, no throw, no fake)', () => {
  const res = computeReadiness('x', nullSignals);
  const items = byId(res.items);
  it('identity + providers degrade to unavailable, never fake-ready', () => {
    expect(items['identity.name'].status).toBe('unavailable');
    expect(items['provider.email'].status).toBe('unavailable');
    expect(items['provider.whatsapp'].status).toBe('unavailable');
    expect(res.goLive.eligible).toBe(false);
  });
  it('still cites a signal source for every item', () => {
    for (const it of res.items) expect(it.signal.source.length).toBeGreaterThan(0);
  });
});
