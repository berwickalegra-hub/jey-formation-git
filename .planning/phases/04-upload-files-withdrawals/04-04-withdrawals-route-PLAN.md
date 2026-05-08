---
phase: 04-upload-files-withdrawals
plan: 04
type: execute
wave: 1
depends_on:
  - 04-01
files_modified:
  - frontend/src/app/api/withdrawals/route.ts
autonomous: true
requirements:
  - WD-01
  - WD-02
  - WD-03
  - WD-04
must_haves:
  truths:
    - "Authenticated user with valid PIN + sufficient balance can POST /api/withdrawals → 201 + PENDING row"
    - "All 8 stable withdrawal error codes map to correct HTTP statuses returned by validateWithdrawalRequest"
    - "Two concurrent POSTs for same user resolve to exactly 1 PENDING + 1 INSUFFICIENT_BALANCE (advisory lock + Serializable tx)"
    - "GET /api/withdrawals returns caller's own withdrawals only, ordered requestedAt DESC, cursor-paginated"
    - "WITHDRAWAL_BALANCE_CHECK=0 documented + tested: same excessive amount returns 201 (check skipped)"
  artifacts:
    - path: "frontend/src/app/api/withdrawals/route.ts"
      provides: "POST + GET /api/withdrawals — race-free withdrawal request + own-list pagination"
      exports: ["POST", "GET", "runtime"]
      contains: "export const runtime = 'nodejs'"
  key_links:
    - from: "frontend/src/app/api/withdrawals/route.ts"
      to: "frontend/src/lib/server/withdrawals/lock.ts"
      via: "lockUserTx(tx, auth.user.sub) — first statement after BEGIN"
      pattern: "lockUserTx\\(tx, auth\\.user\\.sub\\)"
    - from: "frontend/src/app/api/withdrawals/route.ts"
      to: "frontend/src/lib/server/withdrawals/guards.ts"
      via: "validateWithdrawalRequest({ prisma: tx, config, userId, amount, pin, withdrawalPinHash, computeBalance, bcryptCompare: verifyPin })"
      pattern: "validateWithdrawalRequest"
    - from: "frontend/src/app/api/withdrawals/route.ts"
      to: "Prisma.TransactionIsolationLevel.Serializable"
      via: "$transaction(fn, { isolationLevel: 'Serializable' })"
      pattern: "isolationLevel:.*Serializable"
    - from: "frontend/src/app/api/withdrawals/route.ts"
      to: "frontend/src/lib/server/notifications/index.ts"
      via: "createNotification AFTER tx commits (post-commit, dedupeKey: withdrawal-requested:${id})"
      pattern: "createNotification\\(prisma"
---

<objective>
Ship `POST /api/withdrawals` (race-free with advisory lock + Serializable tx + full guard chain) and `GET /api/withdrawals` (cursor-paginated own list). Implements WD-01 through WD-04.

Purpose: This is the financially-critical route — a double-spend regression here is a real-money bug. The advisory lock + Serializable tx pattern is non-negotiable per CLAUDE.md "Critical invariants" and CF-12.

Output: One route handler file with both POST and GET; all Wave 0 RED withdrawal tests GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/04-upload-files-withdrawals/04-CONTEXT.md
@.planning/phases/04-upload-files-withdrawals/04-RESEARCH.md
@.planning/phases/04-upload-files-withdrawals/04-VALIDATION.md
@CLAUDE.md

@frontend/src/lib/server/withdrawals/lock.ts
@frontend/src/lib/server/withdrawals/balance.ts
@frontend/src/lib/server/withdrawals/guards.ts
@frontend/src/lib/server/auth/pin.ts
@frontend/src/lib/server/notifications/index.ts
@frontend/src/lib/server/notifications/cursor.ts
@frontend/src/lib/server/middleware/index.ts
@frontend/src/lib/server/auth.ts
@frontend/src/lib/server/observability/request-context.ts
@frontend/src/app/api/admin/withdrawals/route.ts
@frontend/src/app/api/withdrawals/route.test.ts

