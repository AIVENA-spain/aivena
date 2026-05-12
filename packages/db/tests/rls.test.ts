// packages/db/tests/rls.test.ts
// AIVENA RLS behavior test — Vitest version of rls-test.mjs.
// Connects as aivena_app only. Reads only APP_PW from env.
// All 8 assertions preserve the exact meaning of the original .mjs test.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

// ---------- Connection config (match rls-test.mjs) ----------
const PROJECT_REF = 'atminvhrybxegpdtnnpl';
const POOLER_HOST = 'aws-0-eu-west-1.pooler.supabase.com';
const POOLER_PORT = 6543;
const DATABASE = 'postgres';

const APP_PW = process.env.APP_PW;
if (!APP_PW) {
  throw new Error('APP_PW environment variable is required for RLS tests. Run with: APP_PW=... npm test');
}

const appConfig = {
  host: POOLER_HOST,
  port: POOLER_PORT,
  database: DATABASE,
  username: 'aivena_app.' + PROJECT_REF,
  password: APP_PW,
  ssl: 'require' as const,
  prepare: false,
  max: 4,
  idle_timeout: 5,
  connect_timeout: 10,
};

// ---------- Per-run identifiers (module scope so afterAll always has them) ----------
const AGENCY_A = randomUUID();
const AGENCY_B = randomUUID();
const FAKE_AGENCY = randomUUID();
const LEAD_A_ID = randomUUID();
const LEAD_B_ID = randomUUID();
const RUN_SOURCE = 'rls-test-' + randomUUID().slice(0, 8);

// ---------- Error predicates (match rls-test.mjs) ----------
type PgError = { code?: string; message?: string };
const isRls = (e: unknown): boolean => {
  const err = e as PgError;
  return !!err && err.code === '42501' && /row-level security/i.test(err.message ?? '');
};
const isPerm = (e: unknown): boolean => {
  const err = e as PgError;
  return !!err && err.code === '42501' && /permission denied/i.test(err.message ?? '');
};

// ---------- Module-scoped postgres client ----------
let app: ReturnType<typeof postgres>;

// withAgency mirrors rls-test.mjs — app.begin commits on success, rolls back on throw.
async function withAgency<T>(agencyId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    if (agencyId !== null) {
      await tx`SELECT set_config('app.current_agency_id', ${agencyId}, true)`;
    }
    return fn(tx);
  }) as Promise<T>;
}

describe('RLS behavior (aivena_app role)', () => {
  beforeAll(async () => {
    app = postgres(appConfig);

    // Confirm connecting role is aivena_app.
    const r = await app`SELECT current_user AS u, current_database() AS d`;
    if (!String(r[0].u).startsWith('aivena_app')) {
      throw new Error(`Expected aivena_app role, got: ${r[0].u}`);
    }

    // Seed one lead per agency, each inside its own agency context.
    await withAgency(AGENCY_A, async (tx) => {
      await tx`
        INSERT INTO public.leads (id, agency_id, full_name, phone, source, missed_call_captured, opt_in_status)
        VALUES (${LEAD_A_ID}, ${AGENCY_A}, 'Lead A', '+34000000001', ${RUN_SOURCE}, false, 'opted_in')
      `;
    });
    await withAgency(AGENCY_B, async (tx) => {
      await tx`
        INSERT INTO public.leads (id, agency_id, full_name, phone, source, missed_call_captured, opt_in_status)
        VALUES (${LEAD_B_ID}, ${AGENCY_B}, 'Lead B', '+34000000002', ${RUN_SOURCE}, false, 'opted_in')
      `;
    });
  });

  afterAll(async () => {
    if (app) {
      try {
        await app`DELETE FROM public.leads WHERE source = ${RUN_SOURCE}`;
      } finally {
        await app.end({ timeout: 5 });
      }
    }
  });

  // 1: No context → SELECT returns 0 rows.
  it('returns 0 rows when no agency context is set', async () => {
    const n = await withAgency(null, async (tx) => {
      const r = await tx`SELECT count(*)::int AS n FROM public.leads WHERE source = ${RUN_SOURCE}`;
      return r[0].n as number;
    });
    expect(n).toBe(0);
  });

  // 2: Fake (non-existent) agency context → SELECT returns 0 rows.
  it('returns 0 rows when agency context is a non-existent agency_id', async () => {
    const n = await withAgency(FAKE_AGENCY, async (tx) => {
      const r = await tx`SELECT count(*)::int AS n FROM public.leads WHERE source = ${RUN_SOURCE}`;
      return r[0].n as number;
    });
    expect(n).toBe(0);
  });

  // 3: Agency A context → SELECT returns exactly A's row.
  it('returns only agency A rows when agency A context is set', async () => {
    const rows = await withAgency(AGENCY_A, async (tx) => {
      return tx`SELECT id, agency_id FROM public.leads WHERE source = ${RUN_SOURCE}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].agency_id).toBe(AGENCY_A);
  });

  // 4: Agency B context → SELECT returns exactly B's row.
  it('returns only agency B rows when agency B context is set', async () => {
    const rows = await withAgency(AGENCY_B, async (tx) => {
      return tx`SELECT id, agency_id FROM public.leads WHERE source = ${RUN_SOURCE}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].agency_id).toBe(AGENCY_B);
  });

  // 5: Cross-tenant INSERT (A context inserting B's agency_id) → RLS blocks with 42501.
  it('blocks cross-tenant INSERT (A context, B agency_id) with RLS error 42501', async () => {
    let caught: unknown = null;
    try {
      await withAgency(AGENCY_A, async (tx) => {
        await tx`
          INSERT INTO public.leads (agency_id, full_name, phone, source, missed_call_captured, opt_in_status)
          VALUES (${AGENCY_B}, 'Cross-tenant attempt', '+34000000099', ${RUN_SOURCE}, false, 'opted_in')
        `;
      });
    } catch (err) {
      caught = err;
    }
    expect(isRls(caught)).toBe(true);
  });

  // 6: Cross-tenant UPDATE (A context updating B's row) → affects 0 rows; B's row is unchanged.
  it('blocks cross-tenant UPDATE (A context, B row) — 0 rows affected, B row unchanged', async () => {
    // Attempt the update under A's context.
    const updateCount = await withAgency(AGENCY_A, async (tx) => {
      const r = await tx`UPDATE public.leads SET full_name = 'Tampered' WHERE id = ${LEAD_B_ID}`;
      return r.count;
    });
    expect(updateCount).toBe(0);

    // Verify B's row still has its original name.
    const bName = await withAgency(AGENCY_B, async (tx) => {
      const r = await tx`SELECT full_name FROM public.leads WHERE id = ${LEAD_B_ID}`;
      return r[0]?.full_name as string | undefined;
    });
    expect(bName).toBe('Lead B');
  });

  // 7: email_templates SELECT as aivena_app (no agency context) → succeeds (global read).
  it('allows email_templates SELECT globally as aivena_app', async () => {
    let caught: unknown = null;
    try {
      await app`SELECT count(*)::int AS n FROM public.email_templates`;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeNull();
  });

  // 8: email_templates INSERT as aivena_app → blocked with permission-denied 42501.
  it('blocks email_templates INSERT with permission-denied 42501', async () => {
    let caught: unknown = null;
    try {
      await app`
        INSERT INTO public.email_templates (template_key, html_template)
        VALUES (${'rls-test-' + randomUUID()}, '<p>test</p>')
      `;
    } catch (err) {
      caught = err;
    }
    expect(isPerm(caught)).toBe(true);
  });
});
