---
phase: "05"
plan: "04"
subsystem: cron
tags: [cron, email-queue, resend, vercel-cron, leader-lease]
requires:
  - "@/lib/server/cron/auth"
  - "@/lib/server/leader-lease"
  - "@/lib/server/redis"
  - "@/lib/server/queues/email-queue-singleton"
  - "@/lib/server/observability/request-context"
provides:
  - "POST /api/cron/email-queue-drain"
affects:
  - "CRON-02"
  - "CRON-06"
tech-stack:
  added: []
  patterns:
    - "Vercel cron adapter (verifyCronSecret → withLease → bounded loop)"
    - "Graceful no-op when optional providers (Resend/Upstash) are not configured"
key-files:
  created:
    - "frontend/src/app/api/cron/email-queue-drain/route.ts"
  modified: []
decisions:
  - "LEASE_TTL_MS = 120_000 (2× maxDuration of 60s — Pitfall 3 in RESEARCH §4)"
  - "BATCH_SIZE = 100 hard-coded (D-08, NOT env-configurable to keep Vercel timeout headroom)"
  - "Early break on !handled to avoid 100 useless drainOne calls after queue empties"
  - "Null-queue path returns processed=0 with log.warn (graceful no-op for inert mailer envs)"
metrics:
  duration: "~3 minutes"
  tasks_completed: 1
  files_changed: 1
  completed: "2026-05-08"
---

# Phase 05 Plan 04: Cron Email-Queue-Drain Summary

POST `/api/cron/email-queue-drain` ships as a ~50-LOC Vercel cron adapter that drains up to 100 EmailJob rows per minute via `EmailQueue.drainOne()`, gated by `CRON_SECRET` and a 120s Redis leader-lease.

## What Shipped

A single thin Route Handler at `frontend/src/app/api/cron/email-queue-drain/route.ts` that wires together five PROTECTED/Wave-0 helpers without modifying any of them:

1. `verifyCronSecret(req)` — first statement; 401 bail-out if `Authorization: Bearer ${CRON_SECRET}` is missing/wrong (mitigates T-05-04-01).
2. `makeRequestContext(req.headers)` + `withRequestContext(ctx, fn)` — entire handler body runs inside ALS scope so all logs auto-attach `requestId`.
3. `withLease(redis ?? undefined, 'email-queue-drain', 120_000, fn)` — prevents concurrent multi-instance ticks from each draining the queue and double-sending emails.
4. `getEmailQueue()` — returns `null` when `UPSTASH_REDIS_REST_*` or `RESEND_API_KEY` envs are missing; route logs a warning and returns `{ ok: true, processed: 0 }` (no throw).
5. Bounded `for` loop calling `EmailQueue.drainOne()` up to `BATCH_SIZE = 100` times, breaking early when `drainOne` returns `false` (queue empty).

Final response: `NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } })`.

## Acceptance Criteria — All PASS

| Criterion | Result |
|---|---|
| `export const runtime = 'nodejs'` | 1 occurrence |
| `export const dynamic = 'force-dynamic'` | 1 occurrence |
| `export const maxDuration = 60` | 1 occurrence |
| `verifyCronSecret(req)` first statement | 1 occurrence |
| `withLease` invocation | present (import + 1 call) |
| `'email-queue-drain'` lease name | 1 occurrence |
| `getEmailQueue` | present (import + 1 call) |
| `drainOne` | 1 occurrence |
| `BATCH_SIZE = 100` | 1 occurrence |
| `if (!handled) break` | 1 occurrence |
| No protected file modified | confirmed (only NEW file added) |

## Tests Turned GREEN

The Wave 0 RED test file (`frontend/src/app/api/cron/email-queue-drain/route.test.ts`) lives in plan 05-01's sibling worktree and is not present in this worktree. Per the plan's `<sibling_plans_note>`, vitest verification runs AFTER merge-back. The route was implemented verbatim from RESEARCH §4 "Email-Queue-Drain Pattern" against the documented Wave 0 contracts:

- `verifyCronSecret(req: NextRequest): NextResponse | null`
- `getEmailQueue(): EmailQueue | null`
- `EmailQueue.drainOne(): Promise<boolean>`
- `withLease(redis, name, ttlMs, fn): Promise<void>`

Expected to satisfy ≥ 4 RED tests:
1. POST without Bearer CRON_SECRET → 401 (via `verifyCronSecret`)
2. POST with correct secret + mocked drainOne → loops up to 100, stops on false
3. `getEmailQueue() === null` → returns `{ ok: true, processed: 0 }`
4. `withLease` called with name `'email-queue-drain'` and `ttlMs ≥ 60_000`

## Lease TTL Chosen

`LEASE_TTL_MS = 120_000` (120s = 2× `maxDuration = 60`). Per RESEARCH §4 Pitfall 3: TTL must comfortably exceed worst-case fn() runtime, otherwise a slow tick can let a peer steal the lease mid-drain and double-send emails.

## Threat Mitigations Honored

- **T-05-04-01 (Spoofing)**: `verifyCronSecret(req)` is the first statement.
- **T-05-04-03 (DoS)**: `BATCH_SIZE = 100` cap + `maxDuration = 60` Vercel timeout bound runaway sends.
- **T-05-04-02 (Info disclosure)**: route logs only `{ processed, requestId }`; no email/recipient/key surface.

## Deviations from Plan

None — plan executed exactly as written. Implementation is verbatim from the plan's `<action>` block (which itself quotes RESEARCH §4).

## Authentication Gates

None.

## Known Stubs

None.

## Self-Check: PASSED

- File `frontend/src/app/api/cron/email-queue-drain/route.ts` — FOUND
- Commit `16fb710` — FOUND in `git log`
- All 10 grep-based acceptance criteria — FOUND
- No PROTECTED file modified — CONFIRMED (only new file added)
