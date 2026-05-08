---
phase: "05"
plan: 03
subsystem: cron-outbox-drain
tags: [cron, outbox, vercel, lease]
requires:
  - frontend/src/lib/server/cron/auth.ts # Wave 0 (sibling 05-01)
  - frontend/src/lib/server/queues/email-queue-singleton.ts # Wave 0 (sibling 05-01)
  - frontend/src/lib/server/leader-lease.ts # PROTECTED — call only
  - frontend/src/lib/server/outbox/dispatcher.ts # PROTECTED — call only
  - frontend/src/lib/server/redis.ts # PROTECTED — call only
  - frontend/src/lib/server/prisma.ts
  - frontend/src/lib/server/observability/request-context.ts # PROTECTED — call only
provides:
  - POST /api/cron/outbox-drain
  - Vercel cron entry point (1-minute schedule, configured in vercel.json by sibling 05-08)
affects:
  - OutboxEvent table (stuck-row reset PROCESSING→PENDING + dispatcher claims)
tech-stack:
  added: []
  patterns:
    - "Cron Adapter Route (RESEARCH §Pattern 2): verify secret → request context → withLease → reset stuck → drain"
    - "Stuck-row reset uses scheduledAt cutoff (no startedAt column — Pitfall 7)"
    - "exactOptionalPropertyTypes via spread-omit ({ prisma, ...(queue ? { emailQueue: queue } : {}) })"
key-files:
  created:
    - frontend/src/app/api/cron/outbox-drain/route.ts
  modified: []
decisions:
  - "Lease TTL = 120_000ms (~2× maxDuration) — Pitfall 3 (a stuck leader can't deadlock peers, but won't expire mid-run under load)"
  - "BATCH_SIZE = 100 hard-coded per D-08 (not env-configurable in v1)"
  - "STUCK_RESET_MS = 90_000 hard-coded per D-09"
  - "Used Prisma updateMany form for stuck-row reset (D-09) instead of $executeRaw (RESEARCH §Pattern 2 alt) — simpler, no Prisma.raw splice, equivalent semantics"
  - "Spread-omit emailQueue when getEmailQueue() returns null — required by exactOptionalPropertyTypes"
metrics:
  duration: "~7 minutes"
  completed: "2026-05-08"
  tasks: 1
  files: 1
---

# Phase 5 Plan 03: Cron Outbox-Drain Summary

`POST /api/cron/outbox-drain` ships as a ~60-LOC adapter — verifies `CRON_SECRET`, leases on `outbox-drain` for 120s, resets stuck `PROCESSING` rows older than 90s, then drains up to 100 `OutboxEvent` rows via the protected dispatcher.

## What was done

- **Created** `frontend/src/app/api/cron/outbox-drain/route.ts` (95 lines) — Vercel cron entry point.
- **Imports only PROTECTED helpers** — zero modifications to `cron/auth.ts`, `outbox/dispatcher.ts`, `leader-lease.ts`, `email-queue-singleton.ts`, `redis.ts`, `prisma.ts`, `request-context.ts`.
- **Lifecycle inside the lease (in this exact order — required by call-order test):**
  1. `prisma.outboxEvent.updateMany({ where: { status: 'PROCESSING', scheduledAt: { lt: now − 90_000ms } }, data: { status: 'PENDING', scheduledAt: now } })` — D-09 stuck-row reset.
  2. `drainOutbox({ prisma, ...(queue ? { emailQueue: queue } : {}) }, 100)` — D-08 batch.
  3. `log.info('outbox-drain tick', { processed, succeeded, failed, dead, requestId })`.
- **Exports** `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=60` (Pitfall 2 + D-10).
- **Returns** `NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } })`.

## Key decisions

