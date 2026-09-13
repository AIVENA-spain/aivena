import { describe, it, expect } from 'vitest';
import { liveScoreOf } from './live-score';
import { SERVICE_SOURCE } from './source';
import { urgencyOf } from './urgency';

const scored = {
  score: 89,
  temperature: 'super_hot',
  scored_at: '2026-09-13T10:02:00Z',
  score_source: SERVICE_SOURCE,
  score_rubric_version: 'v1.6',
  score_model: 'claude-haiku-4-5-20251001',
  score_band: 'super_hot',
  score_message_count: 31,
  score_cost_usd: '0.006451',
  score_viewing_date: '2026-09-03',
  reasoning_summary: 'Super-hot 89: viewing agreed, change pending: “Ja det passer”',
};

describe('only a score the new scorer wrote, while scoring is live, can ever be shown', () => {
  it('a live score comes out with its provenance', () => {
    expect(liveScoreOf(scored, true)).toEqual({
      score: 89, temperature: 'super_hot', band: 'super_hot', scoredAt: '2026-09-13T10:02:00.000Z', rubricVersion: 'v1.6',
      model: 'claude-haiku-4-5-20251001', messageCount: 31, costUsd: 0.006451, viewingDate: '2026-09-03',
      reason: 'Super-hot 89: viewing agreed, change pending: “Ja det passer”',
    });
  });
  it('a June score from the legacy pipeline is never shown, even with scoring live', () => {
    expect(liveScoreOf({ score: 75, temperature: 'warm', scored_at: '2026-06-19T10:58:29Z', score_source: null, reasoning_summary: 'Lead has active engagement' }, true)).toBeNull();
    expect(liveScoreOf({ score: 75, temperature: 'warm', scored_at: '2026-06-19T10:58:29Z', score_source: 'legacy_n8n_2a' }, true)).toBeNull();
  });
  it('a score with the right source but no calculation time is not trusted', () => {
    expect(liveScoreOf({ ...scored, scored_at: null }, true)).toBeNull();
  });
  it('while scoring is not live, nothing is shown at all', () => {
    expect(liveScoreOf(scored, false)).toBeNull();
  });
  it('lost / deal / do-not-contact: no score and no temperature, but the band and provenance are kept', () => {
    expect(liveScoreOf({ ...scored, score: null, temperature: null, score_band: 'lost', reasoning_summary: 'Lost, not scored: bought elsewhere' }, true))
      .toMatchObject({ score: null, temperature: null, band: 'lost' });
  });
});

describe('urgency is beside the score, never inside it (Christian, 2026-09-13)', () => {
  const now = '2026-09-13T10:00:00Z';
  it('the lead spoke last: waiting for your reply, with the days, however long — never dormant', () => {
    expect(urgencyOf({ lastInboundAt: '2026-08-31T15:06:51Z', lastOutboundAt: '2026-08-31T14:56:18Z', viewingDate: null, now }))
      .toEqual([{ kind: 'waiting_for_reply', days: 12 }]);
    expect(urgencyOf({ lastInboundAt: '2026-06-01T10:00:00Z', lastOutboundAt: '2026-05-30T10:00:00Z', viewingDate: null, now }))
      .toEqual([{ kind: 'waiting_for_reply', days: 104 }]);
  });
  it('a viewing date that has passed is flagged, alongside waiting', () => {
    expect(urgencyOf({ lastInboundAt: '2026-08-31T15:06:51Z', lastOutboundAt: '2026-08-31T14:56:18Z', viewingDate: '2026-09-03', now }))
      .toEqual([{ kind: 'waiting_for_reply', days: 12 }, { kind: 'viewing_date_passed', date: '2026-09-03' }]);
  });
  it('a viewing today or later is not passed', () => {
    expect(urgencyOf({ lastInboundAt: null, lastOutboundAt: '2026-09-12T10:00:00Z', viewingDate: '2026-09-13', now })).toEqual([]);
  });
  it('the agency spoke last and the lead went quiet: inactive at 30 days, dormant at 60', () => {
    expect(urgencyOf({ lastInboundAt: '2026-08-20T10:00:00Z', lastOutboundAt: '2026-08-21T10:00:00Z', viewingDate: null, now })).toEqual([]);
    expect(urgencyOf({ lastInboundAt: '2026-08-10T10:00:00Z', lastOutboundAt: '2026-08-11T10:00:00Z', viewingDate: null, now }))
      .toEqual([{ kind: 'inactive', days: 34 }]);
    expect(urgencyOf({ lastInboundAt: '2026-07-01T10:00:00Z', lastOutboundAt: '2026-07-02T10:00:00Z', viewingDate: null, now }))
      .toEqual([{ kind: 'dormant', days: 74 }]);
  });
  it('no conversation at all: nothing to say', () => {
    expect(urgencyOf({ lastInboundAt: null, lastOutboundAt: null, viewingDate: null, now })).toEqual([]);
  });
});
