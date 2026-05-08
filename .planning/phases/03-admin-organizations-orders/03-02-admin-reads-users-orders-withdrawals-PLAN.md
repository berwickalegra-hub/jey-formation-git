---
phase: 03-admin-organizations-orders
plan: 02
type: execute
wave: 1
depends_on: [01]
files_modified:
  - frontend/src/app/api/admin/users/route.ts
  - frontend/src/app/api/admin/users/[id]/route.ts
  - frontend/src/app/api/admin/orders/route.ts
  - frontend/src/app/api/admin/withdrawals/route.ts
autonomous: true
requirements: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-05]
must_haves:
  truths:
    - GET /api/admin/users?q=test returns paginated users for ADMIN role
    - GET /api/admin/users/[id] returns full user object for ADMIN role
    - GET /api/admin/orders returns paginated orders with status/since/until filters
    - GET /api/admin/withdrawals returns paginated withdrawals with status/since/until filters
    - Every admin GET applies enforceAdminRateLimit (returns 429 TOO_MANY_REQUESTS after 100/min/userId)
    - All four routes export `runtime = 'nodejs'` and wrap handlers in withRequestContext
    - Empty result returns 200 { items: [], nextCursor: null } — never 404 (D-LIST-05)
  artifacts:
    - path: frontend/src/app/api/admin/users/route.ts
      provides: GET admin users listing (search + filter + cursor)
      exports: ['runtime', 'GET']
    - path: frontend/src/app/api/admin/users/[id]/route.ts
      provides: GET admin user detail
      exports: ['runtime', 'GET']
    - path: frontend/src/app/api/admin/orders/route.ts
      provides: GET admin orders listing (status/since/until + cursor)
      exports: ['runtime', 'GET']
    - path: frontend/src/app/api/admin/withdrawals/route.ts
      provides: GET admin withdrawals listing (status/since/until + cursor)
      exports: ['runtime', 'GET']
  key_links:
    - from: frontend/src/app/api/admin/users/route.ts
      to: frontend/src/lib/server/middleware/index.ts
      via: requireAdmin('ADMIN')
      pattern: 'requireAdmin'
    - from: frontend/src/app/api/admin/users/route.ts
      to: frontend/src/lib/server/pagination/paginate.ts
      via: clampLimit + cursorWhere + buildPage + decodeCursor
      pattern: 'pagination/paginate'
    - from: frontend/src/app/api/admin/users/route.ts
      to: frontend/src/lib/server/middleware/rate-limit-by-userid.ts
      via: enforceAdminRateLimit(auth.admin.id)
      pattern: 'enforceAdminRateLimit'
---

<objective>
Wave 1 — implement the four "vanilla read" admin listings: users (list + detail), orders (list), withdrawals (list). All four are gated by `requireAdmin('ADMIN')` (PII access is allowed per D-ADMIN-03), use cursor pagination via the Wave 0 paginate helper, and enforce the per-userId admin rate limit (D-ADMIN-05).

Purpose: Cover ADMIN-01 (read paths), ADMIN-02, ADMIN-03 (read path), and the rate-limit invariant of ADMIN-05. Mutations land in Plan 03-06.

Output: 4 route files implementing the canonical "admin-read" pattern from RESEARCH.md Pattern 1.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/03-admin-organizations-orders/03-CONTEXT.md
@.planning/phases/03-admin-organizations-orders/03-RESEARCH.md
@frontend/src/app/api/notifications/route.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/src/lib/server/pagination/paginate.ts
@frontend/src/lib/server/middleware/rate-limit-by-userid.ts
@CLAUDE.md

<interfaces>
From frontend/src/lib/server/middleware/index.ts (verified line 30-148):
```typescript
export interface AuthContext { user: { sub: string; email: string }; ... }
export interface AdminContext extends AuthContext { admin: { id: string; email: string; role: 'ADMIN' | 'SUPERADMIN' } }
export async function requireAdmin(min: 'ADMIN' | 'SUPERADMIN'): Promise<AdminContext | NextResponse>;
```

From frontend/src/lib/server/pagination/paginate.ts (Wave 0):
```typescript
export function clampLimit(raw: string | null): number;
export function cursorWhere(cursor: Cursor | null): Record<string, unknown>;
export function buildPage<T extends { id: string; createdAt: Date }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null };
export function decodeCursor(raw: string | null | undefined): Cursor | null;
```

