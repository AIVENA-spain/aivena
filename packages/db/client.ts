import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { env } from '../config/env';
import * as schema from './schema';

// Connection pool for the API/workers. Disable prefetch as it is not supported by Supabase pooler.
const queryClient = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 10,
});

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;

// Transaction-scoped DB type — what handlers receive when running inside withAgency.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run a callback inside a Postgres transaction with app.current_agency_id set
 * for the duration of that transaction. All queries made via the provided tx
 * client will be subject to RLS scoped to this agency.
 *
 * The third argument to set_config is true (local), so the setting is
 * automatically discarded when the transaction ends — no leakage between
 * pooled connections.
 *
 * Transaction-scoped: each request gets its own isolated agency context.
 */
export async function withAgency<T>(
  agencyId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_agency_id', ${agencyId}, true)`);
    return fn(tx);
  });
}
