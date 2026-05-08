---
id: 05-04-cron-email-queue-drain
phase: "05"
plan: 04
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/src/app/api/cron/email-queue-drain/route.ts
autonomous: true
task_count: 1
requirements:
  - CRON-02
  - CRON-06
must_haves:
  truths:
    - "POST without Bearer ${CRON_SECRET} returns 401"
    - "POST with correct CRON_SECRET drains up to 100 EmailJob rows by calling EmailQueue.drainOne() in a loop"
    - "Loop stops early when drainOne returns false (queue empty)"
    - "When getEmailQueue() returns null (env missing), route returns { ok: true, processed: 0 } without error"
    - "Route exports runtime='nodejs', dynamic='force-dynamic', maxDuration=60"
    - "withLease called with name='email-queue-drain' and ttlMs ≥ 60_000"
  artifacts:
    - path: "frontend/src/app/api/cron/email-queue-drain/route.ts"
      provides: "POST /api/cron/email-queue-drain — Vercel cron handler (every 1 minute)"
      exports: ["POST", "runtime", "dynamic", "maxDuration"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/cron/email-queue-drain/route.ts"
      to: "frontend/src/lib/server/cron/auth.ts"
      via: "verifyCronSecret(req) — first statement"
      pattern: "verifyCronSecret\\(req\\)"
    - from: "frontend/src/app/api/cron/email-queue-drain/route.ts"
      to: "frontend/src/lib/server/queues/email-queue-singleton.ts"
      via: "getEmailQueue() — null when UPSTASH+RESEND env missing"
      pattern: "getEmailQueue"
    - from: "frontend/src/app/api/cron/email-queue-drain/route.ts"
      to: "EmailQueue.drainOne() (PROTECTED — call only)"
      via: "for-loop up to BATCH_SIZE=100, break on false"
      pattern: "drainOne"
---

<objective>
Ship `POST /api/cron/email-queue-drain`: a Vercel cron route that (a) verifies CRON_SECRET, (b) wraps work in `withLease(redis, 'email-queue-drain', 120_000, fn)`, (c) calls `EmailQueue.drainOne()` up to 100 times, breaking early when the queue is empty. Implements CRON-02 + CRON-06.

Purpose: The outbox-drain produces EmailJob rows; this cron consumes them by sending via Resend. Without this route, no emails are ever delivered. The route is a ~50-LOC thin adapter — every line of business logic lives in PROTECTED helpers.

Output: One route handler file. All ≥ 4 Wave 0 RED email-queue-drain tests GREEN.
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
@frontend/src/lib/server/queues/email-queue.ts
@frontend/src/lib/server/queues/email-queue-singleton.ts
@frontend/src/lib/server/redis.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/src/app/api/cron/email-queue-drain/route.test.ts

<interfaces>
From frontend/src/lib/server/queues/email-queue.ts (PROTECTED):
```typescript
export class EmailQueue {
  drainOne(): Promise<boolean>; // true = job processed; false = queue empty
}
```

From frontend/src/lib/server/queues/email-queue-singleton.ts (Wave 0):
```typescript
export function getEmailQueue(): EmailQueue | null;
// returns null when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN / RESEND_API_KEY missing
```

From frontend/src/lib/server/leader-lease.ts (PROTECTED):
```typescript
export async function withLease(redis, name, ttlMs, fn): Promise<void>;
```

From frontend/src/lib/server/cron/auth.ts (Wave 0):
```typescript
export function verifyCronSecret(req: NextRequest): NextResponse | null;
```
</interfaces>

<reference_patterns>
- **Cron adapter shape:** RESEARCH §"Pattern 2: Cron Adapter Route" — same structure as outbox-drain
- **EmailQueue.drainOne() loop:** RESEARCH §4 "Email-Queue-Drain Pattern" — verbatim for-loop with `break` on `!handled`
- **No-mailer graceful no-op:** RESEARCH §4 — `if (!queue) { log.warn(...); return; }` returns `{ ok: true, processed: 0 }`
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 RED test file (`frontend/src/app/api/cron/email-queue-drain/route.test.ts`) was authored in plan 05-01's worktree. Sibling Wave 1 plans ship parallel routes/files with NO `files_modified` overlap. Run `pnpm --filter frontend exec vitest run src/app/api/cron/email-queue-drain/route.test.ts` AFTER merge-back to confirm GREEN.
</sibling_plans_note>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/cron/email-queue-drain route adapter</name>
  <files>
    - frontend/src/app/api/cron/email-queue-drain/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/cron/email-queue-drain/route.test.ts (the contract — every test must pass)
    - frontend/src/lib/server/cron/auth.ts (verifyCronSecret signature)
    - frontend/src/lib/server/queues/email-queue-singleton.ts (getEmailQueue: null when env missing)
    - frontend/src/lib/server/queues/email-queue.ts lines 100-101 (drainOne signature: returns boolean)
    - frontend/src/lib/server/leader-lease.ts (withLease semantics)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §4 "Email-Queue-Drain Pattern" (verbatim skeleton)
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60` exported
    2. `verifyCronSecret(req)` first; bail with NextResponse on fail
    3. Enter request context for log correlation
    4. `withLease(redis ?? undefined, 'email-queue-drain', 120_000, async () => { ... })`
    5. INSIDE the lease:
       a. `getEmailQueue()` — if `null`, log.warn + return (processed stays 0)
       b. Loop: `for (let i = 0; i < BATCH_SIZE; i++) { const handled = await queue.drainOne(); if (!handled) break; processed++; }`
       c. log.info `{ processed, requestId }`
    6. Return `NextResponse.json({ ok: true, processed }, { headers: { 'x-request-id': ctx.requestId } })`
  </behavior>
  <action>
Create `frontend/src/app/api/cron/email-queue-drain/route.ts` — verbatim from RESEARCH §4:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // D-10

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { redis } from '@/lib/server/redis';
import { getEmailQueue } from '@/lib/server/queues/email-queue-singleton';
import { createLogger } from '@/lib/server/logger';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const log = createLogger();
const BATCH_SIZE = 100; // D-08
const LEASE_TTL_MS = 120_000; // ~2 × maxDuration (Pitfall 3)

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let processed = 0;

    await withLease(redis ?? undefined, 'email-queue-drain', LEASE_TTL_MS, async () => {
      const queue = getEmailQueue();
      if (!queue) {
        // No mailer/redis configured — graceful no-op. Operators see this in
        // logs and can wire UPSTASH_REDIS_REST_URL + RESEND_API_KEY.
        log.warn('email-queue-drain: not configured (UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN/RESEND_API_KEY missing)', {
          requestId: ctx.requestId,
        });
        return;
      }

      for (let i = 0; i < BATCH_SIZE; i++) {
        const handled = await queue.drainOne();
        if (!handled) break; // queue empty
        processed++;
      }

      log.info('email-queue-drain tick', { processed, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, processed },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

**Critical:**
- The `for` loop MUST `break` on `!handled` — without it, the loop runs 100 useless iterations after the queue empties.
- `BATCH_SIZE = 100` hard-coded (D-08, NOT env-configurable).
- `LEASE_TTL_MS = 120_000` (≥ 60_000 per the test).
- The `if (!queue)` early-return inside the lease must NOT throw — graceful no-op behavior is asserted by the test "returns processed=0 when getEmailQueue returns null".
- Do NOT modify any of: `cron/auth.ts`, `queues/email-queue.ts`, `queues/email-queue-singleton.ts`, `leader-lease.ts`, `redis.ts`.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/cron/email-queue-drain/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/cron/email-queue-drain/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "export const dynamic = 'force-dynamic'" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "export const maxDuration = 60" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "verifyCronSecret(req)" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "withLease" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "'email-queue-drain'" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "getEmailQueue" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "drainOne" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "BATCH_SIZE = 100" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `grep -c "if (!handled) break" frontend/src/app/api/cron/email-queue-drain/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/cron/email-queue-drain/route.test.ts` exits 0 (all RED tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - No protected file modified
  </acceptance_criteria>
  <done>POST /api/cron/email-queue-drain ships; drainOne loop honors BATCH_SIZE + early-break on empty; null-queue path returns processed=0 gracefully; all RED tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel→cron | `Authorization: Bearer ${CRON_SECRET}` is THE access boundary |
| cron→Resend | `EmailQueue.drainOne()` makes outbound HTTPS calls to Resend with API key |
| cron→Redis | `withLease` SET NX EX + JobQueue list pop both use Upstash |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-04-01 | S (Spoofing) | unauthenticated cron invocation | mitigate | `verifyCronSecret(req)` first statement (Wave 0). |
| T-05-04-02 | I (Information disclosure) | RESEND_API_KEY leakage via logs | mitigate | EmailQueue (PROTECTED) does not log the key; route logs only `{ processed, requestId }`. The lazy-init singleton reads the key at construction and forgets it. |
| T-05-04-03 | D (DoS) | runaway loop sends 1000s of emails | mitigate | `BATCH_SIZE = 100` cap + `maxDuration = 60` Vercel timeout + EmailQueue MAX_ATTEMPTS=5+DEAD-letter prevents infinite retry. |
| T-05-04-04 | T (Tampering) | EmailJob row mutated mid-drain | accept | EmailQueue (PROTECTED) uses Postgres `EmailJob.status` transitions PENDING→SENT/FAILED/DEAD with explicit prisma updates; race conditions handled by JobQueue's visibility-timeout + atomic claim. |
| T-05-04-05 | I | email content / recipient leaked via log | accept | `EmailQueue.drainOne()` logs job id only on success; on failure logs the error message (which may contain Resend's error body). Sentry/log access is authenticated. |
| T-05-04-06 | E (Elevation of privilege) | drainOne sends email "from" address controlled by attacker | mitigate | `EMAIL_FROM` env (set by operator) is the only `from` value used; the email-queue-singleton constructs the mailer with this constant. Job payload supplies `to`/`subject`/`html` only. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/cron/email-queue-drain/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- No protected file modified
</verification>

<success_criteria>
- POST /api/cron/email-queue-drain ships as ~50-LOC adapter
- drainOne loop respects BATCH_SIZE + early-break on `!handled`
- Null-queue path returns `{ ok: true, processed: 0 }` (no throw)
- runtime + dynamic + maxDuration all exported
- All ≥ 4 Wave 0 RED email-queue-drain tests GREEN
- Zero modifications to PROTECTED files
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-04-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (≥ 4 from email-queue-drain/route.test.ts)
- Lease TTL chosen (120_000ms)
- Any deviation from RESEARCH §4
</output>
</content>
</invoke>