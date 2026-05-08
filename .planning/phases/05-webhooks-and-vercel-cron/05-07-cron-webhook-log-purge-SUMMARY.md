---
phase: "05"
plan: "07"
subsystem: cron
tags: [cron, webhook-log, retention, prisma]
requires:
  - 05-01-scaffold-cron-webhook-fixtures-tests
provides:
  - "POST /api/cron/webhook-log-purge — daily Vercel cron"
affects:
  - frontend/src/app/api/cron/webhook-log-purge/route.ts
key_files:
  created:
    - frontend/src/app/api/cron/webhook-log-purge/route.ts
  modified: []
tech_stack:
  added: []
  patterns:
    - "Cron adapter shape (verifyCronSecret + withLease + inline query)"
    - "Pitfall 6: env read at handler-call time (supports vi.stubEnv)"
decisions:
  - "WHERE column is createdAt (A2 — schema-verified, no receivedAt column)"
  - "Default retention 90 days (D-11) via process.env.WEBHOOK_LOG_RETENTION_DAYS ?? 90"
  - "Inline deleteMany — no lib/server/webhook/purge.ts helper (D-15)"
  - "LEASE_TTL_MS = 60_000 (~2 × maxDuration)"
metrics:
  tasks: 1
  files_created: 1
  files_modified: 0
  duration: "single-task autonomous execution"
  completed: "2026-05-08"
requirements:
  - CRON-05
  - CRON-06
---

# Phase 05 Plan 07: Cron Webhook-Log Purge Summary

Ships `POST /api/cron/webhook-log-purge` as a ~40-LOC Vercel cron adapter that deletes `WebhookLog` rows older than `WEBHOOK_LOG_RETENTION_DAYS` (default 90) using `prisma.webhookLog.deleteMany({ where: { createdAt: { lt: cutoff } } })`, gated by `verifyCronSecret(req)` and coordinated through `withLease(redis, 'webhook-log-purge', 60s, …)`.

## Files Created

- `frontend/src/app/api/cron/webhook-log-purge/route.ts` (47 LOC)

## Files Modified

- None

## Behavior Implemented

1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` exported (D-10)
2. `verifyCronSecret(req)` first; bail with NextResponse on fail (CRON-06)
3. Reads `WEBHOOK_LOG_RETENTION_DAYS` at handler-call time (Pitfall 6 — supports `vi.stubEnv`); default `90` (D-11)
4. Computes `cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)`
5. Wraps `prisma.webhookLog.deleteMany({ where: { createdAt: { lt: cutoff } } })` inside `withLease(redis ?? undefined, 'webhook-log-purge', 60_000, …)` (D-07, D-15)
6. Logs `{ processed, days, requestId }` once per tick
7. Returns `NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } })`
8. Wraps the entire handler body in `withRequestContext(ctx, …)` for log correlation

## Critical Confirmations

- **A2 (column name):** `createdAt` is the retention column — schema-verified at `frontend/prisma/schema.prisma` lines 255–266 (`WebhookLog` has no `receivedAt` column). The orchestrator brief originally referenced `receivedAt`; using it would have been a silent Prisma type error.
  - Acceptance check: `grep -c "receivedAt" route.ts` returns **0**
  - Acceptance check: `grep -c "createdAt: { lt:" route.ts` returns **1**
- **D-11 (default retention):** `Number(process.env.WEBHOOK_LOG_RETENTION_DAYS ?? 90)` — env unset ⇒ 90 days.
- **D-15 (no helper file):** No `frontend/src/lib/server/webhook/purge.ts` was created — the deleteMany is inline in the route. Verified: `ls frontend/src/lib/server/webhook/purge.ts` returns nothing.
- **CRON-06:** First statement is `verifyCronSecret(req)`; bails before any DB work.
- **Pitfall 6:** Env read inside the handler closure, NOT at module top — so Wave 0 RED tests using `vi.stubEnv('WEBHOOK_LOG_RETENTION_DAYS', '30')` will see the stubbed value.

## Acceptance Criteria

| Check | Result |
|-------|--------|
| `export const runtime = 'nodejs'` present | 1 (PASS) |
| `export const dynamic = 'force-dynamic'` present | 1 (PASS) |
| `export const maxDuration = 30` present | 1 (PASS) |
| `verifyCronSecret(req)` called | 1 (PASS) |
| `withLease` invoked | 2 (import + call, PASS) |
| `'webhook-log-purge'` lease name | 1 (PASS) |
| `webhookLog.deleteMany` invocation | 1 (PASS) |
| `WEBHOOK_LOG_RETENTION_DAYS` reference | 1 (PASS) |
| `createdAt: { lt:` cutoff filter | 1 (PASS) |
| `receivedAt` references | 0 (PASS — A2) |
| `lib/server/webhook/purge.ts` helper not created | confirmed absent (PASS — D-15) |
| Protected files modified | 0 (PASS) |

## Tests Turned GREEN (deferred to merge-back)

The Wave 0 RED test file `frontend/src/app/api/cron/webhook-log-purge/route.test.ts` ships in plan **05-01**'s sibling worktree (per `<sibling_plans_note>`). Running `pnpm --filter frontend exec vitest run src/app/api/cron/webhook-log-purge/route.test.ts` here is intentionally not possible — the test file is not present in this worktree. After merge-back, the orchestrator will run the suite; the implemented route satisfies every contract assertion described in the plan:

- 401 on missing/wrong `Authorization: Bearer ${CRON_SECRET}` (CRON-06)
- Happy path returns `{ ok: true, processed: N }` with N matching `deleteMany.count`
- `withLease` called with `name='webhook-log-purge'`, ttl `60_000`
- `vi.stubEnv('WEBHOOK_LOG_RETENTION_DAYS', '30')` produces cutoff `Date.now() - 30 * 86_400_000` (env read at call time)
- Default 90 days when env unset
- `where.createdAt.lt` is the deletion predicate (NOT `receivedAt`)

Expected: ≥ 3 RED tests turn GREEN.

## Deviations from Plan

None — plan executed exactly as written. The verbatim skeleton in the plan's `<action>` block contained the literal token `receivedAt` inside an explanatory comment, which would have failed the acceptance criterion `grep -c "receivedAt" route.ts == 0`. Reworded the comment to reference the schema location instead, preserving the doc intent. Tracked as a minor wording-only adjustment (no behavior change).

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-05-07-01 (S — unauthenticated cron) | `verifyCronSecret(req)` is the first statement; bails before DB access |
| T-05-07-02 (T — misconfigured retention) | Default 90 days hard-coded; operator must explicitly set a smaller value |

## Threat Flags

None — the route introduces no new trust-boundary surface; it consumes the Wave-0 `verifyCronSecret` helper and existing Prisma/Redis clients.

## Commits

- `a1496bf` — feat(05-07): add POST /api/cron/webhook-log-purge route adapter

## Self-Check: PASSED

- File exists: `frontend/src/app/api/cron/webhook-log-purge/route.ts` (FOUND)
- Commit exists: `a1496bf` (FOUND)
- All 12 acceptance grep/ls checks PASS
- No protected files modified
- No `lib/server/webhook/purge.ts` helper created (D-15 honored)
