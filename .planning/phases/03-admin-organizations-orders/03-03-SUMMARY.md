---
phase: 03-admin-organizations-orders
plan: 03
subsystem: admin-back-office
tags: [admin, audit-log, capability-probe, rate-limit, wave-1]
dependency_graph:
  requires:
    - frontend/src/lib/server/pagination/paginate.ts (Wave 0)
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts (Wave 0)
    - frontend/src/lib/server/middleware/index.ts (PROTECTED — requireAdmin)
    - frontend/src/lib/server/observability/request-context.ts
    - frontend/prisma/schema.prisma (AdminAction model — already shipped)
  provides:
    - GET /api/admin/audit-log endpoint (ADMIN-04)
    - GET /api/admin/me endpoint (ADMIN-05)
    - CAPABILITIES_BY_ROLE locked-shape contract for back-office UIs
  affects:
    - frontend/src/app/api/admin/audit-log/route.test.ts (it.todo → real it)
    - frontend/src/app/api/admin/me/route.test.ts (it.todo → real it)
tech_stack:
  added: []
  patterns:
    - Wrapper pattern: makeRequestContext + withRequestContext + requireAdmin('ADMIN') + enforceAdminRateLimit composition
    - Cursor pagination via Wave 0 paginate helper (clampLimit/cursorWhere/buildPage)
    - Capability list as `as const`-typed Record keyed by role
key_files:
  created:
    - frontend/src/app/api/admin/audit-log/route.ts
    - frontend/src/app/api/admin/me/route.ts
  modified:
    - frontend/src/app/api/admin/audit-log/route.test.ts (replaced 3 todos with 15 real tests)
    - frontend/src/app/api/admin/me/route.test.ts (replaced 4 todos with 10 real tests)
