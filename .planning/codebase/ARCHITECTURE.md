# Architecture

**Analysis Date:** 2026-05-07

## Pattern Overview

**Overall:** Next.js full-stack monolith (App Router) porting from separate Express backend + Next.js frontend monorepo.

**Key Characteristics:**
- Single Next.js 16 process serving both pages and API routes (no separate backend server)
- Server code in `src/lib/server/` with `'server-only'` import guard — builds only for Node runtime
- Route handlers in `src/app/api/*/route.ts` (App Router pattern, not Pages API)
- Client components use context providers (`AuthContext`, `ToastContext`) for app state
- Prisma 5 for data access; Upstash Redis for sessions/caching/leases
- Sentry instrumentation at runtime boot via `instrumentation.ts` (Next.js register hook)

## Layers

**Route Handlers (API Layer):**
- Purpose: HTTP entry points for frontend + webhooks
- Location: `src/app/api/*/route.ts`
- Contains: `export async function GET/POST/PUT/PATCH/DELETE(req, res)`
- Depends on: Middleware helpers, lib/server/*, Prisma
- Used by: Browser fetch calls, webhooks from external services

**Middleware Layer (Auth/Authz):**
- Purpose: Guard routes with auth/CSRF/rate-limiting before handler logic
- Location: `src/lib/server/middleware/*.ts`
- Contains: `requireAuth()`, `requireAdmin(minRole)`, `requireOrgRole(role, paramName)`, `optionalAuth()`, `verifyCsrf()`, `createEmailLimiter().check()`
- Depends on: `auth.ts` (JWT/cookie), `prisma.ts` (role lookup)
- Used by: All route handlers that need protection

**Core Server Libraries:**
- Purpose: Shared stateless utilities (auth, crypto, Redis, logging, storage)
- Location: `src/lib/server/`
- Contains:
  - `auth.ts` — JWT generation/verification, cookie getters/setters (async via `cookies()` from next/headers), CSRF token generation
  - `redis.ts` — singleton Upstash client; returns null if env missing
  - `prisma.ts` — global singleton PrismaClient with dev hot-reload
  - `logger.ts` — structured JSON logging with Sentry breadcrumb integration
  - `crypto.ts` — bcrypt hashing, token generation
  - `email.ts` — Resend client + template rendering
  - `storage.ts` — S3/R2 client (AWS SDK)
  - `slug.ts` — URL-safe slug generation
  - `rate-limit-store.ts` — Redis or in-memory rate-limit backend
  - `sentry.ts` — error capture wrapper
  - `zod-helpers.ts` — schema validation utilities
- Depends on: Prisma, Redis, external SDKs (AWS, Resend)
- Used by: Route handlers, domain libs

**Domain Libraries:**
- Purpose: Encapsulate business logic (payments, auth, withdrawals, notifications, webhooks)
- Location: `src/lib/server/{payments,oauth,withdrawals,notifications,outbox,webhook,queues,upload,admin}/`
- Contains:
  - `payments/` — `PaymentProvider` interface, Bictorys implementation, circuit breaker
  - `oauth/` — OAuth flow per provider (Google via arctic, account linking)
  - `withdrawals/` — guards (KYC, limits), advisory lock pattern (`pg_advisory_xact_lock`), balance checks
  - `notifications/` — template registry, dedup via unique constraint, outbox integration
  - `outbox/` — atomic dedup + exponential backoff dispatcher (transactional outbox pattern)
  - `webhook/` — idempotent handler factory, raw body HMAC verification, Serializable tx dedup
  - `queues/` — job queue (job-queue.ts), email queue (email-queue.ts) with Redis LMOVE
  - `upload/` — magic-byte sniffing + MIME allowlist
  - `admin/` — audit log writer, role helpers
- Depends on: Prisma, Redis, logger, middleware
- Used by: Route handlers, other domain libs

**Client Layer:**
- Purpose: Browser-side state, API communication, UI rendering
- Location: `src/contexts/`, `src/lib/api.ts`, `src/lib/useApi.ts`, `src/app/page.tsx`
- Contains:
  - `AuthContext.tsx` — user state machine, auto-refresh on 401, logout clearing
  - `ToastContext.tsx` — toast notifications
  - `api.ts` — fetch wrapper with auto-refresh lock, CSRF injection, idempotent-only retry (GET/HEAD only)
  - `useApi.ts` — hook for cached API calls with SWR-like pattern
  - Pages and components (no UI kit in template — design your own)
- Depends on: API layer via `api()` wrapper
- Used by: React pages/components

**Data Layer:**
- Purpose: Transactional database access
- Location: `src/lib/server/prisma.ts`, `frontend/prisma/schema.prisma`
- Contains: PrismaClient singleton, schema models (User, Order, Withdrawal, Notification, WebhookLog, etc.)
- Depends on: PostgreSQL (Neon), Prisma 5
- Used by: All server code

## Data Flow

**Authenticated Request:**
1. Browser sends `fetch(url, { credentials: 'include' })` — cookies auto-attached
2. Route handler reads CSRF cookie via `verifyCsrf(req)` — returns null or 400 NextResponse
3. Handler calls `requireAuth()` middleware — reads access JWT from `app-token` cookie, verifies signature, re-checks tokenVersion in DB to invalidate stale tokens
4. Handler receives `AuthContext { user: { sub, email } }`
5. Handler executes business logic (Prisma reads/writes, Redis operations)
6. Handler responds with `NextResponse.json(data)` — frontend `api()` wrapper receives it, extracts stable error code from `.code` field

**Webhook (Bictorys Payment):**
1. Bictorys sends POST to `api/webhooks/bictorys`
2. Route reads raw body via `await req.arrayBuffer()` BEFORE any other body access (preserves byte-identical HMAC)
3. Calls `createWebhookHandler(...)` with Bictorys provider interface (verifySignature, parsePayload, extractIds)
4. Handler verifies signature → 401 if bad
5. Opens `Serializable` Prisma transaction:
   - Upserts `WebhookLog` on `@@unique([externalId, eventType])`
   - If already `processedAt`, returns `{ ok: true, deduped: true }`
   - Calls handler callback (onPaid/onRefunded/onFailed) with tx client
   - Handler calls `enqueueOutbox(tx, event)` to queue side-effects (email, notification)
   - Sets `processedAt`
6. Responds 200 `{ ok: true, deduped: false }`
7. Outbox cron (1 min via Vercel) drains pending events atomically with exponential backoff

**Admin Audit Trail:**
1. Admin route receives mutation (e.g., role change)
2. Route calls `logAdminAction(prisma, { action, targetType, targetId, metadata, ip, userAgent })`
3. AdminAction row created inside the same tx (before commit)
4. Mutating code can reference the row id if needed; otherwise it's just logged

**Authorization Hierarchy:**
- `optionalAuth()` → returns user or null (guest allowed)
- `requireAuth()` → returns AuthContext or 401 (user required)
- `requireAdmin('ADMIN')` → returns AdminContext or 401 (admin+ required)
- `requireSuperadmin()` → returns AdminContext or 401 (superadmin only)
- `requireOrgRole('ADMIN', 'orgId')` → returns OrgContext or 404 (org member+ required; non-members get 404, not 403)

**State Management:**
- Server state: Prisma (single source of truth)
- Session state: httpOnly cookies (access JWT + refresh JWT scoped to `/api/auth`)
- CSRF: double-submit cookie (`app-csrf`)
- Redis: rate-limit counters, leader leases (cron coordination), visibility timeouts (outbox/email queue)
- Client state: React context (AuthContext, ToastContext)

## Key Abstractions

**PaymentProvider Interface:**
- Purpose: Pluggable payment processors (Bictorys, Stripe, Paddle, etc.)
- Examples: `src/lib/server/payments/provider.ts` (interface), `src/lib/server/payments/bictorys.ts` (implementation)
- Pattern: Implement `charge()`, `refund()`, `webhookProvider` (verifySignature + parsePayload + extractIds)

**WebhookProvider Interface:**
- Purpose: Provider-agnostic webhook HMAC + parsing
- Examples: `src/lib/server/payments/bictorys.ts` (webhookProvider), future `src/lib/server/oauth/google.ts` (event not needed, but same shape)
- Pattern: Implement `verifySignature(rawBody, headers)` → `{ valid, reason? }`, `parsePayload(rawBody)`, `extractIds(payload)` → `{ externalId, eventType, kind? }`

**Notification Template:**
- Purpose: Typed, dedup-safe notifications
- Examples: `src/lib/server/notifications/templates.ts`
- Pattern: Each template is a factory `createNotification(prisma, { userId, type, data, dedupeKey })`; dedupeKey prevents at-most-once duplicates via `@@unique([userId, type, dedupeKey])`

**WithdrawalGuard:**
- Purpose: Extensible withdrawal validation (KYC, daily limits, cooldown, PIN)
- Location: `src/lib/server/withdrawals/guards.ts`
- Pattern: Guard returns `{ ok: true } | { ok: false, code: string, message: string }`; route chains guards before DB insert

**Outbox Event:**
- Purpose: Transactional side-effect queueing
- Examples: `src/lib/server/outbox/types.ts`, `src/lib/server/outbox/index.ts`
- Pattern: `enqueueOutbox(tx, { type, payload })` inside webhook/order tx; cron drains with atomic claim + backoff

## Entry Points

**HTTP Server:**
- Location: `src/app/api/` (Next.js runs the server automatically)
- Triggers: `next dev` or `next start`
- Responsibilities: Listen on port (default 3000 when run via `pnpm dev`), route requests to handlers

**Instrumentation Hook:**
- Location: `instrumentation.ts` (root)
- Triggers: Next.js boots each runtime (Node, edge) on cold start
- Responsibilities: Import runtime-specific Sentry config (`sentry.server.config.ts` or `sentry.edge.config.ts`), auto-instrument `http`/`express` before any user code loads

**Layout Root:**
- Location: `src/app/layout.tsx`
- Triggers: Every page render
- Responsibilities: Wrap entire app with `ToastProvider` → `AuthProvider`, load fonts, inject metadata

**Next.js Config:**
- Location: `next.config.ts`
- Triggers: Build time + dev server startup
- Responsibilities: Set `output: 'standalone'` for Docker, wrap with `withSentryConfig()` for source map upload, Sentry tunnel route (optional)

## Error Handling

**Strategy:** Structured error codes + HTTP status codes.

**Patterns:**
- Backend returns `{ error?: string, code?: string }` in JSON body with appropriate status (400, 401, 403, 404, 429, 500)
- Frontend `api()` wrapper throws `ApiError` with `status`, `message`, `code` fields
- Frontend code switches on `ApiError.code` (e.g., `PIN_REQUIRED`), not on message (which is translated)
- Route handlers catch errors, log via `logger.error(err, { ...context })`, respond with 500 + Sentry capture

**Recovery:**
- 401 → frontend auto-refreshes access token (single-flight lock)
- 429 → frontend backs off exponentially
- 5xx → user sees "Try again later"

## Cross-Cutting Concerns

**Logging:** Structured JSON via `logger` (`src/lib/server/logger.ts`) with Sentry breadcrumb integration. Redaction: email hashing for PII, scrubbing of sensitive env var keys.

**Validation:** Zod schemas at route entry points via `safeParse()`, error responses with field-level detail via `zod-helpers.ts`.

**Authentication:** JWT (access 15m, refresh 7d scoped to `/api/auth`) + CSRF token (7d, double-submit cookie). All mutations require `x-csrf-token` header echoing the `app-csrf` cookie. Signup is enumeration-resistant (same 200 regardless of email existence).

**Rate Limiting:** IP-global (Redis or MemoryStore fallback) + per-email (login 10/15m, signup 5/h, verify 5/15m). Handled by `createEmailLimiter(redis, key, ...limits).check(req, email)`.

**Multi-Tenancy:** Opt-in via `Organization` + `OrganizationMember`. Apps wire `organizationId String?` on domain models, gate access with `requireOrgRole()`. Non-members receive 404, not 403.

**Sentry Observability:** Auto-instrumented at `instrumentation.ts` boot. Sentry DSN optional (no-op if missing). Breadcrumbs logged per request, errors captured with context. Source maps uploaded in CI if `SENTRY_AUTH_TOKEN` present.

---

*Architecture analysis: 2026-05-07*
