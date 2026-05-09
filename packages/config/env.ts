import { z } from 'zod';

const envSchema = z.object({
  // Supabase
  SUPABASE_URL:              z.string().url(),
  SUPABASE_ANON_KEY:         z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL:              z.string().url(),

  // Redis / BullMQ
  UPSTASH_REDIS_REST_URL:   z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),

  // AI
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY:    z.string().min(1),

  // Auth
  JWT_SECRET: z.string().min(32),

  // Monitoring
  SENTRY_DSN:              z.string().url(),
  BETTERSTACK_SOURCE_TOKEN: z.string().min(1),

  // App
  API_BASE_URL:       z.string().url(),
  DASHBOARD_URL:      z.string().url(),
  NODE_ENV:           z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Missing or invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;