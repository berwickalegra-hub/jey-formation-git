---
phase: 03-admin-organizations-orders
plan: 02
subsystem: admin-back-office-reads
tags: [admin, reads, pagination, rate-limit, wave-1]
dependency_graph:
  requires:
    - frontend/src/lib/server/middleware/index.ts (requireAdmin, PROTECTED)
    - frontend/src/lib/server/pagination/paginate.ts (Wave 0)
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts (Wave 0)
    - frontend/src/lib/server/observability/request-context.ts (PROTECTED)
    - frontend/src/test-utils/admin-fixtures.ts (Wave 0)
  provides:
    - GET /api/admin/users (list) [ADMIN-01 read]
    - GET /api/admin/users/[id] (detail) [ADMIN-01 read]
    - GET /api/admin/orders (list) [ADMIN-02]
    - GET /api/admin/withdrawals (list) [ADMIN-03 read path]
  affects:
    - frontend/src/app/api/admin/users/route.test.ts (RED → GREEN for list, todos preserved for Wave 2 PATCH)
    - frontend/src/app/api/admin/orders/route.test.ts (RED → GREEN for list)
    - frontend/src/app/api/admin/withdrawals/route.test.ts (RED → GREEN for list, cancel todos preserved)
tech_stack:
  added: []
  patterns:
    - "admin-read" canonical handler (Pattern 1 from 03-RESEARCH.md): runtime=nodejs → withRequestContext → requireAdmin('ADMIN') → enforceAdminRateLimit → cursor pagination
    - PII whitelist via Prisma `select` (excludes passwordHash/withdrawalPinHash/tokenVersion on User)
    - Cursor wire-format reuse with `requestedAt` aliasing for the Withdrawal model (no createdAt column)
key_files:
  created:
    - frontend/src/app/api/admin/users/route.ts
    - frontend/src/app/api/admin/users/[id]/route.ts
    - frontend/src/app/api/admin/users/[id]/route.test.ts
    - frontend/src/app/api/admin/orders/route.ts
    - frontend/src/app/api/admin/withdrawals/route.ts
  modified:
    - frontend/src/app/api/admin/users/route.test.ts
    - frontend/src/app/api/admin/orders/route.test.ts
    - frontend/src/app/api/admin/withdrawals/route.test.ts
decisions:
  - Re-used the shared `{ createdAt, id }` cursor wire-shape for withdrawals but bound it to `requestedAt` server-side (Withdrawal has no createdAt column per schema.prisma:327). Inlined an OR fragment + manual cursor emission rather than using `cursorWhere`/`buildPage` which both target `createdAt`.
  - q parameter clamped to 200 chars BEFORE Prisma `contains` (T-03-02-03 mitigation; D-LIST-02). Confirmed by an oversize-q test that asserts the contains.length stays at 200.
  - Empty `?status=` / `?role=` / `?since=` / `?until=` query params are omitted from the where-clause rather than passed as empty strings (would never match).
  - Malformed since/until dates silently ignored (no 400) per D-LIST-05 spirit — admin listings tolerate input rather than break the page.
metrics:
  tasks_planned: 3
  tasks_completed: 3
  duration_minutes: 6
  completed_at: 2026-05-08
commits:
  - 556e950 feat(03-02): admin users list + detail routes (ADMIN-01)
  - ee19517 feat(03-02): admin orders list route (ADMIN-02)
  - b739a17 feat(03-02): admin withdrawals list route (ADMIN-03 read path)
---

# Phase 3 Plan 2: Admin Reads (Users + Orders + Withdrawals) Summary

Four admin-read endpoints land behind `requireAdmin('ADMIN')` + `enforceAdminRateLimit` (D-ADMIN-05), each cursor-paginated via the Wave 0 `paginate.ts` helper, returning PII-safe whitelisted columns. 53 GREEN tests across 5 files; 9 it.todos intentionally preserved (Wave 2 mutations land in Plan 03-06).

## What Shipped

### Task 1 — Users list + detail (commit 556e950)

