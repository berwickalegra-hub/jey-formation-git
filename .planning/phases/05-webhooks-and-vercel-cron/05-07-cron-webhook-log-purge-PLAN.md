---
id: 05-07-cron-webhook-log-purge
phase: "05"
plan: 07
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/src/app/api/cron/webhook-log-purge/route.ts
autonomous: true
task_count: 1
requirements:
  - CRON-05
  - CRON-06
must_haves:
  truths:
    - "POST without Bearer ${CRON_SECRET} returns 401"
    - "POST with correct CRON_SECRET deletes WebhookLog rows older than WEBHOOK_LOG_RETENTION_DAYS via prisma.webhookLog.deleteMany"
    - "Cutoff = now() - WEBHOOK_LOG_RETENTION_DAYS days; default 90 days when env unset"
    - "WHERE column is `createdAt` (NOT `receivedAt` — schema verified A2)"
    - "Response is { ok: true, processed: N } where N is the deleteMany.count"
    - "Route exports runtime='nodejs', dynamic='force-dynamic', maxDuration=30"
    - "withLease called with name='webhook-log-purge'"
  artifacts:
    - path: "frontend/src/app/api/cron/webhook-log-purge/route.ts"
      provides: "POST /api/cron/webhook-log-purge — Vercel cron handler (daily)"
      exports: ["POST", "runtime", "dynamic", "maxDuration"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/cron/webhook-log-purge/route.ts"
      to: "frontend/src/lib/server/cron/auth.ts"
      via: "verifyCronSecret(req) — first statement"
      pattern: "verifyCronSecret\\(req\\)"
    - from: "frontend/src/app/api/cron/webhook-log-purge/route.ts"
      to: "prisma.webhookLog"
      via: "deleteMany({ where: { createdAt: { lt: cutoff } } })"
      pattern: "webhookLog\\.deleteMany"
    - from: "frontend/src/app/api/cron/webhook-log-purge/route.ts"
      to: "process.env.WEBHOOK_LOG_RETENTION_DAYS"
      via: "Number(... ?? 90) at handler-call time (Pitfall 6)"
      pattern: "WEBHOOK_LOG_RETENTION_DAYS"
---

<objective>
Ship `POST /api/cron/webhook-log-purge`: a Vercel cron route that (a) verifies CRON_SECRET, (b) wraps a `prisma.webhookLog.deleteMany` call in `withLease`, (c) computes the retention cutoff from `WEBHOOK_LOG_RETENTION_DAYS` env (default 90), (d) returns the count of deleted rows. Implements CRON-05 + CRON-06.

Purpose: Without this cron, the WebhookLog dedup table grows unboundedly (one row per (provider, externalId, eventType)). The route is a ~40-LOC thin adapter — D-15 explicitly forbids creating a `lib/server/webhook/purge.ts` helper (single-query work).

Output: One route handler file. All ≥ 3 Wave 0 RED webhook-log-purge tests GREEN.
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
@frontend/src/lib/server/redis.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/prisma/schema.prisma
@frontend/src/app/api/cron/webhook-log-purge/route.test.ts

<interfaces>
From frontend/prisma/schema.prisma lines 255-266 (verified):
```prisma
model WebhookLog {
  id          String    @id @default(cuid())
  provider    String
  externalId  String
  eventType   String
  payload     Json
  processedAt DateTime?
  createdAt   DateTime  @default(now())   // ← retention column (A2 — NOT receivedAt)
  @@unique([externalId, eventType])
  @@index([provider, createdAt])
}
```

From frontend/src/lib/server/cron/auth.ts (Wave 0):
```typescript
export function verifyCronSecret(req: NextRequest): NextResponse | null;
```
</interfaces>

<reference_patterns>
- **Cron adapter shape:** RESEARCH §"Pattern 2"
- **Inline deleteMany (D-15):** RESEARCH §8 — verbatim skeleton
- **A2 column name:** WebhookLog has `createdAt` only (NOT `receivedAt`). RESEARCH explicitly flags this as a planner-brief correction.
- **Default retention:** 90 days (D-11) when env unset; otherwise `Number(env)`.
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 RED test file (`frontend/src/app/api/cron/webhook-log-purge/route.test.ts`) was authored in plan 05-01's worktree. Sibling Wave 1 plans ship parallel routes/files with NO `files_modified` overlap. Run `pnpm --filter frontend exec vitest run src/app/api/cron/webhook-log-purge/route.test.ts` AFTER merge-back to confirm GREEN.
</sibling_plans_note>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/cron/webhook-log-purge route adapter</name>
  <files>
    - frontend/src/app/api/cron/webhook-log-purge/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/cron/webhook-log-purge/route.test.ts (the contract — asserts createdAt cutoff math, default 90)
    - frontend/src/lib/server/cron/auth.ts (verifyCronSecret signature)
    - frontend/prisma/schema.prisma lines 255-266 (WebhookLog model — createdAt is the only retention column)
    - frontend/src/lib/server/leader-lease.ts (withLease signature)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §8 "WebhookLog Purge" (verbatim skeleton)
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` exported (D-10)
    2. `verifyCronSecret(req)` first; bail with NextResponse on fail
    3. Read `WEBHOOK_LOG_RETENTION_DAYS` at handler-call time (Pitfall 6 — supports vi.stubEnv): `const days = Number(process.env.WEBHOOK_LOG_RETENTION_DAYS ?? 90)` (default 90 per D-11)
    4. Compute `cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)`
    5. `withLease(redis ?? undefined, 'webhook-log-purge', 60_000, async () => { ... })`
    6. INSIDE the lease: `const result = await prisma.webhookLog.deleteMany({ where: { createdAt: { lt: cutoff } } })` — A2: column is `createdAt`, NOT `receivedAt`
    7. log.info `{ processed: result.count, days, requestId }`
    8. Return `NextResponse.json({ ok: true, processed: result.count }, { headers: { 'x-request-id': ctx.requestId } })`
  </behavior>
  <action>
Create `frontend/src/app/api/cron/webhook-log-purge/route.ts` — verbatim from RESEARCH §8:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // D-10

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
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
    // Pitfall 6: read env at handler-call time so vi.stubEnv works in tests.
    const days = Number(process.env.WEBHOOK_LOG_RETENTION_DAYS ?? 90); // D-11 default
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let processed = 0;

    await withLease(redis ?? undefined, 'webhook-log-purge', LEASE_TTL_MS, async () => {
      // D-15 + A2: inline deleteMany; column is `createdAt` (schema-verified —
      // there is no `receivedAt` column on WebhookLog).
      const result = await prisma.webhookLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      processed = result.count;
      log.info('webhook-log-purge tick', { processed, days, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, processed },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

**Critical:**
- The WHERE column is `createdAt`, NOT `receivedAt` (A2). The orchestrator brief originally said `receivedAt`; the schema doesn't have that column — using it would silently fail with Prisma type error or zero deletions.
- Read env INSIDE the handler, not at module top (Pitfall 6 — `vi.stubEnv` is the test contract).
- `Number(... ?? 90)` returns NaN if env is non-numeric; the test stubs `'30'` so the math is `Date.now() - 30 * 86400000`. If you want defensive `Number.isFinite` guard, accept the test still passes — but match the verbatim skeleton.
- Do NOT create a `lib/server/webhook/purge.ts` helper (D-15 — inline only).
- Do NOT modify: `cron/auth.ts`, `leader-lease.ts`, `redis.ts`.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/cron/webhook-log-purge/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/cron/webhook-log-purge/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "export const dynamic = 'force-dynamic'" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "export const maxDuration = 30" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "verifyCronSecret(req)" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "withLease" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "'webhook-log-purge'" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "webhookLog.deleteMany" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1
    - `grep -c "WEBHOOK_LOG_RETENTION_DAYS" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns ≥ 1
    - `grep -c "createdAt: { lt:" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 1 (A2 — createdAt, not receivedAt)
    - `grep -c "receivedAt" frontend/src/app/api/cron/webhook-log-purge/route.ts` returns 0 (must NOT use receivedAt — column doesn't exist)
    - `pnpm --filter frontend exec vitest run src/app/api/cron/webhook-log-purge/route.test.ts` exits 0 (all RED tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - No protected file modified
    - No new file created at `frontend/src/lib/server/webhook/purge.ts` (D-15)
  </acceptance_criteria>
  <done>POST /api/cron/webhook-log-purge ships as ~40-LOC adapter; createdAt cutoff math correct; default 90 days; all RED tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel→cron | `Authorization: Bearer ${CRON_SECRET}` |
| cron→DB | Single deleteMany scoped by createdAt cutoff |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-07-01 | S (Spoofing) | unauthenticated cron | mitigate | `verifyCronSecret(req)` first. |
| T-05-07-02 | T (Tampering) | misconfigured retention deletes recent logs | mitigate | Default 90 days in code (D-11) — test asserts default with env unset. Operator must explicitly set a smaller value. |
| T-05-07-03 | D (DoS) | mass deletion lock contention | accept | Daily cadence keeps batch sizes bounded; deleteMany on `@@index([provider, createdAt])` is fast. |
| T-05-07-04 | I | webhook payloads contain sensitive data | accept | WebhookLog stores raw payload (already a Phase 2 trust decision); purge merely deletes — does not exfiltrate. |
| T-05-07-05 | E | env-poisoning sets retention=0 | mitigate | Operator-controlled env var; not user-influenced. Defense-in-depth: a future enhancement could clamp `Number.isFinite(days) && days >= 1`. v1 accepts. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/cron/webhook-log-purge/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- No protected file modified
- No new helper file at `lib/server/webhook/purge.ts`
</verification>

<success_criteria>
- POST /api/cron/webhook-log-purge ships as ~40-LOC adapter
- WHERE column is `createdAt` (A2)
- Default 90 days (D-11) when env unset
- Env read at handler-call time (Pitfall 6)
- runtime + dynamic + maxDuration all exported
- All ≥ 3 Wave 0 RED webhook-log-purge tests GREEN
- Zero modifications to PROTECTED files
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-07-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (≥ 3)
- Confirms createdAt column used (A2 — not receivedAt)
- Confirms default 90 days when WEBHOOK_LOG_RETENTION_DAYS unset (D-11)
</output>
</content>
</invoke>