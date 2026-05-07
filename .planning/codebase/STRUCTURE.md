# Codebase Structure

**Analysis Date:** 2026-05-07

## Directory Layout

```
amadou-monolith/
├── frontend/                    # Single Next.js monolith (backend ported as lib/server)
│   ├── src/
│   │   ├── app/                # Next.js App Router pages + API routes
│   │   ├── contexts/           # Client context providers
│   │   └── lib/                # Shared + server-only utilities
│   ├── prisma/                 # Schema + migrations
│   ├── public/                 # Static assets
│   ├── scripts/                # DB/admin utilities (tsx scripts)
│   ├── instrumentation.ts      # Next.js register hook (Sentry boot)
│   ├── sentry.*.config.ts      # Sentry runtime configs
│   ├── next.config.ts          # Next.js build config
│   └── package.json
├── examples/                    # Reference pages (admin, auth-error)
├── .planning/codebase/         # GSD analysis documents (this directory)
├── prisma/                     # Old backend schema (reference only, delete after M7)
├── backend/                    # Old Express backend (reference only, delete after M7)
└── README.md, CLAUDE.md, etc.
```

## Directory Purposes

**`frontend/src/app/`:**
- Purpose: Next.js App Router pages and API routes
- Contains: `.tsx` files for page layouts, API route handlers (`.ts` with `route.ts` export), special files (layout.tsx, error.tsx)
- Key files:
  - `app/page.tsx` — root page
  - `app/layout.tsx` — root layout (wraps app with providers)
  - `app/api/health/route.ts` — liveness probe (no DB calls)
  - `app/api/readyz/route.ts` — readiness probe (DB + Redis ping)
  - `app/api/pay-redirect/route.ts` — payment provider redirect handler
  - Future: `app/api/auth/*/route.ts` (signup, login, logout, verify-email, refresh, etc.)
  - Future: `app/api/webhooks/*/route.ts` (bictorys, etc.)

**`frontend/src/lib/`:**
- Purpose: Client + server utilities
- Contains:
  - `api.ts` — client-side fetch wrapper (auto-refresh, CSRF, retry)
  - `constants.ts` — client constants (API_URL, COOKIE_PREFIX, etc.)
  - `useApi.ts` — React hook for cached API calls
  - `utils.ts` — miscellaneous client helpers
  - `server/` — server-only libraries (guarded by `'server-only'` import)

**`frontend/src/lib/server/`:**
- Purpose: Server-only utilities (Node runtime only)
- Contains:
  - `auth.ts` — JWT/cookie helpers, CSRF generation
  - `prisma.ts` — PrismaClient singleton
  - `redis.ts` — Upstash client singleton (returns null if env missing)
  - `logger.ts` — structured logging
  - `crypto.ts` — bcrypt, token generation
  - `email.ts` — Resend email client
  - `storage.ts` — AWS SDK S3/R2 client
  - `sentry.ts` — error capture helpers
  - `slug.ts` — URL slug generation
  - `zod-helpers.ts` — validation error formatting
  - `rate-limit-store.ts` — Redis or memory-based rate limiter
  - `leader-lease.ts` — Redis advisory lock for cron coordination
  - Subdirectories:
    - `middleware/` — `requireAuth()`, `requireAdmin()`, `requireOrgRole()`, `verifyCsrf()`, etc.
    - `payments/` — `PaymentProvider` interface, Bictorys impl, circuit breaker
    - `oauth/` — OAuth providers (Google via arctic)
    - `withdrawals/` — guards, advisory lock, balance checks
    - `notifications/` — template factory, dedup
    - `outbox/` — transactional side-effect queue
    - `webhook/` — idempotent handler factory
    - `queues/` — job queue, email queue
    - `upload/` — file validation + magic-byte sniffing
    - `admin/` — audit log, role helpers

**`frontend/src/contexts/`:**
- Purpose: Client React context providers
- Contains:
  - `AuthContext.tsx` — user state, auto-refresh, logout
  - `ToastContext.tsx` — toast notifications
- Key pattern: Exported as `useAuth()` hook + `AuthProvider` component

**`frontend/prisma/`:**
- Purpose: Database schema + migrations
- Contains:
  - `schema.prisma` — Prisma schema (User, Order, Withdrawal, Notification, WebhookLog, Organization, AdminAction, etc.)
  - `migrations/` — versioned SQL migration files (created by `pnpm db:migrate:dev`)
  - `seed.ts` (future) — dev data seeding script