`frontend/src/app/api/admin/users/route.ts` — `GET /api/admin/users`:
- Filters: `?q` (case-insensitive contains on email + name, clamped to 200 chars), `?status` (ACTIVE|SUSPENDED), `?role` (USER|ADMIN|SUPERADMIN), `?cursor`, `?limit` (1..50, default 20)
- Orders by `[{ createdAt: 'desc' }, { id: 'desc' }]` for stable pagination across ties
- `USER_SELECT` whitelist: `id, email, name, avatarUrl, role, status, emailVerifiedAt, createdAt` — explicitly NOT passwordHash/withdrawalPinHash/tokenVersion (T-03-02-02)
- `take: limit + 1` + `buildPage` for nextCursor emission
- Empty result → `200 { items: [], nextCursor: null }` per D-LIST-05

`frontend/src/app/api/admin/users/[id]/route.ts` — `GET /api/admin/users/[id]`:
- Same gate stack + same USER_SELECT whitelist
- 404 with `USER_NOT_FOUND` stable code on miss (D-LIST response shape)

Tests: 8 GREEN list tests + 4 GREEN detail tests + 6 `it.todo` preserved for Wave 2 (role/status PATCH endpoints).

### Task 2 — Orders list (commit ee19517)

`frontend/src/app/api/admin/orders/route.ts` — `GET /api/admin/orders`:
- Filters: `?status` (PENDING|PAID|EXPIRED|FAILED|REFUNDED), `?since` / `?until` (inclusive on createdAt; malformed silently ignored), `?cursor`, `?limit`
- Orders by `[{ createdAt: 'desc' }, { id: 'desc' }]`
- `ORDER_SELECT` whitelist excludes `metadata` (often large; can be added back per project)

Tests: 8 GREEN tests covering happy path, status filter, since/until window, malformed-date tolerance, cursor +1 fetch, rate-limit propagation, 403 propagation.

### Task 3 — Withdrawals list (commit b739a17)

`frontend/src/app/api/admin/withdrawals/route.ts` — `GET /api/admin/withdrawals`:
- Filters: `?status` (PENDING|PROCESSING|COMPLETED|FAILED|CANCELLED), `?since` / `?until`, `?cursor`, `?limit`
- Orders by `[{ requestedAt: 'desc' }, { id: 'desc' }]` — Withdrawal has NO `createdAt` column (schema.prisma:327)
- Inline OR fragment binds the shared cursor's `createdAt` value to `requestedAt`; manual cursor emission via `encodeCursor({ createdAt: row.requestedAt, id: row.id })`
- `WITHDRAWAL_SELECT` includes `destination` JSON (phone PII) per D-ADMIN-03

Tests: 8 GREEN list tests including a cursor-shape test that asserts the OR-fragment uses `requestedAt` (not `createdAt`) and a round-trip test that decodes the emitted cursor back to the 20th row's `requestedAt`. Cancel suite (3 todos) preserved for Plan 03-06 — D-ADMIN-01 makes the cancel route SUPERADMIN-only and out-of-scope here.

## Verification

```
pnpm --filter frontend exec vitest run \
    src/app/api/admin/users/ src/app/api/admin/orders/ \
    src/app/api/admin/withdrawals/ \
    src/lib/server/observability/runtime-enforcement.test.ts
  → 5 files, 53 passed | 9 todo (62 total)

pnpm --filter frontend exec tsc --noEmit
  → 0 (clean — strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes)

pnpm --filter frontend exec eslint src/app/api/admin/{users,orders,withdrawals}/
  → 0 (clean)
```

`runtime-enforcement.test.ts` count went from 21 → 23 tests, proving the walker discovered our 3 new `route.ts` files and confirmed each declares `runtime = 'nodejs'`.

Acceptance grep checks (all PASSED):

