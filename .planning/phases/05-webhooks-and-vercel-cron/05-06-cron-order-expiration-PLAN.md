---
id: 05-06-cron-order-expiration
phase: "05"
plan: 06
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/src/app/api/cron/order-expiration/route.ts
autonomous: true
task_count: 1
requirements:
  - CRON-04
  - CRON-06
must_haves:
  truths:
    - "POST without Bearer ${CRON_SECRET} returns 401"
    - "POST with correct CRON_SECRET calls expirePendingOrders({ prisma }) helper"
    - "Response is { ok: true, processed: N } where N is the helper's expired count"
    - "Route exports runtime='nodejs', dynamic='force-dynamic', maxDuration=30"
    - "withLease called with name='order-expiration'"
  artifacts:
    - path: "frontend/src/app/api/cron/order-expiration/route.ts"
      provides: "POST /api/cron/order-expiration — Vercel cron handler (every 5 minutes)"
      exports: ["POST", "runtime", "dynamic", "maxDuration"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/cron/order-expiration/route.ts"
      to: "frontend/src/lib/server/cron/auth.ts"
      via: "verifyCronSecret(req) — first statement"
      pattern: "verifyCronSecret\\(req\\)"
    - from: "frontend/src/app/api/cron/order-expiration/route.ts"
      to: "frontend/src/lib/server/orders/expire.ts"
      via: "expirePendingOrders({ prisma }) — D-14 helper"
      pattern: "expirePendingOrders"
---

<objective>
Ship `POST /api/cron/order-expiration`: a Vercel cron route that (a) verifies CRON_SECRET, (b) wraps `expirePendingOrders({ prisma })` in `withLease`, (c) returns the expired count. Implements CRON-04 + CRON-06.

Purpose: Pending Orders accumulate forever without this cron. The `expirePendingOrders` helper (Wave 0 — D-14) reads `Order.expiresAt` (set by the order-creation route per fork) and transitions PENDING→EXPIRED in batches. The route is a ~40-LOC thin adapter.

Output: One route handler file. All ≥ 3 Wave 0 RED order-expiration tests GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md
@.planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md
@CLAUDE.md

@frontend/src/lib/server/cron/auth.ts
@frontend/src/lib/server/leader-lease.ts
@frontend/src/lib/server/orders/expire.ts
@frontend/src/lib/server/redis.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/src/app/api/cron/order-expiration/route.test.ts

<interfaces>
From frontend/src/lib/server/orders/expire.ts (Wave 0):
```typescript
export interface ExpirePendingOrdersOptions {
  prisma: PrismaClient;
  batchSize?: number; // default 100
}
export async function expirePendingOrders(opts: ExpirePendingOrdersOptions): Promise<{ expired: number }>;
```

From frontend/src/lib/server/cron/auth.ts (Wave 0):
```typescript
export function verifyCronSecret(req: NextRequest): NextResponse | null;
```
</interfaces>

<reference_patterns>
- **Cron adapter shape:** RESEARCH §"Pattern 2"
- **D-14 helper invocation:** `expirePendingOrders({ prisma })` (default batchSize=100 — no need to override)
- **A3 acknowledgment:** the route does NOT compute `expiresAt` cutoff itself — the helper reads `Order.expiresAt` set at creation time. `ORDER_EXPIRATION_MINUTES` env is documentation-only for forks customizing their order-creation route.
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 RED test file (`frontend/src/app/api/cron/order-expiration/route.test.ts`) was authored in plan 05-01's worktree. Sibling Wave 1 plans ship parallel routes/files with NO `files_modified` overlap. Run `pnpm --filter frontend exec vitest run src/app/api/cron/order-expiration/route.test.ts` AFTER merge-back to confirm GREEN.
</sibling_plans_note>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/cron/order-expiration route adapter</name>
  <files>
    - frontend/src/app/api/cron/order-expiration/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/cron/order-expiration/route.test.ts (the contract)
    - frontend/src/lib/server/cron/auth.ts (verifyCronSecret signature)
    - frontend/src/lib/server/orders/expire.ts (expirePendingOrders signature — Wave 0)
    - frontend/src/lib/server/leader-lease.ts (withLease signature)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §7 "Order Expiration Helper"
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` exported
    2. `verifyCronSecret(req)` first; bail with NextResponse on fail
    3. `withLease(redis ?? undefined, 'order-expiration', 60_000, async () => { ... })`
    4. INSIDE the lease: `const { expired } = await expirePendingOrders({ prisma })`
    5. log.info `{ processed: expired, requestId }`
    6. Return `NextResponse.json({ ok: true, processed: expired }, { headers: { 'x-request-id': ctx.requestId } })`
  </behavior>
  <action>
Create `frontend/src/app/api/cron/order-expiration/route.ts`:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // D-10

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { expirePendingOrders } from '@/lib/server/orders/expire';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 60_000; // ~2 × maxDuration (Pitfall 3)

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let processed = 0;

    await withLease(redis ?? undefined, 'order-expiration', LEASE_TTL_MS, async () => {
      // D-14: helper reads Order.expiresAt set at creation time. ORDER_EXPIRATION_MINUTES
      // env is documentation-only — forks adjusting checkout windows tweak that value
      // in their order-creation route. This cron does NOT compute the cutoff itself.
      const { expired } = await expirePendingOrders({ prisma });
      processed = expired;
      log.info('order-expiration tick', { processed, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, processed },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

**Critical:**
- The route does NOT pass a `batchSize` arg — helper default (100) is correct per D-08.
- The route does NOT read `ORDER_EXPIRATION_MINUTES` env — that's a fork-customizable knob for the order-CREATION route (Phase 3) per RESEARCH A3.
- Do NOT modify: `cron/auth.ts`, `orders/expire.ts` (Wave 0 — call only), `leader-lease.ts`, `redis.ts`.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/cron/order-expiration/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/cron/order-expiration/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "export const dynamic = 'force-dynamic'" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "export const maxDuration = 30" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "verifyCronSecret(req)" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "withLease" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "'order-expiration'" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "expirePendingOrders" frontend/src/app/api/cron/order-expiration/route.ts` returns 1
    - `grep -c "ORDER_EXPIRATION_MINUTES" frontend/src/app/api/cron/order-expiration/route.ts` returns 0 (route does NOT read this env — A3)
    - `pnpm --filter frontend exec vitest run src/app/api/cron/order-expiration/route.test.ts` exits 0 (all RED tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - No protected file modified
  </acceptance_criteria>
  <done>POST /api/cron/order-expiration ships as ~40-LOC adapter; calls Wave 0 expirePendingOrders helper; all RED tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel→cron | `Authorization: Bearer ${CRON_SECRET}` |
| cron→DB | `expirePendingOrders` per-row tx with WHERE-guard against PAID-race |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-06-01 | S (Spoofing) | unauthenticated cron | mitigate | `verifyCronSecret(req)` first. |
| T-05-06-02 | T (Tampering) | race with concurrent webhook flipping PENDING→PAID | mitigate | Helper's per-row tx uses `updateMany WHERE id=$1 AND status='PENDING'` — webhook winner forces row count=0 here, helper skips. |
| T-05-06-03 | D (DoS) | unbounded findMany on Order table | mitigate | `take=100` (default batchSize); per-row tx prevents long-held lock. Worst case: O(100) per 5-min tick. |
| T-05-06-04 | E (Elevation of privilege) | cron downgrades PAID order back to EXPIRED | mitigate | Helper findMany filters `status='PENDING'` only; updateMany re-checks `status='PENDING'`. PAID rows are filtered out at both stages. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/cron/order-expiration/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- No protected file modified
</verification>

<success_criteria>
- POST /api/cron/order-expiration ships as ~40-LOC adapter
- Calls Wave 0 `expirePendingOrders({ prisma })` helper
- runtime + dynamic + maxDuration all exported
- All ≥ 3 Wave 0 RED order-expiration tests GREEN
- Zero modifications to PROTECTED files
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-06-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (≥ 3)
- Confirms ORDER_EXPIRATION_MINUTES env NOT read by route (A3)
</output>
</content>
</invoke>