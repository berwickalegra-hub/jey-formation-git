---
phase: 03-admin-organizations-orders
plan: 06
subsystem: admin-back-office-mutations
tags: [admin, mutations, audit, advisory-lock, serializable, wave-2]
dependency_graph:
  requires:
    - frontend/src/lib/server/admin/audit.ts (logAdminAction, PROTECTED)
    - frontend/src/lib/server/middleware/index.ts (requireAdmin/requireSuperadmin, PROTECTED)
    - frontend/src/lib/server/withdrawals/lock.ts (lockUserTx, PROTECTED)
    - frontend/src/lib/server/auth.ts (verifyCsrf, PROTECTED)
    - frontend/src/lib/server/middleware/rate-limit-by-userid.ts (Wave 0)
    - frontend/src/lib/server/observability/request-context.ts (PROTECTED)
    - frontend/src/test-utils/admin-fixtures.ts (Wave 0)
  provides:
    - PATCH /api/admin/users/[id]/role (ADMIN-01 mutate, SUPERADMIN-only, last-superadmin guard)
    - PATCH /api/admin/users/[id]/status (ADMIN-01 + D-ADMIN-02, ADMIN suspend, SUPERADMIN restore)
    - POST /api/admin/withdrawals/[id]/cancel (ADMIN-03 mutate, SUPERADMIN-only, race-free)
  affects:
    - frontend/src/app/api/admin/users/route.test.ts (6 role todos + 3 status todos → 15 GREEN tests)
    - frontend/src/app/api/admin/withdrawals/route.test.ts (3 cancel todos → 7 GREEN tests)
tech_stack:
  added: []
  patterns:
    - Atomic COUNT + UPDATE inside same prisma.$transaction (CF-09 / Pitfall 1) — last-SUPERADMIN race-free guard
    - Idempotent same-status no-op on PATCH /status — short-circuits BEFORE writing AdminAction (T-03-06-08)
    - Two-phase lookup for advisory lock — read userId outside lock, then acquire lockUserTx as FIRST statement inside Serializable tx (CLAUDE.md "Withdrawals are race-free")
    - Discriminated-union return type from prisma.$transaction callback for typed branching after the tx closes
key_files:
  created:
    - frontend/src/app/api/admin/users/[id]/role/route.ts
    - frontend/src/app/api/admin/users/[id]/status/route.ts
    - frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts
  modified:
    - frontend/src/app/api/admin/users/route.test.ts
    - frontend/src/app/api/admin/withdrawals/route.test.ts
decisions:
  - All three routes use a discriminated-union (`{ kind: 'NOT_FOUND' | 'LAST_SUPERADMIN' | 'OK', ... }`) returned from the $transaction callback so the route maps to NextResponse OUTSIDE the tx. Keeps tx body pure-DB and typed.
  - PATCH /status: idempotent same-status PATCH returns 200 + the existing user shape WITHOUT writing AdminAction. Mitigates T-03-06-08 (audit-log noise).
  - POST /cancel: two-phase lookup. Phase-1 read of `userId` happens OUTSIDE the lock because we need the lock key before entering the locked region. Phase-2 re-fetch under the lock catches status flips that happened while waiting.
  - POST /cancel uses `Prisma.TransactionIsolationLevel.Serializable` (typed import) rather than the bare string literal — matches the action-block spec in 03-06-PLAN.md.
  - Ran the planned route-grep + typecheck + lint locally; all clean (cancel route lockUserTx=5, Serializable=4, exceeding ≥2 / =1 thresholds).
metrics:
  tasks_planned: 3
  tasks_completed: 3
  duration_minutes: 6
  completed_at: 2026-05-08
commits:
  - ad6fb7d feat(03-06): PATCH /api/admin/users/[id]/role — SUPERADMIN with last-superadmin guard
  - cdf89e6 feat(03-06): PATCH /api/admin/users/[id]/status — ADMIN suspend, SUPERADMIN restore
  - 9a3a200 feat(03-06): POST /api/admin/withdrawals/[id]/cancel — SUPERADMIN race-free manual cancel
---

# Phase 3 Plan 6: Admin Mutations (Role / Status / Cancel) Summary

