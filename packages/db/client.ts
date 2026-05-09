import { drizzle } from 'drizzle-orm/postgres-js';
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