| Check | Path | Expected | Actual |
|------|------|----------|--------|
| `runtime='nodejs'` | users/route.ts | 1 | 1 |
| `runtime='nodejs'` | users/[id]/route.ts | 1 | 1 |
| `requireAdmin('ADMIN')` | users/route.ts | ≥1 | 2 |
| `enforceAdminRateLimit` | users/route.ts | 1 | 3 |
| `withRequestContext` | users/route.ts | 1 | 3 |
| `mode: 'insensitive'` | users/route.ts | ≥1 | 2 |
| `runtime='nodejs'` | orders/route.ts | 1 | 1 |
| `requireAdmin('ADMIN')` | orders/route.ts | 1 | 1 |
| `enforceAdminRateLimit` | orders/route.ts | 1 | 2 |
| `createdAt` references | orders/route.ts | ≥2 | 3 |
| `runtime='nodejs'` | withdrawals/route.ts | 1 | 1 |
| `requireAdmin('ADMIN')` | withdrawals/route.ts | 1 | 1 |
| `enforceAdminRateLimit` | withdrawals/route.ts | 1 | 2 |
| `requestedAt` references | withdrawals/route.ts | ≥2 | 12 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `pnpm install` required before vitest could run**
- **Found during:** Task 1 verification (`pnpm --filter frontend exec vitest` returned `Command "vitest" not found`)
- **Issue:** This worktree was created without `node_modules`. Vitest binary needed to verify the GREEN tests for the per-task acceptance criterion.
- **Fix:** Ran `pnpm install --frozen-lockfile` once. Subsequent vitest invocations worked. Prisma client regenerated as part of postinstall, picking up the Wave 0 schema delta (User.status + Order.idempotencyKey).
- **Files modified:** none (node_modules is gitignored)
- **Commit:** n/a (not committed)

### Notable design choices (NOT deviations — within plan's Discretion)

- Added a 6-test detail suite at `users/[id]/route.test.ts` rather than rolling detail assertions into the LIST file. Cleaner separation; mirrors the existing `[id]/route.test.ts` patterns elsewhere in the repo.
- Added an extra "ignores oversized q" test to assert the 200-char clamp surface (T-03-02-03 mitigation). The plan flagged this in `<threat_model>` but didn't explicitly require a test — adding one makes the mitigation auditable.
- Added a "cursor decode-back" assertion in the withdrawals cursor test that decodes the emitted nextCursor and confirms `createdAt: row.requestedAt` aliasing — the trickiest invariant in Task 3 deserves a direct assertion.

## Authentication Gates

None. All four endpoints' auth and rate-limiter behavior are tested via mocks (`vi.mock('@/lib/server/middleware')` + `vi.mock('@/lib/server/middleware/rate-limit-by-userid')`), so no live JWT/Redis credentials are needed.

## Known Stubs

None — all four routes return real data shapes from Prisma. The `it.todo` blocks left in the test files are intentional and tracked:

- `users/route.test.ts`: 6 todos for `[id]/role` PATCH and `[id]/status` PATCH (Wave 2, Plan 03-06)
- `withdrawals/route.test.ts`: 3 todos for `[id]/cancel` POST (Wave 2, Plan 03-06; D-ADMIN-01 SUPERADMIN-only)

The plan's `<output>` block calls out the cancel-still-RED expectation explicitly.

## Threat Flags

None. All four routes consume already-known-trust-boundary surface (admin auth + Prisma reads with PII) — no new endpoints, auth paths, or trust boundaries beyond what the plan's `<threat_model>` enumerates.

## Self-Check: PASSED

- `frontend/src/app/api/admin/users/route.ts` — FOUND
- `frontend/src/app/api/admin/users/[id]/route.ts` — FOUND
- `frontend/src/app/api/admin/users/[id]/route.test.ts` — FOUND
- `frontend/src/app/api/admin/orders/route.ts` — FOUND
- `frontend/src/app/api/admin/withdrawals/route.ts` — FOUND
- `frontend/src/app/api/admin/users/route.test.ts` (modified) — FOUND
- `frontend/src/app/api/admin/orders/route.test.ts` (modified) — FOUND
- `frontend/src/app/api/admin/withdrawals/route.test.ts` (modified) — FOUND
- Commit 556e950 — FOUND
- Commit ee19517 — FOUND
- Commit b739a17 — FOUND
- 53 vitest tests GREEN; 9 todos preserved
- `tsc --noEmit` exits 0
- `eslint src/app/api/admin/{users,orders,withdrawals}/` exits 0
