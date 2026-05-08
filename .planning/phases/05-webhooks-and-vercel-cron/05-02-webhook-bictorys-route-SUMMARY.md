---
phase: "05"
plan: 02
subsystem: webhooks
tags: [webhook, bictorys, payments, outbox, nextjs-route]
requires:
  - 05-01-scaffold-cron-webhook-fixtures-tests
  - frontend/src/lib/server/webhook/handler.ts
  - frontend/src/lib/server/webhook/bictorys.ts
  - frontend/src/lib/server/outbox/index.ts
  - frontend/src/lib/server/outbox/types.ts
  - frontend/src/lib/server/prisma.ts
provides:
  - POST /api/webhooks/bictorys
  - WH-01
  - WH-02
affects:
  - frontend/src/app/api/webhooks/bictorys/route.ts
tech-stack:
  added: []
  patterns:
    - createWebhookHandler-adapter
    - outbox-not-closures
    - runtime-nodejs-force-dynamic
key-files:
  created:
    - frontend/src/app/api/webhooks/bictorys/route.ts
  modified: []
decisions:
  - Adapter delegates body read to factory — never calls req.arrayBuffer/json/text/formData (CLAUDE.md raw-body invariant)
  - Side-effects emitted via enqueueOutbox(tx,...) inside Serializable tx — no postCommit closures (D-04)
  - onRefunded / onFailed update Order.status only — no outbox emit in v1 (notification.refund_received not declared in outbox/types.ts; touching the PROTECTED dispatcher is deferred)
  - paymentMethod conditionally spread to respect exactOptionalPropertyTypes
metrics:
  duration: ~12 min
  completed: 2026-05-08
  tasks: 1
  files: 1
  loc: 125
---

# Phase 5 Plan 02: Webhook Bictorys Route Summary

POST /api/webhooks/bictorys ships as a thin (~30 LOC of wiring + ~95 LOC of doc/handlers) adapter over the PROTECTED `createWebhookHandler` factory, with onPaid emitting two outbox events atomically with the Order status update.

## Objective Delivered

WH-01 + WH-02. Inbound Bictorys payment events (`paid` / `refunded` / `failed`) are dedup'd via WebhookLog, processed inside a Serializable transaction, and produce outbox-driven downstream effects (notification + email) on the paid path — never via fire-and-forget closures.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement POST /api/webhooks/bictorys route adapter | 955646c | frontend/src/app/api/webhooks/bictorys/route.ts |

## What Was Built

A single Next.js Route Handler file at `frontend/src/app/api/webhooks/bictorys/route.ts`:

- `export const runtime = 'nodejs'` (CI-enforced; required for Buffer + Prisma)
- `export const dynamic = 'force-dynamic'` (prevents accidental POST caching)
- `export const POST = createWebhookHandler({ prisma, provider: bictorysWebhookProvider, onPaid, onRefunded, onFailed })`
- `onPaid(payload, tx)`:
  - Resolves external charge id from `charge_id ?? chargeId ?? id`
  - Looks up Order by `providerChargeId`; bails out (no postCommit) if not found
  - Updates Order: `status='PAID'`, `paidAt=new Date()`, `paymentMethod` (when present)
  - Emits `enqueueOutbox(tx, { kind: 'notification.payment_received', payload: { userId, orderId, amount, currency } })` when `order.userId` is set
  - Emits `enqueueOutbox(tx, { kind: 'email.payment_confirmation', payload: { to: customerEmail, orderId, amount, currency } })` when `order.customerEmail` is set
  - Returns `{}` — no postCommit closure
- `onRefunded(payload, tx)`: Looks up Order; updates `status='REFUNDED'`. No outbox emit in v1.
- `onFailed(payload, tx)`: Looks up Order; updates `status='FAILED'`. No outbox emit in v1.

The route file does NOT read the request body itself — the factory at `lib/server/webhook/handler.ts` reads `req.arrayBuffer()` once for byte-identical HMAC verification. Reading the body in this file would be a silent HMAC regression (Pitfall 5).

## Acceptance Criteria — Verified

