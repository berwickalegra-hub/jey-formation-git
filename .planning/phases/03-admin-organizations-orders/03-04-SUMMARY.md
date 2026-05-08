---
phase: 03-admin-organizations-orders
plan: 04
subsystem: admin-visibility (outbox + email-queue + rate-limits)
tags: [admin, observability, outbox, email-queue, rate-limits, wave-1]
dependency_graph:
  requires:
    - frontend/src/lib/server/pagination/paginate.ts (Wave 0)
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts (Wave 0)
    - frontend/src/test-utils/admin-fixtures.ts (Wave 0)
    - frontend/src/lib/server/redis.ts (PROTECTED — read-only)
    - frontend/src/lib/server/middleware/index.ts (PROTECTED — requireAdmin)
    - frontend/src/lib/server/observability/request-context.ts (PROTECTED)
  provides:
    - GET /api/admin/outbox (OBS-01) — paginated OutboxEvent rows, filters status+kind
    - GET /api/admin/email-queue (OBS-02) — paginated EmailJob rows with bodyPreview ≤200 chars
    - GET /api/admin/rate-limits (OBS-03) — 7-bucket Upstash SCAN summary with 1000-key cap
  affects:
    - .planning/REQUIREMENTS.md (OBS-01, OBS-02, OBS-03 ready to mark complete)
tech_stack:
  added: []
  patterns:
    - Cursor pagination via Wave 0 paginate helper (createdAt DESC, id DESC)
    - PII-protective select+transform: select html, then drop and emit bodyPreview slice(0, 200)
    - Upstash SCAN with 1000-key hard cap and `truncated: true` flag
    - Graceful degradation when redis === null → 200 `{ buckets: [], note: 'redis not configured' }`
    - vi.mock with `get redis()` accessor to swap mock <-> null per test
key_files:
  created:
    - frontend/src/app/api/admin/outbox/route.ts
    - frontend/src/app/api/admin/email-queue/route.ts
    - frontend/src/app/api/admin/rate-limits/route.ts
  modified:
    - frontend/src/app/api/admin/outbox/route.test.ts (it.todo → 8 real `it`)
    - frontend/src/app/api/admin/email-queue/route.test.ts (it.todo → 11 real `it`)
    - frontend/src/app/api/admin/rate-limits/route.test.ts (it.todo → 11 real `it`)
decisions:
  - Used 7 buckets (login, signup, verify, forgot, reset, pin, lockout) per PLAN.md §<behavior>; the prompt's <critical_constraints> listed an alternative 8-prefix shape but PLAN.md is authoritative and matches the actual `bucket:` values used by auth route handlers (`auth:login`, `auth:signup`, `auth:verify`, `auth:forgot`, `auth:reset`).
  - Lockout bucket scans `auth:lockout:` (the lock flag itself) rather than `auth:lockout-count:` (the counter) — admins triaging an account-lockout incident need the lock state directly. Counter decays in tandem.
  - bodyPreview implemented as `slice(0, 200)` literal (per acceptance criterion grep) rather than a named constant.
  - For the rate-limits test, used a `get redis()` accessor in `vi.mock('@/lib/server/redis')` so a single `redisHolder.current = … | null` mutation per test swaps between mocked client and null — keeps the redis-null branch testable without remounting the route module.
metrics:
  tasks_planned: 3
  tasks_completed: 3
  tasks_deferred: 0
  duration_minutes: 8
  completed_at: 2026-05-08
---

# Phase 3 Plan 4: Admin Visibility (Outbox + Email-Queue + Rate-Limits) Summary

Three read-only admin observability routes ship under `/api/admin/*` for incident-response workflows: outbox queue (`OBS-01`), email-queue with PII truncation (`OBS-02`), and rate-limit bucket summary from Upstash (`OBS-03`). All 30 new tests pass; full suite 295/295 (36 todos remain for Waves 2+).

## What Shipped

