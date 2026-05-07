# Architecture Research

**Domain:** Next.js 16 App Router full-stack monolith — auth + payments + webhooks + outbox + admin + crons on Vercel
**Researched:** 2026-05-07
**Confidence:** HIGH (current structure validated from code; Vercel-specific decisions verified against official docs + community)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER / CLIENT                            │
│  AuthContext  ToastContext  api()  useApi()  React pages            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ fetch (cookies: 'include')
┌───────────────────────────────▼─────────────────────────────────────┐
│                     Next.js App Router (Node.js runtime)            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  middleware.ts (edge)  — redirect-only: unauthed → /login   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────┐  │
│  │  app/api/**  │  │ app/api/     │  │ app/api/  │  │app/api/  │  │
│  │  auth/*      │  │ webhooks/*   │  │ cron/*    │  │admin/*   │  │
│  │  route.ts    │  │ route.ts     │  │ route.ts  │  │route.ts  │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  └────┬─────┘  │
│         │                 │                │              │        │
│  ┌──────▼─────────────────▼────────────────▼──────────────▼─────┐  │
│  │         lib/server/middleware/  (HOF guards — Node runtime)   │  │
│  │   requireAuth  requireAdmin  requireOrgRole  verifyCsrf       │  │
│  │   createEmailLimiter                                          │  │
│  └──────────────────────────────┬────────────────────────────────┘  │
│                                 │                                   │
│  ┌──────────────────────────────▼────────────────────────────────┐  │
│  │              lib/server/  (domain libraries)                  │  │
│  │  payments/  oauth/  withdrawals/  notifications/              │  │
│  │  outbox/  webhook/  queues/  upload/  admin/                  │  │
│  └──────────────────────────────┬────────────────────────────────┘  │
│                                 │                                   │
│  ┌──────────────────────────────▼────────────────────────────────┐  │
│  │              lib/server/  (core singletons)                   │  │
│  │  prisma.ts  redis.ts  auth.ts  crypto.ts  logger.ts           │  │
│  │  email.ts  storage.ts  rate-limit-store.ts  sentry.ts         │  │
│  └──────────────────────────────┬────────────────────────────────┘  │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌─────────────┐      ┌──────────────────┐    ┌──────────────────┐
   │  Neon Postgres│    │  Upstash Redis   │    │  External SaaS   │
   │  (Prisma 5)  │    │  (leases, RL,    │    │  R2, Resend,     │
   │  + PgBouncer │    │   queues)        │    │  Bictorys, Sentry│
   └─────────────┘      └──────────────────┘    └──────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With | Runtime |
|-----------|---------------|-------------------|---------|
| `middleware.ts` | Unauthenticated redirect for page routes only. No body access, no DB calls. | Next.js routing layer | Edge |
| `app/api/**/route.ts` | HTTP entry points. Composes guards, calls domain libs, returns NextResponse. No business logic inline. | middleware helpers, lib/server | Node.js |
| `lib/server/middleware/` | HOF guards: parse JWT/cookie, check role, return `Context | NextResponse`. | auth.ts, prisma.ts, redis.ts | Node.js only |
| `lib/server/{payments,oauth,withdrawals,notifications,outbox,webhook,queues,upload,admin}/` | Domain logic. Stateless functions or thin classes. No HTTP concepts. | prisma.ts, redis.ts, logger.ts | Node.js only |
| `lib/server/prisma.ts` | Global PrismaClient singleton (globalThis guard for dev hot-reload). | Postgres via PgBouncer | Node.js only |
| `lib/server/redis.ts` | Upstash Redis singleton; returns `null` when env missing. All call sites handle null gracefully. | Upstash REST API | Node.js only |
| `lib/api.ts` | Client fetch wrapper: auto-refresh (single-flight), CSRF injection, GET/HEAD retry only. | api/** route handlers | Browser |
| `contexts/AuthContext.tsx` | Client user state machine. | lib/api.ts | Browser |
| `instrumentation.ts` | Sentry init at Node/edge boot, before any user module loads. | @sentry/nextjs | Both runtimes |
| `prisma/schema.prisma` | Single schema. Domain models extend generic models (User, Order, etc.). | Prisma migrations | Build-time |
| `scripts/` | One-off admin scripts via `tsx`. Never imported by route handlers. | lib/server/prisma.ts | Node CLI |
| `vercel.json` | Cron schedule definitions. Ties cron route paths to UTC schedule expressions. | Vercel infrastructure | Deploy-time |

**Key boundary rules:**
- `lib/server/**` imports `'server-only'` — build will fail if any client bundle accidentally imports it. This is the primary enforcement mechanism (MEDIUM confidence: verified by `server-only` npm package behavior, not runtime env check).
- `middleware.ts` must NEVER read the request body or call Prisma/Redis. It runs on the edge runtime which lacks Node.js APIs and is stateless.
- Route handlers own the HTTP contract; domain libs own the business invariants. No business logic in route files.

---

## Recommended Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root: ToastProvider → AuthProvider
│   │   ├── page.tsx                # Public landing (or redirect)
│   │   ├── (auth)/                 # Route group — auth pages (no shared layout)
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── auth/error/page.tsx # OAuth error landing
│   │   ├── (app)/                  # Route group — protected app pages
│   │   │   ├── layout.tsx          # requireAuth redirect via useAuth()
│   │   │   └── dashboard/page.tsx
│   │   ├── (admin)/                # Route group — admin back-office
│   │   │   ├── layout.tsx          # admin role check
│   │   │   ├── users/page.tsx
│   │   │   └── withdrawals/page.tsx
│   │   └── api/
│   │       ├── health/route.ts     # Liveness — no DB
│   │       ├── readyz/route.ts     # Readiness — DB + Redis ping
│   │       ├── auth/
│   │       │   ├── signup/route.ts
│   │       │   ├── login/route.ts
│   │       │   ├── logout/route.ts
│   │       │   ├── refresh/route.ts
│   │       │   ├── me/route.ts
│   │       │   ├── verify-email/route.ts
│   │       │   ├── forgot-password/route.ts
│   │       │   ├── reset-password/route.ts
│   │       │   ├── change-password/route.ts
│   │       │   ├── withdrawal-pin/route.ts
│   │       │   └── oauth/
│   │       │       └── google/
│   │       │           ├── start/route.ts
│   │       │           └── callback/route.ts
│   │       ├── notifications/
│   │       │   ├── route.ts        # GET list, POST mark-read
│   │       │   ├── count/route.ts
│   │       │   └── prefs/route.ts
│   │       ├── upload/route.ts
│   │       ├── files/[...key]/route.ts
│   │       ├── orders/route.ts
│   │       ├── withdrawals/route.ts
│   │       ├── organizations/
│   │       │   ├── route.ts        # POST create, GET list
│   │       │   └── [orgId]/
│   │       │       ├── route.ts    # GET, PATCH, DELETE
│   │       │       └── members/
│   │       │           ├── route.ts
│   │       │           └── [memberId]/route.ts
│   │       ├── admin/
│   │       │   ├── me/route.ts
│   │       │   ├── users/
│   │       │   │   ├── route.ts
│   │       │   │   └── [userId]/route.ts
│   │       │   ├── orders/route.ts
│   │       │   ├── withdrawals/
│   │       │   │   ├── route.ts
│   │       │   │   └── [id]/route.ts
│   │       │   └── audit-log/route.ts
│   │       ├── webhooks/
│   │       │   └── bictorys/route.ts
│   │       └── cron/
│   │           ├── outbox-drain/route.ts
│   │           ├── email-queue-drain/route.ts
│   │           ├── verification-cleanup/route.ts
│   │           ├── order-expiration/route.ts
│   │           └── webhook-log-purge/route.ts
│   ├── contexts/
│   │   ├── AuthContext.tsx
│   │   └── ToastContext.tsx
│   └── lib/
│       ├── api.ts                  # Client fetch wrapper
│       ├── useApi.ts
│       ├── constants.ts
│       ├── utils.ts
│       └── server/                 # server-only boundary here
│           ├── auth.ts
│           ├── prisma.ts
│           ├── redis.ts
│           ├── logger.ts
│           ├── crypto.ts
│           ├── email.ts
│           ├── storage.ts
│           ├── sentry.ts
│           ├── slug.ts
│           ├── rate-limit-store.ts
│           ├── leader-lease.ts
│           ├── zod-helpers.ts
│           ├── middleware/         # requireAuth, requireAdmin, etc.
│           ├── payments/           # PaymentProvider, Bictorys, CircuitBreaker
│           ├── oauth/              # google.ts (arctic, PKCE)
│           ├── withdrawals/        # guards.ts, lock.ts
│           ├── notifications/      # templates.ts, createNotification
│           ├── outbox/             # dispatcher.ts, types.ts
│           ├── webhook/            # handler.ts (raw-body HMAC)
│           ├── queues/             # job-queue.ts, email-queue.ts
│           ├── upload/             # magic-byte sniff, MIME allowlist
│           └── admin/              # audit.ts, role helpers
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── make-superadmin.ts
│   └── seed-dev.ts
├── public/
├── instrumentation.ts              # MUST be first — Sentry boot
├── middleware.ts                   # Edge — redirect-only
├── next.config.ts
├── vercel.json                     # Cron schedule entries
├── sentry.server.config.ts
├── sentry.edge.config.ts
└── package.json
```

**Structure rationale:**
- `(auth)/`, `(app)/`, `(admin)/` route groups allow per-group layouts without URL pollution.
- `api/cron/` groups all scheduled handlers — matches `vercel.json` paths exactly, searchable in one place.
- `api/webhooks/` isolated from `api/cron/` because their guard mechanism differs (HMAC vs CRON_SECRET).
- `lib/server/` vs `lib/` boundary is the single server/client split point; `server-only` enforces it at build.
- `scripts/` is never imported by route handlers (it is a CLI namespace, not a lib namespace).

---

## Architectural Patterns

### Pattern 1: HOF Guard Composition in Route Handlers

**What:** Each route handler explicitly calls middleware helpers as HOFs, chaining them before business logic. No global Express-style middleware stack.

**When to use:** All protected routes. The guard returns either a typed context object or a `NextResponse` error. Route checks `instanceof NextResponse` to early-return.

**Trade-offs:** Verbose compared to Express `app.use()`, but explicit — each route's security requirements are visible in the file. No magic. No accidental bypass from middleware mis-ordering.

```typescript
// app/api/orders/route.ts
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const csrf = verifyCsrf(req);
  if (csrf) return csrf;                        // 403 if bad CSRF

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth; // 401 if no valid JWT

  const body = createOrderSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request', issues: body.error.issues }, { status: 400 });

  // business logic — auth.user.sub is available here
}
```

### Pattern 2: Webhook Raw-Body Preservation

**What:** Webhook route reads raw body with `await req.arrayBuffer()` before any other body access. This preserves byte-identical content for HMAC verification.

**When to use:** Any route that verifies a provider signature (Bictorys, future Stripe/Github/etc.).

**Trade-offs:** Cannot use `req.json()` afterward — must manually parse: `JSON.parse(Buffer.from(rawBody).toString())`. This is the only correct order.

```typescript
// app/api/webhooks/bictorys/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // never cache

export const POST = createWebhookHandler({
  prisma,
  provider: bictorys.webhookProvider,
  onPaid: async (tx, payload) => { /* enqueueOutbox(tx, ...) */ },
  onRefunded: async (tx, payload) => { /* ... */ },
  onFailed: async (tx, payload) => { /* ... */ },
});
// handler.ts internally calls req.arrayBuffer() first — invariant preserved
```

`dynamic = 'force-dynamic'` is required: without it, Next.js may statically analyze the route and skip the actual POST handler in some edge cases. `runtime = 'nodejs'` is required: edge runtime can re-encode the request body during proxying, breaking HMAC byte-identity (HIGH confidence — verified against Vercel docs and community reports).

### Pattern 3: Vercel Cron Handler Shape

**What:** Each cron route is a thin route handler that: (1) verifies `Bearer ${CRON_SECRET}`, (2) calls the domain lib drain function with a batch size, (3) wraps with optional Sentry check-in, (4) returns 200.

**When to use:** All 5 scheduled jobs replacing the Express `setInterval` loops.

**Trade-offs:** Vercel cron minimum granularity is 1 minute (not 5 seconds). Outbox/email-queue drains must batch more aggressively per invocation (recommend 100 rows). Vercel can fire the same cron event twice — the drain functions must be idempotent (atomic row-claim with `LMOVE`/`UPDATE ... RETURNING` already satisfies this).

```typescript
// app/api/cron/outbox-drain/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  await drainOutbox({ batchSize: 100 }); // lib/server/outbox/dispatcher.ts
  return NextResponse.json({ ok: true });
}
```

**Vercel cron function timeout:** Default 10s, max 60s on Hobby, up to 800s with Fluid Compute on Pro. Batch size must be tuned so a drain run completes within the budget. At 100 rows with simple Prisma ops, typical wall time is well under 10s. (MEDIUM confidence — Vercel docs show limits, actual row throughput is workload-dependent.)

**Redis lease removal:** The Express template used `withLease()` Redis leader-election because multiple server instances competed on the same `setInterval`. Vercel crons fire exactly once per schedule (though duplicate fires are possible and must be handled via idempotency, not leases). The leader-lease can be removed from cron routes — idempotency at the row level (atomic claim) is sufficient.

### Pattern 4: Transactional Outbox — App Router Shape

**What:** The outbox pattern ensures side-effects (emails, notifications) are atomically coupled to the triggering transaction. The App Router shape is identical to the Express shape because Prisma's `$transaction` is runtime-agnostic.

**When to use:** Webhook handlers and any route that must trigger a side-effect without risk of the side-effect failing silently after DB commit.

**Trade-offs:** Adds a second table write (OutboxEvent) to every transaction. The 5s Express drain becomes a 60s Vercel cron drain — maximum side-effect latency increases from ~5s to ~60s. For email delivery this is acceptable. If near-real-time is required, use Upstash QStash or Vercel Edge Config triggers instead (out of scope for v1).

```typescript
// Inside webhook onPaid callback — identical to Express version
await prisma.$transaction(async (tx) => {
  await tx.order.update({ where: { id }, data: { status: 'PAID' } });
  await enqueueOutbox(tx, { type: 'ORDER_PAID', payload: { orderId: id } });
  // tx commits → OutboxEvent row is durable
}, { isolationLevel: 'Serializable' });
// Cron fires ~60s later, dispatcher picks up event, sends email
```

### Pattern 5: middleware.ts — Redirect-Only, Never Security Boundary

**What:** `middleware.ts` lives at the project root, runs on the edge runtime, and handles unauthenticated redirects for page routes only. It does NOT verify JWTs cryptographically (edge runtime cannot run `jose` or native crypto in all edge environments without explicit config). It reads the presence of the access token cookie and redirects if absent.

**When to use:** Redirect unauthed users from protected page routes (`/(app)/**`, `/(admin)/**`) to `/login`. Prevents flash-of-unauthenticated-content.

**What it must NOT do:** Act as a security boundary. Never gate API routes in `middleware.ts`. All API security lives in route handler guards.

```typescript
// middleware.ts  — edge runtime (default)
export function middleware(request: NextRequest) {
  const token = request.cookies.get(COOKIE_PREFIX + '-token');
  const isProtected = request.nextUrl.pathname.startsWith('/app') ||
                      request.nextUrl.pathname.startsWith('/admin');
  if (isProtected && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
```

Note: Next.js 15.2+ supports `runtime = 'nodejs'` in middleware for full Node.js APIs, but this disables CDN-edge execution. For this project, keep edge runtime + presence-check redirect. The real auth verification stays in `requireAuth()` inside route handlers (HIGH confidence — Next.js official docs on middleware security model).

---

## Data Flow Diagrams

### Auth Flow (Login → Session)

```
Browser POST /api/auth/login
  → verifyCsrf(req)                    — 403 if CSRF cookie mismatch
  → createEmailLimiter.check(email)    — 429 if rate-limited
  → bcrypt.compare(password, hash)     — constant-time, always runs
  → prisma.user.findUnique(email)
  → issue accessJWT (15m) + refreshJWT (7d, path=/api/auth)
  → set cookies: app-token, app-refresh, app-csrf
  → 200 { user }
Browser (later) — access token expires
  → api() wrapper catches 401
  → single-flight lock: POST /api/auth/refresh
  → refreshJWT verified (path-scoped cookie auto-attached)
  → new accessJWT issued, cookie overwritten
  → original request retried
```

### Webhook → Outbox → Notification Flow

```
Bictorys POST /api/webhooks/bictorys
  → req.arrayBuffer()                  — raw bytes captured first
  → createWebhookHandler()
      → verifySignature(rawBody, headers)   — HMAC-SHA256
      → prisma.$transaction(Serializable) {
          → WebhookLog upsert @@unique([externalId, eventType])
          → if processedAt: return { deduped: true }
          → onPaid(tx, payload) {
              → prisma.order.update(status=PAID) [inside tx]
              → enqueueOutbox(tx, { type: 'ORDER_PAID', ... }) [inside tx]
            }
          → WebhookLog.processedAt = now
        }  — tx commits atomically
  → 200 { ok: true }

Vercel Cron fires /api/cron/outbox-drain (every 1 min)
  → Bearer CRON_SECRET check
  → drainOutbox({ batchSize: 100 })
      → for each unclaimed OutboxEvent:
          → atomic claim (UPDATE status=PROCESSING WHERE status=PENDING LIMIT 1 RETURNING)
          → dispatch(event) → createNotification | sendEmail
          → on success: UPDATE status=DONE
          → on failure: exponential backoff, max 5 attempts → DEAD
```

### Withdrawal — Race-Free Flow

```
Browser POST /api/withdrawals
  → verifyCsrf(req)
  → requireAuth(req)
  → validateAmount(body)
  → withdrawalLock(userId) {            — pg_advisory_xact_lock(hashtext(userId))
      → prisma.$transaction(Serializable) {
          → runGuards(guards, user, amount) — PIN, KYC, daily limit, cooldown
          → prisma.user balance check
          → prisma.withdrawal.create(status=PENDING)
          → prisma.user.update balance -= amount
        }
    }                                   — lock releases on tx end
  → initiatePayout(withdrawal)          — Bictorys payout API
  → 201 { withdrawal }

Concurrent request from same user:
  → blocks at pg_advisory_xact_lock
  → sees PENDING reservation / updated balance
  → INSUFFICIENT_BALANCE or COOLDOWN_ACTIVE guard fires
  → 400 { code: 'INSUFFICIENT_BALANCE' }
```

### Admin Audit Trail Flow

```
Admin PATCH /api/admin/users/:userId
  → requireAdmin('ADMIN')(req)          — role check
  → verifyCsrf(req)
  → prisma.$transaction {
      → prisma.user.update(role = newRole)
      → logAdminAction(tx, {
          action: 'USER_ROLE_CHANGE',
          targetType: 'USER',
          targetId: userId,
          metadata: { from: oldRole, to: newRole },
          ip, userAgent
        })                              — AdminAction row in same tx
    }
  → 200 { user }
```

---

## Build Order and Phase Dependencies

Phase dependencies derive from what each phase's code imports.

```
Phase M3 (Auth routes)
  depends on: lib/server/auth.ts, lib/server/middleware/, lib/server/prisma.ts
              lib/server/crypto.ts, lib/server/email.ts, lib/server/notifications/
  blocks: nothing (auth is leaf consumer of lib)

Phase M4 (OAuth + Notifications + WithdrawalPin)
  depends on: M3 (withdrawal-pin uses requireAuth, share same cookie helpers)
              lib/server/oauth/google.ts (already ported)
              lib/server/notifications/templates.ts
  blocks: M5 (withdrawals need withdrawal-pin to exist for PIN guard)

Phase M5 (Upload, Files, Orders, Withdrawals, Admin, Orgs)
  depends on: M3 (requireAuth)
              M4 (withdrawal-pin routes must exist for PIN guard to be testable)
              lib/server/payments/, lib/server/withdrawals/, lib/server/admin/
              lib/server/upload/
  internal parallelism: upload/files, orders, admin, orgs are independent — can be
    ported in any order. Withdrawals depend on M4 (PIN). Admin depends on M3.

Phase M6 (Webhooks + Cron)
  depends on: M5 (orders route must exist — webhook onPaid updates orders)
              lib/server/outbox/dispatcher.ts (already ported)
              lib/server/webhook/handler.ts (already ported)
  internal parallelism: all 5 cron routes are independent of each other.
    Webhook route is independent of cron routes.

Phase M7 (Scripts, Tests, Docker, Docs)
  depends on: M3–M6 complete (tests reference all routes)
  internal parallelism: scripts, Dockerfile, docker-compose, docs are all
    independent once routes are stable.

Phase M8 (Final pass)
  depends on: M7 (pnpm lint + typecheck + test must all pass)
```

**Parallel porting within M5 (largest phase):**
- `upload/route.ts` + `files/[...key]/route.ts` — independent, share nothing with payments
- `orders/route.ts` — depends only on payments/ and requireAuth
- `admin/**` — depends only on requireAdmin and audit.ts
- `organizations/**` — depends only on requireOrgRole
- `withdrawals/route.ts` — depends on withdrawal-pin (M4) + lock.ts + guards.ts

M5 can be split into two sub-sessions: (admin + orgs + orders) then (upload + files + withdrawals), or run in any interleaving since file-system coupling is zero.

---

## Vercel-Specific Architectural Quirks

### Cold Starts + Neon Connection Latency

Neon computes suspend after 5 min of inactivity by default (configurable to 1 min–7 days). On wakeup, Postgres takes 300–500ms to become ready. Prisma's connection timeout can fire before Neon wakes.

**Mitigation (priority order):**
1. Use Neon's pooled connection string (PgBouncer) — the `?pgbouncer=true&connection_limit=1` parameters are required in the `DATABASE_URL` for serverless. Without `connection_limit=1`, each Vercel function instance opens multiple connections and the pool exhausts.
2. Set `pool_timeout=15` in the connection string to give Neon time to wake.
3. The `verification-cleanup` and `webhook-log-purge` crons act as keep-warm traffic. The `order-expiration` cron fires every 5 min, preventing full compute suspension under normal load.
4. Do NOT add a dedicated keep-warm cron — the existing crons provide sufficient wake traffic.

Connection string format:
```
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/dbname?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require"
```

(HIGH confidence — Neon official docs + Prisma Vercel deployment guide)

### Connection Pool Exhaustion

Vercel functions are stateless — each cold start creates a new `PrismaClient`. The `globalThis` singleton pattern prevents multiple clients per hot-reload cycle in dev, but in production each function instance has its own pool. With `connection_limit=1` and PgBouncer pooling, 100 concurrent Vercel function instances use 100 connections — within typical Neon limits.

Prisma singleton in `lib/server/prisma.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

### Vercel Cron Double-Fire

Vercel documents that a cron event may fire twice for a single schedule tick. The outbox dispatcher uses `UPDATE ... WHERE status = 'PENDING' RETURNING` (atomic claim) and the email queue uses `LMOVE` — both are idempotent against double-fire. The webhook handler uses `@@unique([externalId, eventType])` on `WebhookLog`. No additional locking needed beyond what the template already ships.

### Function Timeout Budget

Default cron timeout: 10s (Hobby), 15s (Pro), up to 60s configurable, 800s with Fluid Compute. Design cron batch sizes conservatively:
- `outbox-drain`: 100 rows (network I/O per row — email API call — budget carefully)
- `email-queue-drain`: 100 rows
- `verification-cleanup`: single DELETE query, fast
- `order-expiration`: single UPDATE batch, fast
- `webhook-log-purge`: single DELETE, fast

If email drain hits the timeout budget (each Resend API call ~200ms × 100 = 20s), reduce batch to 50 or add a `maxDuration` annotation in `vercel.json`.

### `dynamic = 'force-dynamic'` Placement

Required on:
- All webhook routes — POST handlers must never be statically analyzed away
- All cron routes — GET handlers that perform mutations must not be cached
- Any GET route that reads DB/Redis state that must be fresh (notifications count, me endpoint)

Not required on:
- Static pages, health check (liveness has no state to cache)

### `runtime = 'nodejs'` Requirement

Required on ALL route handlers that use:
- Prisma (uses native binaries)
- bcrypt (`bcryptjs` is pure JS but `bcrypt` uses native)
- `pg_advisory_xact_lock` (Prisma raw SQL)
- `req.arrayBuffer()` for HMAC (works in both, but edge may re-encode body)
- `cookies()` from `next/headers` (works in Node runtime, behavior differs on edge)

Set `export const runtime = 'nodejs'` at the top of every file under `app/api/`. Do NOT rely on the default.

---

## server-only Enforcement

The `server-only` package (already in deps) causes a build-time error if any file importing it is bundled into the client. Place `import 'server-only'` at the top of `lib/server/auth.ts` and `lib/server/prisma.ts` (the two most dangerous leak vectors). The import propagates transitively — any module importing these files will also fail to build on the client.

Do not place `'server-only'` in every file — it is sufficient at the two root singletons that all domain libs depend on. Placing it in hundreds of files creates redundant noise.

Additional defense: TypeScript path aliases. `@/lib/server/*` is visually distinct from `@/lib/*`. Lint rule `no-restricted-imports` can be added to `.eslintrc` to block `@/lib/server` from `*.tsx` client components (LOW confidence on enforceability without custom lint rule — worth adding in M7).

---

## Integration Points

| Service | Integration Pattern | Critical Notes |
|---------|---------------------|----------------|
| Neon Postgres | Prisma 5 over PgBouncer pooled URL | `connection_limit=1` + `pgbouncer=true` required |
| Upstash Redis | REST SDK singleton, null-fallback | All call sites must handle `redis === null` — MemoryStore fallback in dev |
| Cloudflare R2 | AWS SDK S3 client (compatible API) | Proxy through `api/files/[...key]` — never expose presigned URLs directly |
| Resend | Node SDK, email queue | Outbox → email queue → Resend; never call Resend inside a Prisma transaction |
| Bictorys | PaymentProvider interface + WebhookProvider | HMAC raw-body; `BICTORYS_API_KEY` (charges) ≠ `BICTORYS_PRIVATE_KEY` (payouts) |
| Sentry | `@sentry/nextjs` via instrumentation.ts | Must be first import at boot; env-gated no-op without DSN |
| Vercel Cron | HTTP GET to `api/cron/*` with `Authorization: Bearer CRON_SECRET` | Vercel auto-injects Bearer header when invoking; manual test with curl |

---

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Route Handlers

**What people do:** Put Prisma queries, validation, and business rules directly in `route.ts` files.

**Why it's wrong:** Route files become untestable (require HTTP layer to test), logic is duplicated across routes, invariants are scattered.

**Do this instead:** Route handlers are thin — guard composition + body parse + single domain lib call + return. All logic lives in `lib/server/{domain}/`.

### Anti-Pattern 2: Calling `req.json()` Before HMAC Verification

**What people do:** Parse the request body with `await req.json()` at the top of the webhook handler for convenience, then try to re-serialize for HMAC.

**Why it's wrong:** Re-serialized JSON is not byte-identical to the original body (key ordering, whitespace, unicode escapes may differ). HMAC fails unpredictably.

**Do this instead:** Always `await req.arrayBuffer()` first, compute HMAC, then `JSON.parse(Buffer.from(raw).toString())`.

### Anti-Pattern 3: Prisma Inside Middleware.ts

**What people do:** Call `prisma.session.findUnique()` inside `middleware.ts` to do a real auth check.

**Why it's wrong:** Middleware runs on edge runtime. Prisma requires Node.js runtime (native query engine binaries). This causes build failures or runtime crashes.

**Do this instead:** Middleware does presence-check redirect only (cookie exists?). Real JWT verification + DB token-version check lives in `requireAuth()` inside route handlers.

### Anti-Pattern 4: Sending Emails / Notifications Directly Inside Webhook Transactions

**What people do:** Call `resend.emails.send()` or `prisma.notification.create()` directly inside the `$transaction` block in the webhook handler.

**Why it's wrong:** If the email API call fails, the entire transaction rolls back — the webhook is re-delivered indefinitely. If the transaction commits but the email fails, the side-effect is lost.

**Do this instead:** `enqueueOutbox(tx, event)` inside the transaction. The outbox cron handles delivery with exponential backoff and dead-letter semantics.

### Anti-Pattern 5: Importing `lib/server/**` from Client Components

**What people do:** Import a utility from `lib/server/crypto.ts` in a `'use client'` component thinking it's just a helper.

**Why it's wrong:** The module graph pulls server-only code (bcrypt, Prisma, Redis) into the client bundle. Secrets are exposed. Build may fail or silently pass with broken output.

**Do this instead:** Client components only import from `lib/*.ts` (non-`server/` path). The `server-only` package on root singletons catches violations at build time.

### Anti-Pattern 6: Skipping Advisory Lock for Withdrawals

**What people do:** Run balance check + insert as two separate Prisma operations without a transaction, assuming optimistic concurrency is sufficient.

**Why it's wrong:** Two concurrent requests can both read the same balance, both pass the check, and both insert — resulting in a double-spend.

**Do this instead:** Use `withdrawalLock(userId)` which calls `pg_advisory_xact_lock(hashtext(userId))` inside a Serializable transaction. The lib already implements this — call it, never re-implement.

---

## Scaling Considerations

| Scale | Approach |
|-------|----------|
| 0–1k users | Hobby Vercel, Neon free tier, single function instance. No changes needed. |
| 1k–50k users | Pro Vercel, Neon Pro (larger compute, lower suspend threshold), PgBouncer connection limit tuning. CircuitBreaker stays in-memory (single-instance per function — acceptable). |
| 50k+ users | Replace in-memory CircuitBreaker with Redis-backed variant. Consider Vercel Fluid Compute for long-drain crons. Evaluate Upstash QStash as outbox replacement for sub-60s side-effect latency. Multi-region Neon read replicas if read-heavy. |

**First bottleneck:** Neon connection exhaustion under high concurrency. Fix: `connection_limit=1` + PgBouncer (already prescribed above).

**Second bottleneck:** Outbox drain latency (up to 60s). Fix: Upstash QStash or more frequent Vercel Pro crons (30s minimum on Pro).

---

## Sources

- Vercel Cron Jobs official docs: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Vercel Function duration limits: https://vercel.com/docs/functions/configuring-functions/duration
- Next.js security model (middleware is not a security boundary): https://nextjs.org/blog/security-nextjs-server-components-actions
- Neon connection latency and pooling: https://neon.com/docs/connect/connection-latency
- Prisma + Vercel deployment guide: https://www.prisma.io/docs/orm/prisma-client/deployment/serverless/deploy-to-vercel
- server-only package pattern: https://www.builder.io/blog/server-only-next-app-router
- Next.js webhook raw body (arrayBuffer): https://webhooks.cc/blog/nextjs-app-router-webhook-handler
- Sentry cron monitoring for Next.js: https://docs.sentry.io/platforms/javascript/guides/nextjs/crons/

---

*Architecture research for: Next.js 16 App Router full-stack monolith (auth + payments + webhooks + outbox + admin + Vercel crons)*
*Researched: 2026-05-07*
