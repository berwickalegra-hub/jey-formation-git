---
phase: 03-admin-organizations-orders
plan: 07
subsystem: auth + admin-bootstrap
tags: [auth, suspended, admin, bootstrap, protected-files, d-admin-02, admin-07]
requirements: [ADMIN-07]
dependency-graph:
  requires: [01]
  provides:
    - SUSPENDED-enforcement-loop (login + refresh refuse status='SUSPENDED')
    - BOOTSTRAP-SUPERADMIN-cli (frontend/scripts/make-superadmin.ts with audit)
  affects:
    - frontend/src/app/api/auth/login/route.ts (PROTECTED — modified with user approval)
    - frontend/src/app/api/auth/refresh/route.ts (PROTECTED — modified with user approval)
tech-stack:
  added: []
  patterns:
    - Pitfall 2 — SUSPENDED check between EMAIL_NOT_VERIFIED and recordSuccess (lockout counter NOT cleared)
    - Pitfall 8 — Refresh route is the 15-min choke point for suspension propagation
    - Testable main(args, deps) export with CLI entrypoint guard (`import.meta.url === ...`)
    - prisma.$transaction wrapping role flip + logAdminAction for atomicity
key-files:
  created:
    - frontend/scripts/make-superadmin.test.ts (converted 4 it.todos + 1 new test)
  modified:
    - frontend/src/app/api/auth/login/route.ts (PROTECTED — line 95-103 select extension; line 142-152 SUSPENDED branch)
    - frontend/src/app/api/auth/refresh/route.ts (PROTECTED — line 65 select extension; line 81-89 SUSPENDED branch)
    - frontend/src/app/api/auth/login/route.test.ts (added Test 9 — SUSPENDED user)
    - frontend/src/app/api/auth/refresh/route.test.ts (added Test 8 — SUSPENDED user)
    - frontend/scripts/make-superadmin.ts (refactored: testable main + transactional audit)
decisions:
  - SUSPENDED check ordering — AFTER EMAIL_NOT_VERIFIED, BEFORE recordSuccess (Pitfall 2). Suspended user's lockout counter is preserved.
  - main(args, deps) signature — accepts injectable Prisma client so tests bypass subprocess spawning.
  - prismaMock.$transaction stub — runs callback against the same mock; sufficient for asserting calls inside the tx.
metrics:
  tasks-completed: 3
  tests-added: 8 (1 login + 1 refresh + 5 make-superadmin + 1 from grep verification step)
  duration: ~30 min (continuation execution after checkpoint approval)
  completed-date: 2026-05-08
---

# Phase 3 Plan 07: Protected-File Edits + Make-Superadmin Bootstrap Summary

D-ADMIN-02 SUSPENDED enforcement loop closed at the login + refresh choke points (PROTECTED files modified with explicit user approval) and ADMIN-07 bootstrap CLI now writes a `BOOTSTRAP_SUPERADMIN` AdminAction inside a transaction.

## Tasks Completed

### Task 1: CONFIRM-BEFORE-EDIT — Protected files login + refresh (CHECKPOINT)
- Emitted the verbatim "I am about to modify X because Y — confirm?" line per CLAUDE.md's protected-files invariant.
- User replied "approved", unlocking Task 2.
- No code changes in this task — gate only.

### Task 2: SUSPENDED check at login + refresh (PROTECTED files)
- **Login route** (`frontend/src/app/api/auth/login/route.ts`):
  - Line 95-103: `select` extended with `status: true`.
  - Line 142-152: New "7b. D-ADMIN-02" branch returns `403 { error: 'ACCOUNT_SUSPENDED' }` AFTER `EMAIL_NOT_VERIFIED` check and BEFORE `recordSuccess`. Per Pitfall 2, the lockout counter is NOT cleared for SUSPENDED users.
- **Refresh route** (`frontend/src/app/api/auth/refresh/route.ts`):
  - Line 65: `select` extended with `status: true`.
  - Line 81-89: New "D-ADMIN-02" branch returns `403 { error: 'ACCOUNT_SUSPENDED' }` AFTER `tokenVersion` check and BEFORE `acquireRefreshLock`. The 15-min access-JWT TTL guarantees suspension takes effect within 15 min worst case (Pitfall 8 — refresh is the choke point).
- **Tests**:
  - `login/route.test.ts` Test 9: asserts 403 + ACCOUNT_SUSPENDED + no cookies + `recordSuccess` NOT called (Pitfall 2 verification).
  - `refresh/route.test.ts` Test 8: asserts 403 + ACCOUNT_SUSPENDED + no cookies + `acquireRefreshLock` NOT called.