### Task 1 — `GET /api/admin/outbox` (OBS-01) — commit `3b6f0fd`

`frontend/src/app/api/admin/outbox/route.ts`:

- **Behavior:** paginated `OutboxEvent` rows; filters by `?status` (PENDING|SENT|FAILED|DEAD) and `?kind` (free-form dispatcher routing key, e.g. `email.payment_confirmation`); cursor pagination via Wave 0 `paginate.ts` helpers (`clampLimit`, `cursorWhere`, `decodeCursor`, `buildPage`).
- **Field naming (Pitfall 4 / T-03-04-04):** schema column is `kind`. Query param `?kind=…`, response field `kind`. No `type` aliasing — both wire-shape and where-clause use `kind` consistently.
- **Auth:** `requireAdmin('ADMIN')` + `enforceAdminRateLimit(auth.admin.id)`.
- **Response:** `200 { items: OutboxEvent[], nextCursor: string | null }` with `x-request-id` header.
- **Source select:** full row including `payload` (admins triaging "why didn't this side-effect run" need it; D-OBS-06 accepts).
- **Tests (8 pass):** paginated list, `?status` enumeration (PENDING/SENT/FAILED/DEAD + invalid ignored), `?kind` filter, `?limit`+cursor, requireAdmin bail (403), rate-limit short-circuit (429), x-request-id header, source invariants.

### Task 2 — `GET /api/admin/email-queue` (OBS-02 with PII truncation) — commit `6b1b213`

`frontend/src/app/api/admin/email-queue/route.ts`:

- **Behavior:** paginated `EmailJob` rows; filter `?status` (PENDING|SENT|FAILED|DEAD); cursor pagination.
- **PII protection (D-OBS-02 / T-03-04-01):** `html` is selected only to compute `bodyPreview = (html ?? '').slice(0, 200)`, then dropped from the response shape. `text` is never selected at the Prisma layer.
- **Auth:** `requireAdmin('ADMIN')` + `enforceAdminRateLimit`.
- **Response item shape:** `{ id, to, subject, bodyPreview, status, attempts, lastError, scheduledAt, sentAt, createdAt }` — explicitly no `html` or `text`.
- **Truncation observed:** test seeds `html = 'a'.repeat(1000)` and asserts `bodyPreview.length === 200`. A second test asserts `JSON.stringify(body)` does not contain `'X'.repeat(201)` (defensive: any html beyond 200 chars leaking = bug).
- **Tests (11 pass):** truncation to exactly 200 chars, status enumeration, html/text absent from wire, empty-result shape, pagination with nextCursor, null-html safety (`bodyPreview === ''`), requireAdmin bail, rate-limit short-circuit, x-request-id header, two source invariants.

### Task 3 — `GET /api/admin/rate-limits` (OBS-03) — commit `6fa684e`

`frontend/src/app/api/admin/rate-limits/route.ts`:

- **Behavior:** read-only summary across 7 buckets. Each bucket emits `{ bucket, totalKeys, top10: [{ key, hits, expiresAt }], truncated? }`.
- **Bucket prefix table (7 buckets):**

  | Bucket          | Prefix              | Source                                      |
  | --------------- | ------------------- | ------------------------------------------- |
  | `auth:login`    | `rl:auth:login:`    | `app/api/auth/login/route.ts:46`            |
  | `auth:signup`   | `rl:auth:signup:`   | `app/api/auth/signup/route.ts:37`           |
  | `auth:verify`   | `rl:auth:verify:`   | `app/api/auth/verify-email/route.ts:37`     |
  | `auth:forgot`   | `rl:auth:forgot:`   | `app/api/auth/forgot-password/route.ts:43`  |
  | `auth:reset`    | `rl:auth:reset:`    | `app/api/auth/reset-password/route.ts:37`   |
  | `auth:pin`      | `rl:auth:pin:`      | (PIN limiter; key shape per RESEARCH.md §A1)|
  | `lockout`       | `auth:lockout:`     | `lib/server/auth/lockout.ts:42` (NOT under rl: — the lock flag, distinct from the count counter at `auth:lockout-count:`) |

