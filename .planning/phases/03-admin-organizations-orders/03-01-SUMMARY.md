---
phase: 03-admin-organizations-orders
plan: 01
subsystem: schema-migrations + helpers + test-scaffolds
tags: [admin, orders, migration, scaffolding, wave-0]
dependency_graph:
  requires:
    - frontend/src/lib/server/notifications/cursor.ts
    - frontend/src/lib/server/rate-limit-store.ts
    - frontend/src/lib/server/redis.ts
  provides:
    - User.status column (default ACTIVE) + @@index([status])
    - Order.idempotencyKey column (String? @unique)
    - frontend/src/lib/server/pagination/paginate.ts
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts
    - frontend/src/test-utils/admin-fixtures.ts
    - 10 RED test scaffolds (8 admin + orders + scripts/make-superadmin)
  affects:
    - frontend/prisma/schema.prisma
    - frontend/vitest.config.ts (include glob extended to scripts/)
tech_stack:
  added: []
  patterns:
    - Cursor pagination wrapper composing existing notifications/cursor.ts
    - Per-userId rate limiter mirroring createEmailLimiter (RedisRateLimitStore + dev fail-open)
    - vi.fn-backed Prisma row factories returning frozen-time deterministic shapes
key_files:
  created:
    - frontend/src/lib/server/pagination/paginate.ts
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts
    - frontend/src/test-utils/admin-fixtures.ts
    - frontend/src/app/api/admin/users/route.test.ts
    - frontend/src/app/api/admin/orders/route.test.ts
    - frontend/src/app/api/admin/withdrawals/route.test.ts
    - frontend/src/app/api/admin/audit-log/route.test.ts
    - frontend/src/app/api/admin/me/route.test.ts
    - frontend/src/app/api/admin/outbox/route.test.ts
    - frontend/src/app/api/admin/email-queue/route.test.ts
    - frontend/src/app/api/admin/rate-limits/route.test.ts
    - frontend/src/app/api/orders/route.test.ts
    - frontend/scripts/make-superadmin.test.ts
  modified:
    - frontend/prisma/schema.prisma
    - frontend/vitest.config.ts
decisions:
  - Adjusted enforceAdminRateLimit to real RedisRateLimitStore shape (single-arg increment, windowMs in ctor, totalHits/resetTime return) — plan's hypothetical signature didn't match the existing protected file
  - Used `it.todo` everywhere in the 10 scaffolds rather than failing imports of non-existent route modules — keeps `pnpm typecheck` green (success criterion) while still surfacing 46 RED todos in `pnpm test`
  - Extended vitest.config.ts include glob to also discover scripts/**/*.test.ts (the only viable path to host make-superadmin.test.ts without moving the script under src/)
  - Task 3 (DB migration) deferred to user — see Deferred Issues below
metrics:
  tasks_planned: 3
  tasks_completed: 2
  tasks_deferred: 1
  duration_minutes: 12
  completed_at: 2026-05-08
---

# Phase 3 Plan 1: Wave-0 Scaffolding for Admin/Orders/Visibility Summary

Schema delta (User.status + Order.idempotencyKey) lands at the model layer with prisma generate succeeding; cursor-paginate + per-userId admin rate-limit helpers extracted; 10 RED test scaffolds + 1 fixture file ship for Wave 1/2 to fill in. **DB migration push (Task 3) is deferred — DATABASE_URL/DIRECT_URL are not set in this worktree environment and `docker compose up -d` is unavailable on this machine (no `docker` binary on PATH).**

## What Shipped

### Task 1 — Schema delta (commit a9d1d2d)

`frontend/prisma/schema.prisma`:
- Added `User.status String @default("ACTIVE")` with comment indicating ACTIVE | SUSPENDED domain (D-ADMIN-02)
- Added `@@index([status])` next to existing `@@index([role])` for fast admin user-list filters
- Added `Order.idempotencyKey String? @unique` for D-PAY-01 (Stripe-grade replay protection); nullable so existing rows don't break the unique constraint
- `pnpm --filter frontend exec prisma generate` exits 0; `pnpm typecheck` exits 0 (proves generated client types include the new fields)

### Task 2 — Helpers + fixtures + 10 RED scaffolds (commit 2f3ec0b)

**`frontend/src/lib/server/pagination/paginate.ts`** — exports:
- `clampLimit(raw)` (default 20, max 50)
- `DEFAULT_LIMIT = 20`, `MAX_LIMIT = 50`
- `cursorWhere(cursor)` — returns the OR fragment for composite (createdAt, id) cursor
- `buildPage(rows, limit)` — slices the +1 page and emits next cursor
- Re-exports `encodeCursor`, `decodeCursor`, type `Cursor` from `@/lib/server/notifications/cursor`

**`frontend/src/lib/server/middleware/rate-limit-by-userid.ts`** — exports `enforceAdminRateLimit(userId)`:
- Key prefix `rl:admin:userid:` per D-ADMIN-05
- Window 60s, max 100 hits → 429 `TOO_MANY_REQUESTS` with `Retry-After`/`X-RateLimit-*` headers
- `redis === null` → returns null (fail-open in dev parity with `createEmailLimiter`)