decisions:
  - Used `auth.admin.role as 'ADMIN' | 'SUPERADMIN'` cast in /me — `AdminContext.admin.role` is typed `AdminRole = USER | ADMIN | SUPERADMIN` but `requireAdmin('ADMIN')` excludes USER at runtime; the cast teaches TS what the contract guarantees. Alternative (narrowing requireAdmin's return type) would touch a PROTECTED middleware file.
  - Used `vi.mock('@/lib/server/middleware/rate-limit-by-userid')` to stub `enforceAdminRateLimit` per test rather than mocking redis — keeps tests fast and the rate-limit-store contract (already covered elsewhere) decoupled.
  - Source-invariant test for /me strips comments before counting capability tokens so the docstring listing the SUPERADMIN-only caps doesn't inflate the "appears once" check (Rule 1 fix during Task 2).
metrics:
  tasks_planned: 2
  tasks_completed: 2
  duration_minutes: 8
  completed_at: 2026-05-08
  test_count: 25  # 15 audit-log + 10 me
requirements: [ADMIN-04, ADMIN-05]
---

# Phase 3 Plan 3: Admin Audit-Log + /me + Rate-Limit Summary

Two thin admin endpoints land: `GET /api/admin/audit-log` (paginated, filterable read of AdminAction rows for incident triage) and `GET /api/admin/me` (capability probe returning the role-keyed `can` array). Both gate at `requireAdmin('ADMIN')` and apply per-userId rate limiting. 25 RED tests converted to GREEN.

## What Shipped

### Task 1 — `GET /api/admin/audit-log` (commit 4bf7005)

`frontend/src/app/api/admin/audit-log/route.ts` (94 LOC):

- `runtime='nodejs'`, wraps body in `withRequestContext`
- `requireAdmin('ADMIN')` + `enforceAdminRateLimit(auth.admin.id)` gates (bail-on-NextResponse pattern)
- D-AUDIT-01 filters: `?actor` (exact `actorId`), `?action` (exact dotted-string), `?targetType` (exact column match), `?since` / `?until` (ISO 8601 → `createdAt` `gte`/`lte`); invalid dates silently ignored
- Cursor pagination via Wave 0 `paginate.ts`: `clampLimit` (default 20, max 50), `cursorWhere(cursor)` for the OR fragment, `buildPage(rows, limit)` for slice + `nextCursor`
- Field select: full incident-triage shape — `id, actorId, action, targetType, targetId, metadata, ip, userAgent, createdAt`
- `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` (matches `@@index([actorId, createdAt])`)
- Response includes `x-request-id` header from request context

`frontend/src/app/api/admin/audit-log/route.test.ts` — 15 tests (was 3 `it.todo`s):
- 401/403 forwarding, 429 rate-limit gate, empty-result shape, 11-row pagination + cursor decode, all 5 filters individually + combined, invalid-date silent ignore, cursor `OR` clause structure, `orderBy/take` shape, full select shape, `x-request-id` header, source invariants (`runtime='nodejs'`, `requireAdmin('ADMIN')`, `enforceAdminRateLimit`, `prisma.adminAction.findMany`, `withRequestContext`)

### Task 2 — `GET /api/admin/me` (commit 2dfc324)

`frontend/src/app/api/admin/me/route.ts` (84 LOC):

- `runtime='nodejs'`, wraps body in `withRequestContext`
- `requireAdmin('ADMIN')` + `enforceAdminRateLimit(auth.admin.id)` gates
- `CAPABILITIES_BY_ROLE` is a `readonly`-typed `Record<'ADMIN' | 'SUPERADMIN', readonly string[]>`:
  - **ADMIN (8):** `users:read, users:status:suspend, orders:read, withdrawals:read, audit-log:read, outbox:read, email-queue:read, rate-limits:read`
  - **SUPERADMIN (11):** ADMIN's 8 + `users:role`, `users:status:restore`, `withdrawals:cancel`
- Returns `{ admin: { id, email, role }, can: string[] }`
- T-03-03-03 mitigation documented in route docstring: capability list is presentational hint; every mutating route re-checks role server-side

`frontend/src/app/api/admin/me/route.test.ts` — 10 tests (was 4 `it.todo`s):
- ADMIN exact 8-item list match
- SUPERADMIN broader list contains 3 SUPERADMIN-only caps (`users:role`, `withdrawals:cancel`, `users:status:restore`)
- SUPERADMIN exact 11-item list match
- 401 (unauthenticated) skips rate-limit
- 403 USER (ADMIN_REQUIRED) skips rate-limit
- 429 after auth passes
- rate-limit called with admin userId (not email/role)
- ADMIN list does NOT contain any of the 3 SUPERADMIN-only caps
- Source invariants — runtime + auth + rate-limit + `CAPABILITIES_BY_ROLE` + `withRequestContext`
- Source invariants — each SUPERADMIN-only capability appears exactly once in code (comments stripped before counting)

## Verification

```
pnpm --filter frontend exec vitest run src/app/api/admin/audit-log/route.test.ts
                              → 15/15 passed
pnpm --filter frontend exec vitest run src/app/api/admin/me/route.test.ts
                              → 10/10 passed
pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts
                              → 21/21 passed (incl. both new routes)
pnpm typecheck                → clean for plan-03-03 files
                                (one pre-existing error in src/app/api/orders/route.ts from
                                 parallel agent's commit 5d25e93 — out of scope)
pnpm --filter frontend exec eslint <plan-03-03 files>
                              → clean
```

Acceptance grep checks (all matched):

| File | Check | Count | Required |
|------|-------|-------|----------|
| audit-log/route.ts | `export const runtime = 'nodejs'` | 1 | 1 ✓ |
| audit-log/route.ts | `requireAdmin('ADMIN')` | 1 | 1 ✓ |
| audit-log/route.ts | `enforceAdminRateLimit` | 2 | ≥1 ✓ (import + call) |
| audit-log/route.ts | `prisma.adminAction.findMany` | 1 | 1 ✓ |
| me/route.ts | `CAPABILITIES_BY_ROLE` | 3 | ≥2 ✓ |
| me/route.ts | `'users:role'` (code only, comments stripped) | 1 | 1 ✓ |
| me/route.ts | `'withdrawals:cancel'` (code only, comments stripped) | 1 | 1 ✓ |
| me/route.ts | `'users:status:restore'` (code only, comments stripped) | 1 | 1 ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AdminContext.admin.role typed `USER | ADMIN | SUPERADMIN` breaks `CAPABILITIES_BY_ROLE` indexing**
- **Found during:** Task 2 typecheck (`pnpm typecheck` after route shipped GREEN)
- **Issue:** `requireAdmin('ADMIN')` returns `AdminContext` whose `.admin.role: AdminRole = 'USER' | 'ADMIN' | 'SUPERADMIN'` (per `frontend/src/lib/server/middleware/require-admin.ts:12`). At runtime the value is narrowed to `ADMIN | SUPERADMIN` because `requireAdmin('ADMIN')` 403s on USER, but TypeScript doesn't see that. Indexing `CAPABILITIES_BY_ROLE: Record<'ADMIN' | 'SUPERADMIN', readonly string[]>` with `AdminRole` therefore fails (`Property 'USER' does not exist`).
- **Fix:** Cast `auth.admin.role as 'ADMIN' | 'SUPERADMIN'` at the call site with a comment pointing to the runtime contract that `requireAdmin('ADMIN')` enforces. Alternative (changing `AdminContext.admin.role` to a generic-narrowed type) would have required modifying `frontend/src/lib/server/middleware/index.ts` — a PROTECTED file per CLAUDE.md.
- **Files modified:** `frontend/src/app/api/admin/me/route.ts`
- **Commit:** 2dfc324 (single commit captures the fix + initial route together)

**2. [Rule 1 - Bug] /me source-invariant test triple-counted capability tokens via comments**
- **Found during:** Task 2 first vitest run after implementation
- **Issue:** The plan's acceptance check `grep -c 'withdrawals:cancel' route.ts` returns `2` because the route docstring lists the SUPERADMIN-only capabilities (correctly, per plan instructions to document the contract). My test asserted `===1` and failed.
- **Fix:** Strip line- and block-comments from the source string before counting `'<cap>'` occurrences. The semantic intent of the acceptance check is "appears in SUPERADMIN list only, not in ADMIN list" — the comment count is irrelevant.
- **Files modified:** `frontend/src/app/api/admin/me/route.test.ts`
- **Commit:** 2dfc324

### Out-of-scope discoveries (NOT fixed)

- `frontend/src/app/api/orders/route.ts` (committed by parallel agent at `5d25e93`) typechecks against a Prisma client that does NOT yet include `Order.idempotencyKey` (the schema delta from Wave 0 commit `a9d1d2d` was applied to the Prisma model but the migration push was deferred — Wave 0 SUMMARY.md "Deferred Issues" section). Two errors:
  - `route.ts:84` — `idempotencyKey` on `OrderWhereUniqueInput`
  - `route.ts:150` — `idempotencyKey` on `OrderCreateInput`
- These are owned by Plan 03-04 (orders endpoint) or by the user re-running `pnpm --filter frontend exec prisma generate` once `frontend/.env` is provisioned. Out of scope for plan 03-03 per the deviation Rule 4 / scope-boundary guidance.

## Authentication Gates

None.

## Known Stubs

None — both routes are fully wired. `CAPABILITIES_BY_ROLE` is a static const by design (D-ADMIN-04 says "informational hint computed from role" — there is no per-user override). No empty arrays / null props flow to UI.

## Threat Flags

None — all surface introduced is in the plan's `<threat_model>` (T-03-03-01..04). No new auth paths, no new file access, no schema changes at trust boundaries.

## Self-Check: PASSED

- `frontend/src/app/api/admin/audit-log/route.ts` — FOUND
- `frontend/src/app/api/admin/me/route.ts` — FOUND
- `frontend/src/app/api/admin/audit-log/route.test.ts` (modified) — FOUND
- `frontend/src/app/api/admin/me/route.test.ts` (modified) — FOUND
- Commit `4bf7005` (audit-log feat) — FOUND
- Commit `2dfc324` (me feat) — FOUND
- 25 plan tests passing (15 audit-log + 10 me)
- 21 runtime-enforcement tests still passing (both new routes counted)
