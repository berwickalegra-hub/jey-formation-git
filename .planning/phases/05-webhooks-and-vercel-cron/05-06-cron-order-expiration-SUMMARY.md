---
phase: "05"
plan: 06
subsystem: cron
tags: [cron, orders, expiration, vercel-cron, adapter]
requires:
  - cron/auth.ts::verifyCronSecret (sibling worktree 05-01)
  - orders/expire.ts::expirePendingOrders (sibling worktree 05-01)
  - leader-lease.ts::withLease
  - observability/request-context.ts::makeRequestContext, withRequestContext
  - redis.ts::redis (singleton, may be null)
  - prisma.ts::prisma
provides:
  - "POST /api/cron/order-expiration — Vercel cron handler (every 5 minutes)"
affects:
  - Order rows where status='PENDING' AND expiresAt < now() → status='EXPIRED'
tech-stack:
  added: []
  patterns:
    - "Cron adapter: verifyCronSecret → withRequestContext → withLease → helper call → JSON response"
    - "Lease TTL ≈ 2× maxDuration (60s lease vs 30s maxDuration) — pitfall #3"
    - "Helper-driven cutoff: route reads no env; expirePendingOrders consumes Order.expiresAt"
key-files:
  created:
    - frontend/src/app/api/cron/order-expiration/route.ts
  modified: []
decisions:
  - "Did NOT read ORDER_EXPIRATION_MINUTES env in route (A3): helper uses Order.expiresAt set at creation time"
  - "Did NOT pass batchSize to expirePendingOrders: helper default 100 is correct (D-08)"
  - "Lease name literal 'order-expiration' matches Vercel schedule path"
metrics:
  duration: ~5 min
  completed: 2026-05-08
  files_created: 1
  files_modified: 0
  tasks_completed: 1
requirements:
  - CRON-04
  - CRON-06
---

# Phase 05 Plan 06: Cron Order-Expiration Summary

POST /api/cron/order-expiration cron adapter — verifies CRON_SECRET, takes the `order-expiration` Redis lease (60s TTL), invokes `expirePendingOrders({ prisma })`, returns `{ ok: true, processed: N }`.

## What shipped

**1 new file (44 LOC):** `frontend/src/app/api/cron/order-expiration/route.ts`

Route shape:
- `export const runtime = 'nodejs'` (Prisma + bcrypt — CLAUDE.md invariant)
- `export const dynamic = 'force-dynamic'` (defeat default POST caching for cron)
- `export const maxDuration = 30` (D-10 — single updateMany is sub-second; 30s is generous)
- `verifyCronSecret(req)` first; bails on 401
- `withRequestContext(ctx, ...)` wrapper for log correlation
- `withLease(redis ?? undefined, 'order-expiration', 60_000, async () => { ... })` — defense-in-depth even though Vercel cron is single-instance per schedule (D-07)
- Inside lease: `const { expired } = await expirePendingOrders({ prisma })` — Wave 0 D-14 helper
- Response: `NextResponse.json({ ok: true, processed: expired }, { headers: { 'x-request-id': ctx.requestId } })`

## Verification

Acceptance criteria (grep counts on the new file):
- runtime='nodejs': **1**
- dynamic='force-dynamic': **1**
- maxDuration = 30: **1**
- verifyCronSecret(req): **1**
- withLease referenced: **2** (import + call — both required)
- 'order-expiration' string literal: **1** (lease name)
- expirePendingOrders referenced: **2** (import + call)
- ORDER_EXPIRATION_MINUTES present: **0** (route does NOT read this env — A3 confirmed)
- No PROTECTED file modified: **confirmed**

The Wave 0 RED test (`frontend/src/app/api/cron/order-expiration/route.test.ts`) lives in plan 05-01's worktree by design. Per `<sibling_plans_note>` in the PLAN, the GREEN run executes after merge-back:
```
pnpm --filter frontend exec vitest run src/app/api/cron/order-expiration/route.test.ts
pnpm --filter frontend exec tsc -p tsconfig.json --noEmit
```
Same applies to the typecheck — `@/lib/server/cron/auth` and `@/lib/server/orders/expire` import targets ship in the sibling worktree.

## A3 confirmation (Open Question Resolved)

Per RESEARCH §"Order Expiration Helper" + A3, the route does NOT compute the expiration cutoff. The Wave 0 helper `expirePendingOrders` reads `Order.expiresAt` (set by the order-creation route at checkout time). The `ORDER_EXPIRATION_MINUTES` env is documentation-only for forks adjusting checkout windows in their own order-creation route (Phase 3). The cron route is therefore env-free — verified via `grep -c ORDER_EXPIRATION_MINUTES … = 0`.

## Threat-model coverage

All 4 STRIDE threats from the PLAN's `<threat_model>` are mitigated by the route + helper composition:

| Threat ID | Mitigation in this plan |
|-----------|------------------------|
| T-05-06-01 (Spoofing) | `verifyCronSecret(req)` is the first statement; bails 401 on missing/wrong Bearer |
| T-05-06-02 (Tampering — PAID-race) | Helper's per-row `updateMany WHERE status='PENDING'` skips winner-flipped rows (helper concern, not route) |
| T-05-06-03 (DoS — unbounded findMany) | Helper default batchSize=100; route does not override |
| T-05-06-04 (Elevation — downgrade PAID→EXPIRED) | Helper double-checks `status='PENDING'` at find AND update (helper concern) |

No new threat surface introduced. No threat flags.

## Deviations from Plan

None — plan executed exactly as written. The behavior block, action snippet, and acceptance criteria all matched line-for-line.

## Deferred Issues

None.

## Self-Check: PASSED

- File `frontend/src/app/api/cron/order-expiration/route.ts` — **FOUND**
- Commit `d28b194` (feat(05-06)) — **FOUND**
