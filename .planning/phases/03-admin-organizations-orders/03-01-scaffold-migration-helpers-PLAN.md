---
phase: 03-admin-organizations-orders
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - frontend/prisma/schema.prisma
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
autonomous: true
requirements: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-07, PAY-01, OBS-01, OBS-02, OBS-03]
must_haves:
  truths:
    - Prisma schema has User.status enum (default ACTIVE) and Order.idempotencyKey @unique String?
    - Prisma client regenerated; types include user.status + order.idempotencyKey
    - Database accepts the new columns (db push or migrate dev applied)
    - paginate helper exported with cursor-based listing utility for admin reads
    - per-userId rate-limit helper exported with rl:admin:userid:<id> bucket
    - 10 RED test files exist (one per Wave 1/2 endpoint); each has at least one failing test
    - admin-fixtures.ts exports seedAdmin/seedSuperadmin/seedDemotableSuperadmin/seedSuspendedUser/seedOrder/seedOutbox/seedEmailJob/mockRedis/mockBictorysProvider
  artifacts:
    - path: frontend/prisma/schema.prisma
      provides: User.status + Order.idempotencyKey columns
      contains: 'status            String    @default("ACTIVE")'
    - path: frontend/src/lib/server/pagination/paginate.ts
      provides: Reusable cursor pagination helper for admin listings
      exports: ['paginate', 'clampLimit', 'DEFAULT_LIMIT', 'MAX_LIMIT']
    - path: frontend/src/lib/server/middleware/rate-limit-by-userid.ts
      provides: Per-userId limiter (100/min) for admin endpoints
      exports: ['enforceAdminRateLimit']
    - path: frontend/src/test-utils/admin-fixtures.ts
      provides: Shared test factories
      exports: ['seedAdmin', 'seedSuperadmin', 'seedDemotableSuperadmin', 'seedSuspendedUser', 'seedOrder', 'seedOutbox', 'seedEmailJob', 'mockRedis', 'mockBictorysProvider']
  key_links:
    - from: frontend/src/lib/server/pagination/paginate.ts
      to: frontend/src/lib/server/notifications/cursor.ts
      via: import { encodeCursor, decodeCursor }
      pattern: 'from .*notifications/cursor'
    - from: frontend/src/lib/server/middleware/rate-limit-by-userid.ts
      to: frontend/src/lib/server/rate-limit-store.ts
      via: RedisRateLimitStore for rl:admin:userid:<id> keyspace
      pattern: 'rate-limit-store'
---

<objective>
Wave 0 scaffolding for Phase 3. Land the Prisma migration (User.status + Order.idempotencyKey), extract two shared helpers (paginate, per-userId admin rate-limit), seed the test scaffolds for all Wave 1/2 endpoints (10 RED test files + 1 fixture file from VALIDATION.md), then run the [BLOCKING] schema push.

Purpose: Every downstream Wave 1/2 task can be implemented and verified independently because the schema columns exist, the helpers are importable, and the test files are already RED.

Output: 1 schema delta + 2 helper files + 1 fixture file + 10 test scaffolds + applied migration.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@.planning/phases/03-admin-organizations-orders/03-VALIDATION.md
@frontend/prisma/schema.prisma
@frontend/src/lib/server/notifications/cursor.ts
@frontend/src/lib/server/rate-limit-store.ts
@frontend/src/lib/server/middleware/rate-limit-by-email.ts
@CLAUDE.md

<interfaces>
<!-- Existing exports the new helpers MUST consume -->

From frontend/src/lib/server/notifications/cursor.ts:
```typescript
export interface Cursor { createdAt: Date; id: string }
export function encodeCursor(c: Cursor): string;
export function decodeCursor(raw: string | null | undefined): Cursor | null;
```

From frontend/src/lib/server/rate-limit-store.ts:
```typescript
export interface IncrementResponse { count: number; ttlSeconds: number }
export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<IncrementResponse>;
  // (other methods)
}
export interface RedisRateLimitStoreOptions { /* see file */ }
```

