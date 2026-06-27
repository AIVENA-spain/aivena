import { describe, it, expect } from 'vitest';
import {
  mapStatus,
  extractItems,
  computeMissingSids,
} from '../../../../supabase/functions/twilio-template-sync/sync-logic';

describe('mapStatus', () => {
  it('maps approved/rejected verbatim and everything else to pending', () => {
    expect(mapStatus('approved')).toBe('approved');
    expect(mapStatus('rejected')).toBe('rejected');
    for (const s of ['received', 'pending', 'unsubmitted', 'draft', 'something_new']) {
      expect(mapStatus(s)).toBe('pending');
    }
  });
});

describe('extractItems', () => {
  it('builds items and skips entries missing a sid or an approval status', () => {
    const body = {
      contents: [
        { sid: 'HX1', approval_requests: { status: 'approved', category: 'marketing', rejection_reason: '' } },
        { sid: 'HX2', approval_requests: { status: 'received' } },
        { approval_requests: { status: 'approved' } }, // no sid -> skip
        { sid: 'HX3', approval_requests: {} }, // no status -> skip
        { sid: 'HX4' }, // no approval_requests -> skip
      ],
    };
    const items = extractItems(body);
    expect(items.map((i) => i.sid)).toEqual(['HX1', 'HX2']);
    expect(items[0]).toMatchObject({
      sid: 'HX1',
      provider_status: 'approved',
      mapped_status: 'approved',
      category: 'marketing',
      rejection_reason: '',
    });
    expect(items[1]).toMatchObject({ sid: 'HX2', provider_status: 'received', mapped_status: 'pending' });
  });

  it('returns [] for a failed/empty/garbage page so a partial fetch never builds rows', () => {
    expect(extractItems(null)).toEqual([]);
    expect(extractItems({})).toEqual([]);
    expect(extractItems({ contents: [] })).toEqual([]);
    expect(extractItems({ contents: 'not-an-array' })).toEqual([]);
  });
});

describe('computeMissingSids', () => {
  it('returns DB SIDs absent from Twilio, de-duped, nulls dropped', () => {
    const missing = computeMissingSids(['HX1', 'HX1', 'HX9', null, undefined], new Set(['HX1']));
    expect(missing).toEqual(['HX9']);
  });

  it('returns [] when every DB sid was seen', () => {
    expect(computeMissingSids(['HX1', 'HX2'], new Set(['HX1', 'HX2']))).toEqual([]);
  });
});