Three SUPERADMIN/ADMIN mutation routes land behind verifyCsrf + requireSuperadmin/requireAdmin + enforceAdminRateLimit, each writing an AdminAction inside the SAME Prisma transaction as the mutation (CF-11 / ADMIN-06). 22 new GREEN tests across 2 modified test files; previously-RED `it.todo` blocks from Plans 03-02/Wave-0 are now real tests.

## What Shipped

### Task 1 — PATCH /api/admin/users/[id]/role (commit ad6fb7d)

`frontend/src/app/api/admin/users/[id]/role/route.ts`:
- Body Zod: `{ role: 'USER' | 'ADMIN' | 'SUPERADMIN' }`
- SUPERADMIN gate (CF-08); CSRF (CF-02); per-userId admin rate-limit (D-ADMIN-05)
- **Last-SUPERADMIN guard atomically inside a single `prisma.$transaction`** (Pitfall 1 — Demote-last-SUPERADMIN race condition):
  1. Find target user
  2. If target was SUPERADMIN AND new role is not SUPERADMIN → COUNT current SUPERADMINs; if `count <= 1` → return `LAST_SUPERADMIN` discriminator (no update)
  3. Otherwise update + logAdminAction with `metadata = { from: oldRole, to: newRole }`
- Mapping: NOT_FOUND → 404 USER_NOT_FOUND, LAST_SUPERADMIN → 409, OK → 200 `{ user: { id, role } }`
- 6 new tests in `users/route.test.ts`: SUPERADMIN happy path, ADMIN→403, last-SUPERADMIN→409 (no update, no AdminAction), missing user→404, invalid body→400, CSRF→403 short-circuit.

### Task 2 — PATCH /api/admin/users/[id]/status (commit cdf89e6)

`frontend/src/app/api/admin/users/[id]/status/route.ts`:
- Body Zod: `{ status: 'ACTIVE' | 'SUSPENDED', reason?: string (1..500) }`
- ADMIN gate; the SUSPENDED→ACTIVE (restore) branch additionally requires SUPERADMIN (D-ADMIN-02)
- **Idempotent no-op:** if `target.status === parsed.status` → return 200 with the existing user shape WITHOUT writing AdminAction (T-03-06-08 — audit-log noise mitigation)
- Action discriminator: `user.suspend` for ACTIVE→SUSPENDED, `user.restore` for SUSPENDED→ACTIVE; metadata `{ from, to, ...(reason ? { reason } : {}) }` per RESEARCH.md "AdminAction metadata shapes"
- 9 new tests: ADMIN suspend happy path with reason, ADMIN restore→403 RESTORE_REQUIRES_SUPERADMIN, SUPERADMIN restore happy path with reason, idempotent no-op (no update + no AdminAction), canonical suspend without reason (metadata omits reason), missing user→404, invalid body→400, CSRF→403.

### Task 3 — POST /api/admin/withdrawals/[id]/cancel (commit 9a3a200)

`frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts`:
- Body Zod: `{ reason: z.string().min(1).max(500) }` (T-03-06-07 — financial repudiation mitigation)
- SUPERADMIN gate (D-ADMIN-01)
- **Race-free pattern (CLAUDE.md "Withdrawals are race-free" invariant):**
  - Phase-1: read `userId` OUTSIDE the lock via `prisma.withdrawal.findUnique({ where: { id }, select: { userId: true } })`. Required because `lockUserTx` is keyed on userId (hashtext) and we need the value before entering the locked region. If missing → 404 WITHDRAWAL_NOT_FOUND (no tx, no lock).
  - Phase-2: `prisma.$transaction(..., { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` whose FIRST statement is `await lockUserTx(tx, owner.userId)`. This serializes admin cancels with concurrent user-initiated `POST /api/withdrawals` mutations on the same userId. The lock key is the **withdrawal's owner**, NOT the admin actor.
  - Phase-3: re-fetch the withdrawal under the lock. Status may have changed while we waited (e.g., a concurrent webhook flipped it to COMPLETED). If missing → NOT_FOUND; if status not in `{PENDING, PROCESSING}` → NOT_CANCELLABLE.
  - Phase-4: update `status='CANCELLED'`, `failureReason=<reason>`, set `processedAt` (preserved if already set, else now), `completedAt=now()`.
  - Phase-5: logAdminAction with action='withdrawal.cancel' + metadata `{ withdrawalId, amount, currency, reason, previousStatus }`.