**`frontend/scripts/`:**
- Purpose: One-off admin/setup scripts
- Contains:
  - `make-superadmin.ts` — bootstrap first SUPERADMIN (run: `pnpm db:make-superadmin <email>`)
  - `seed-dev.ts` (future) — populate dev DB with test data

**Root Config Files:**
- `frontend/next.config.ts` — Next.js settings (output, Sentry wrapper)
- `frontend/instrumentation.ts` — Next.js register hook (Sentry boot before user code)
- `frontend/sentry.server.config.ts` — Sentry config for Node runtime
- `frontend/sentry.edge.config.ts` — Sentry config for edge runtime
- `frontend/tsconfig.json` — TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- `frontend/vitest.config.ts` — Vitest test runner config
- `frontend/package.json` — dependencies + scripts

**`examples/frontend-pages/`:**
- Purpose: Reference implementations for key pages
- Contains:
  - `admin/layout.tsx`, `admin/users.tsx`, `admin/withdrawals.tsx` — back-office example
  - `auth-error.tsx` — OAuth error page (query params from Google callback)

## Key File Locations

**Entry Points:**
- `frontend/instrumentation.ts` — Runtime boot hook (Sentry init)
- `frontend/src/app/layout.tsx` — Root layout (AuthProvider, ToastProvider)
- `frontend/next.config.ts` — Build config

**Configuration:**
- `frontend/.env` (not committed) — DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, JWT_SECRET, ENCRYPTION_KEY, etc.
- `frontend/.nvmrc` — Node version (≥20)
- `frontend/tsconfig.json` — TypeScript strict mode

