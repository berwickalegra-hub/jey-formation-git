import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/.prisma/**',
      '**/generated/**',
      '**/next-env.d.ts',
      // Examples are illustrative only; copied into projects then restyled.
      // Excluded from lint and typecheck so they don't have to satisfy
      // strict workspace tsconfig (e.g. they reference `@/lib/...` aliases
      // that only exist inside the frontend workspace).
      'examples/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // ── Type-aware rules — backend only, to avoid the perf hit on the frontend ──
  // no-floating-promises catches an unawaited Promise that could silently
  // swallow a rejection. Critical for an async-heavy backend that does DB +
  // queue + outbox work. Uses tsconfig.eslint.json which includes tests
  // and scripts (the build tsconfig excludes them).
  {
    files: ['backend/src/**/*.ts', 'backend/scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './backend/tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: true }],
    },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.config.{js,mjs,ts}', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
