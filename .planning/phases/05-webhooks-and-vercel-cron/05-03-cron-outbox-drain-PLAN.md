---
id: 05-03-cron-outbox-drain
phase: "05"
plan: 03
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/src/app/api/cron/outbox-drain/route.ts
autonomous: true
task_count: 1
requirements:
  - CRON-01
  - CRON-06
must_haves:
  truths:
    - "POST without Bearer ${CRON_SECRET} returns 401"
    - "POST with correct CRON_SECRET resets stuck PROCESSING rows older than 90s, then drains up to 100 PENDING rows"
    - "Response is { ok: true, processed: N } where N matches drainOutbox return"
    - "Stuck-row reset query runs BEFORE drainOutbox (D-09 — first step inside lease)"
    - "Route exports runtime='nodejs', dynamic='force-dynamic', maxDuration=60"
    - "withLease called with name='outbox-drain' and ttlMs ≥ 60_000 (Pitfall 3 — 2× maxDuration)"
  artifacts:
    - path: "frontend/src/app/api/cron/outbox-drain/route.ts"
      provides: "POST /api/cron/outbox-drain — Vercel cron handler (every 1 minute)"
      exports: ["POST", "runtime", "dynamic", "maxDuration"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/cron/outbox-drain/route.ts"
      to: "frontend/src/lib/server/cron/auth.ts"
      via: "verifyCronSecret(req) — first statement after handler entry"
      pattern: "verifyCronSecret\\(req\\)"
    - from: "frontend/src/app/api/cron/outbox-drain/route.ts"
      to: "frontend/src/lib/server/leader-lease.ts (PROTECTED — call only)"
      via: "withLease(redis, 'outbox-drain', LEASE_TTL_MS, fn)"
      pattern: "withLease"
    - from: "frontend/src/app/api/cron/outbox-drain/route.ts"
      to: "frontend/src/lib/server/outbox/dispatcher.ts (PROTECTED — call only)"
      via: "drainOutbox({ prisma, emailQueue }, 100)"
      pattern: "drainOutbox"
    - from: "frontend/src/app/api/cron/outbox-drain/route.ts"
      to: "prisma.outboxEvent.updateMany"
      via: "stuck-PROCESSING reset BEFORE drainOutbox (D-09)"
      pattern: "outboxEvent\\.updateMany"
---

<objective>
Ship `POST /api/cron/outbox-drain`: a Vercel cron route that (a) verifies CRON_SECRET, (b) wraps work in `withLease(redis, 'outbox-drain', 120_000, fn)`, (c) resets stuck PROCESSING rows older than 90s, (d) drains up to 100 OutboxEvent rows via the protected `drainOutbox` dispatcher. Implements CRON-01 + CRON-06.

Purpose: Every webhook handler enqueues outbox rows; this cron drains them. Without this route, no notification emails are ever sent and no in-app notifications appear. The route is a ~50-LOC thin adapter — every line of business logic lives in PROTECTED helpers.

Output: One route handler file. All ≥ 5 Wave 0 RED outbox-drain tests GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-webhooks-and-vercel-cron/05-CONTEXT.md
@.planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md
@.planning/phases/05-webhooks-and-vercel-cron/05-VALIDATION.md
@CLAUDE.md

@frontend/src/lib/server/cron/auth.ts
@frontend/src/lib/server/outbox/dispatcher.ts
@frontend/src/lib/server/leader-lease.ts
@frontend/src/lib/server/queues/email-queue-singleton.ts
@frontend/src/lib/server/redis.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/src/app/api/cron/outbox-drain/route.test.ts

<interfaces>
From frontend/src/lib/server/cron/auth.ts (Wave 0):
```typescript
export function verifyCronSecret(req: NextRequest): NextResponse | null;
// returns null on pass; NextResponse(401) on fail; NextResponse(500) when CRON_SECRET unset
```

From frontend/src/lib/server/outbox/dispatcher.ts (PROTECTED):
```typescript
export interface OutboxDispatcherDeps { prisma: PrismaClient; emailQueue?: EmailQueue; }
export async function drainOutbox(
  deps: OutboxDispatcherDeps,
  batchSize?: number,
): Promise<{ processed: number; succeeded: number; failed: number; dead: number }>;
```

From frontend/src/lib/server/leader-lease.ts (PROTECTED):
```typescript
export async function withLease(
  redis: Redis | undefined,
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<void>;
// No-Redis fallback: runs fn() unconditionally when redis === undefined.
```

From frontend/src/lib/server/queues/email-queue-singleton.ts (Wave 0):
```typescript
export function getEmailQueue(): EmailQueue | null;
```

From frontend/prisma/schema.prisma:
```prisma
model OutboxEvent {
  status String       // PENDING | PROCESSING | SENT | FAILED | DEAD
  scheduledAt DateTime @default(now())
  // NO startedAt — stuck-row reset uses scheduledAt as proxy (RESEARCH §3 + Pitfall 7)
}
```
</interfaces>

<reference_patterns>
- **Cron adapter shape:** RESEARCH §"Pattern 2: Cron Adapter Route (canonical shape)" — verbatim 50-LOC skeleton
- **Stuck-row reset:** RESEARCH §3 "Stuck-row reset query (Prisma-friendly form)" — `prisma.outboxEvent.updateMany({ where: { status: 'PROCESSING', scheduledAt: { lt: <now-90s> } }, data: { status: 'PENDING', scheduledAt: <now> } })`
- **Lease TTL:** Pitfall 3 — `LEASE_TTL_MS = 2 * maxDuration * 1000` = 120_000ms for outbox-drain
- **Pitfall 4 acknowledgment:** rows reset from PROCESSING carry their `attempts++` history → backoff index uses `attempts - 1` so reset row hits a longer backoff slot (acceptable feature, not a bug)
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 RED test file (`frontend/src/app/api/cron/outbox-drain/route.test.ts`) was authored in plan 05-01's worktree. Sibling Wave 1 plans (05-02, 05-04..05-08) ship parallel routes/files with NO `files_modified` overlap, so this plan can run in its own worktree without conflict. Run `pnpm --filter frontend exec vitest run src/app/api/cron/outbox-drain/route.test.ts` AFTER merge-back to confirm GREEN.
</sibling_plans_note>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/cron/outbox-drain route adapter</name>
  <files>
    - frontend/src/app/api/cron/outbox-drain/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/cron/outbox-drain/route.test.ts (the contract — every test must pass)
    - frontend/src/lib/server/cron/auth.ts (verifyCronSecret signature)
    - frontend/src/lib/server/outbox/dispatcher.ts (drainOutbox return shape — { processed, succeeded, failed, dead })
    - frontend/src/lib/server/leader-lease.ts (withLease semantics + no-Redis fallback)
    - frontend/src/lib/server/queues/email-queue-singleton.ts (getEmailQueue: returns null if env missing)
    - frontend/src/lib/server/observability/request-context.ts (makeRequestContext + withRequestContext)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §"Pattern 2" (verbatim) + §3 "Outbox-Drain Route Shim"
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60` exported (Pitfall 2 + D-10)
    2. `verifyCronSecret(req)` first; bail with returned NextResponse if non-null (CRON-06)
    3. Enter `makeRequestContext(req.headers)` + `withRequestContext(ctx, async () => { ... })` for log correlation
    4. `withLease(redis ?? undefined, 'outbox-drain', 120_000, async () => { ... })` — TTL ~2× maxDuration (Pitfall 3)
    5. INSIDE the lease, in this exact order:
       a. **FIRST:** `prisma.outboxEvent.updateMany({ where: { status: 'PROCESSING', scheduledAt: { lt: new Date(Date.now() - 90_000) } }, data: { status: 'PENDING', scheduledAt: new Date() } })` — D-09 stuck-row reset
       b. `getEmailQueue()` → may be null (graceful: dispatcher will throw "email queue not configured" for `email.*` events, which surfaces as a row retry — acceptable)
       c. `drainOutbox({ prisma, emailQueue: queue ?? undefined }, 100)` — D-08 BATCH_SIZE
       d. log `{ processed, succeeded, failed, dead, requestId }` once per drain
    6. Return `NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } })`
  </behavior>
  <action>
Create `frontend/src/app/api/cron/outbox-drain/route.ts` — verbatim from RESEARCH §"Pattern 2" with the email-queue-singleton wiring per RESEARCH §3:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // D-10

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { drainOutbox } from '@/lib/server/outbox/dispatcher';
import { getEmailQueue } from '@/lib/server/queues/email-queue-singleton';
import { redis } from '@/lib/server/redis';
import { prisma } from '@/lib/server/prisma';
import { createLogger } from '@/lib/server/logger';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const log = createLogger();
const BATCH_SIZE = 100; // D-08
const STUCK_RESET_MS = 90_000; // D-09 — 90 seconds
const LEASE_TTL_MS = 120_000; // ~2 × maxDuration (Pitfall 3)

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let processed = 0;

    await withLease(redis ?? undefined, 'outbox-drain', LEASE_TTL_MS, async () => {
      // 1. FIRST step (D-09): reset stuck PROCESSING rows older than 90s.
      // OutboxEvent has no `startedAt` column — `scheduledAt` is the cutoff
      // proxy (Pitfall 7). The dispatcher does NOT update scheduledAt on
      // claim, so a row stuck for ≥90s reliably matches the WHERE clause.
      // Pitfall 4: reset rows carry their `attempts++` history; backoff
      // index uses `attempts - 1` so reset rows hit a longer backoff slot.
      // Acceptable — chronic failures back off more aggressively.
      await prisma.outboxEvent.updateMany({
        where: {
          status: 'PROCESSING',
          scheduledAt: { lt: new Date(Date.now() - STUCK_RESET_MS) },
        },
        data: { status: 'PENDING', scheduledAt: new Date() },
      });

      // 2. Drain. EmailQueue is required for `email.*` outbox kinds; if
      // unconfigured (no UPSTASH+RESEND env), dispatcher throws per-row
      // and rows retry per existing backoff. Graceful degradation.
      const queue = getEmailQueue();
      const result = await drainOutbox(
        { prisma, ...(queue ? { emailQueue: queue } : {}) },
        BATCH_SIZE,
      );
      processed = result.processed;
      log.info('outbox-drain tick', {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        dead: result.dead,
        requestId: ctx.requestId,
      });
    });

    return NextResponse.json(
      { ok: true, processed },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

**Critical:**
- The stuck-row reset MUST run BEFORE drainOutbox — the test asserts call ordering via `mock.invocationCallOrder`.
- `BATCH_SIZE = 100` is hard-coded per D-08 (not env-configurable in v1).
- `LEASE_TTL_MS = 120_000` (≥ 60_000 per the test). Setting it to maxDuration (60_000) would risk Pitfall 3 (lease expires mid-execution).
- Do NOT call `req.json()` or `req.text()` — cron POSTs from Vercel have no body.
- Do NOT modify any of: `cron/auth.ts` (just shipped Wave 0 — call only), `outbox/dispatcher.ts`, `leader-lease.ts`, `queues/email-queue-singleton.ts` (Wave 0 — call only), `redis.ts`.
- The `getEmailQueue()` returns `EmailQueue | null`; spread `...(queue ? { emailQueue: queue } : {})` so the optional `emailQueue` field on `OutboxDispatcherDeps` is omitted when null (TS `exactOptionalPropertyTypes` requires this — assigning `undefined` to an optional field is rejected).
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/cron/outbox-drain/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/cron/outbox-drain/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "export const dynamic = 'force-dynamic'" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "export const maxDuration = 60" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "verifyCronSecret(req)" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "withLease" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "'outbox-drain'" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "drainOutbox" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "BATCH_SIZE = 100" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "status: 'PROCESSING'" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1 (stuck-row reset WHERE)
    - `grep -c "outboxEvent.updateMany" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `grep -c "getEmailQueue" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/cron/outbox-drain/route.test.ts` exits 0 (all RED tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - No protected file modified (`git diff --name-only` lists only `frontend/src/app/api/cron/outbox-drain/route.ts`)
  </acceptance_criteria>
  <done>POST /api/cron/outbox-drain ships; stuck-row reset runs before drainOutbox; lease TTL = 120s; all Wave 0 RED tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel→cron | `Authorization: Bearer ${CRON_SECRET}` is THE access boundary |
| cron→DB | Stuck-row reset + drainOutbox both run as separate SQL transactions |
| cron→Redis | `withLease` SET NX EX coordinates multi-instance workers |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-03-01 | S (Spoofing) | unauthenticated cron invocation | mitigate | `verifyCronSecret(req)` first statement; 401 before any DB/Redis call. Constant-time compare via `crypto.timingSafeEqual` (Wave 0). |
| T-05-03-02 | T (Tampering) | stuck-row reset opens a recovery window for malicious actor | accept | An attacker would need DB write access to set rows status='PROCESSING' with old scheduledAt — assumes app DB is compromised, in which case this cron is the least of their problems. The reset only flips PROCESSING→PENDING, no payload mutation. |
| T-05-03-03 | I (Information disclosure) | log line exposes internal counts | accept | `log.info` emits `{ processed, succeeded, failed, dead }` — operational metrics, not user data. Sentry/log aggregator access is authenticated. |
| T-05-03-04 | D (DoS) | unbounded drain consumes Vercel function time | mitigate | `BATCH_SIZE = 100` caps per-invocation work. `maxDuration = 60s` enforces Vercel timeout. Lease TTL = 120s = 2× maxDuration prevents two parallel drains (Pitfall 3). |
| T-05-03-05 | E (Elevation of privilege) | drainOutbox runs as `prisma` (full DB perms) | accept | `prisma` is the project's superuser — same as every other route. Per-row event handlers are dispatcher-controlled (PROTECTED), no untrusted input dictates DB writes. |
| T-05-03-06 | T | duplicate drains across multi-region Vercel deploy | mitigate | `withLease` Redis NX+EX coordinates. No-Redis fallback (single-instance dev) accepts the race per CLAUDE.md "documented limitation". |
| T-05-03-07 | I | CRON_SECRET appears in headers → cached by an upstream proxy | accept | Vercel Cron is region-internal traffic; cookies/headers not cached by external CDN. Defense-in-depth via timingSafeEqual. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/cron/outbox-drain/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- No protected file modified
- `grep -c "BATCH_SIZE = 100" frontend/src/app/api/cron/outbox-drain/route.ts` returns 1 (D-08)
- `grep -c "STUCK_RESET" frontend/src/app/api/cron/outbox-drain/route.ts` returns ≥ 1 (D-09)
</verification>

<success_criteria>
- POST /api/cron/outbox-drain ships as ~60-LOC adapter
- verifyCronSecret first; withLease(name='outbox-drain', ttl=120_000) wraps work
- Stuck-row reset (90s) runs FIRST inside the lease — verified by call-order test
- drainOutbox called with BATCH_SIZE=100 + EmailQueue (when configured)
- runtime + dynamic + maxDuration all exported
- All ≥ 5 Wave 0 RED outbox-drain tests GREEN
- Zero modifications to PROTECTED files
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-03-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (≥ 5 from outbox-drain/route.test.ts)
- Lease TTL chosen (120_000ms = 2× maxDuration)
- Any deviation from RESEARCH §"Pattern 2" (e.g., if email-queue-singleton import path differs)
</output>
</content>
</invoke>