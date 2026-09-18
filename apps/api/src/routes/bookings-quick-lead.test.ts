import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'bookings.ts'), 'utf8');

// The only unique key on leads is leads_agency_dedup_uniq (agency_id, dedup_key).
// An ON CONFLICT target that matches no unique key fails with 42P10 before the
// insert runs; from 2026-06-12 to 2026-09-18 that meant "Create lead" in the
// New viewing dialog never created a single lead.
describe('quick-lead conflict target matches the leads unique key', () => {
  const quickLead = src.slice(src.indexOf("route.post('/quick-lead'"));

  it('targets (agency_id, dedup_key)', () => {
    expect(quickLead).toMatch(/ON CONFLICT \(agency_id, dedup_key\) DO UPDATE/);
  });

  it('never targets dedup_key alone', () => {
    expect(src).not.toMatch(/ON CONFLICT \(dedup_key\)/);
  });
});
