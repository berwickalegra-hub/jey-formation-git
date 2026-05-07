# Technology Stack

**Analysis Date:** 2026-05-07

## Languages

**Primary:**
- TypeScript 5.9.3 - Full-stack type safety (frontend + Next.js API routes)
- JavaScript (Node.js) - Runtime environment

**Secondary:**
- SQL (PostgreSQL via Prisma) - Data persistence

## Runtime

**Environment:**
- Node.js ≥ 20 (specified in `.nvmrc` as 20.18.1)

**Package Manager:**
- pnpm 9.15.0
- Lockfile: `pnpm-lock.yaml` (present, committed)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack framework (App Router, API Routes, Server Actions)
- React 19.2.3 - UI component library
- React DOM 19.2.3 - DOM rendering

**Data & Schema:**
- Prisma 5.22.0 - ORM + migrations
  - Client: `@prisma/client` v5.22.0
  - CLI: `prisma` (dev dependency)
  - Codegen: Automatic on postinstall

**Styling:**
- Tailwind CSS 4.0.0 - Utility-first CSS
- Tailwind PostCSS plugin (@tailwindcss/postcss) 4.0.0
- PostCSS 8.5.0 - CSS transformation
- Autoprefixer 10.4.20 - Browser vendor prefixes

**Testing:**
- Vitest 2.1.8 - Unit test runner (backend-only; frontend has no test framework in v1)

**Build & Dev:**
- Turbopack - Next.js built-in bundler (enabled in dev: `next dev --turbopack`)
- tsx 4.19.2 - TypeScript execution for scripts

## Key Dependencies

**Authentication & Security:**
- bcryptjs 2.4.3 - Password hashing
- jose 5.9.6 - JWT signing/verification (ES256/RS256 compatible)
- arctic 3.7.0 - OAuth 2.0 + PKCE helper (used for Google Sign-in)
- server-only 0.0.1 - Prevents accidental client-side imports of server code

**Error Reporting & Monitoring:**
- @sentry/nextjs 10.51.0 - Error tracking + distributed tracing
  - Auto-instruments: HTTP, Express (legacy), RSC, fetch
  - Separate client DSN recommended (NEXT_PUBLIC_SENTRY_DSN)
  - Source map upload via CI (SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN)

**External APIs & Services:**
- @aws-sdk/client-s3 3.1037.0 - S3/R2 file uploads (Cloudflare R2 endpoint)
- @upstash/redis 1.34.3 - Redis client (HTTP-based, serverless-friendly)
- resend 6.12.2 - Transactional email service

**Schema Validation:**
- zod 3.23.8 - Runtime schema validation

**Utilities:**
- clsx 2.1.1 - Conditional CSS class merging
- tailwind-merge 2.5.5 - Tailwind CSS conflict resolution

## Configuration

**Environment:**
- Loaded from `.env` (root, shared by both Next.js API routes and scripts)
- Example template: `.env.example` (5.7 KB, comprehensive)
- Key variables required:
  - `DATABASE_URL` - PostgreSQL connection string (Neon, Supabase, local Docker)
  - `JWT_SECRET` - ≥32 char signing key (validated at boot; rejects placeholder patterns)
  - `COOKIE_PREFIX` - Cookie namespace (default: "app")
  - `FRONTEND_URL` - CORS allowlist (e.g., "http://localhost:3000")

**Build:**
- `next.config.ts` - Next.js configuration
  - Standalone output enabled (bundles `server.js` + minimal node_modules into `.next/standalone`)
  - Sentry integration via `withSentryConfig` wrapper
  - Source map hiding enabled for security
- `tsconfig.base.json` - Shared TypeScript compiler options (workspace root)
  - Target: ES2022
  - Strict mode: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  - Module resolution: NodeNext
- `frontend/tsconfig.json` - Frontend-specific config
  - Extends base
  - Bundler module resolution
  - Path alias: `@/*` → `./src/*`

**Linting & Formatting:**
- ESLint 9.18.0 - Flat config (`eslint.config.mjs`)
  - TypeScript support via `typescript-eslint` 8.20.0
  - No floating promises (backend only, catches unhandled rejections)
  - Unused variable rule: `argsIgnorePattern: '^_'` allows intentional ignores
- Prettier 3.4.2 - Code formatting
  - Config: `.prettierrc.json` (semi, singleQuote, trailingComma, printWidth: 100, tabWidth: 2)
  - Ignores: `.prettierignore` (dist, .next, .turbo, node_modules, etc.)

**Instrumentation:**
- `frontend/instrumentation.ts` - Next.js instrumentation entry point
- `frontend/sentry.{client,server,edge}.config.ts` - Sentry SDK configuration per runtime

## Platform Requirements

**Development:**
- Node ≥ 20, pnpm ≥ 9
- PostgreSQL (can use Docker: `docker compose up -d` provides Postgres + Redis + MinIO + Mailpit)
- Redis optional in dev (rate limiter falls back to in-memory MemoryStore with `logger.warn`)

**Production:**
- Deployment target: Vercel recommended (Next.js official), but any Node.js runtime works
- Standalone output supports Docker (see `frontend/Dockerfile` reference in docker-compose)
- PostgreSQL (managed: Neon, Supabase; self-hosted: compatible with PgBouncer)
- Upstash Redis strongly recommended (HTTP-based, serverless-friendly; required for rate limiting in prod)

## Database

**Primary:**
- PostgreSQL (Neon, Supabase, or self-hosted)
- Connection: `DATABASE_URL` env var
- Migrations: Prisma
  - Dev: `pnpm db:migrate:dev` (creates + applies)
  - Prod: `pnpm db:migrate:deploy` (idempotent, reads from `prisma/migrations/`)
  - Sync only: `pnpm db:push` (for rapid iteration, not version controlled)
  - Introspection: `pnpm db:studio` (Prisma Studio on port 5555)

## Scripts

**Development:**
- `pnpm dev` - Frontend on :3000 (Turbopack)
- `pnpm db:studio` - Open Prisma Studio (schema explorer + data browser)
- `pnpm seed:dev` - Run seed script (`frontend/scripts/seed-dev.ts` via tsx)

**Database:**
- `pnpm db:push` - Apply schema changes instantly (dev only)
- `pnpm db:migrate:dev` - Create versioned migration + apply
- `pnpm db:migrate:deploy` - Apply pending migrations (CI/prod)
- `pnpm db:make-superadmin <email>` - Promote user to SUPERADMIN role

**Quality:**
- `pnpm lint` - ESLint (all packages)
- `pnpm typecheck` - TypeScript no-emit check (all packages)
- `pnpm format` - Prettier write (all packages)
- `pnpm format:check` - Prettier check (CI)
- `pnpm test` - Vitest (backend-only, frontend is no-op in v1)

**Build:**
- `pnpm build` - Next.js production build (generates `.next/standalone`)
- `pnpm start` - Run production server

---

*Stack analysis: 2026-05-07*