From frontend/prisma/schema.prisma — User and Order current shapes (must extend, not break):
```prisma
model User {
  id                String    @id @default(cuid())
  email             String    @unique
  role              String    @default("USER") // USER | ADMIN | SUPERADMIN
  // ... existing fields
}
model Order {
  id              String    @id @default(cuid())
  // ... existing fields, no idempotencyKey yet
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Schema delta + Prisma client regeneration</name>
  <files>frontend/prisma/schema.prisma</files>
  <read_first>
    - frontend/prisma/schema.prisma — current User + Order models (lines 11-50, 270-301)
    - .planning/phases/03-admin-organizations-orders/03-CONTEXT.md (D-ADMIN-02, D-PAY-01)
    - CLAUDE.md "Critical invariants" section — integer amounts, runtime=nodejs (no schema impact, but reinforces field-typing discipline)
  </read_first>
  <behavior>
    - User.status field exists with default "ACTIVE" and index — accepts only "ACTIVE" | "SUSPENDED" string values at the Prisma type layer (string-enum convention used elsewhere in this schema for User.role)
    - Order.idempotencyKey is `String?` with `@unique` — accepts null on existing rows, rejects duplicate non-null values
    - `pnpm --filter frontend exec prisma generate` exits 0 and the generated client emits typed access for `prisma.user.status` + `prisma.order.idempotencyKey`
  </behavior>
  <action>
    Edit `frontend/prisma/schema.prisma` to add:

    1. Inside `model User` (after the existing `role` field on line 29), add:
       ```prisma
       // Account status. ACTIVE = login + refresh allowed; SUSPENDED = both
       // refused with 403 ACCOUNT_SUSPENDED. Mutated via /api/admin/users/[id]/status
       // (ADMIN can suspend; only SUPERADMIN can restore).
       status            String    @default("ACTIVE") // ACTIVE | SUSPENDED
       ```
       Then add `@@index([status])` next to the existing `@@index([role])` line so admin user-list filters on status are fast.

    2. Inside `model Order` (after `metadata Json?` around line 280), add:
       ```prisma
       // Stripe-grade idempotency. Required header on POST /api/orders; replay
       // with same value returns the original Order row instead of double-charging.
       // Nullable so existing rows pre-migration don't break the @unique constraint.
       idempotencyKey  String?   @unique
       ```

    3. After the schema edits, run `pnpm --filter frontend exec prisma generate` to refresh `@prisma/client` types. Do NOT push the migration in this task — the [BLOCKING] push lives in Task 3.

    Per D-ADMIN-02 (CONTEXT.md) and D-PAY-01.
  </action>
  <verify>
    <automated>grep -n 'status            String    @default("ACTIVE")' frontend/prisma/schema.prisma &amp;&amp; grep -n 'idempotencyKey  String?   @unique' frontend/prisma/schema.prisma &amp;&amp; pnpm --filter frontend exec prisma generate</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'status            String    @default("ACTIVE")' frontend/prisma/schema.prisma` returns 1
    - `grep -c 'idempotencyKey  String?   @unique' frontend/prisma/schema.prisma` returns 1
    - `grep -c '@@index(\[status\])' frontend/prisma/schema.prisma` returns 1
    - `pnpm --filter frontend exec prisma generate` exits 0
    - `pnpm typecheck` exits 0 (proves generated Prisma client types include the new fields)
  </acceptance_criteria>
  <done>schema.prisma has both columns + index, prisma generate succeeds, typecheck passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: paginate helper + per-userId admin rate-limit helper + test scaffolds + admin fixtures</name>
  <files>frontend/src/lib/server/pagination/paginate.ts, frontend/src/lib/server/middleware/rate-limit-by-userid.ts, frontend/src/test-utils/admin-fixtures.ts, frontend/src/app/api/admin/users/route.test.ts, frontend/src/app/api/admin/orders/route.test.ts, frontend/src/app/api/admin/withdrawals/route.test.ts, frontend/src/app/api/admin/audit-log/route.test.ts, frontend/src/app/api/admin/me/route.test.ts, frontend/src/app/api/admin/outbox/route.test.ts, frontend/src/app/api/admin/email-queue/route.test.ts, frontend/src/app/api/admin/rate-limits/route.test.ts, frontend/src/app/api/orders/route.test.ts, frontend/scripts/make-superadmin.test.ts</files>
  <read_first>
    - frontend/src/lib/server/notifications/cursor.ts (encodeCursor / decodeCursor signatures + Cursor interface)
    - frontend/src/lib/server/rate-limit-store.ts (RedisRateLimitStore + IncrementResponse contract)
    - frontend/src/lib/server/middleware/rate-limit-by-email.ts (existing per-email pattern to mirror)
    - frontend/src/app/api/notifications/route.ts (canonical Phase 2 cursor-paged GET pattern)
    - frontend/vitest.setup.ts + frontend/src/test-utils/ (existing test helper conventions)
    - .planning/phases/03-admin-organizations-orders/03-VALIDATION.md "Wave 0 Requirements" section
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Required Test Fixtures" table
  </read_first>
  <behavior>
    - `paginate.ts` exports `clampLimit(raw: string | null): number` returning min(50, max(1, parseInt(raw) || 20)); exports `DEFAULT_LIMIT = 20`, `MAX_LIMIT = 50`; exports `paginate&lt;T extends { id: string; createdAt: Date }&gt;(query: { findMany(args): Promise&lt;T[]&gt; }, opts: { where, limit, cursor }): Promise&lt;{ items: T[]; nextCursor: string | null }&gt;` that adds `take: limit + 1`, `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`, applies the cursor-OR clause, slices the +1, encodes nextCursor from the last visible row
    - `rate-limit-by-userid.ts` exports `enforceAdminRateLimit(userId: string): Promise&lt;NextResponse | null&gt;` — builds key `rl:admin:userid:${userId}`, calls `RedisRateLimitStore.increment(key, 60)`, returns `NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 })` if count > 100 in the window, else null. When `redis === null` → returns null (fail-open in dev parity with `createEmailLimiter`)
    - `admin-fixtures.ts` exports the 9 factories listed in VALIDATION.md "Wave 0 Requirements"
    - 10 test files import from the (not-yet-existing) route handlers and assert RED behavior; running `pnpm --filter frontend exec vitest run src/app/api/admin/` reports each test FAILS with "Cannot find module" or similar import-failure (this is the RED state)
  </behavior>
  <action>
    Create files in this exact order:

    **A. `frontend/src/lib/server/pagination/paginate.ts`** — Reusable wrapper around the existing `notifications/cursor.ts` helper. Concrete signature:
    ```typescript
    import { encodeCursor, decodeCursor, type Cursor } from '@/lib/server/notifications/cursor';

    export const DEFAULT_LIMIT = 20;
    export const MAX_LIMIT = 50;

    export function clampLimit(raw: string | null): number {
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
      return Math.min(MAX_LIMIT, Math.max(1, parsed));
    }

    export interface PaginateOptions {
      limit: number;
      cursor: Cursor | null;
    }

    export interface PaginateResult<T> {
      items: T[];
      nextCursor: string | null;
    }

    /**
     * Build the where-fragment for cursor pagination. Caller merges this with
     * its own filter where-clause (so we don't have to know the model shape).
     */
    export function cursorWhere(cursor: Cursor | null): Record<string, unknown> {
      if (!cursor) return {};
      return {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      };
    }

    /**
     * Slice the +1 page and emit the next cursor from the last visible row.
     */
    export function buildPage<T extends { id: string; createdAt: Date }>(
      rows: T[],
      limit: number,
    ): PaginateResult<T> {
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1];
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
      return { items, nextCursor };
    }

    export { encodeCursor, decodeCursor };
    export type { Cursor };
    ```

    **B. `frontend/src/lib/server/middleware/rate-limit-by-userid.ts`** — Per-userId admin limiter (D-ADMIN-05 + Pitfall 5). Concrete signature:
    ```typescript
    import 'server-only';
    import { NextResponse } from 'next/server';
    import { redis } from '@/lib/server/redis';
    import { RedisRateLimitStore } from '@/lib/server/rate-limit-store';

    const ADMIN_PREFIX = 'rl:admin:userid:';
    const WINDOW_SECONDS = 60;
    const MAX_HITS = 100;

    export async function enforceAdminRateLimit(userId: string): Promise<NextResponse | null> {
      if (!redis) return null; // graceful degrade in dev w/o Upstash
      const store = new RedisRateLimitStore({ redis, keyPrefix: '' });
      const { count } = await store.increment(`${ADMIN_PREFIX}${userId}`, WINDOW_SECONDS);
      if (count > MAX_HITS) {
        return NextResponse.json(
          { error: 'TOO_MANY_REQUESTS', message: 'Admin rate limit exceeded; retry shortly.' },
          { status: 429 },
        );
      }
      return null;
    }
    ```
    NOTE: Inspect `RedisRateLimitStoreOptions` in `rate-limit-store.ts` and adjust the construction call to match its actual constructor shape. Do NOT modify rate-limit-store.ts (PROTECTED file).

    **C. `frontend/src/test-utils/admin-fixtures.ts`** — Test factories. Each factory returns a typed seed result. Example shape:
    ```typescript
    import { prisma } from '@/lib/server/prisma';
    import { hashPassword } from '@/lib/server/auth'; // or whichever helper Phase 1 ships

    export async function seedAdmin(overrides?: Partial<{ email: string; status: string }>) {
      return prisma.user.create({
        data: {
          email: overrides?.email ?? `admin-${Date.now()}@test.local`,
          role: 'ADMIN',
          status: overrides?.status ?? 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash: await hashPassword('TestPass123!'),
        },
      });
    }
    export async function seedSuperadmin(overrides?: { email?: string }) { /* role: 'SUPERADMIN' */ }
    export async function seedDemotableSuperadmin() {
      // Returns { keeper, demotable } — both SUPERADMIN so the demotable can be demoted to ADMIN without violating CF-09
    }
    export async function seedSuspendedUser() { /* role: 'USER', status: 'SUSPENDED' */ }
    export async function seedOrder(opts: { userId: string; status?: string; idempotencyKey?: string | null }) { /* prisma.order.create */ }
    export async function seedOutbox(opts: { kind: string; status?: string }) { /* prisma.outboxEvent.create */ }
    export async function seedEmailJob(opts: { status?: string; html?: string }) { /* prisma.emailJob.create with html length controllable */ }
    export function mockRedis(map: Record<string, string | number>) {
      // returns a stub satisfying { scan, mget, ttl, get, increment, ... } shape used by enforceAdminRateLimit + rate-limits/route.ts
    }
    export function mockBictorysProvider(opts?: { openCircuit?: boolean; chargeResult?: { paymentUrl: string; providerChargeId: string } }) {
      // returns a stub PaymentProvider whose .charge() either resolves with chargeResult or rejects to trip the breaker
    }
    ```
    Use `vi.fn` for the mocks. Read the existing fixtures already shipped (Phase 1 patterns under `frontend/src/test-utils/`) and re-export shared helpers (e.g. password-hash util, prisma cleanup) rather than re-implementing.

    **D. Ten RED test files** — one per endpoint per VALIDATION.md "Wave 0 Requirements". Each file has the structure:
    ```typescript
    import { describe, it, expect, beforeEach, vi } from 'vitest';
    // Intentional: import the route module that does NOT exist yet — first run is RED.
    import { GET /* or POST/PATCH */ } from './route';
    import { seedAdmin /* etc */ } from '@/test-utils/admin-fixtures';

    describe('/api/admin/<resource> [Wave N]', () => {
      it.todo('renders the success path'); // placeholder so file is valid Vitest
      // RED tests with concrete expectations live here. They should describe
      // the request/response inventory from RESEARCH.md "Endpoint Inventory" §1-9.
    });
    ```

    Per-file required test names (verbatim, drive `vitest -t` patterns from VALIDATION.md):
    - `users/route.test.ts`: `it('GET returns paginated users for ADMIN')`, `it('GET applies q search case-insensitive')`, `it('GET filters by status and role')`, `it.todo('rate limits admin per-userId after 100/min')`
    - `orders/route.test.ts`: `it('GET returns paginated orders for ADMIN')`, `it('GET filters by status and since/until')`
    - `withdrawals/route.test.ts`: `it('GET returns paginated withdrawals for ADMIN')`, `it('POST [id]/cancel by ADMIN returns 403 ADMIN_REQUIRED')` and `it('POST [id]/cancel by SUPERADMIN succeeds + writes AdminAction with action="withdrawal.cancel"')` — note name `withdrawal cancel`
    - `audit-log/route.test.ts`: `it('GET returns paginated AdminAction items')`, `it('GET filters by actor, action, targetType')`
    - `me/route.test.ts`: `it('GET returns role + capability list for ADMIN')`, `it('GET returns broader capability list for SUPERADMIN including users:role and withdrawals:cancel')`
    - `outbox/route.test.ts`: `it('GET returns paginated OutboxEvent rows')`, `it('GET filters by status and kind (not type)')` — Pitfall 4
    - `email-queue/route.test.ts`: `it('GET returns EmailJob rows with bodyPreview ≤200 chars (PII protection)')`
    - `rate-limits/route.test.ts`: `it('GET returns bucket summary across known prefixes')`, `it('GET hard-caps at 1000 keys per bucket and emits truncated:true')` — Pitfall 6, mocked Upstash
    - `orders/route.test.ts` (under `app/api/orders/`, NOT admin): `it('POST creates an Order and returns 201 + paymentUrl')`, `it('POST replays returns prior order on same Idempotency-Key')`, `it('POST circuit open returns 503 PAYMENT_PROVIDER_UNAVAILABLE')`, `it('POST without BICTORYS_API_KEY returns 503 PAYMENT_PROVIDER_UNCONFIGURED')` — Pitfall 7
    - `frontend/scripts/make-superadmin.test.ts`: `it('promotes existing user to SUPERADMIN and writes BOOTSTRAP_SUPERADMIN AdminAction')`, `it('missing user exits 1 with clear stderr message')`

    Run `pnpm --filter frontend exec vitest run src/app/api/admin/ src/app/api/orders/ scripts/` and EXPECT failures (RED). Capture the count of failing tests as the Wave 0 baseline.
  </action>
  <verify>
    <automated>test -f frontend/src/lib/server/pagination/paginate.ts &amp;&amp; test -f frontend/src/lib/server/middleware/rate-limit-by-userid.ts &amp;&amp; test -f frontend/src/test-utils/admin-fixtures.ts &amp;&amp; test -f frontend/src/app/api/admin/users/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/orders/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/withdrawals/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/audit-log/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/me/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/outbox/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/email-queue/route.test.ts &amp;&amp; test -f frontend/src/app/api/admin/rate-limits/route.test.ts &amp;&amp; test -f frontend/src/app/api/orders/route.test.ts &amp;&amp; test -f frontend/scripts/make-superadmin.test.ts &amp;&amp; pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - All 13 file paths above exist
    - `paginate.ts` exports `clampLimit`, `DEFAULT_LIMIT`, `MAX_LIMIT`, `cursorWhere`, `buildPage` (`grep -E "^export (const|function) (clampLimit|DEFAULT_LIMIT|MAX_LIMIT|cursorWhere|buildPage)" frontend/src/lib/server/pagination/paginate.ts | wc -l` returns ≥5)
    - `rate-limit-by-userid.ts` exports `enforceAdminRateLimit` and references `rl:admin:userid:` literal (`grep -c 'rl:admin:userid:' frontend/src/lib/server/middleware/rate-limit-by-userid.ts` returns ≥1)
    - `admin-fixtures.ts` exports `seedAdmin`, `seedSuperadmin`, `seedDemotableSuperadmin`, `seedSuspendedUser`, `seedOrder`, `seedOutbox`, `seedEmailJob`, `mockRedis`, `mockBictorysProvider` (`grep -cE "^export (async function|function) (seedAdmin|seedSuperadmin|seedDemotableSuperadmin|seedSuspendedUser|seedOrder|seedOutbox|seedEmailJob|mockRedis|mockBictorysProvider)" frontend/src/test-utils/admin-fixtures.ts` returns 9)
    - `pnpm typecheck` exits 0
    - `pnpm --filter frontend exec vitest run src/app/api/admin/ src/app/api/orders/ scripts/ 2>&1 | grep -E "(FAIL|failed)"` returns matches (RED state confirmed)
  </acceptance_criteria>
  <done>Helpers + fixture + 10 RED tests in place; typecheck green; vitest run shows expected RED state.</done>