From frontend/src/lib/server/middleware/rate-limit-by-userid.ts (Wave 0):
```typescript
export async function enforceAdminRateLimit(userId: string): Promise<NextResponse | null>;
```

From frontend/prisma/schema.prisma (post Wave 0): User has `role` and `status` columns; Order has `idempotencyKey` (not used in this plan but visible).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: GET /api/admin/users (list) + GET /api/admin/users/[id] (detail)</name>
  <files>frontend/src/app/api/admin/users/route.ts, frontend/src/app/api/admin/users/[id]/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/users/route.test.ts (Wave 0 RED scaffolding — drives behavior)
    - frontend/src/app/api/notifications/route.ts (Phase 2 cursor-paged reference — exact wrapping pattern)
    - frontend/src/lib/server/middleware/index.ts (requireAdmin signature)
    - frontend/src/lib/server/pagination/paginate.ts (Wave 0 helpers)
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts (Wave 0 helper)
    - frontend/src/lib/server/observability/request-context.ts (makeRequestContext + withRequestContext)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Endpoint Inventory" §1a/1b + Pattern 1
  </read_first>
  <behavior>
    - LIST: GET `/api/admin/users` with optional `?q` (max 200 chars, contains both `email` and `name` case-insensitive — Prisma `mode: 'insensitive'`), `?status=ACTIVE|SUSPENDED`, `?role=USER|ADMIN|SUPERADMIN`, `?cursor=<base64>`, `?limit=1..50` (default 20). Returns `200 { items: User[], nextCursor: string | null }`. Empty → `200 { items: [], nextCursor: null }`. ADMIN role suffices.
    - LIST excludes sensitive fields not needed for the admin UI: `passwordHash`, `withdrawalPinHash`, `tokenVersion`. Returns `id, email, name, avatarUrl, role, status, emailVerifiedAt, createdAt`.
    - DETAIL: GET `/api/admin/users/[id]` returns `200 { user }` for an existing user; `404 { error: 'USER_NOT_FOUND' }` otherwise. Same field whitelist as LIST.
    - Both routes: `requireAdmin('ADMIN')` gate; `enforceAdminRateLimit` BEFORE the gate's auth lookup (cheap path first); wrap handler body in `withRequestContext`; export `runtime = 'nodejs'` first.
    - Returning 429 from rate-limit must NOT touch the DB.
  </behavior>
  <action>
    Create both files using RESEARCH.md Pattern 1 verbatim.

    **`frontend/src/app/api/admin/users/route.ts`** — list endpoint:
    ```typescript
    export const runtime = 'nodejs';

    import 'server-only';
    import { NextResponse, type NextRequest } from 'next/server';
    import type { Prisma } from '@prisma/client';
    import { requireAdmin } from '@/lib/server/middleware';
    import { prisma } from '@/lib/server/prisma';
    import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
    import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
    import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

    const USER_SELECT = {
      id: true, email: true, name: true, avatarUrl: true,
      role: true, status: true, emailVerifiedAt: true, createdAt: true,
    } as const satisfies Prisma.UserSelect;

    export async function GET(req: NextRequest): Promise<NextResponse> {
      const ctx = makeRequestContext(req.headers);
      return withRequestContext(ctx, async () => {
        const auth = await requireAdmin('ADMIN');
        if (auth instanceof NextResponse) return auth;

        const limited = await enforceAdminRateLimit(auth.admin.id);
        if (limited) return limited;

        const url = req.nextUrl;
        const limit = clampLimit(url.searchParams.get('limit'));
        const q = (url.searchParams.get('q') ?? '').slice(0, 200).trim();
        const status = url.searchParams.get('status');
        const role = url.searchParams.get('role');
        const cursor = decodeCursor(url.searchParams.get('cursor'));

        const where: Prisma.UserWhereInput = {
          ...(q ? { OR: [
            { email: { contains: q, mode: 'insensitive' } },
            { name:  { contains: q, mode: 'insensitive' } },
          ] } : {}),
          ...(status ? { status } : {}),
          ...(role ? { role } : {}),
          ...cursorWhere(cursor),
        };

        const rows = await prisma.user.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          select: USER_SELECT,
        });

        const page = buildPage(rows, limit);
        return NextResponse.json(page, { headers: { 'x-request-id': ctx.requestId } });
      });
    }
    ```

    **`frontend/src/app/api/admin/users/[id]/route.ts`** — detail endpoint mirrors the wrapper pattern but does a `findUnique`:
    ```typescript
    export const runtime = 'nodejs';

    import 'server-only';
    import { NextResponse, type NextRequest } from 'next/server';
    import { requireAdmin } from '@/lib/server/middleware';
    import { prisma } from '@/lib/server/prisma';
    import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
    import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

    export async function GET(
      req: NextRequest,
      ctx: { params: Promise<{ id: string }> },
    ): Promise<NextResponse> {
      const reqCtx = makeRequestContext(req.headers);
      return withRequestContext(reqCtx, async () => {
        const auth = await requireAdmin('ADMIN');
        if (auth instanceof NextResponse) return auth;

        const limited = await enforceAdminRateLimit(auth.admin.id);
        if (limited) return limited;

        const { id } = await ctx.params;
        const user = await prisma.user.findUnique({
          where: { id },
          select: { id: true, email: true, name: true, avatarUrl: true, role: true, status: true, emailVerifiedAt: true, createdAt: true },
        });
        if (!user) return NextResponse.json({ error: 'USER_NOT_FOUND' }, { status: 404 });
        return NextResponse.json({ user });
      });
    }
    ```

    Then make the Wave 0 RED tests in `users/route.test.ts` GREEN by mocking `requireAdmin` (return an `AdminContext`) and `enforceAdminRateLimit` (return null), seeding two users via `seedAdmin()` + a regular `seedUser`-equivalent, asserting:
    - 200 + items array sorted by createdAt DESC
    - `?q=foo` filters to email/name contains foo (insensitive)
    - `?status=SUSPENDED` filters
    - `?limit=2` then follow `nextCursor` returns the next page
    - 401/403 from `requireAdmin` propagates
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/users/route.ts` and `frontend/src/app/api/admin/users/[id]/route.ts` exist
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/users/route.ts` returns 1 and same for `[id]/route.ts`
    - `grep -c "requireAdmin\('ADMIN'\)" frontend/src/app/api/admin/users/route.ts` returns 1
    - `grep -c "enforceAdminRateLimit" frontend/src/app/api/admin/users/route.ts` returns 1
    - `grep -c "withRequestContext" frontend/src/app/api/admin/users/route.ts` returns 1
    - `grep -c 'mode: .insensitive.' frontend/src/app/api/admin/users/route.ts` returns ≥1
    - `pnpm --filter frontend exec vitest run src/app/api/admin/users/route.test.ts` exits 0
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0 (proves both new files declare runtime='nodejs')
  </acceptance_criteria>
  <done>List + detail endpoints implemented; users/route.test.ts green; runtime-enforcement test still green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: GET /api/admin/orders (list with status/since/until filters)</name>
  <files>frontend/src/app/api/admin/orders/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/orders/route.test.ts (Wave 0 RED scaffolding)
    - frontend/src/app/api/admin/users/route.ts (Task 1 reference — mirror the wrapper)
    - frontend/prisma/schema.prisma — Order model (lines 270-301)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Endpoint Inventory" §2 + D-LIST-03
  </read_first>
  <behavior>
    - GET `/api/admin/orders` with optional `?status=PENDING|PAID|EXPIRED|FAILED|REFUNDED`, `?since=<ISO date>`, `?until=<ISO date>`, `?cursor`, `?limit=1..50`. Returns `200 { items: Order[], nextCursor }`. Empty → `200 { items: [], nextCursor: null }`. ADMIN role suffices.
    - `since`/`until` are inclusive on `createdAt`; both optional; if invalid date string → silently ignored (do not 400; D-LIST-05 spirit — admin listings tolerate input).
    - Field whitelist: `id, userId, amount, currency, status, customerEmail, provider, providerChargeId, paymentUrl, paymentMethod, expiresAt, paidAt, createdAt`. Exclude `metadata` (often large; can be added later if needed).
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/orders/route.ts` mirroring Task 1's structure. Concrete `where` shape:
    ```typescript
    const since = parseDate(url.searchParams.get('since'));
    const until = parseDate(url.searchParams.get('until'));
    const where: Prisma.OrderWhereInput = {
      ...(status ? { status } : {}),
      ...(since || until ? { createdAt: {
        ...(since ? { gte: since } : {}),
        ...(until ? { lte: until } : {}),
      } } : {}),
      ...cursorWhere(cursor),
    };
    ```
    where `parseDate` is a local helper:
    ```typescript
    function parseDate(raw: string | null): Date | null {
      if (!raw) return null;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    ```
    Field select object as listed in `<behavior>`.

    Make the Wave 0 RED test in `orders/route.test.ts` GREEN — assertions:
    - 200 + items sorted createdAt DESC
    - `?status=PAID` filters to paid orders only
    - `?since=2026-01-01&until=2026-12-31` filters to that window (seed orders inside + outside the window)
    - cursor follow-up returns subsequent page
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/orders/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/orders/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/orders/route.ts` returns 1
    - `grep -c "requireAdmin\('ADMIN'\)" frontend/src/app/api/admin/orders/route.ts` returns 1
    - `grep -c "enforceAdminRateLimit" frontend/src/app/api/admin/orders/route.ts` returns 1
    - `grep -c "createdAt" frontend/src/app/api/admin/orders/route.ts` returns ≥2 (in select + in `where.createdAt`)
    - `pnpm --filter frontend exec vitest run src/app/api/admin/orders/route.test.ts` exits 0
  </acceptance_criteria>
  <done>Orders listing implemented; orders/route.test.ts green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GET /api/admin/withdrawals (list with status/since/until filters)</name>
  <files>frontend/src/app/api/admin/withdrawals/route.ts</files>
  <read_first>
    - frontend/src/app/api/admin/withdrawals/route.test.ts (Wave 0 RED scaffolding — note this file ALSO has placeholder cancel tests; only the LIST part is implemented in this task; cancel lands in Plan 03-06)
    - frontend/src/app/api/admin/orders/route.ts (Task 2 reference)
    - frontend/prisma/schema.prisma — Withdrawal model (lines 303-324)
    - .planning/phases/03-admin-organizations-orders/03-RESEARCH.md "Endpoint Inventory" §3a + D-LIST-03
  </read_first>
  <behavior>
    - GET `/api/admin/withdrawals` with optional `?status=PENDING|PROCESSING|COMPLETED|FAILED|CANCELLED`, `?since=<ISO>`, `?until=<ISO>`, `?cursor`, `?limit=1..50`. Returns `200 { items: Withdrawal[], nextCursor }`. ADMIN role suffices for read.
    - Order by `requestedAt DESC, id DESC` (note: Withdrawal's primary timestamp is `requestedAt`, not `createdAt` — schema line 317). For cursor compatibility, alias the cursor's `createdAt` ↔ `requestedAt` at the where-clause level: emit cursor from `{ createdAt: row.requestedAt, id: row.id }` and apply the cursor filter against `requestedAt` (NOT `createdAt`).
    - Field select: `id, userId, amount, currency, status, destination, provider, providerPayoutId, failureReason, requestedAt, processedAt, completedAt`. Note `destination` is JSON containing PII (phone numbers) — D-ADMIN-03 allows admin to see it.
  </behavior>
  <action>
    Create `frontend/src/app/api/admin/withdrawals/route.ts`. Because `Withdrawal.requestedAt` plays the role of `createdAt`, write a small inline cursor adapter rather than using `cursorWhere` blindly:

    ```typescript
    // Withdrawal uses requestedAt as the primary timestamp, not createdAt.
    // We re-use the same Cursor shape (createdAt + id) but apply it to requestedAt.
    const where: Prisma.WithdrawalWhereInput = {
      ...(status ? { status } : {}),
      ...(since || until ? { requestedAt: {
        ...(since ? { gte: since } : {}),
        ...(until ? { lte: until } : {}),
      } } : {}),
      ...(cursor ? { OR: [
        { requestedAt: { lt: cursor.createdAt } },
        { requestedAt: cursor.createdAt, id: { lt: cursor.id } },
      ] } : {}),
    };

    const rows = await prisma.withdrawal.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { /* whitelist */ },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ createdAt: last.requestedAt, id: last.id })
      : null;
    ```
    Import `encodeCursor` from `@/lib/server/pagination/paginate` (re-exported in Wave 0).

    Make the LIST portion of `withdrawals/route.test.ts` GREEN. The cancel tests in that same file remain RED until Plan 03-06 — note this in the SUMMARY.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/admin/withdrawals/route.test.ts -t "GET"</automated>
  </verify>
  <acceptance_criteria>
    - `frontend/src/app/api/admin/withdrawals/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/admin/withdrawals/route.ts` returns 1
    - `grep -c "requireAdmin\('ADMIN'\)" frontend/src/app/api/admin/withdrawals/route.ts` returns 1
    - `grep -c "enforceAdminRateLimit" frontend/src/app/api/admin/withdrawals/route.ts` returns 1
    - `grep -c "requestedAt" frontend/src/app/api/admin/withdrawals/route.ts` returns ≥2 (in orderBy + in cursor branch)
    - `pnpm --filter frontend exec vitest run src/app/api/admin/withdrawals/route.test.ts -t "GET"` exits 0
  </acceptance_criteria>
  <done>Withdrawals listing implemented; LIST tests green; cancel tests still RED (intentional — Plan 03-06).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → admin GET routes | Authenticated cookie session crossing into ADMIN-scoped queries |
| admin → DB | Prisma queries with PII fields (email, phone in withdrawal.destination) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-02-01 | Elevation of Privilege | All four GET routes | mitigate | `requireAdmin('ADMIN')` re-reads role from DB on every request (verified in middleware/index.ts:111) — in-flight role demotion takes effect on next request. Verification: routes/users/route.test.ts asserts non-admin → 403. |
| T-03-02-02 | Information Disclosure | users LIST select | mitigate | `USER_SELECT` whitelist excludes `passwordHash`, `withdrawalPinHash`, `tokenVersion`. Verification: `grep -c "passwordHash" frontend/src/app/api/admin/users/route.ts` returns 0. |
| T-03-02-03 | Tampering (SQL injection) | `?q` search param | mitigate | Prisma parametric `contains` — never raw SQL. `?q` is also clamped to 200 chars (D-LIST-02). |
| T-03-02-04 | Denial of Service | Cursor pagination on huge user table | mitigate | `clampLimit` enforces max 50; cursor is base64 JSON validated by `decodeCursor` (returns null on tamper). |
| T-03-02-05 | Denial of Service | Burst from a single admin | mitigate | `enforceAdminRateLimit(auth.admin.id)` returns 429 after 100/min/userId. Verification: `grep -c "enforceAdminRateLimit" frontend/src/app/api/admin/users/route.ts` returns 1. |
| T-03-02-06 | Information Disclosure | withdrawals.destination JSON contains phone numbers | accept | D-ADMIN-03 explicitly allows ADMINs to read PII (no extra VIEW_PII audit). Documented in CONTEXT.md. |
</threat_model>

<verification>
- All 4 route files exist with `runtime = 'nodejs'`
- `pnpm --filter frontend exec vitest run src/app/api/admin/users/ src/app/api/admin/orders/ src/app/api/admin/withdrawals/` — list tests green; withdrawals cancel tests RED (expected, Plan 03-06)
- `pnpm typecheck && pnpm lint` exit 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
</verification>

<success_criteria>
- ADMIN can read users (list + detail), orders (list), withdrawals (list)
- All four routes export `runtime = 'nodejs'`, gate via `requireAdmin('ADMIN')`, apply `enforceAdminRateLimit`, wrap in `withRequestContext`
- `?q` search on users is case-insensitive on email + name (Prisma contains)
- Cursor pagination round-trips correctly across limit boundaries
- Empty result returns `200 { items: [], nextCursor: null }` (never 404)
</success_criteria>

<output>
After completion, create `.planning/phases/03-admin-organizations-orders/03-02-SUMMARY.md` documenting:
- 4 route files created
- Any deviation in cursor handling (especially the Withdrawal.requestedAt aliasing)
- Test count green / RED breakdown (cancel still RED)
</output>
