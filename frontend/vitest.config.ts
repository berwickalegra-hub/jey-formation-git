// frontend/vitest.config.ts — minimal config; default test discovery.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Wave 0 ships this config before any test files exist (Wave 1 plans add them).
    // Without this, Vitest 2.x exits 1 on zero tests, blocking the plan's own
    // acceptance criterion ("`pnpm --filter frontend test` exits 0").
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