**`frontend/src/test-utils/admin-fixtures.ts`** — 9 exports:
- `seedAdmin`, `seedSuperadmin`, `seedDemotableSuperadmin` (returns `{ keeper, demotable }`), `seedSuspendedUser`
- `seedOrder`, `seedOutbox`, `seedEmailJob` (default html length 500 to exercise OBS-02 truncation)
- `mockRedis(map)` — vi.fn-backed `scan`/`mget`/`ttl`/`get`/`incr`/`expire`/`decr`/`del`/`keys`
- `mockBictorysProvider({ openCircuit?, chargeResult?, chargeError? })` — returns a stubbed PaymentProvider

**10 RED scaffolds** (46 it.todos, vitest discovers all):
- `frontend/src/app/api/admin/users/route.test.ts` (10 todos — list + role + status)
- `frontend/src/app/api/admin/orders/route.test.ts` (2)
- `frontend/src/app/api/admin/withdrawals/route.test.ts` (4 — list + cancel)
- `frontend/src/app/api/admin/audit-log/route.test.ts` (3)
- `frontend/src/app/api/admin/me/route.test.ts` (4)
- `frontend/src/app/api/admin/outbox/route.test.ts` (3 — note `kind` not `type`)
- `frontend/src/app/api/admin/email-queue/route.test.ts` (3 — bodyPreview ≤200)
- `frontend/src/app/api/admin/rate-limits/route.test.ts` (4 — Pitfall 6 truncated:true)
- `frontend/src/app/api/orders/route.test.ts` (9 — happy + idempotency + circuit + UNCONFIGURED + validation)
- `frontend/scripts/make-superadmin.test.ts` (4 — exit codes + AdminAction logging)

`frontend/vitest.config.ts` `include` glob extended to `scripts/**/*.test.ts` so the make-superadmin scaffold is discovered alongside `src/`.

## Verification

```
pnpm typecheck                → 0 (Prisma client types include status + idempotencyKey)
pnpm lint                     → 0
pnpm --filter frontend exec vitest run src/app/api/admin/ src/app/api/orders/ scripts/
                              → 10 files / 46 todos discovered (RED state surfaced)
pnpm --filter frontend exec prisma generate
                              → 0 (Prisma Client v5.22.0)
```

Acceptance grep checks (all matched):
- `grep -E "^export (const|function|interface) (clampLimit|DEFAULT_LIMIT|MAX_LIMIT|cursorWhere|buildPage)" paginate.ts` → 5 matches
- `grep -c 'rl:admin:userid:' rate-limit-by-userid.ts` → 2 matches
- `grep -cE "^export (async function|function) (seedAdmin|seedSuperadmin|seedDemotableSuperadmin|seedSuspendedUser|seedOrder|seedOutbox|seedEmailJob|mockRedis|mockBictorysProvider)" admin-fixtures.ts` → 9 matches

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] enforceAdminRateLimit signature corrected to real RedisRateLimitStore shape**
- **Found during:** Task 2 (creating rate-limit-by-userid.ts)
- **Issue:** Plan's `<action>` block for the helper used a hypothetical signature `store.increment(key, windowSeconds)` returning `{ count, ttlSeconds }`. The actual exported `RedisRateLimitStore` (`frontend/src/lib/server/rate-limit-store.ts`, PROTECTED file) takes `windowMs` in the constructor and exposes `increment(key)` returning `{ totalHits, resetTime }`.
- **Fix:** Wrote the helper against the real interface — `new RedisRateLimitStore({ redis, prefix: '', windowMs: 60_000 })`, then `store.increment(...)` returning `{ totalHits, resetTime }`. 429 response computes `Retry-After` from `resetTime.getTime() - Date.now()` like the existing `createEmailLimiter` does.
- **Files modified:** `frontend/src/lib/server/middleware/rate-limit-by-userid.ts`
- **Commit:** 2f3ec0b

**2. [Rule 3 - Blocking] vitest.config.ts include glob extended for scripts/**
- **Found during:** Task 2 (creating make-superadmin.test.ts)
- **Issue:** The shipped vitest config only includes `src/**/*.test.ts`. The plan requires `frontend/scripts/make-superadmin.test.ts` outside that glob, so vitest would silently skip it.
- **Fix:** Added `'scripts/**/*.test.ts'` to the include array. Comment in config explains the Phase 3 Wave 0 motivation.
- **Files modified:** `frontend/vitest.config.ts`
- **Commit:** 2f3ec0b

**3. [Rule 3 - Pragmatic] it.todo over failing imports for RED scaffolds**
- **Found during:** Task 2 (creating 10 test files)
- **Issue:** The plan suggested importing `{ GET }` from `./route` in each scaffold (with the routes not yet existing) so the imports would fail loudly = RED. But Task 2's own acceptance criterion requires `pnpm typecheck` to exit 0, and a missing-module import fails type resolution.
- **Fix:** Used `it.todo` blocks with the verbatim test names from the plan instead. Vitest still reports each file in the run output (10 files, 46 todos) — the RED state is surfaced as "todo" rather than "fail", and Wave 1/2 plans MUST convert each todo to a real `it` block as they implement each endpoint. The scaffold serves the same purpose: a discoverable to-do list, just without breaking typecheck.
- **Files affected:** all 10 RED scaffold files
- **Commit:** 2f3ec0b

### Deferred Issues

**Task 3 — Prisma migration NOT applied to dev DB.**

`pnpm --filter frontend exec prisma migrate dev --name phase3-admin-orders --skip-seed` failed with:

```
Error: Prisma schema validation - (get-config wasm)
Error code: P1012
error: Environment variable not found: DIRECT_URL.
  -->  prisma/schema.prisma:8