- 7 new tests: ADMIN→403, SUPERADMIN/PENDING→200 + AdminAction, **lock-key-is-owner-not-actor + Serializable isolation level** (T-03-06-10 mitigation), COMPLETED→409 (no update, no AdminAction), missing id→404 (no tx, no lock), CSRF→403, empty/missing reason→400.

## Verification

```
pnpm --filter frontend exec vitest run \
    src/app/api/admin/ src/lib/server/observability/runtime-enforcement.test.ts
  → 10 files, 138 passed (24 in users/route.test.ts, 15 in withdrawals/route.test.ts)

pnpm --filter frontend exec vitest run    [full suite]
  → 42 files, 392 passed | 4 todo (396 total) | 1 skipped — 0 failures

pnpm --filter frontend exec tsc --noEmit  → 0 (clean)
pnpm --filter frontend exec eslint src/   → 0 (clean)
```

`runtime-enforcement.test.ts` count went from 29 → 32 tests (Wave 1 left it at 29; we added 3 new `route.ts` files), all GREEN — confirms each declares `runtime = 'nodejs'`.

### Acceptance grep checks (all PASSED)

| Check | Path | Expected | Actual |
|---|---|---|---|
| `runtime='nodejs'` | role/route.ts | 1 | 1 |
| `verifyCsrf` | role/route.ts | 1 | 3 (import + body + reject path) |
| `requireSuperadmin` | role/route.ts | 1 | 3 |
| `prisma.$transaction` | role/route.ts | 1 | 2 (typed annotation + invocation) |
| `logAdminAction` | role/route.ts | 1 | 3 |
| `user.role_change` | role/route.ts | 1 | 2 |
| `LAST_SUPERADMIN` | role/route.ts | ≥1 | 4 |
| `runtime='nodejs'` | status/route.ts | 1 | 1 |
| `verifyCsrf` | status/route.ts | 1 | 3 |
| `requireAdmin('ADMIN')` | status/route.ts | 1 | 2 |
| `RESTORE_REQUIRES_SUPERADMIN` | status/route.ts | ≥1 | 4 |
| `user.suspend` | status/route.ts | 1 | 2 |
| `user.restore` | status/route.ts | 1 | 2 |
| `logAdminAction` | status/route.ts | 1 | 3 |
| `runtime='nodejs'` | cancel/route.ts | 1 | 1 |
| `verifyCsrf` | cancel/route.ts | 1 | 2 |
| `requireSuperadmin` | cancel/route.ts | 1 | 2 |
| `withdrawal.cancel` | cancel/route.ts | 1 | 3 |
| `WITHDRAWAL_NOT_CANCELLABLE` | cancel/route.ts | 1 | 1 |
| `logAdminAction` | cancel/route.ts | 1 | 2 |
| `withdrawals/lock` | cancel/route.ts | 1 | 1 |
| `lockUserTx` | cancel/route.ts | ≥2 | 5 |
| `Serializable` | cancel/route.ts | 1 | 4 |

## AdminAction metadata shapes verified in tests

Per RESEARCH.md "AdminAction metadata shapes" (lines 671-677):

| Action | Metadata shape | Verified by |
|---|---|---|
| `user.role_change` | `{ from, to }` | role/route test "PATCH role by SUPERADMIN" — exact-match assertion |
| `user.suspend` | `{ from: 'ACTIVE', to: 'SUSPENDED' }` (+ optional `reason`) | status/route 2 tests (with/without reason) |
| `user.restore` | `{ from: 'SUSPENDED', to: 'ACTIVE' }` (+ optional `reason`) | status/route SUPERADMIN restore test with `reason: 'appeal granted'` |
| `withdrawal.cancel` | `{ withdrawalId, amount, currency, reason, previousStatus }` | cancel/route SUPERADMIN/PENDING test — `expect.objectContaining` on each field |

## Cancel test conversion: previously-RED → GREEN

Plan 03-02 explicitly left these `it.todo` in `withdrawals/route.test.ts`:
- `POST [id]/cancel by ADMIN returns 403 ADMIN_REQUIRED` → GREEN
- `POST [id]/cancel by SUPERADMIN succeeds + writes AdminAction with action="withdrawal.cancel"` → GREEN
- `withdrawal cancel uses pg_advisory_xact_lock(hashtext(userId)) inside the same Serializable tx` → GREEN

