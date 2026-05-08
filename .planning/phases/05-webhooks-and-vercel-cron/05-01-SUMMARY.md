---
phase: "05"
plan: "01"
subsystem: webhooks-and-vercel-cron
tags: [scaffolding, tests, helpers, fixtures, wave-0, tdd]
dependency-graph:
  requires:
    - frontend/src/lib/server/webhook/handler.ts (PROTECTED — call only)
    - frontend/src/lib/server/payments/bictorys.ts (PROTECTED — call only)
    - frontend/src/lib/server/leader-lease.ts (PROTECTED — call only)
    - frontend/src/lib/server/outbox/dispatcher.ts (PROTECTED — call only)
    - frontend/src/lib/server/queues/email-queue.ts
    - frontend/src/lib/server/email.ts (createMailer factory)
    - frontend/src/lib/server/redis.ts (redis singleton)
    - frontend/src/lib/server/prisma.ts
  provides:
    - frontend/src/lib/server/cron/auth.ts (verifyCronSecret)
    - frontend/src/lib/server/webhook/bictorys.ts (bictorysWebhookProvider with refunded-kind upgrade)
    - frontend/src/lib/server/orders/expire.ts (expirePendingOrders)
    - frontend/src/lib/server/queues/email-queue-singleton.ts (getEmailQueue)
    - frontend/src/test-utils/bictorys-mock.ts (bictorysFixture, bictorysFixtureRequest)
    - 6 RED route.test.ts contracts for Wave 1 routes
    - frontend/src/lib/server/observability/vercel-json-shape.test.ts (D-20 tripwire)
    - .env.example WEBHOOK_LOG_RETENTION_DAYS + ORDER_EXPIRATION_MINUTES blocks
  affects:
    - .env.example (append-only)
    - frontend/src/lib/server/observability/env-shape.test.ts (extend, no deletion)
tech-stack:
  added: []
  patterns:
    - lazy-init-singleton (env reads at first call; vi.stubEnv compatible)
    - timing-safe-compare (node:crypto.timingSafeEqual + length-mismatch fast-path)
    - per-row-tx-with-where-guard (race-vs-webhook for order-expiration)
    - red-by-design-tripwire (vercel-json-shape uses existsSync gate)
key-files:
  created:
    - frontend/src/lib/server/cron/auth.ts
    - frontend/src/lib/server/cron/auth.test.ts
    - frontend/src/lib/server/webhook/bictorys.ts
    - frontend/src/lib/server/webhook/bictorys.test.ts
    - frontend/src/lib/server/orders/expire.ts
    - frontend/src/lib/server/orders/expire.test.ts
    - frontend/src/lib/server/queues/email-queue-singleton.ts
    - frontend/src/test-utils/bictorys-mock.ts
    - frontend/src/app/api/webhooks/bictorys/route.test.ts
    - frontend/src/app/api/cron/outbox-drain/route.test.ts
    - frontend/src/app/api/cron/email-queue-drain/route.test.ts
    - frontend/src/app/api/cron/verification-cleanup/route.test.ts
    - frontend/src/app/api/cron/order-expiration/route.test.ts
    - frontend/src/app/api/cron/webhook-log-purge/route.test.ts
    - frontend/src/lib/server/observability/vercel-json-shape.test.ts
  modified:
    - .env.example (Phase 5 block appended; no existing keys touched)
    - frontend/src/lib/server/observability/env-shape.test.ts (one new describe; no existing assertions removed)
decisions:
  - "Used existing createMailer({RESEND_API_KEY, EMAIL_FROM}) factory in email-queue-singleton (DRYer than plan-suggested inline new Resend(); benefits from List-Unsubscribe header support already in createMailer)"
  - "Added @ts-expect-error on every `await import('./route')` in 6 RED route.test.ts files so tsc --noEmit exits 0; Wave 1 plans remove these directives as part of going GREEN"
  - "vercel-json-shape.test.ts uses existsSync gates so 4 of 5 assertions skip-pass cleanly when vercel.json is absent; only the existence check is RED-by-design"
metrics:
  duration_min: 11
  completed: "2026-05-08T23:10:54Z"
  task_count: 6
  files_created: 15
  files_modified: 2
  tests_added: 38
requirements_addressed:
  - WH-01 (webhook route contract via route.test.ts + bictorys-mock fixture)
  - WH-02 (replay/dedup behavior in route.test.ts)
  - CRON-01 (outbox-drain route.test.ts contract)
  - CRON-02 (email-queue-drain route.test.ts + email-queue-singleton helper)
  - CRON-03 (verification-cleanup route.test.ts)
  - CRON-04 (order-expiration route.test.ts + expirePendingOrders helper)
  - CRON-05 (webhook-log-purge route.test.ts + WEBHOOK_LOG_RETENTION_DAYS env)
  - CRON-06 (verifyCronSecret helper + 7-case auth.test.ts; 5 cron route 401 cases)
  - CRON-07 (vercel-json-shape.test.ts D-20 tripwire)
