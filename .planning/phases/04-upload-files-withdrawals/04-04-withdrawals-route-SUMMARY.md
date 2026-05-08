---
phase: 04-upload-files-withdrawals
plan: 04-04-withdrawals-route
subsystem: withdrawals
tags: [withdrawals, financial, advisory-lock, serializable, route-handler]
requires:
  - frontend/src/lib/server/withdrawals/lock.ts
  - frontend/src/lib/server/withdrawals/balance.ts
  - frontend/src/lib/server/withdrawals/guards.ts
  - frontend/src/lib/server/auth/pin.ts
  - frontend/src/lib/server/notifications/index.ts
  - frontend/src/lib/server/middleware/index.ts
  - frontend/src/lib/server/auth.ts
  - frontend/src/lib/server/pagination/paginate.ts
  - frontend/src/lib/server/observability/request-context.ts
  - frontend/src/lib/server/prisma.ts
provides:
  - POST /api/withdrawals — race-free withdrawal request (advisory lock + Serializable tx)
  - GET  /api/withdrawals — cursor-paginated own-list scoped to caller
affects:
  - WD-01, WD-02, WD-03, WD-04 (closed)
key-files:
  created:
    - frontend/src/app/api/withdrawals/route.ts
  modified: []
decisions:
  - PIN delivered in JSON body (not header) — matches Phase 2 PIN routes; Pitfall 1 mitigation
  - createNotification dispatched POST-COMMIT (Pitfall 4) — exported signature takes PrismaClient,
    not TransactionClient; idempotent via dedupeKey 'withdrawal-requested:${id}'
  - WITHDRAWAL_REQUIRE_PIN + WITHDRAWAL_BALANCE_CHECK read at call-time via
    loadGuardConfigFromEnv(process.env) (Pitfall 5 — supports vi.stubEnv)
  - GET reuses cursor wire format ({ createdAt, id }) but binds to requestedAt
    (Pitfall 2 — Withdrawal has no createdAt column)
  - P2034 (Serializable retry abort) translated to 409 TRANSIENT_CONFLICT — frontend api()
    intentionally does NOT auto-retry POSTs (CF-14)
  - Withdrawal.idempotencyKey deferred (CF-14 + RESEARCH Open Q 3) — advisory lock makes the
    racy double-spend that idempotency keys protect against impossible
metrics:
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  lines_added: 289
  duration: ~6min
  completed: 2026-05-08
---

# Phase 04 Plan 04-04: Withdrawals Route Summary

POST + GET `/api/withdrawals` shipped — financially-critical race-free withdrawal request
behind a per-user `pg_advisory_xact_lock` inside a `Serializable` Prisma transaction, with
the existing 8-code guard chain and post-commit `WITHDRAWAL_REQUESTED` notification.
WD-01..WD-04 closed.

## What Was Built

A single Route Handler file `frontend/src/app/api/withdrawals/route.ts` with both `POST` and `GET`:

**POST `/api/withdrawals`** — request a withdrawal:
- `runtime='nodejs'` exported (CF-01 / CLAUDE.md invariant)
- `verifyCsrf(req)` → bail before any auth/DB work (T-04-04-08)
- `requireAuth()` → 401 on missing/invalid session
- Zod body: `amount` int>0 (smallest currency unit, no decimals — T-04-04-10),
  `currency='XOF'` literal, `destination.{method enum WAVE|ORANGE_MONEY|MTN_MOMO,
  phone E.164, accountName? max 120}`, `pin?` (4–12 chars)
- `loadGuardConfigFromEnv(process.env)` read at call time (Pitfall 5 — `vi.stubEnv`)
- `createDefaultBalanceComputer(prisma)` outside the tx (closure factory)
- `prisma.$transaction(async (tx) => { ... }, { isolationLevel: Serializable })`
  - **First awaited statement: `lockUserTx(tx, auth.user.sub)`** (CF-12 / D-LOCK-FIRST)
  - `tx.user.findUnique` for `withdrawalPinHash`
  - `validateWithdrawalRequest({ prisma: tx, ... })` — guard reads share the tx snapshot
  - On guard failure → return early `{ ok: false, status, code, message }`
  - On guard success → `tx.withdrawal.create` with `status='PENDING'`
- 8 stable codes pass through verbatim with the guard's chosen status:
  `AMOUNT_BELOW_MIN` (422), `AMOUNT_ABOVE_MAX` (422), `DAILY_LIMIT_EXCEEDED` (422),
  `COOLDOWN_ACTIVE` (422), `PIN_NOT_SET` (403), `PIN_REQUIRED` (403),
  `PIN_INVALID` (403), `INSUFFICIENT_BALANCE` (422)
- POST-commit: `createNotification(prisma, { type: 'WITHDRAWAL_REQUESTED',
  dedupeKey: 'withdrawal-requested:${id}', ... })` wrapped in try/catch so a
  notifications-table failure never poisons the 201 response (T-04-04-11)
- Defensive `P2034` → 409 `TRANSIENT_CONFLICT`

**GET `/api/withdrawals`** — caller's own list, cursor-paginated:
- Cursor wire format `{ createdAt, id }` reused but bound to `requestedAt`
  (Pitfall 2 — `Withdrawal` has no `createdAt`); pattern lifted verbatim from
  `app/api/admin/withdrawals/route.ts` lines 80–101
- `where = { userId: auth.user.sub, ...orFragment }` — caller-scoped (T-04-04-07)
- `orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }]`, `take: limit + 1`
- Returns `{ items, nextCursor }`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement POST + GET /api/withdrawals route handler | `540f026` | `frontend/src/app/api/withdrawals/route.ts` (+289) |

## Verification

