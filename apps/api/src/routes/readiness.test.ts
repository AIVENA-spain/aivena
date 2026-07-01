import { describe, it, expect } from 'vitest';
import { canReadReadiness } from './readiness';
import {
  computeReadiness,
  evaluateGoLive,
  type ReadinessSignals,
  type ReadinessItem,
  type ReadinessResponse,
  type WhatsAppSignal,
  type GoLiveAttestations,
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
    email: { from_email: 'costahomes@send.aivena.es', send_proven: true, send_proven_at: '2026-06-15T12:24:20.988Z' },
    team: { owners: 2, agents: 0 },
    templates: { enApproved: 8, nonEnApproved: 0 },
    properties: { count: 141 },
    consent: { count: 1 },
    calendar: { oauthCount: 0 },
    whatsapp: null,
    pilotStatus: 'setup',
    ...over,
  };
}

const nullSignals: ReadinessSignals = {
  agency: null, branding: null, settings: null, email: null, team: null,
  templates: null, properties: null, consent: null, calendar: null, whatsapp: null, pilotStatus: null,
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

  it('email is "ready" ONLY because a REAL send is proven (provider_audit_log), never faked', () => {
    // demo has real successful Resend sends → send_proven=true (last 2026-06-15)
    expect(items['provider.email'].status).toBe('ready');
    const p = res.providers.find((x) => x.provider === 'email')!;
    expect(p.detail).toContain('Email sending proven');
    expect(p.detail).not.toMatch(/domain verified/i);
  });

  it('email with from_email but NO proven send is "configured — sending not proven" (never faked/ready)', () => {
    const noSend = computeReadiness(
      'demo-costa-homes-pilot01',
      demoSignals({ email: { from_email: 'costahomes@send.aivena.es', send_proven: false, send_proven_at: null } }),
    );
    const e = byId(noSend.items)['provider.email'];
    expect(e.status).toBe('live_but_unproven');
    expect(e.status).not.toBe('ready');
    const p = noSend.providers.find((x) => x.provider === 'email')!;
    expect(p.detail).toBe('Email configured — sending not proven');
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

  it('reflects the real pilot_status (setup → blocked) and go-live is never eligible in Phase 1', () => {
    expect(res.pilotStatus).toBe('setup');
    expect(items['lifecycle.go_live'].status).toBe('blocked');
    expect(items['lifecycle.go_live'].adminApproved).toBe(false);
    expect(items['lifecycle.go_live'].signal.value).toBe('setup');
    expect(res.goLive.eligible).toBe(false);
    const g1 = res.gates.find((g) => g.gate === 'G1')!;
    expect(g1.status).toBe('blocked');
    expect(g1.blockedBy).toContain('lifecycle.go_live');
    expect(res.goLive.blockedBy).toContain('lifecycle.go_live');
  });

  it('maps each pilot_status to an honest lifecycle state (read-only — never auto-flips)', () => {
    const life = (p: ReadinessSignals['pilotStatus']) =>
      byId(computeReadiness('a', demoSignals({ pilotStatus: p })).items)['lifecycle.go_live'];
    expect(life('live').status).toBe('ready');
    expect(life('live').adminApproved).toBe(true);
    expect(life('ready_for_pilot').status).toBe('live_but_unproven');
    expect(life('ready_for_pilot').adminApproved).toBe(false);
    expect(life('paused').status).toBe('blocked');
    expect(life('blocked').status).toBe('blocked');
    expect(life(null).status).toBe('unavailable');
    expect(computeReadiness('a', demoSignals({ pilotStatus: 'live' })).pilotStatus).toBe('live');
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

// ── C3 go-live decision (server-side; the admin endpoint recomputes then calls this) ──
describe('evaluateGoLive — staff pilot transition (never trust the browser)', () => {
  // evaluateGoLive only reads readiness.goLive.blockedBy; a thin cast is enough.
  const mkReadiness = (blockedBy: string[]): ReadinessResponse =>
    ({ goLive: { blockedBy } } as ReadinessResponse);
  const ALL_ATTEST: GoLiveAttestations = {
    autonomo_corrected: true,
    legal_pages_published: true,
    dpa_consent_live: true,
    test_data_cleaned: true,
  };

  it('setup/paused/blocked are always allowed (staff lifecycle control), even with open blockers', () => {
    const r = mkReadiness(['identity.name', 'provider.email']);
    for (const t of ['setup', 'paused', 'blocked'] as const) {
      const d = evaluateGoLive(t, r, {}, false);
      expect(d.allowed).toBe(true);
      expect(d.overrideUsed).toBe(false);
    }
  });

  it('ready_for_pilot is blocked by unresolved readiness unless explicitly overridden', () => {
    const r = mkReadiness(['identity.name']);
    const blocked = evaluateGoLive('ready_for_pilot', r, {}, false);
    expect(blocked.allowed).toBe(false);
    expect(blocked.configBlockers).toEqual(['identity.name']);

    const overridden = evaluateGoLive('ready_for_pilot', r, {}, true);
    expect(overridden.allowed).toBe(true);
    expect(overridden.overrideUsed).toBe(true);
    expect(overridden.configBlockers).toEqual(['identity.name']);
  });

  it('ready_for_pilot with a clean readiness picture is allowed without override', () => {
    const d = evaluateGoLive('ready_for_pilot', mkReadiness([]), {}, false);
    expect(d.allowed).toBe(true);
    expect(d.overrideUsed).toBe(false);
  });

  it('the self-referential lifecycle.go_live blocker is excluded from configBlockers', () => {
    // A clean agency still lists lifecycle.go_live (pilot_status not yet live) — it must
    // not count as its own blocker, or nothing could ever transition.
    const d = evaluateGoLive('ready_for_pilot', mkReadiness(['lifecycle.go_live']), {}, false);
    expect(d.configBlockers).toEqual([]);
    expect(d.allowed).toBe(true);
  });

  it('live requires EVERY manual attestation — missing ones block even with override (attestations are not override-able)', () => {
    const clean = mkReadiness([]);
    const missingOne = evaluateGoLive('live', clean, { ...ALL_ATTEST, dpa_consent_live: false }, true);
    expect(missingOne.allowed).toBe(false);
    expect(missingOne.missingAttestations).toEqual(['dpa_consent_live']);

    const noneGiven = evaluateGoLive('live', clean, {}, true);
    expect(noneGiven.allowed).toBe(false);
    expect(noneGiven.missingAttestations).toEqual([
      'autonomo_corrected',
      'legal_pages_published',
      'dpa_consent_live',
      'test_data_cleaned',
    ]);
  });

  it('override bypasses a soft readiness gap for live but STILL requires all attestations', () => {
    const soft = mkReadiness(['identity.website']);
    // override true + a config gap, but attestations complete → allowed, override recorded
    const ok = evaluateGoLive('live', soft, ALL_ATTEST, true);
    expect(ok.allowed).toBe(true);
    expect(ok.overrideUsed).toBe(true);
    expect(ok.configBlockers).toEqual(['identity.website']);

    // same soft gap, attestations complete, but NO override → still blocked on readiness
    const stillBlocked = evaluateGoLive('live', soft, ALL_ATTEST, false);
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.configBlockers).toEqual(['identity.website']);
  });

  it('live with clean readiness + all attestations is allowed, with overrideUsed=false', () => {
    const d = evaluateGoLive('live', mkReadiness([]), ALL_ATTEST, false);
    expect(d.allowed).toBe(true);
    expect(d.overrideUsed).toBe(false);
    expect(d.missingAttestations).toEqual([]);
  });

  it('overrideUsed is false when override is passed but there was nothing to override', () => {
    const d = evaluateGoLive('ready_for_pilot', mkReadiness([]), {}, true);
    expect(d.allowed).toBe(true);
    expect(d.overrideUsed).toBe(false);
  });
});
