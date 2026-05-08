---
id: 05-05-cron-verification-cleanup
phase: "05"
plan: 05
type: execute
wave: 1
depends_on:
  - 05-01-scaffold-cron-webhook-fixtures-tests
files_modified:
  - frontend/src/app/api/cron/verification-cleanup/route.ts
autonomous: true
task_count: 1
requirements:
  - CRON-03
  - CRON-06
must_haves:
  truths:
    - "POST without Bearer ${CRON_SECRET} returns 401"
    - "POST with correct CRON_SECRET deletes all VerificationCode rows where expiresAt < now() via prisma.verificationCode.deleteMany"
    - "Response is { ok: true, processed: N } where N is the deleteMany.count"
    - "Route exports runtime='nodejs', dynamic='force-dynamic', maxDuration=30"
    - "withLease called with name='verification-cleanup'"
  artifacts:
    - path: "frontend/src/app/api/cron/verification-cleanup/route.ts"
      provides: "POST /api/cron/verification-cleanup — Vercel cron handler (hourly)"
      exports: ["POST", "runtime", "dynamic", "maxDuration"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/cron/verification-cleanup/route.ts"
      to: "frontend/src/lib/server/cron/auth.ts"
      via: "verifyCronSecret(req) — first statement"
      pattern: "verifyCronSecret\\(req\\)"
    - from: "frontend/src/app/api/cron/verification-cleanup/route.ts"
      to: "prisma.verificationCode"
      via: "deleteMany({ where: { expiresAt: { lt: new Date() } } })"
      pattern: "verificationCode\\.deleteMany"
---

<objective>
Ship `POST /api/cron/verification-cleanup`: a Vercel cron route that (a) verifies CRON_SECRET, (b) wraps a `prisma.verificationCode.deleteMany` call in `withLease`, (c) returns the count of expired rows deleted. Implements CRON-03 + CRON-06.

Purpose: Without this cron, expired email-verification + password-reset codes accumulate forever (every signup adds a row). The route is a ~30-LOC thin adapter — D-13 explicitly forbids creating a `lib/server/auth/verification-cleanup.ts` helper since the work is a one-line deleteMany.

Output: One route handler file. All ≥ 3 Wave 0 RED verification-cleanup tests GREEN.
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
@frontend/src/app/api/cron/verification-cleanup/route.test.ts

<interfaces>
From frontend/prisma/schema.prisma:
```prisma
model VerificationCode {
  id        String   @id @default(cuid())
  email     String
  codeHash  String
  purpose   String   // EMAIL_VERIFY | PASSWORD_RESET
  expiresAt DateTime  // ← retention column
  createdAt DateTime @default(now())
}
```

From frontend/src/lib/server/cron/auth.ts (Wave 0):
```typescript
export function verifyCronSecret(req: NextRequest): NextResponse | null;
```
</interfaces>

<reference_patterns>
- **Cron adapter shape:** RESEARCH §"Pattern 2"
- **One-liner deleteMany:** RESEARCH §5 — `await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } })`
- **D-13 — no helper file:** verification-cleanup is intentionally inline in the route (no `lib/server/auth/verification-cleanup.ts`). If complexity grows later, refactor then.
</reference_patterns>
</context>

<sibling_plans_note>
The Wave 0 RED test file (`frontend/src/app/api/cron/verification-cleanup/route.test.ts`) was authored in plan 05-01's worktree. Sibling Wave 1 plans ship parallel routes/files with NO `files_modified` overlap. Run `pnpm --filter frontend exec vitest run src/app/api/cron/verification-cleanup/route.test.ts` AFTER merge-back to confirm GREEN.
</sibling_plans_note>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST /api/cron/verification-cleanup route adapter</name>
  <files>
    - frontend/src/app/api/cron/verification-cleanup/route.ts (NEW)
  </files>
  <read_first>
    - frontend/src/app/api/cron/verification-cleanup/route.test.ts (the contract)
    - frontend/src/lib/server/cron/auth.ts (verifyCronSecret signature)
    - frontend/src/lib/server/leader-lease.ts (withLease signature)
    - frontend/prisma/schema.prisma lines 150-163 (VerificationCode model — `expiresAt` is the retention column)
    - .planning/phases/05-webhooks-and-vercel-cron/05-RESEARCH.md §5 "verification-cleanup (one-liner per D-13)" (verbatim skeleton)
  </read_first>
  <behavior>
    1. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 30` exported (D-10)
    2. `verifyCronSecret(req)` first; bail with NextResponse on fail
    3. `withLease(redis ?? undefined, 'verification-cleanup', 60_000, async () => { ... })` — TTL = 60_000ms (2× maxDuration)
    4. INSIDE the lease: `const result = await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });`
    5. log.info `{ processed: result.count, requestId }`
    6. Return `NextResponse.json({ ok: true, processed: result.count }, { headers: { 'x-request-id': ctx.requestId } })`
  </behavior>
  <action>
Create `frontend/src/app/api/cron/verification-cleanup/route.ts` — verbatim from RESEARCH §5:

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
    let processed = 0;

    await withLease(redis ?? undefined, 'verification-cleanup', LEASE_TTL_MS, async () => {
      // D-13: inline deleteMany — single-query work doesn't deserve its own
      // lib helper. If complexity grows (e.g., per-purpose retention), refactor
      // to lib/server/auth/verification-cleanup.ts at that point.
      const result = await prisma.verificationCode.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      processed = result.count;
      log.info('verification-cleanup tick', { processed, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, processed },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

**Critical:**
- Do NOT create a `lib/server/auth/verification-cleanup.ts` helper (D-13 forbids it).
- The WHERE clause uses `expiresAt: { lt: new Date() }` (NOT `createdAt` — `expiresAt` is the per-row retention deadline set at creation time).
- `LEASE_TTL_MS = 60_000` — sufficient for a single deleteMany (sub-second in practice).
- Do NOT modify any of: `cron/auth.ts`, `leader-lease.ts`, `redis.ts`.
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/cron/verification-cleanup/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/cron/verification-cleanup/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "export const dynamic = 'force-dynamic'" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "export const maxDuration = 30" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "verifyCronSecret(req)" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "withLease" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "'verification-cleanup'" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "verificationCode.deleteMany" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `grep -c "expiresAt: { lt:" frontend/src/app/api/cron/verification-cleanup/route.ts` returns 1
    - `pnpm --filter frontend exec vitest run src/app/api/cron/verification-cleanup/route.test.ts` exits 0 (all RED tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - No protected file modified
    - No new file created at `frontend/src/lib/server/auth/verification-cleanup.ts` (D-13 — inline only)
  </acceptance_criteria>
  <done>POST /api/cron/verification-cleanup ships as ~30-LOC adapter; deleteMany inline; all RED tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Vercel→cron | `Authorization: Bearer ${CRON_SECRET}` is THE access boundary |
| cron→DB | Single deleteMany; no user input in WHERE clause |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-05-01 | S (Spoofing) | unauthenticated cron invocation | mitigate | `verifyCronSecret(req)` first statement. |
| T-05-05-02 | T (Tampering) | accidental deletion of un-expired rows | mitigate | WHERE clause is `expiresAt: { lt: new Date() }` — Prisma parameterizes; no string interpolation. Code review confirms `lt` (less-than) not `gt`. |
| T-05-05-03 | D (DoS) | mass-deletion lock contention | accept | Once-per-hour cadence keeps deletion volumes small (~1k rows max in normal load). DELETE on indexed `expiresAt` is fast. |
| T-05-05-04 | I (Information disclosure) | nothing — verification codes are hashed at rest | accept | The deleteMany doesn't read `codeHash` — no secret material in route flow. |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/cron/verification-cleanup/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec tsc -p tsconfig.json --noEmit` exits 0
- No protected file modified
- No new helper file at `lib/server/auth/verification-cleanup.ts`
</verification>

<success_criteria>
- POST /api/cron/verification-cleanup ships as ~30-LOC adapter
- deleteMany inline (D-13 — no helper file)
- runtime + dynamic + maxDuration all exported
- All ≥ 3 Wave 0 RED verification-cleanup tests GREEN
- Zero modifications to PROTECTED files
</success_criteria>

<output>
After completion, create `.planning/phases/05-webhooks-and-vercel-cron/05-05-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (≥ 3)
- Any deviation from RESEARCH §5 (none expected)
</output>
</content>
</invoke>