| Check | Result |
|-------|--------|
| `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` | ✅ 33/33 pass — every route handler exports `runtime='nodejs'` |
| `pnpm --filter frontend run typecheck` | ✅ no errors |
| `pnpm --filter frontend run lint` | ✅ no errors |
| `pnpm --filter frontend exec vitest run` (full suite) | ✅ 411/411 tests pass — zero regression |
| `pnpm --filter frontend exec vitest run src/app/api/withdrawals/route.test.ts` | ⏭ test file lives in sibling worktree (Plan 04-01); will run after orchestrator merge-back |

### Acceptance grep checklist (from PLAN)

| Pattern | Expected | Actual | Pass |
|---------|----------|--------|------|
| `export const runtime = 'nodejs'` | 1 | 1 | ✅ |
| `export async function POST` | 1 | 1 | ✅ |
| `export async function GET`  | 1 | 1 | ✅ |
| `lockUserTx(tx, auth.user.sub)` | 1 | 1 | ✅ |
| `validateWithdrawalRequest` | 1 | 4 (1 import + 1 call + 2 in comments) | ✅ (≥1) |
| `Prisma.TransactionIsolationLevel.Serializable` | 1 | 2 (1 use + 1 comment) | ✅ (≥1) |
| `loadGuardConfigFromEnv(process.env)` | 1 | 1 | ✅ |
| `createDefaultBalanceComputer(prisma)` | 1 | 1 | ✅ |
| `verifyPin` | ≥1 | 2 (import + use) | ✅ |
| `withdrawal-requested:` | 1 | 2 (1 dedupeKey + 1 comment) | ✅ (≥1) |
| `WAVE.*ORANGE_MONEY.*MTN_MOMO` | 1 | 2 (Zod enum + comment) | ✅ (≥1) |
| `requestedAt` (orderBy + cursor + select) | ≥3 | 9 | ✅ |
| `INVALID_BODY` | 1 | 1 | ✅ |
| `P2034` | 1 | 2 (catch + comment) | ✅ (≥1) |
| `TRANSIENT_CONFLICT` | 1 | 1 | ✅ |
| `createNotification(tx` (must be ZERO — post-commit invariant) | 0 | 0 | ✅ |
| `createNotification(prisma` | 1 | 1 | ✅ |
| `x-withdrawal-pin` (must be ZERO — PIN goes in body) | 0 | 0 | ✅ |
| `git diff --name-only` lists only `frontend/src/app/api/withdrawals/route.ts` | yes | yes | ✅ |

> The "≥1 vs exactly 1" deltas above are inline-doc comments referencing the
> identifiers — every actual code reference is unique. The plan's intent
> (single use in code) is satisfied; raising counts via comments is harmless.

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None encountered.

## Threats Mitigated

| Threat ID | Category | Mitigation |
|-----------|----------|------------|
| T-04-04-01 | T (TOCTOU double-spend) | `lockUserTx` first inside Serializable tx — concurrent POSTs serialize on the per-user advisory lock |
| T-04-04-02 | T (check-then-write outside lock) | `validateWithdrawalRequest` receives `prisma: tx` — every read shares the snapshot |
| T-04-04-03 | E (PIN brute-force timing) | `verifyPin` (Phase 2 helper) wraps bcrypt; cooldown env bounds attempts |
| T-04-04-04 | I (PIN log leak) | PIN in body; logger redaction (Phase 0/1 protected logger.ts); notification body never interpolates PIN |
| T-04-04-05 | T (BALANCE_CHECK=0 bypass) | accepted — operator opted in; `.env.example` warning verbatim (Wave 0 Plan 01) |
| T-04-04-06 | D (advisory-lock starvation) | per-userId hash — different users don't contend; P2034 → 409 surfaced |
| T-04-04-07 | I (cursor enumeration) | accepted — `userId` filter scopes to caller; cursor only filters within own scope |
| T-04-04-08 | S (CSRF on POST) | `verifyCsrf(req)` first — bail before any auth/DB |
| T-04-04-09 | T (idempotency-key collision) | accepted — column deferred; advisory lock + balance check make replay attempts deterministically fail |
| T-04-04-10 | T (decimal underflow) | `z.number().int().positive()` rejects decimals at the schema boundary |
| T-04-04-11 | E (notification crash) | try/catch around post-commit `createNotification`; dedupeKey makes any retry idempotent |

## Threat Flags

None — no new security-relevant surface introduced beyond what the threat
register covers. The route's surface is exactly what `<threat_model>` enumerated.

## Open Follow-ups

- **HUMAN-UAT (deferred per VALIDATION.md "Manual-Only Verifications"):** Live concurrent-POST
  smoke against real Postgres — assert exactly 1 PENDING + 1 INSUFFICIENT_BALANCE for two
  parallel `curl` invocations. Mocked Prisma client used in unit tests cannot exercise
  the actual advisory-lock + Serializable retry behavior.
- **`Withdrawal.idempotencyKey` migration (Open Q 3 / CF-14):** intentionally deferred. The
  advisory lock + balance check defeat the racy double-spend that idempotency keys protect
  against. Add when a real client need surfaces (e.g., flaky mobile network retries).
- **`createNotification` signature widening (Pitfall 4 alternative, Phase 6 cleanup):** the
  helper currently takes `PrismaClient`; widening to `PrismaClient | TransactionClient`
  would let us dispatch the notification inside the same tx (zero-gap exactly-once). The
  current dedupeKey-based post-commit pattern is acceptable in the interim.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources.

## Self-Check

```
$ [ -f frontend/src/app/api/withdrawals/route.ts ] && echo FOUND || echo MISSING
FOUND

$ git log --oneline -1
540f026 feat(04-04): ship POST + GET /api/withdrawals (advisory lock + Serializable tx)
```

## Self-Check: PASSED