---

# Phase 5 Plan 01: Scaffold Cron Webhook Fixtures Tests Summary

**One-liner:** Wave 0 scaffolding for Phase 5 — 3 lib helpers (`verifyCronSecret`, `bictorysWebhookProvider` re-export with refunded-kind upgrade, `expirePendingOrders`), 1 lazy-init queue singleton, 1 HMAC fixture, 6 RED route.test.ts files (1 webhook + 5 cron) with canonical NextRequest+NextResponse mock shapes, and the D-20 vercel.json tripwire — together they lock the test contracts so all 7 Wave 1 plans become "make tests green" work.

## What Shipped

### Lib helpers (3 modules + their unit tests, all GREEN)

1. **`frontend/src/lib/server/cron/auth.ts`** + 7-case test — `verifyCronSecret(req): NextResponse | null` mirroring `verifyCsrf` shape; constant-time compare via `node:crypto.timingSafeEqual` with a length-mismatch fast-path that prevents Buffer.from-throw and side-channel; returns 500 `CRON_NOT_CONFIGURED` when env unset, 401 on missing/wrong/empty/wrong-scheme/wrong-secret, null on match. CRON-06 contract locked.

2. **`frontend/src/lib/server/webhook/bictorys.ts`** + 7-case test — re-exports `payments/bictorys.ts:webhookProvider` (PROTECTED) with two enhancements: lazy-init via `getBictorysWebhookProvider()` (reads env at first call → `vi.stubEnv` compatible) and an `extractIds` patch that upgrades `kind` to `'refunded'` when payload.status is `'refunded'` or `'refund'` (the underlying `classifyStatus` only emits `paid|failed|other`). `__resetBictorysWebhookProvider()` exported for test isolation. WH-01/WH-02 contracts locked.

3. **`frontend/src/lib/server/orders/expire.ts`** + 6-case test — `expirePendingOrders({ prisma, batchSize? })` finds PENDING orders with `expiresAt < now()` (default batch 100), per-row `prisma.$transaction` with `updateMany WHERE id=? AND status='PENDING'` so a webhook racing the cron to PAID wins (count=0 → cron skips that row). Returns `{ expired: N }`, idempotent on re-run. CRON-04 contract locked.

### Lazy-init queue singleton (no dedicated test — exercised by Wave 1 route tests)

4. **`frontend/src/lib/server/queues/email-queue-singleton.ts`** — `getEmailQueue(): EmailQueue | null`. Returns null gracefully when any of `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`/`RESEND_API_KEY`/`EMAIL_FROM` is missing (callers skip work; outbox-drain logs a warn and skips email.* events; email-queue-drain returns `processed: 0`). Uses existing `createMailer({RESEND_API_KEY, EMAIL_FROM})` from `lib/server/email.ts` (deviation from plan — see below). `__resetEmailQueueSingleton()` for test isolation.

### Test fixture

5. **`frontend/src/test-utils/bictorys-mock.ts`** — `bictorysFixture(opts)` builds raw body + valid HMAC headers (`sha256` of `${ts}.` + rawBody, mirroring `payments/bictorys.ts:367-413` verbatim — drift between fixture and verifier is impossible). `bictorysFixtureRequest(opts)` wraps it in a `NextRequest` for direct route POST. Modeled on Phase 4's `r2-mock.ts` factory pattern.

### 6 RED route.test.ts files (D-17/D-19 canonical shapes)

All use:
- `vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }))` — default-pass; per-test override returns `NextResponse.json(...)` for 401 cases
- `vi.mock('@/lib/server/leader-lease', () => ({ withLease: vi.fn(async (...args, fn) => fn()) }))` — pass-through
- `vi.mock('@/lib/server/redis', () => ({ redis: null }))`
- `NextRequest` (not plain `Request`) for the request object
- `await import('./route')` so missing module = explicit RED test failure
- `// @ts-expect-error` on each route import so `tsc --noEmit` exits 0 (Wave 1 plans remove these directives)