```

The fallback `pnpm --filter frontend exec prisma db push --accept-data-loss` failed with the same `P1012`.

**Root cause:**
- `frontend/.env` and root `.env` do not exist in this worktree (only `.env.example` is present).
- `docker` binary is not installed on this machine (`docker ps` → command not found), so `docker compose up -d` from CLAUDE.md is not viable here.
- This worktree was created without DB credentials — likely the developer runs migrations from a separate shell against Neon dev or a locally-installed Postgres outside Docker.

**Why this is OK to defer:**
- Both columns are purely additive (User.status defaults to ACTIVE, Order.idempotencyKey is nullable) — applying them later is rollback-safe.
- The Prisma client has been regenerated locally and `pnpm typecheck` is green, so Wave 1 plans can write code that references `user.status` / `order.idempotencyKey` without typecheck regression.
- Wave 1 unit tests run against `vitest-mock-extended`'s deep-mock Prisma client (D-25) and don't touch a real DB, so they will run green even with the migration unapplied.

**What the user needs to do before Wave 1 ships any integration tests / `pnpm dev` smoke:**

```bash
# Option A — local Postgres (preferred for offline dev)
# 1) Install Docker Desktop OR a native Postgres (Homebrew: brew install postgresql@16)
# 2) Bring up local deps OR start postgres directly
docker compose up -d            # if Docker is installed
# OR
brew services start postgresql@16

# 3) Set DATABASE_URL + DIRECT_URL in frontend/.env (copy from .env.example):
cp .env.example frontend/.env
# Edit frontend/.env and fill DATABASE_URL + DIRECT_URL.

# 4) Apply the migration:
pnpm db:migrate:dev --name phase3-admin-orders
# OR (faster for dev iteration, no migration file emitted):
pnpm db:push

# Option B — Neon dev branch
# 1) Set DATABASE_URL (the -pooler URL) + DIRECT_URL in frontend/.env per .env.example
# 2) pnpm db:migrate:dev --name phase3-admin-orders
```

**Verification once applied:**

```bash
pnpm db:migrate:status          # → Database schema is up to date
# OR after db push:
pnpm --filter frontend exec prisma db execute --stdin <<<'SELECT column_name FROM information_schema.columns WHERE table_name='\''User'\'' AND column_name='\''status'\'';'
```

A migration file under `frontend/prisma/migrations/<timestamp>_phase3-admin-orders/` should appear when the `migrate dev` path is taken. The orchestrator phase-verification step is the right place to enforce this gate before Wave 1 plans wire DB-touching integration tests.

## Authentication Gates

None.

## Known Stubs

The 10 RED scaffolds use `it.todo` placeholders. These are intentional and tracked: Wave 1 and Wave 2 plans MUST convert each `it.todo` to a real `it` block as they implement the corresponding endpoint. The plan's `<output>` block calls out this deferral path explicitly.

No code-path stubs (no hardcoded empty arrays/strings flowing to UI) were introduced — this is a pure scaffolding plan.

## Threat Flags

None — Wave 0 doesn't add any new network surface. The new helpers consume existing protected libs (rate-limit-store, redis, cursor) without modification.

## Self-Check: PASSED

- `frontend/prisma/schema.prisma` — FOUND (status + idempotencyKey + @@index added)
- `frontend/src/lib/server/pagination/paginate.ts` — FOUND
- `frontend/src/lib/server/middleware/rate-limit-by-userid.ts` — FOUND
- `frontend/src/test-utils/admin-fixtures.ts` — FOUND
- `frontend/src/app/api/admin/users/route.test.ts` — FOUND
- `frontend/src/app/api/admin/orders/route.test.ts` — FOUND
- `frontend/src/app/api/admin/withdrawals/route.test.ts` — FOUND
- `frontend/src/app/api/admin/audit-log/route.test.ts` — FOUND
- `frontend/src/app/api/admin/me/route.test.ts` — FOUND
- `frontend/src/app/api/admin/outbox/route.test.ts` — FOUND
- `frontend/src/app/api/admin/email-queue/route.test.ts` — FOUND
- `frontend/src/app/api/admin/rate-limits/route.test.ts` — FOUND
- `frontend/src/app/api/orders/route.test.ts` — FOUND
- `frontend/scripts/make-superadmin.test.ts` — FOUND
- `frontend/vitest.config.ts` (modified) — FOUND
- Commit a9d1d2d — FOUND
- Commit 2f3ec0b — FOUND

**Outstanding:** DB migration push not yet applied to live dev DB (Task 3 deferred — see Deferred Issues).