<interfaces>
From frontend/src/lib/server/withdrawals/lock.ts (existing — call only):
```typescript
export type TxClient = Prisma.TransactionClient;
export async function lockUserTx(tx: TxClient, userId: string): Promise<void>;
// SQL: SELECT pg_advisory_xact_lock(hashtext($1)) — must be FIRST statement after BEGIN
```

From frontend/src/lib/server/withdrawals/guards.ts (existing — verified export name):
```typescript
export function loadGuardConfigFromEnv(env: NodeJS.ProcessEnv): WithdrawalGuardConfig;

export async function validateWithdrawalRequest(args: {
  prisma: Prisma.TransactionClient;
  config: WithdrawalGuardConfig;
  userId: string;
  amount: number;
  pin?: string;
  withdrawalPinHash: string | null;
  computeBalance: BalanceComputer;
  bcryptCompare: (plain: string, hash: string) => Promise<boolean>;
}): Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>;
```
**Returns 8 stable codes per WD-02:** AMOUNT_BELOW_MIN, AMOUNT_ABOVE_MAX, DAILY_LIMIT_EXCEEDED, COOLDOWN_ACTIVE, PIN_NOT_SET, PIN_REQUIRED, PIN_INVALID, INSUFFICIENT_BALANCE.

From frontend/src/lib/server/withdrawals/balance.ts:
```typescript
export function createDefaultBalanceComputer(prisma: PrismaClient): BalanceComputer;
```

From frontend/src/lib/server/auth/pin.ts:
```typescript
export async function verifyPin(plain: string, hash: string | null): Promise<boolean>;
```

From frontend/src/lib/server/notifications/cursor.ts:
```typescript
export function encodeCursor(c: { createdAt: Date; id: string }): string;
export function decodeCursor(s: string | null): { createdAt: Date; id: string } | null;
```
**Note:** the cursor's wire field is `createdAt` even though we sort on `requestedAt` — RESEARCH Pitfall 2 confirms; admin/withdrawals/route.ts already uses this trick.

From frontend/src/app/api/admin/withdrawals/route.ts (verbatim cursor pattern lines 80–101 — Pattern 5 reference).
</interfaces>

<decisions_locked>
- D-WD-01..04 (RESEARCH important_notes):
  - PIN delivered in **body** (`pin?: string`), NOT header
  - `createNotification` called **AFTER** `$transaction` commits (post-commit, NOT inside tx — sidesteps PrismaClient/TransactionClient typing issue per Pitfall 4)
  - Notification dedupeKey: `withdrawal-requested:${withdrawal.id}` (idempotent across retries)
  - **NO** `Withdrawal.idempotencyKey` schema migration this phase (Open Question 3 + CF-14)
  - Zod amount: `z.number().int().positive()` (integer, smallest currency unit per CLAUDE.md invariant)
  - Zod destination.method enum: `WAVE | ORANGE_MONEY | MTN_MOMO` (D-WD-METHOD-01)
  - Zod destination.phone: `^\+\d{10,15}$` E.164