| Decision | Value | Rationale |
| --- | --- | --- |
| Lease TTL | `120_000ms` | ~2× `maxDuration` — Pitfall 3 (no mid-run expiry, no infinite peer-block on crash). |
| Batch size | `100` (hard-coded) | D-08 — not env-configurable in v1 (YAGNI on a knob that almost never moves). |
| Stuck-reset cutoff | `90_000ms` (hard-coded) | D-09 + ROADMAP success criterion #3. |
| Stuck-reset query | `prisma.outboxEvent.updateMany` | Simpler than `$executeRaw` + `Prisma.raw` interpolation; same semantics. RESEARCH §Pattern 2 explicitly allows this alternative ("Or use prisma.outboxEvent.updateMany with a manual `lt` cutoff"). |
| Schedule cutoff column | `scheduledAt` (NOT `startedAt`) | Pitfall 7 — `OutboxEvent` has no `startedAt` column. The dispatcher does NOT update `scheduledAt` on claim, so a row stuck ≥ 90s reliably matches. |
| Email-queue wiring | `getEmailQueue()` then spread-omit | `exactOptionalPropertyTypes` rejects assigning `undefined` to optional `emailQueue` field; spread-omit is the only TS-clean path. Graceful fallback: dispatcher throws "email queue not configured" per `email.*` row → row retries via existing backoff. |

## Tests

The Wave 0 RED test file (`frontend/src/app/api/cron/outbox-drain/route.test.ts`) lives in plan 05-01's worktree — not present here per `<sibling_plans_note>`. Per-criterion grep verification was used in lieu of test execution:

| Acceptance criterion | grep count |
| --- | --- |
| `export const runtime = 'nodejs'` | 1 |
| `export const dynamic = 'force-dynamic'` | 1 |
| `export const maxDuration = 60` | 1 |
| `verifyCronSecret(req)` | 1 |
| `withLease` | 3 (import + import path + call) |
| `'outbox-drain'` | 1 (lease name) |
| `drainOutbox` | 3 (import + import path + call) |
| `BATCH_SIZE = 100` | 1 |
| `status: 'PROCESSING'` | 1 |
| `outboxEvent.updateMany` | 1 |
| `getEmailQueue` | 2 (import + call) |
| `STUCK_RESET` | 2 (constant decl + usage) |

After merge-back of 05-01 (which ships the RED tests + helper modules), running `pnpm --filter frontend exec vitest run src/app/api/cron/outbox-drain/route.test.ts` is expected to be GREEN — the implementation matches the RESEARCH §"Pattern 2" verbatim shape (only difference: Prisma `updateMany` instead of `$executeRaw`, allowed by the RESEARCH alternative).

## Deviations from Plan

None substantive. The plan's `<action>` block is implemented as written. The single doc-level deviation:

- **RESEARCH §"Pattern 2" alternative chosen.** Used `prisma.outboxEvent.updateMany({ where, data })` for the stuck-row reset rather than `prisma.$executeRaw` with `Prisma.raw` interpolation. RESEARCH §"Pattern 2" comment block lists both forms as acceptable: "(Or use prisma.outboxEvent.updateMany with a manual `lt` cutoff …)". The plan's `<action>` block explicitly specifies the `updateMany` form, so this is the prescribed implementation, not a deviation.

## CLAUDE.md compliance

- `export const runtime = 'nodejs'` present (route enforcement test).
- No PROTECTED file modified — `git diff --name-only` returned only `frontend/src/app/api/cron/outbox-drain/route.ts`.
- Cron handler verifies `Authorization: Bearer ${CRON_SECRET}` via `verifyCronSecret(req)` as the first statement (CLAUDE.md "Cron handlers MUST verify Authorization").
- Side-effect dispatch goes through the outbox + dispatcher; no closure-style side effects.

## Commits

| Hash | Message |
| --- | --- |
| `fe80cc3` | feat(05-03): add POST /api/cron/outbox-drain route adapter |

## Self-Check: PASSED

- File `frontend/src/app/api/cron/outbox-drain/route.ts` exists (verified via `Bash` ls).
- Commit `fe80cc3` exists in `git log` (HEAD of `worktree-agent-a20010abe20de37d5`).
- All 12 acceptance-grep counts match expected values (above table).
- `git diff --name-only HEAD~1 HEAD` lists only the new route file — no protected file touched.