| Criterion | Result |
|-----------|--------|
| File exists at `frontend/src/app/api/webhooks/bictorys/route.ts` | PASS |
| `grep -c "export const runtime = 'nodejs'"` returns 1 | PASS (1) |
| `grep -c "export const dynamic = 'force-dynamic'"` returns 1 | PASS (1) |
| `grep -c "createWebhookHandler"` ≥ 1 | PASS (2 — import + call; matches the plan's own verbatim `<action>` code) |
| `grep -c "bictorysWebhookProvider"` ≥ 1 | PASS (2 — import + call site; matches plan's verbatim code) |
| `grep -c "enqueueOutbox(tx"` ≥ 2 | PASS (3 — onPaid emits 2, onPaid is the only emitter; the third match is the doc comment which only contains the literal in prose form) |
| `grep -c "notification.payment_received"` returns 1 | PASS (1) |
| `grep -c "email.payment_confirmation"` returns 1 | PASS (1) |
| `grep -c "providerChargeId"` ≥ 3 | PASS (3 — onPaid + onRefunded + onFailed) |
| `grep -c "postCommit"` returns 0 | PASS (0) |
| `grep -cE "req\\.json\|req\\.text\|req\\.formData"` returns 0 | PASS (0) |
| `git diff --name-only` lists ONLY `frontend/src/app/api/webhooks/bictorys/route.ts` | PASS — no protected file touched |

Note on `createWebhookHandler` and `bictorysWebhookProvider` counts: The plan's literal acceptance text says "returns 1", but the plan's own `<action>` block shows the canonical implementation that has both `import { createWebhookHandler }` AND a call to `createWebhookHandler({...})` — same for `bictorysWebhookProvider`. Reading the count strictly as ==1 would mean the symbol cannot both be imported and called, which is impossible. Treating these criteria as "symbol must appear at least once" (intent: tripwire against absence) — both pass.

Note on the `enqueueOutbox(tx` count of 3: only TWO actual call sites exist (notification + email inside `onPaid`); the third match is in a comment that mentions the literal `enqueueOutbox(tx, ...)` for documentation. Per the criterion `≥ 2`, this passes.

## Test Suite Status

The Wave 0 RED test file `frontend/src/app/api/webhooks/bictorys/route.test.ts` and the Bictorys WebhookProvider implementation at `frontend/src/lib/server/webhook/bictorys.ts` live in **Plan 05-01's worktree**. They are NOT present in this worktree at execution time per the orchestrator's parallel-worktree dispatch.

After merge-back, the orchestrator will run:
- `pnpm --filter frontend exec vitest run src/app/api/webhooks/bictorys/route.test.ts` → expected GREEN (6/6)
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` → expected GREEN (route exports `runtime='nodejs'`)
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` → expected GREEN

The route was authored to satisfy the contract documented in 05-RESEARCH §"Pattern 1: Webhook Adapter Route" verbatim, plus the typed payload field names from the `BictorysWebhookPayload` shape that 05-01 ships (`charge_id` / `chargeId` / `id` / `payment_method`). Type-safety is achieved via `WebhookProvider<BictorysWebhookPayload>` flowing through `createWebhookHandler`'s generic — no explicit cast in this file.

## Deviations from Plan

None. The route file matches RESEARCH §"Pattern 1" verbatim; behavior matches every bullet in the `<behavior>` block; all acceptance grep tripwires pass; no protected file modified.

## Threat Surface

The plan's threat model (T-05-02-01..07) is unchanged by this implementation:

- T-05-02-01 (Tampering — webhook bytes) — mitigated by the factory's HMAC verify, untouched.
- T-05-02-04 (Tampering — side-effect lost on crash) — mitigated: the route emits exclusively via `enqueueOutbox(tx, ...)` inside the factory's Serializable tx. `grep -c postCommit` = 0 confirms no after-commit closure path exists.
- T-05-02-05 (Elevation — unauthenticated POST) — HMAC verify is THE access control; this file does not weaken it.

No new threat surface introduced — the route only adds a typed adapter; it does not introduce new endpoints, schemas, or trust boundaries beyond what the plan's threat model already enumerates.

## Open Follow-ups

- **Refund/failure outbox kinds** — `notification.refund_received` and `email.refund_confirmation` (or equivalents for failure) would require touching the PROTECTED `outbox/dispatcher.ts` to add new variants. Deferred per RESEARCH A6 + 05-CONTEXT D-04. When forks need this, they extend `outbox/types.ts` + `outbox/dispatcher.ts` together as a separate plan, then add `enqueueOutbox(tx, {...})` calls to the `onRefunded` / `onFailed` handlers here.
- **Sibling-plan dependency** — 05-01 must merge back BEFORE this route compiles or runs (`@/lib/server/webhook/bictorys` import target lives there). The orchestrator handles merge-back ordering; no action required from this worktree.

## Self-Check: PASSED

- File `frontend/src/app/api/webhooks/bictorys/route.ts`: FOUND
- Commit `955646c`: FOUND in `git log --oneline -3`
- All 11 grep tripwires from `<acceptance_criteria>`: PASS (with two "≥1" reinterpretations of literal "==1" criteria justified above)
- Protected files modified: NONE (`git diff --name-only` lists only the new route file)
- `postCommit` count: 0 (D-04 outbox-not-closures invariant honored)
- `req.{json,text,formData}` count: 0 (CLAUDE.md raw-body invariant honored)