- D-WD-ENV-01: `WITHDRAWAL_REQUIRE_PIN=1` and `WITHDRAWAL_BALANCE_CHECK=1` are defaults; `loadGuardConfigFromEnv` reads each
- CF-12 (CLAUDE.md): `lockUserTx(tx, userId)` MUST be the FIRST statement inside the Serializable tx body
</decisions_locked>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement POST + GET /api/withdrawals route handler</name>
  <files>
    - frontend/src/app/api/withdrawals/route.ts (NEW — single file with both POST and GET)
  </files>
  <read_first>
    - frontend/src/app/api/withdrawals/route.test.ts (the contract — every test must pass)
    - frontend/src/lib/server/withdrawals/lock.ts (lockUserTx signature; PROTECTED — call only)
    - frontend/src/lib/server/withdrawals/guards.ts (validateWithdrawalRequest exact arg shape; PROTECTED)
    - frontend/src/lib/server/withdrawals/balance.ts (createDefaultBalanceComputer; PROTECTED)
    - frontend/src/lib/server/auth/pin.ts (verifyPin; PROTECTED)
    - frontend/src/lib/server/notifications/index.ts (createNotification signature; PROTECTED)
    - frontend/src/lib/server/notifications/cursor.ts (encodeCursor/decodeCursor)
    - frontend/src/app/api/admin/withdrawals/route.ts lines 80–101 (verbatim cursor-on-`requestedAt` pattern)
    - .planning/phases/04-upload-files-withdrawals/04-RESEARCH.md Patterns 4 + 5
  </read_first>
  <behavior>
    POST /api/withdrawals:
    1. `runtime = 'nodejs'` exported
    2. `verifyCsrf(req)` first; bail if non-null
    3. `requireAuth()` second; bail if NextResponse
    4. Parse JSON body via Zod schema:
       - `amount: z.number().int().positive()`
       - `currency: z.literal('XOF').default('XOF')`
       - `destination: { method: z.enum(['WAVE','ORANGE_MONEY','MTN_MOMO']); phone: z.string().regex(/^\+\d{10,15}$/); accountName?: z.string().max(120) }`
       - `pin: z.string().min(4).max(12).optional()`
       - On Zod fail → 400 `{ code: 'INVALID_BODY', issues }`
    5. `loadGuardConfigFromEnv(process.env)` — read at handler-call time (Pitfall 5; supports vi.stubEnv)
    6. `createDefaultBalanceComputer(prisma)` — outside tx (it's a closure factory)
    7. `prisma.$transaction(async (tx) => { ... }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`:
       a. `await lockUserTx(tx, auth.user.sub)` — FIRST statement (CF-12)
       b. Load `withdrawalPinHash` via `tx.user.findUnique({ where: { id: auth.user.sub }, select: { withdrawalPinHash: true } })`
       c. Call `validateWithdrawalRequest({ prisma: tx, config, userId, amount, pin, withdrawalPinHash, computeBalance, bcryptCompare: verifyPin })`
       d. If `!ok`: return early with `{ ok: false, status, code, message }`
       e. INSERT `tx.withdrawal.create({ data: { userId, amount, currency, status: 'PENDING', destination, provider: 'bictorys' }, select: ... })`
       f. Return `{ ok: true, withdrawal }`
    8. After tx commits successfully:
       - Translate `{ ok: false, ... }` → NextResponse.json with stable code + status
       - On `{ ok: true }` → call `createNotification(prisma, { userId, type: 'WITHDRAWAL_REQUESTED', title, body, data, dedupeKey: 'withdrawal-requested:${w.id}' })` (post-commit per Pitfall 4 — small correctness gap accepted; idempotent via dedupeKey)
       - Return 201 `{ withdrawalId, status }`
    9. Catch `P2034` (Serializable retry conflict) → 409 `TRANSIENT_CONFLICT` (defensive — advisory lock should make this rare)

    GET /api/withdrawals:
    1. requireAuth; bail
    2. Read `limit` (clampLimit) + `cursor` (decodeCursor) from URL
    3. `where = { userId: auth.user.sub, ...(cursor ? { OR: [{ requestedAt: { lt: cursor.createdAt } }, { requestedAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }`
    4. `orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }]`
    5. take=limit+1; slice; build nextCursor from `last.requestedAt`/`last.id`
    6. Return `{ items, nextCursor }`
  </behavior>
  <action>
Create `frontend/src/app/api/withdrawals/route.ts` per RESEARCH Patterns 4 + 5. Verbatim with the post-commit notification adjustment (per Pitfall 4 / important_notes):

```typescript
export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { lockUserTx } from '@/lib/server/withdrawals/lock';
import { createDefaultBalanceComputer } from '@/lib/server/withdrawals/balance';
import {
  loadGuardConfigFromEnv,
  validateWithdrawalRequest,
} from '@/lib/server/withdrawals/guards';
import { verifyPin } from '@/lib/server/auth/pin';
import { createNotification } from '@/lib/server/notifications';
import { encodeCursor, decodeCursor } from '@/lib/server/notifications/cursor';
import { clampLimit } from '@/lib/server/pagination/paginate';
import {
  makeRequestContext,
  withRequestContext,
} from '@/lib/server/observability/request-context';

const Body = z.object({
  amount: z.number().int().positive(),
  currency: z.literal('XOF').default('XOF'),
  destination: z.object({
    method: z.enum(['WAVE', 'ORANGE_MONEY', 'MTN_MOMO']),
    phone: z.string().regex(/^\+\d{10,15}$/, 'phone must be E.164 (e.g. +221XXXXXXXX)'),
    accountName: z.string().max(120).optional(),
  }),
  pin: z.string().min(4).max(12).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { code: 'INVALID_BODY', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { amount, currency, destination, pin } = parsed.data;

    // Read env at call time (Pitfall 5 — supports test vi.stubEnv)
    const config = loadGuardConfigFromEnv(process.env);
    const computeBalance = createDefaultBalanceComputer(prisma);

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // CF-12: lockUserTx MUST be the first statement inside Serializable tx
          await lockUserTx(tx, auth.user.sub);

          const userRow = await tx.user.findUnique({
            where: { id: auth.user.sub },
            select: { withdrawalPinHash: true },
          });

          const guard = await validateWithdrawalRequest({
            prisma: tx,
            config,
            userId: auth.user.sub,
            amount,
            ...(pin !== undefined ? { pin } : {}),
            withdrawalPinHash: userRow?.withdrawalPinHash ?? null,
            computeBalance,
            bcryptCompare: verifyPin,
          });
          if (!guard.ok) {
            return { ok: false as const, status: guard.status, code: guard.code, message: guard.message };
          }

          const w = await tx.withdrawal.create({
            data: {
              userId: auth.user.sub,
              amount,
              currency,
              status: 'PENDING',
              destination: destination as Prisma.InputJsonValue,
              provider: 'bictorys',
            },
            select: { id: true, status: true, amount: true, currency: true, requestedAt: true },
          });

          return { ok: true as const, withdrawal: w };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!result.ok) {
        return NextResponse.json(
          { code: result.code, message: result.message },
          { status: result.status, headers: { 'x-request-id': ctx.requestId } },
        );
      }

      // Post-commit notification (Pitfall 4 — sidesteps tx-typing of createNotification).
      // Idempotent via dedupeKey; if process crashes here, a future retry returns the same
      // PENDING row only with idempotency-key (deferred). For now we accept the small gap.
      try {
        await createNotification(prisma, {
          userId: auth.user.sub,
          type: 'WITHDRAWAL_REQUESTED',
          title: 'Withdrawal requested',
          body: `Withdrawal of ${amount} ${currency} is pending.`,
          data: { withdrawalId: result.withdrawal.id, amount, currency },
          dedupeKey: `withdrawal-requested:${result.withdrawal.id}`,
        });
      } catch {
        // Notification failure must not poison the response — withdrawal is committed.
        // log.warn already handled by createNotification's P2002 catch path.
      }

      return NextResponse.json(
        { withdrawalId: result.withdrawal.id, status: result.withdrawal.status },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    } catch (err) {
      if (
        typeof err === 'object' && err !== null && 'code' in err &&
        (err as { code: unknown }).code === 'P2034'
      ) {
        return NextResponse.json(
          { code: 'TRANSIENT_CONFLICT', message: 'Please retry' },
          { status: 409, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    // Pitfall 2: Withdrawal has `requestedAt`, not `createdAt`. Build the cursor
    // OR fragment inline (admin/withdrawals/route.ts pattern lifted verbatim).
    const where: Prisma.WithdrawalWhereInput = {
      userId: auth.user.sub,
      ...(cursor
        ? {
            OR: [
              { requestedAt: { lt: cursor.createdAt } },
              { requestedAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.withdrawal.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        destination: true,
        requestedAt: true,
        processedAt: true,
        completedAt: true,
        failureReason: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.requestedAt, id: last.id }) : null;

    return NextResponse.json(
      { items, nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
```

**Critical:**
- Do NOT modify any of: `withdrawals/lock.ts`, `withdrawals/balance.ts`, `withdrawals/guards.ts`, `auth/pin.ts`, `notifications/index.ts`, `middleware/index.ts`, `auth.ts` (CLAUDE.md PROTECTED list)
- Do NOT call `validateWithdrawalRequest` outside the Serializable tx (RESEARCH Anti-Patterns)
- Do NOT call `createNotification` INSIDE the tx (Pitfall 4 — exported signature takes PrismaClient; passing TransactionClient requires ugly cast that's been declined per important_notes)
- Do NOT add `Withdrawal.idempotencyKey` migration (Open Question 3 — deferred)
- Do NOT extend retry to POST in any frontend wrapper (CF-14)
- Use `Prisma.TransactionIsolationLevel.Serializable` enum (NOT the string literal — TS-safe)
- `lockUserTx(tx, auth.user.sub)` MUST be the first awaited statement inside the tx body
- Verify `clampLimit` is exported from `@/lib/server/pagination/paginate` — if not, import from wherever the existing admin route gets it (read `app/api/admin/withdrawals/route.ts` lines 80–101 for the canonical import path)
- Verify `createNotification`'s exact arg shape by reading `notifications/index.ts` — if `dedupeKey` is named differently or a `kind` field is required instead of `type`, conform to the actual signature; do not invent fields
  </action>
  <verify>
    <automated>pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `frontend/src/app/api/withdrawals/route.ts` exists
    - `grep -c "export const runtime = 'nodejs'" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "export async function POST" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "export async function GET" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "lockUserTx(tx, auth.user.sub)" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "validateWithdrawalRequest" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "Prisma.TransactionIsolationLevel.Serializable" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "loadGuardConfigFromEnv(process.env)" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "createDefaultBalanceComputer(prisma)" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "verifyPin" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "withdrawal-requested:" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "WAVE.*ORANGE_MONEY.*MTN_MOMO" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "requestedAt" frontend/src/app/api/withdrawals/route.ts` returns ≥ 3 (orderBy + cursor where + select)
    - `grep -c "INVALID_BODY" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "P2034" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "TRANSIENT_CONFLICT" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "createNotification(tx" frontend/src/app/api/withdrawals/route.ts` returns 0 (must be POST-COMMIT, NOT inside tx)
    - `grep -c "createNotification(prisma" frontend/src/app/api/withdrawals/route.ts` returns 1
    - `grep -c "x-withdrawal-pin" frontend/src/app/api/withdrawals/route.ts` returns 0 (PIN in body, NOT header — Pitfall 1)
    - `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts` exits 0 (all ≥10 tests GREEN)
    - `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
    - `git diff --name-only` lists only `frontend/src/app/api/withdrawals/route.ts`
    - No PROTECTED file modified
  </acceptance_criteria>
  <done>POST + GET /api/withdrawals shipped; advisory lock + Serializable tx + post-commit notification; all withdrawal RED tests GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client→API | Untrusted JSON body (amount, destination, pin) — must Zod-validate before any DB read |
| API→DB | Multiple reads (user PIN hash, orders, prior withdrawals, balance) — all MUST be inside the same Serializable tx |
| API→Postgres advisory lock | `pg_advisory_xact_lock(hashtext(userId))` — held until tx commits |
| API→notifications | Post-commit dispatch via createNotification (idempotent via dedupeKey) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-04-01 | T (Tampering) | double-spend via TOCTOU between guard chain and INSERT | mitigate | `lockUserTx(tx, auth.user.sub)` is the FIRST statement inside `$transaction({ isolationLevel: Serializable })`. Guards + balance read + INSERT all share the snapshot AND the per-user advisory lock. Two concurrent POSTs serialize on the lock; the second sees the first's PENDING reservation and fails INSUFFICIENT_BALANCE. Verified by ROADMAP Phase 4 success criterion 3. |
| T-04-04-02 | T | check-then-write outside lock | mitigate | `validateWithdrawalRequest` receives `prisma: tx` (the TransactionClient) — every read it does (balance, daily limit, cooldown) is inside the same tx. Acceptance criterion `grep "validateWithdrawalRequest"` + the test "advisory lock" assert this. |
| T-04-04-03 | E (Elevation of privilege) | PIN brute-force via timing-attack | mitigate | `verifyPin(plain, hash)` (Phase 2 helper) wraps bcrypt + dummy-hash compare for users with `withdrawalPinHash=null` — timing-equalized. Per-email rate limit (Phase 1 lockout) on the parent auth flow + cooldown env (`WITHDRAWAL_COOLDOWN_HOURS`) bound the rate of attempts. |
| T-04-04-04 | I (Information disclosure) | leaking PIN in logs | mitigate | PIN is in JSON body; existing logger redaction (Phase 0/1 protected logger.ts) suppresses sensitive fields. Body is not log.info'd directly. createNotification body interpolates only amount + currency — never PIN. |
| T-04-04-05 | T | balance-check bypass when WITHDRAWAL_BALANCE_CHECK=0 | accept | Documented in `.env.example` with FINANCIAL-SAFETY WARNING (Wave 0 Plan 01). `loadGuardConfigFromEnv` reads the env; when `0`, `validateWithdrawalRequest` skips the balance branch by design. Operator opted in. |
| T-04-04-06 | D (DoS) | advisory-lock starvation under load | mitigate | The lock is per-userId (`hashtext(userId)`) — different users do not contend. Same-user contention is by design. `Serializable` retries (P2034) caught and translated to 409 `TRANSIENT_CONFLICT` so the client decides whether to retry (frontend api() does NOT — CF-14 — so the client UX must surface the 409). |
| T-04-04-07 | I | enumeration via cursor pagination | accept | GET is scoped to `userId = auth.user.sub` — no other user's rows are returned regardless of cursor. Cursor is HMAC-less (base64 JSON) but only filters within the caller's own scope; no cross-tenant leak. |
| T-04-04-08 | S (Spoofing) | CSRF on POST | mitigate | `verifyCsrf(req)` first — bail before any auth/db work. Phase 1 cookie pattern. |
| T-04-04-09 | T | idempotency-key collision (deferred column) | accept | `Withdrawal.idempotencyKey` deliberately deferred (CF-14 + Open Question 3). Frontend api() does not retry POSTs, so duplicate-submit attack surface comes only from manual replays. The advisory lock + balance check make a second submission deterministically fail with `INSUFFICIENT_BALANCE`. |
| T-04-04-10 | T | Zod schema accepting decimals → balance underflow | mitigate | `z.number().int().positive()` rejects decimals AND non-positive values. CLAUDE.md "Payment amounts are integer in smallest currency unit" enforced at the schema boundary. |
| T-04-04-11 | E | post-commit notification failure crashes process | mitigate | `try/catch` around `createNotification(prisma, ...)` post-commit; dedupeKey makes any retry idempotent. Withdrawal commit is preserved on notification failure (small correctness gap accepted per Pitfall 4). |
</threat_model>

<verification>
- `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` exits 0
- `pnpm --filter frontend exec vitest run src/lib/server/withdrawals/` exits 0 (no regression on existing lock/balance/guards tests)
- The advisory-lock test (Wave 0 RED `it('advisory lock'`) confirms `isolationLevel: 'Serializable'` and `lockUserTx` first
- No PROTECTED file modified
</verification>

<success_criteria>
- POST /api/withdrawals: 8 stable error codes mapped to correct HTTP statuses (table-driven test)
- POST: advisory lock + Serializable tx pattern (lockUserTx first inside tx)
- POST: post-commit createNotification with `withdrawal-requested:${id}` dedupeKey
- GET /api/withdrawals: cursor-paginated on `requestedAt` (mirrors admin/withdrawals route), scoped to caller
- WITHDRAWAL_BALANCE_CHECK env honored (0 = skip, 1 = enforce)
- All ≥10 Wave 0 RED withdrawal tests GREEN
- No protected file modified; no `Withdrawal.idempotencyKey` migration
</success_criteria>

<output>
After completion, create `.planning/phases/04-upload-files-withdrawals/04-04-SUMMARY.md`:
- File created (1)
- Tests turned GREEN (≥10 of ≥10 from withdrawals/route.test.ts)
- Confirmation: `lockUserTx` is first inside `Serializable` tx; createNotification is post-commit
- Live concurrent-POST UAT deferred to Phase 4 HUMAN-UAT (mirrors Phase 1 pattern)
- Open follow-ups: idempotency-key column (deferred per RESEARCH Open Q 3); widening createNotification signature (Phase 6 cleanup per Pitfall 4 alternative)
</output>