</task>

<task type="auto">
  <name>Task 3: [BLOCKING] Apply Prisma migration to dev database</name>
  <files>frontend/prisma/migrations/</files>
  <read_first>
    - frontend/prisma/schema.prisma (post Task 1 edits — confirm User.status + Order.idempotencyKey present)
    - CLAUDE.md "Commands" table — `pnpm db:migrate:dev` vs `pnpm db:push`
    - frontend/package.json (db: scripts) — confirm command names
  </read_first>
  <action>
    Apply the schema delta from Task 1 to the dev database.

    Strategy (additive migration — User.status defaults to ACTIVE, Order.idempotencyKey is nullable, both rollback-safe):

    1. Run `pnpm --filter frontend exec prisma migrate dev --name phase3-admin-orders --skip-seed` (matches CLAUDE.md preferred command; --skip-seed avoids any seed-script interaction).
    2. If the command prompts interactively for any reason and stalls (Vercel/CI environment), fall back to `npx --yes prisma db push --accept-data-loss --schema=frontend/prisma/schema.prisma` — both new columns are purely additive so no data loss occurs in practice; the flag only suppresses the safety prompt.
    3. Verify with `pnpm --filter frontend exec prisma migrate status` (output should report "Database schema is up to date") OR — when using db push — verify by querying: `pnpm --filter frontend exec prisma db execute --schema frontend/prisma/schema.prisma --stdin <<< "SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='status';"`.

    This task is [BLOCKING] — without it, all Wave 1 tests that read/write `user.status` or `order.idempotencyKey` will fail at the database layer even though `pnpm typecheck` passes (types come from the generated client, not the live DB).
  </action>
  <verify>
    <automated>pnpm --filter frontend exec prisma migrate status 2>&amp;1 | grep -E "(up to date|No pending migrations|Database schema is up to date)"</automated>
  </verify>
  <acceptance_criteria>
    - `prisma migrate status` reports the dev DB is in sync OR `prisma db push` exit 0 confirmed
    - At least one migration file exists under `frontend/prisma/migrations/` whose name contains `phase3-admin-orders` (`find frontend/prisma/migrations -name "*phase3-admin-orders*" -type d | wc -l` returns ≥1) when migrate dev path is taken
    - The `User.status` column exists in the live DB (verified via `prisma db execute` SELECT against `information_schema.columns`)
  </acceptance_criteria>
  <done>Schema delta is live in the dev DB; subsequent waves can persist + query the new columns.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client→admin route | (Wave 0 lays the groundwork; full surface analyzed in subsequent plans) |
