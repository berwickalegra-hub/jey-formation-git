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
    // Phase 1 D-27: setupFile sets JWT_SECRET / ENCRYPTION_KEY before any
    // test module imports `@/lib/server/auth` (which throws at import time
    // when JWT_SECRET is missing or < 32 chars).
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The `server-only` package throws at import time to enforce the
      // server-only boundary in Next.js bundles. Vitest runs in plain Node,
      // so we alias it to the package's empty stub for tests. Production
      // bundles still go through Next's bundler which uses the real package.
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
});