| File | Cases | Coverage |
|------|-------|----------|
| `webhooks/bictorys/route.test.ts` | 6 | valid HMAC + first delivery, replay deduped, tampered body 401, expired replay 401, onPaid enqueues outbox (no closures), exports runtime+dynamic |
| `cron/outbox-drain/route.test.ts` | 5 | 401 fail, processed count from drainOutbox, withLease(name='outbox-drain', ttl≥60s), reset PROCESSING→PENDING BEFORE drainOutbox, BATCH_SIZE=100 |
| `cron/email-queue-drain/route.test.ts` | 4 | 401, drains 100 jobs, stops early on empty queue, no-op when getEmailQueue returns null |
| `cron/verification-cleanup/route.test.ts` | 3 | 401, deleteMany expiresAt<now, processed count |
| `cron/order-expiration/route.test.ts` | 3 | 401, calls expirePendingOrders({ prisma }), processed count |
| `cron/webhook-log-purge/route.test.ts` | 3 | 401, env retention 30d, default 90d |

### vercel.json tripwire + env-shape extension

7. **`frontend/src/lib/server/observability/vercel-json-shape.test.ts`** (NEW, D-20) — RED-by-design until Wave 1 plan 05-08 ships `frontend/vercel.json`. The "exists" assertion fails; 4 follow-on assertions skip-pass via `existsSync` gates. When vercel.json lands, all 5 assertions run: 5 cron schedules total, paths match `/^\/api\/cron\/[a-z-]+$/`, schedules match 5-field cron regex, every path has a matching `app/api/cron/<name>/route.ts`, the 5 canonical Phase 5 cron paths are present.

8. **`frontend/src/lib/server/observability/env-shape.test.ts`** — extended (no deletions) with `'.env.example phase 5 additions'` describe asserting `WEBHOOK_LOG_RETENTION_DAYS="90"` and `ORDER_EXPIRATION_MINUTES="30"` substrings.

9. **`.env.example`** — append-only Phase 5 block:
   - `WEBHOOK_LOG_RETENTION_DAYS="90"` — used by `/api/cron/webhook-log-purge` (CRON-05)
   - `ORDER_EXPIRATION_MINUTES="30"` — Phase-3 fork knob; the cron itself reads `Order.expiresAt` and is independent of this env

## Verification Status

| Check | Status | Notes |
|-------|--------|-------|
| `tsc -p tsconfig.json --noEmit` | exit 0 | clean typecheck |
| `vitest run src/lib/server/cron/auth.test.ts` | 7/7 GREEN | CRON-06 helper |
| `vitest run src/lib/server/webhook/bictorys.test.ts` | 7/7 GREEN | WH-01/02 helper |
| `vitest run src/lib/server/orders/expire.test.ts` | 6/6 GREEN | CRON-04 helper |
| `vitest run src/lib/server/observability/env-shape.test.ts` | 10/10 GREEN | OPS + Phase 4 + Phase 5 envs |
| `vitest run src/lib/server/observability/runtime-enforcement.test.ts` | 35/35 GREEN | no new routes yet — still passes |
| `vitest run src/lib/server/observability/vercel-json-shape.test.ts` | 4/5 (1 RED-by-design) | Wave 1 plan 05-08 ships vercel.json |
| `vitest run src/app/api/webhooks/bictorys src/app/api/cron` | 24 RED on `Failed to load url ./route` | Wave 1 plans 05-02..07 close the gap |
| **Full suite** | **502 tests: 477 GREEN, 25 RED** | RED count = 24 missing routes + 1 missing vercel.json |

## Deviations from Plan

### Auto-fixed Issues (Rules 1–3)

**1. [Rule 3 — Blocker] Missing `node_modules` in worktree**
- **Found during:** Task 1 verification (`pnpm exec vitest` failed with "Command not found")
- **Issue:** Fresh worktree had no `node_modules` symlink; pnpm couldn't resolve the vitest binary
- **Fix:** Created two symlinks — `<worktree>/node_modules → <main>/node_modules` and `<worktree>/frontend/node_modules → <main>/frontend/node_modules`. Both are gitignored (untracked, never committed).
- **Files modified:** worktree filesystem only (no git artifacts)
- **Commit:** N/A (test infrastructure, not source)

**2. [Rule 3 — Blocker] `tsc --noEmit` failed on RED route.test.ts files**
- **Found during:** Task 5 verification + the plan's `<verification>` block requires `tsc --noEmit` exits 0
- **Issue:** TypeScript flagged every `await import('./route')` as `error TS2307: Cannot find module './route'`. Per `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, the test files have to compile clean even with the route absent.
- **Fix:** Added `// @ts-expect-error -- route ships in Wave 1 (plan 05-XX); RED-by-design until then` immediately above every `await import('./route')` line in the 6 RED route.test.ts files. Wave 1 plans remove these directives as part of going GREEN (when the route lands and the directive becomes unused, TS will flag it — automatic cleanup signal).
- **Files modified:** 6 route.test.ts files
- **Commit:** `85b18af` fix(05-01): tame typecheck for RED route tests