- **Hard-cap (T-03-04-02):** 1000 keys per bucket via `HARD_CAP = 1000`; SCAN batches of 200; emits `truncated: true` and stops scanning when capped. Test seeds 1500 keys → asserts `totalKeys === 1000` and `truncated === true`.
- **Top-10 selection:** sorts `trimmed` (≤1000 keys) DESC by hits, takes first 10, strips bucket prefix from `key` so admin sees `e:foo@example.com` not `rl:auth:login:e:foo@example.com`. `expiresAt` derived from `redis.ttl(key) > 0` → `new Date(Date.now() + ttl*1000).toISOString()`, else `null`.
- **Graceful degradation (T-03-04-05):** when `redis === null` (UPSTASH env absent), the route returns `200 { buckets: [], note: 'redis not configured' }` rather than 500/throw. Test asserts exact body shape via `vi.mock('@/lib/server/redis', () => ({ get redis() { return redisHolder.current; } }))` with `redisHolder.current = null`.
- **SCAN-not-KEYS:** test asserts `stub.scan` was called and `stub.keys` was NOT called (Pitfall 6: KEYS blocks Upstash for the whole keyspace).
- **Auth:** `requireAdmin('ADMIN')` + `enforceAdminRateLimit`.
- **Tests (11 pass):** 7-bucket enumeration with seeded data + correct top10 sort + lockout key shape, 1500-key truncation, SCAN-not-KEYS invariant, top10 entry shape `{ key, hits, expiresAt }`, empty-bucket case (`totalKeys: 0, top10: []`), redis-null fallback (exact body shape), requireAdmin bail, rate-limit short-circuit, x-request-id header, two source invariants.

## Verification

```
pnpm --filter frontend exec vitest run \
  src/app/api/admin/outbox/ \
  src/app/api/admin/email-queue/ \
  src/app/api/admin/rate-limits/        → 30 passed (8 + 11 + 11)
pnpm --filter frontend exec vitest run
  src/lib/server/observability/runtime-enforcement.test.ts → 22 passed
pnpm --filter frontend exec vitest run  → 295 passed | 36 todo | 0 failed
pnpm typecheck                          → exits 0
pnpm lint                               → exits 0
```

Acceptance grep checks (all matched):

- `grep -c "export const runtime = 'nodejs'" outbox/route.ts` → 1
- `grep -c "requireAdmin('ADMIN')" outbox/route.ts` → 2 (handler + comment-free; criterion was ≥1)
- `grep -c "enforceAdminRateLimit" outbox/route.ts` → 3 (import + call + comment-adjacent)
- `grep -c "outboxEvent.findMany" outbox/route.ts` → 2 (call + select expr)
- `grep -c "kind" outbox/route.ts` → 7 (≥2 required)
- `grep -c "bodyPreview" email-queue/route.ts` → 4 (≥2 required)
- `grep -c "slice(0, 200)" email-queue/route.ts` → 1 (literal as required)
- `grep -c "emailJob.findMany" email-queue/route.ts` → 2 (call + Prisma type ref)
- `grep -c "redisClient.scan" rate-limits/route.ts` → 1
- `grep -c "HARD_CAP = 1000" rate-limits/route.ts` → 1
- `grep -c "auth:lockout:" rate-limits/route.ts` → 2 (BUCKETS row + comment)
- `grep -c "redis not configured" rate-limits/route.ts` → 1
- `grep -c "truncated: true" rate-limits/route.ts` → 2 (object literal in return + assertion comment-free; ≥1 was the bar)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Pragmatic] Acceptance criterion `grep -c "type" outbox/route.ts returns 0` is unachievable as literally written.**

