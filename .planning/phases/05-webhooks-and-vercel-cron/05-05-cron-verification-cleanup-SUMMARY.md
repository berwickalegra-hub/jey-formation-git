---
phase: "05"
plan: "05-05"
subsystem: cron
tags: [cron, verification-cleanup, prisma, withLease, CRON-03, CRON-06]
requirements: [CRON-03, CRON-06]
dependency-graph:
  requires:
    - frontend/src/lib/server/cron/auth.ts (sibling 05-01 — verifyCronSecret)
    - frontend/src/lib/server/leader-lease.ts (withLease)
    - frontend/src/lib/server/redis.ts (redis singleton)
    - frontend/src/lib/server/prisma.ts (prisma client)
    - frontend/src/lib/server/observability/request-context.ts (makeRequestContext, withRequestContext)
    - frontend/src/lib/server/logger.ts (createLogger)
  provides:
    - "POST /api/cron/verification-cleanup — Vercel cron handler (hourly)"
  affects: []
tech-stack:
  added: []
  patterns:
    - "Cron route adapter: verifyCronSecret bail → withLease → inline prisma deleteMany"
    - "D-13 — inline single-query work, no helper file"
key-files:
  created:
    - frontend/src/app/api/cron/verification-cleanup/route.ts
  modified: []
decisions:
  - "Followed plan body verbatim — response shape `{ ok: true, processed: N }` (matches must_haves.truths and acceptance grep)"
  - "LEASE_TTL_MS = 60_000 (~2 × maxDuration per Pitfall 3)"
metrics:
  duration: "~3 minutes"
  tasks: "1/1"
  files: 1
  completed: "2026-05-08"
---

# Phase 05 Plan 05-05: Cron Verification Cleanup Summary

Ships `POST /api/cron/verification-cleanup` — a ~30-LOC Vercel-cron adapter that deletes expired `VerificationCode` rows hourly.

## What was built

**File:** `frontend/src/app/api/cron/verification-cleanup/route.ts` (44 lines including imports + comments)

Adapter shape:

1. `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=30` exported (CLAUDE.md invariant + D-10)
2. `verifyCronSecret(req)` first statement (CRON-06)
3. `makeRequestContext` + `withRequestContext` for `requestId` propagation (auto-attached to logs)
4. `withLease(redis ?? undefined, 'verification-cleanup', 60_000, fn)` — multi-instance coordination defense-in-depth
5. Inside the lease: inline `prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } })` (D-13 — no helper)
6. `log.info('verification-cleanup tick', { processed, requestId })`
7. Returns `NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } })`

## Acceptance grep results

| Check | Expected | Actual |
| --- | --- | --- |
| `runtime = 'nodejs'` | 1 | 1 |
| `dynamic = 'force-dynamic'` | 1 | 1 |
| `maxDuration = 30` | 1 | 1 |
| `verifyCronSecret(req)` | 1 | 1 |
| `withLease` | ≥1 | 2 (import + call) |
| `'verification-cleanup'` | 1 | 1 |
| `verificationCode.deleteMany` | 1 | 1 |
| `expiresAt: { lt:` | 1 | 1 |
| No `lib/server/auth/verification-cleanup.ts` (D-13) | absent | absent (OK) |

## Test execution

Skipped in this worktree per `<sibling_plans_note>`: the RED test file `frontend/src/app/api/cron/verification-cleanup/route.test.ts` (and the `verifyCronSecret` helper at `frontend/src/lib/server/cron/auth.ts`) ship in plan 05-01's parallel worktree. After merge-back, the orchestrator runs:

```
pnpm --filter frontend exec vitest run src/app/api/cron/verification-cleanup/route.test.ts
pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts
pnpm --filter frontend exec tsc -p tsconfig.json --noEmit
```

to confirm GREEN.

## Deviations from Plan

None. Implementation is verbatim from plan `<action>` block (which was lifted verbatim from RESEARCH §5).

Note on response-shape ambiguity: the orchestrator's `<sibling_plans_note>` mentioned `{ ok: true, deleted: result.count }`, but the plan body, `must_haves.truths` (`processed: N`), and the explicit acceptance criterion all specify `processed`. The Wave 0 RED tests in 05-01 were authored against the plan's frontmatter contract, so `processed` is correct. Following plan body wins per planner intent.

## Threat-model coverage

| Threat ID | Disposition | Status |
| --- | --- | --- |
| T-05-05-01 (S — unauth invocation) | mitigate | `verifyCronSecret(req)` first statement |
| T-05-05-02 (T — accidental over-deletion) | mitigate | WHERE clause uses Prisma-parameterized `expiresAt: { lt: new Date() }` (lt, not gt; verified by grep) |
| T-05-05-03 (D — DoS via mass deletion) | accept | Hourly cadence + indexed column |
| T-05-05-04 (I — info disclosure) | accept | deleteMany never reads codeHash |

## Commits

- `4b16d2c` — feat(05-05): add POST /api/cron/verification-cleanup route

## Self-Check: PASSED

- File exists: FOUND `frontend/src/app/api/cron/verification-cleanup/route.ts`
- Commit exists: FOUND `4b16d2c`
- All 9 acceptance grep counts match expected values
- No protected files touched
- No new helper file created (D-13 honored)