**3. [Rule 3 — Blocker] `Buffer` is not assignable to `BodyInit` in `bictorys-mock.ts`**
- **Found during:** Task 5 typecheck
- **Issue:** Under `exactOptionalPropertyTypes`, neither `Buffer` nor `Uint8Array` matches the `BodyInit` union type expected by `NextRequest`'s constructor.
- **Fix:** Cast `rawBody as unknown as BodyInit`. The bytes are byte-identical at runtime (Buffer extends Uint8Array which is acceptable to fetch).
- **Files modified:** `frontend/src/test-utils/bictorys-mock.ts`
- **Commit:** `85b18af`

**4. [Rule 3 — Blocker] `mock.calls[0]![0]` indexing under `noUncheckedIndexedAccess`**
- **Found during:** Task 5 typecheck on `outbox-drain/route.test.ts`
- **Issue:** Vitest `vi.fn(async () => ({ count: 0 }))` types `mock.calls` as `[][]` (empty-tuple default). `calls[0]![0]` then fails because tuple `[]` has no index 0.
- **Fix:** Cast `updateManyMock.mock.calls as unknown as unknown[][]` before indexing, then index normally.
- **Files modified:** `frontend/src/app/api/cron/outbox-drain/route.test.ts`
- **Commit:** `85b18af`

### Deliberate Plan Deviation (documented in commit message)

**5. [Plan §Task 4 — Deviation] EmailQueue mailer construction**
- **Plan suggested:** inline `new Resend(resendKey)` + manual `mailer = { send(input) { ... } }` because the planner was unsure if a Mailer factory existed
- **Actual code:** uses existing `createMailer({ RESEND_API_KEY, EMAIL_FROM })` from `lib/server/email.ts` (Phase 1+ canon)
- **Rationale:** keeps the surface DRY, gets the existing List-Unsubscribe header support for free, removes a `require('resend')` dynamic import. Both approaches satisfy the contract — chose the cleaner one.
- **Files affected:** `frontend/src/lib/server/queues/email-queue-singleton.ts`
- **Commit:** `a92fef8`

## Wave 1 Readiness

The 7 Wave 1 plans (05-02..05-08) can now consume the contracts shipped here:

| Wave 1 Plan | Imports From This Wave 0 |
|-------------|--------------------------|
| 05-02 webhooks/bictorys/route.ts | `webhook/bictorys.ts:bictorysWebhookProvider` + `webhook/handler.ts:createWebhookHandler` |
| 05-03 cron/outbox-drain/route.ts | `cron/auth.ts:verifyCronSecret` + `outbox/dispatcher.ts:drainOutbox` + `queues/email-queue-singleton.ts:getEmailQueue` |
| 05-04 cron/email-queue-drain/route.ts | `cron/auth.ts:verifyCronSecret` + `queues/email-queue-singleton.ts:getEmailQueue` |
| 05-05 cron/verification-cleanup/route.ts | `cron/auth.ts:verifyCronSecret` + `prisma.verificationCode.deleteMany` |
| 05-06 cron/order-expiration/route.ts | `cron/auth.ts:verifyCronSecret` + `orders/expire.ts:expirePendingOrders` |
| 05-07 cron/webhook-log-purge/route.ts | `cron/auth.ts:verifyCronSecret` + `prisma.webhookLog.deleteMany` |
| 05-08 vercel.json | the route paths shipped by 05-02..05-07 |

Each Wave 1 plan only needs to make its corresponding RED `route.test.ts` go GREEN (no scavenger-hunt for helpers, no fixture re-derivation, no contract drift). The `// @ts-expect-error` directives on `./route` imports become unused on first GREEN landing, providing an automatic cleanup signal.

## Commits

```
8c1f3ab feat(05-01): add verifyCronSecret helper + 7-case unit test
aceb4e7 feat(05-01): add webhook/bictorys re-export wrapper + 7-case unit test
48c032a feat(05-01): add expirePendingOrders helper + 6-case unit test
a92fef8 feat(05-01): add EmailQueue lazy-init singleton
500ea0e test(05-01): add 6 RED route.test.ts files + bictorys-mock.ts fixture
85b18af fix(05-01): tame typecheck for RED route tests
7d8183b test(05-01): add Phase 5 env tripwires + vercel.json D-20 schema test
```

## Self-Check: PASSED

All 15 created files exist on disk; all 7 commits are present in `git log`; all 9 phase requirement IDs (WH-01, WH-02, CRON-01..07) have at least one Wave 0 contract artifact; `tsc --noEmit` exits 0; helper + observability tests are GREEN; route.test.ts + vercel-json-shape.test.ts are RED only on the expected RED-by-design points (missing routes + missing vercel.json).