**Core Logic:**
- `frontend/src/lib/server/auth.ts` — JWT, cookie, CSRF helpers
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth()`, `requireAdmin()`, etc.
- `frontend/src/lib/server/webhook/handler.ts` — Idempotent webhook processor
- `frontend/src/lib/server/outbox/dispatcher.ts` — Atomic outbox drain cron
- `frontend/src/lib/server/withdrawals/lock.ts` — Advisory lock pattern
- `frontend/src/lib/server/payments/circuit-breaker.ts` — In-memory payment circuit breaker

**Testing:**
- `frontend/**/*.test.ts` — Vitest unit tests (co-located with source)
- `frontend/vitest.config.ts` — Test runner config

## Naming Conventions

**Files:**
- API routes: `[dynamic]` in path, `route.ts` as filename (e.g., `api/auth/verify-email/route.ts`)
- Dynamic segments: `[param]` for single, `[...slug]` for catch-all (e.g., `api/files/[...key]/route.ts`)
- Config files: `config.ts`, `.config.ts`, `.config.json` suffix (e.g., `next.config.ts`, `vitest.config.ts`)
- Context providers: `Context.tsx` suffix (e.g., `AuthContext.tsx`)
- Tests: `.test.ts` suffix (e.g., `auth.test.ts` co-located in same dir as `auth.ts`)
- Scripts: `kebab-case.ts` in `/scripts` folder (e.g., `make-superadmin.ts`)
- Server-only: `src/lib/server/` directory enforced by `'server-only'` import

**Directories:**
- Page groups: kebab-case inside parentheses (optional) `(group-name)/`
- API resource paths: kebab-case (e.g., `api/auth/oauth/google/callback/route.ts`)
- Domain logic: domain-name (e.g., `payments/`, `webhooks/`, `withdrawals/`)
- Utility subdirs: function-name (e.g., `middleware/`, `queues/`)

**Variables/Functions:**
- Async functions: prefix with `async`, name describes what it returns (e.g., `fetchUser`, `requireAuth`)
- Middleware: prefix with `require` for guards (e.g., `requireAuth`, `requireAdmin`)
- Constants: UPPER_SNAKE_CASE (e.g., `JWT_SECRET_BYTES`, `COOKIE_NAME`, `MAX_AGE`)
- Types: PascalCase with suffix (e.g., `AuthContext`, `AdminRole`, `WebhookEventType`)
- Booleans: prefix with `is`/`has`/`should` (e.g., `isAdmin`, `hasPermission`)
- Event handlers: prefix with `on` (e.g., `onPaid`, `onRefunded`)

**Imports:**
- Path aliases via `tsconfig.json` `compilerOptions.paths`: `@/*` maps to `src/*`
- Server vs client separation: route handlers import from `src/lib/server/*` only (guarded by `'server-only'`)
- Explicit `'use client'` at top of `.tsx` files that need client features (context, hooks)

## Where to Add New Code

**New API Route:**
- Primary code: `frontend/src/app/api/<resource>/<operation>/route.ts`
- Pattern: `export async function GET/POST/PUT/PATCH/DELETE(req: NextRequest)`
- Middleware stack: Call `verifyCsrf()` for mutations, `requireAuth()` / `requireAdmin()` for protected routes
- Response: `NextResponse.json({ data }, { status })`

**New Domain Model:**
- Schema: Add model to `frontend/prisma/schema.prisma`
- Migration: Run `pnpm db:migrate:dev` to generate versioned migration file
- Library: Create `frontend/src/lib/server/<domain>/` folder with helpers (guards, validators, templates)
- Route: Create `frontend/src/app/api/<resource>/route.ts` route handler

**New Notification Type:**
- Template: Add factory to `frontend/src/lib/server/notifications/templates.ts`
- Pattern: `export async function create<Type>Notification(prisma, { userId, ...args }) { return createNotification(prisma, { type: '<TYPE>', dedupeKey: `user:${userId}:<TYPE>:<id>`, ... }) }`
- Outbox: Dispatcher auto-runs queued notifications via the outbox every 1 min

**New OAuth Provider:**
- Library: Create `frontend/src/lib/server/oauth/<provider>.ts` (model on `google.ts`)
- Pattern: Implement start/callback flows using arctic or native OAuth 2.0 + PKCE
- Route: Add `frontend/src/app/api/auth/oauth/<provider>/start/route.ts` and `/callback/route.ts`
- Mount: Wire into route handler with state + PKCE cookie scoping (path: `/api/auth/oauth`)

**New Payment Provider:**
- Interface: Implement `PaymentProvider` from `frontend/src/lib/server/payments/provider.ts`
- Charge: `charge(amount, currency, ...) => Promise<{ transactionId, ... }>`
- Webhook: Implement `webhookProvider: WebhookProvider<TPayload>`
- Mount: Wire into route handler, export as provider singleton
- Circuit Breaker: Use shared `circuitBreaker.execute()` for charge calls

**Shared Utilities:**
- Helpers: `frontend/src/lib/server/` root level (e.g., `frontend/src/lib/server/slug.ts`)
- Client utilities: `frontend/src/lib/` (non-`server/` subdirs, e.g., `frontend/src/lib/utils.ts`)

**Tests:**
- Location: Co-locate with source file (e.g., `auth.test.ts` in same dir as `auth.ts`)
- Runner: Vitest (already configured)
- Command: `pnpm test` (all), `pnpm --filter frontend exec vitest run src/lib/<file>.test.ts` (single file)

## Special Directories

**`frontend/prisma/migrations/`:**
- Purpose: Version-controlled SQL migration history
- Generated: By `pnpm db:migrate:dev` (creates `<timestamp>_<name>/migration.sql`)
- Committed: Yes (allows team to replay schema evolution)
- Why: Declarative schema + versioned SQL lets you rollback/reapply migrations across environments

**`frontend/.next/`:**
- Purpose: Build output (compiled pages, static chunks, etc.)
- Generated: Yes (by `next build` or `next dev`)
- Committed: No (in `.gitignore`)
- Note: `output: 'standalone'` in `next.config.ts` bundles minimal node_modules into `.next/standalone` for Docker

**`frontend/node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (by `pnpm install`)
- Committed: No (in `.gitignore`)

**`frontend/public/`:**
- Purpose: Static assets (favicon, fonts if hosted locally, etc.)
- Generated: No (hand-authored)
- Committed: Yes
- Served: Via `/<filename>` (e.g., `/favicon.ico` serves `public/favicon.ico`)

**`.env` / `.env.local`:**
- Purpose: Environment variables (secrets, URLs, keys)
- Generated: No (hand-authored or injected by CI)
- Committed: No (in `.gitignore`)
- Note: Never commit `.env`; use `.env.example` as template

---

*Structure analysis: 2026-05-07*