- **Found during:** Task 1 final verification.
- **Issue:** The plan's acceptance criterion expected the literal substring `type` to never appear in `outbox/route.ts`. But TypeScript-strict imports (`import { … type NextRequest } from 'next/server'`, `import type { OutboxEvent, Prisma } from '@prisma/client'`) and the local TS type alias `type OutboxStatus = …` all legitimately use the `type` keyword. These are TS syntax, not field-name aliases.
- **Fix:** Removed the avoidable `type` mention in the route's header comment (was: `Do NOT alias to \`type\``); count went from 4 → 3. The remaining 3 are unavoidable TS keywords. The **intent** of the criterion (no field-name `type` aliasing of `kind`) is fully satisfied — verified by:
  - The Prisma where-clause uses `kind` not `type` (Test 3 asserts `args?.where?.kind === 'email.payment_confirmation'` and `args?.where?.['type'] === undefined`).
  - The response item exposes `kind` not `type` (Test 1 asserts `expect(body.items[0]).toHaveProperty('kind')` and `expect(body.items[0]).not.toHaveProperty('type')`).
- **Files modified:** `frontend/src/app/api/admin/outbox/route.ts`
- **Commit:** `6fa684e`

**2. [Rule 3 — Blocking] `vi.mock('@/lib/server/redis')` needed a getter accessor to support null-swap per test.**

- **Found during:** Task 3 test authoring (rate-limits `redis === null` branch).
- **Issue:** A flat `vi.mock('@/lib/server/redis', () => ({ redis: stub }))` binds `redis` once at module load — there's no clean way to swap it to `null` in a single test of an otherwise-shared route module. Reloading the module per test is heavy and breaks the existing import structure of `import { GET } from './route'`.
- **Fix:** Used a `redisHolder = { current: MockRedisStub | null }` plus `get redis() { return redisHolder.current; }` in the mock factory. Each test sets `redisHolder.current = mockRedis(...)` or `null` in setup. Route reads `redis` as a fresh getter on each call, so the swap takes effect immediately.
- **Why this is correct:** This is a test-only construct (the production module exports a const `redis`, no getter). It mirrors how `vi.mock` is documented to be used for stateful module mocks — see `frontend/src/test-utils/mock-cookies.ts` for the same pattern (closure over a mutable Map + factory returning a Map-shaped value).
- **Files affected:** `frontend/src/app/api/admin/rate-limits/route.test.ts`
- **Commit:** `6fa684e`

### Deferred Issues

None.

## Authentication Gates

None — three read-only admin routes; auth is via the standard `requireAdmin('ADMIN')` cookie flow.

## Known Stubs

None. All three routes return real data shapes wired to live Prisma queries (mocked at the test layer per D-25 / `vitest-mock-extended`) and the live Upstash `redis` client (mocked per-test via `mockRedis()` from `admin-fixtures.ts`).

## Threat Flags

None — all new threats were already enumerated in PLAN.md `<threat_model>` (T-03-04-01..06) and mitigated by the implementation. No new attack surface introduced beyond what the plan anticipated.

## Self-Check: PASSED

- `frontend/src/app/api/admin/outbox/route.ts` — FOUND
- `frontend/src/app/api/admin/email-queue/route.ts` — FOUND
- `frontend/src/app/api/admin/rate-limits/route.ts` — FOUND
- `frontend/src/app/api/admin/outbox/route.test.ts` (modified to real tests) — FOUND
- `frontend/src/app/api/admin/email-queue/route.test.ts` (modified to real tests) — FOUND
- `frontend/src/app/api/admin/rate-limits/route.test.ts` (modified to real tests) — FOUND
- Commit `3b6f0fd` (outbox) — FOUND
- Commit `6b1b213` (email-queue) — FOUND
- Commit `6fa684e` (rate-limits + outbox doc tweak) — FOUND
- Tests: 30/30 plan-route tests pass; 295/295 full suite pass; 36 it.todo remain for Waves 2+
