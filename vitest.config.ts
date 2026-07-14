import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'supabase/functions/**/*.test.ts',
    ],
    testTimeout: 30_000,
    environment: 'node',
  },
});