The third todo is now an explicit assertion on (a) `mockLockUserTx` was called with the withdrawal's `userId` (not `superadminUser.id`), and (b) the `$transaction` opts argument is `{ isolationLevel: 'Serializable' }`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `pnpm install` required before vitest could run**
- **Found during:** Task 1 verification (`Command "vitest" not found`)
- **Issue:** Worktree created without `node_modules`. Vitest binary needed to verify GREEN tests for the per-task acceptance criterion.
- **Fix:** Ran `pnpm install --frozen-lockfile` once. Subsequent vitest invocations worked. Prisma client regenerated as part of postinstall, picking up the Wave 0 schema delta (User.status + Order.idempotencyKey).
- **Files modified:** none (node_modules is gitignored)
- **Commit:** n/a

### Notable design choices (NOT deviations — within plan's Discretion)

- **Test file consolidation:** kept the role + status + cancel tests inside the existing `users/route.test.ts` and `withdrawals/route.test.ts` rather than spinning up sibling `[id]/role/route.test.ts` etc. — matches the plan's "Make the role-change tests in `users/route.test.ts` GREEN" wording and the conversion-of-it.todo pattern.
- **Discriminated-union pattern:** `prisma.$transaction(async tx => …)` returns a typed `{ kind: 'NOT_FOUND' | 'LAST_SUPERADMIN' | 'OK', user?: ... }` instead of throwing inside the tx and catching outside. Cleaner branching after the tx closes; no need for try/catch around the tx call.
- **Phase-1 (outside-lock) `WITHDRAWAL_NOT_FOUND` short-circuits before the tx ever opens.** Avoids a needless `BEGIN` + advisory-lock acquire when the row simply doesn't exist. The plan's action-block walks through this; the test "missing id → no tx, no lock" asserts both `prismaMock.$transaction` and `mockLockUserTx` were never invoked.
- **Two extra tests added beyond the plan's "Make tests GREEN" baseline:**
  - role: `PATCH role with invalid body → 400 VALIDATION_FAILED` and `PATCH role rejects when CSRF fails — short-circuits before auth` (proves Zod and CSRF gates fire correctly)
  - status: `PATCH same-status (idempotent no-op) → 200 + NO AdminAction`, `PATCH on missing user → 404`, `PATCH with invalid body → 400`, `PATCH rejects when CSRF fails`
  - cancel: `POST on missing id → 404 WITHDRAWAL_NOT_FOUND (no tx, no lock)`, `POST rejects when CSRF fails`, `POST with empty/missing reason → 400`
  These directly assert the plan's `<threat_model>` mitigations (T-03-06-04, T-03-06-05, T-03-06-07, T-03-06-08, T-03-06-10).

## Authentication Gates

None. All three endpoints' auth + rate-limiter behavior is tested via `vi.mock` of middleware/auth/audit/lock — no live JWT/Redis/Postgres credentials required.

## Known Stubs

None — all three routes return real data shapes from Prisma. Wave-0 schema migration push remains DEFERRED per user (per `<important_db_note>` in the executor prompt); tests run against `mockDeep<PrismaClient>` from `vitest-mock-extended` so the regenerated client (with `User.status` + `Order.idempotencyKey`) covers all type-level assertions.

## Threat Flags

None. All three routes consume already-known-trust-boundary surface (admin auth + Prisma writes with audit-log) — no new endpoints, auth paths, or trust boundaries beyond the plan's `<threat_model>` enumeration.

## Self-Check: PASSED

- `frontend/src/app/api/admin/users/[id]/role/route.ts` — FOUND
- `frontend/src/app/api/admin/users/[id]/status/route.ts` — FOUND
- `frontend/src/app/api/admin/withdrawals/[id]/cancel/route.ts` — FOUND
- `frontend/src/app/api/admin/users/route.test.ts` (modified) — FOUND
- `frontend/src/app/api/admin/withdrawals/route.test.ts` (modified) — FOUND
- Commit ad6fb7d — FOUND
- Commit cdf89e6 — FOUND
- Commit 9a3a200 — FOUND
- 22 new vitest tests GREEN (15 in users/route.test.ts, 7 in withdrawals/route.test.ts)
- Full suite: 392 passed | 4 todo | 1 skipped — 0 failures
- `tsc --noEmit` exits 0
- `eslint src/` exits 0
- runtime-enforcement.test.ts now discovers + asserts the 3 new route files