| dev shell→DB | Prisma migration runs as the developer; no untrusted input |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01-01 | Tampering | Migration script | mitigate | Migration is purely additive (default values + nullable) → rollback path is `prisma migrate resolve --rolled-back`; no destructive DDL allowed in this task |
| T-03-01-02 | Information Disclosure | admin-fixtures.ts | accept | Fixtures are dev/test only; never imported under `frontend/src/app/api/**` (verified by grep in Wave 1 plans) |
| T-03-01-03 | Denial of Service | enforceAdminRateLimit | mitigate | Hard cap 100 hits/min per userId; `redis === null` branch fails open in dev (acceptable — production sets the env). Verification: rate-limits/route.test.ts asserts the 429 path |
</threat_model>

<verification>
- `pnpm typecheck` exits 0
- `pnpm --filter frontend exec prisma generate` exits 0
- `pnpm --filter frontend exec prisma migrate status` confirms DB in sync
- `pnpm --filter frontend exec vitest run src/app/api/admin/ src/app/api/orders/ scripts/` runs (RED state expected — captured as Wave 0 baseline)
- `pnpm lint` exits 0 (no ESLint regressions in new helper files)
</verification>

<success_criteria>
- Schema has `User.status @default("ACTIVE")` + `Order.idempotencyKey @unique String?` and `@@index([status])`
- `pagination/paginate.ts` exports `clampLimit`, `DEFAULT_LIMIT=20`, `MAX_LIMIT=50`, `cursorWhere`, `buildPage` and re-exports `encodeCursor`/`decodeCursor`/`Cursor`
- `middleware/rate-limit-by-userid.ts` exports `enforceAdminRateLimit(userId)` returning 429 NextResponse | null with `rl:admin:userid:` keyspace
- `test-utils/admin-fixtures.ts` exports the 9 factories listed in VALIDATION.md
- 10 RED test files exist (8 admin + 1 orders + 1 script)
- DB has User.status + Order.idempotencyKey columns live
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-01-SUMMARY.md` with:
- Schema delta applied (which command path: migrate dev vs db push)
- Helpers extracted (paginate + rate-limit-by-userid)
- Test files seeded (count + RED count baseline)
- Any non-trivial deviation from the action block (e.g., RedisRateLimitStore constructor shape adjustment)
</output>