- **Commit**: `a94c4aa feat(03-07): refuse SUSPENDED users at login + refresh (D-ADMIN-02)`

### Task 3: make-superadmin CLI script (ADMIN-07)
- Refactored `frontend/scripts/make-superadmin.ts`:
  - Exposed `main(args = process.argv.slice(2), deps = {}): Promise<number>` so tests inject a mocked Prisma client and assert directly without spawning a subprocess.
  - Lazy-instantiates the real `PrismaClient` only when no `deps.prisma` is supplied (CLI path).
  - CLI entrypoint guard: `if (import.meta.url === \`file://${process.argv[1]}\`)` — keeps script auto-run inert when imported by vitest.
  - Wrapped role flip + `logAdminAction` in a single `prisma.$transaction` for atomicity (T-03-07-05 mitigation).
  - AdminAction shape: `{ action: 'BOOTSTRAP_SUPERADMIN', actorId: <self>, targetType: 'User', targetId: <self>, metadata: { via: 'cli-script', previousRole } }`.
  - Idempotent: already-SUPERADMIN path logs no-op + exits 0 (no tx, no audit row).
- Converted all 4 Wave 0 `it.todo`s to real `it()` blocks plus added a 5th test (missing-arg → Usage exit 1).
- **Commit**: `6ad1b37 feat(03-07): add BOOTSTRAP_SUPERADMIN audit + testable main to make-superadmin (ADMIN-07)`

## Verification

| Check | Status |
|-------|--------|
| `pnpm exec vitest run src/app/api/auth/login/route.test.ts src/app/api/auth/refresh/route.test.ts` | 17/17 pass (9 login + 8 refresh, including 2 new SUSPENDED tests) |
| `pnpm exec vitest run scripts/make-superadmin.test.ts` | 5/5 pass |
| `pnpm exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | 29/29 pass — login + refresh still export `runtime='nodejs'` |
| `pnpm exec tsc --noEmit` | clean (no errors) |
| Manual: `pnpm exec tsx scripts/make-superadmin.ts` (no args) | exits 1, prints "Usage: pnpm db:make-superadmin <email>" |
| `grep -c "ACCOUNT_SUSPENDED"` on login + refresh route.ts | 1 each (correct insertion count) |
| `grep -c "BOOTSTRAP_SUPERADMIN" make-superadmin.ts` | 1 |
| `grep -c "via: 'cli-script'" make-superadmin.ts` | 1 |
| `grep -c "logAdminAction" make-superadmin.ts` | 1 |
| `grep -c "prisma.\$transaction" make-superadmin.ts` | 1 |

## Deviations from Plan

None substantive. The plan-suggested response shape `'This account has been suspended. Contact support.'` (login) and `'This account has been suspended.'` (refresh) was used verbatim. The login route had the EMAIL_NOT_VERIFIED branch positioned slightly higher than the plan's literal description (between password verify and recordSuccess); the SUSPENDED check was inserted between EMAIL_NOT_VERIFIED and recordSuccess — same intent (Pitfall 2 satisfied: lockout counter not cleared, no cookies issued).

The pre-existing `make-superadmin.ts` did the role flip but lacked audit logging and a testable `main` export. Task 3 was therefore a refactor + audit-add, not a from-scratch creation.

## Authentication Gates

None — no auth gates encountered during execution.

## Threat Flags

None — no new security-relevant surface introduced beyond the planned `<threat_model>` (T-03-07-01 through T-03-07-07).

## Self-Check: PASSED

- `frontend/src/app/api/auth/login/route.ts` exists with `ACCOUNT_SUSPENDED` and `status: true` — FOUND
- `frontend/src/app/api/auth/refresh/route.ts` exists with `ACCOUNT_SUSPENDED` and `status: true` — FOUND
- `frontend/src/app/api/auth/login/route.test.ts` contains `SUSPENDED` test — FOUND
- `frontend/src/app/api/auth/refresh/route.test.ts` contains `SUSPENDED` test — FOUND
- `frontend/scripts/make-superadmin.ts` contains `BOOTSTRAP_SUPERADMIN`, `logAdminAction`, `via: 'cli-script'`, `prisma.$transaction` — FOUND
- `frontend/scripts/make-superadmin.test.ts` has 5 real `it()` blocks (no `it.todo`s) — FOUND
- Commit `a94c4aa` (Task 2) — FOUND in `git log`
- Commit `6ad1b37` (Task 3) — FOUND in `git log`
