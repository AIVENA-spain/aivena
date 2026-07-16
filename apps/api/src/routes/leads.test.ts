import { describe, it, expect } from 'vitest';
import { classifyPrefError, EDITABLE_PREF_KEYS } from './leads';

// A Postgres error as Drizzle surfaces it: the real PostgresError sits a few `.cause` levels deep,
// with a 5-char SQLSTATE `code` and a `message`. update_lead_preferences RAISEs its business codes
// as the message with SQLSTATE P0001; require_role denial surfaces as 42501.
const pg = (code: string, message: string, depth = 0): unknown => {
  let e: unknown = { code, message };
  for (let i = 0; i < depth; i++) e = { message: 'drizzle wrapper', cause: e };
  return e;
};

describe('classifyPrefError — Law 2: friendly message, never the raw code', () => {
  it('maps business RAISE codes to friendly copy + correct status', () => {
    expect(classifyPrefError(pg('P0001', 'lead_not_found'))).toEqual({
      error: "Couldn't find that lead — please refresh and try again.", status: 404,
    });
    expect(classifyPrefError(pg('P0001', 'not_a_buyer_lead')).status).toBe(422);
    expect(classifyPrefError(pg('P0001', 'invalid_budget')).status).toBe(400);
    expect(classifyPrefError(pg('P0001', 'invalid_number')).status).toBe(400);
    expect(classifyPrefError(pg('P0001', 'invalid_bedrooms_range')).status).toBe(400);
    expect(classifyPrefError(pg('P0001', 'unknown_field')).status).toBe(400);
    expect(classifyPrefError(pg('P0001', 'no_fields')).status).toBe(400);
    expect(classifyPrefError(pg('P0001', 'invalid_patch')).status).toBe(400);
  });

  it("does NOT leak whether a lead exists in another agency (wrong_agency == not_found)", () => {
    const wrong = classifyPrefError(pg('P0001', 'lead_wrong_agency'));
    const missing = classifyPrefError(pg('P0001', 'lead_not_found'));
    expect(wrong).toEqual(missing);
    expect(wrong.status).toBe(404);
  });

  it('maps require_role denial (P0001/insufficient_role) to a 403 permission message', () => {
    // require_role RAISEs 'insufficient_role' with SQLSTATE P0001 (verified against the live def) —
    // NOT 42501. A viewer editing prefs lands here.
    const r = classifyPrefError(pg('P0001', 'insufficient_role'));
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/permission/i);
    expect(r.error).not.toMatch(/insufficient_role/);
  });

  it('also treats a raw SQLSTATE 42501 as a 403 defensively', () => {
    expect(classifyPrefError(pg('42501', 'permission denied')).status).toBe(403);
  });

  it('finds the PG error even when wrapped several cause-levels deep', () => {
    expect(classifyPrefError(pg('P0001', 'not_a_buyer_lead', 3)).status).toBe(422);
  });

  it('falls back to a calm generic 500 for anything unrecognised (never leaks)', () => {
    for (const junk of [null, undefined, 'a string', new Error('boom'),
                        pg('P0001', 'some_unmapped_code'), pg('XX000', 'internal'), { nope: 1 }]) {
      const r = classifyPrefError(junk);
      expect(r.status).toBe(500);
      expect(r.error).toBe('Something went wrong — please try again.');
    }
  });

  it('an unmapped P0001 code is treated as generic, not surfaced', () => {
    const r = classifyPrefError(pg('P0001', 'lead_secret_internal_state'));
    expect(r.error).not.toMatch(/secret_internal/);
    expect(r.status).toBe(500);
  });
});

describe('EDITABLE_PREF_KEYS — mirrors the RPC whitelist exactly', () => {
  it('is exactly the six agent-editable structured preference columns', () => {
    expect([...EDITABLE_PREF_KEYS].sort()).toEqual([
      'bathrooms_min', 'bedrooms_max', 'bedrooms_min',
      'budget_extracted', 'location_interest_extracted', 'property_type_pref',
    ]);
  });

  it('excludes free-text raw fields and anything identity/status related', () => {
    for (const forbidden of ['budget_raw', 'location_interest_raw', 'lead_type', 'status',
                             'agency_id', 'email', 'phone', 'embedding', 'score']) {
      expect((EDITABLE_PREF_KEYS as readonly string[]).includes(forbidden)).toBe(false);
    }
  });
});
