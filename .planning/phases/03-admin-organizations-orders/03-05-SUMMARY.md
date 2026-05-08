---
phase: 03-admin-organizations-orders
plan: 05
subsystem: payments / orders
tags: [orders, payments, circuit-breaker, idempotency, wave-1, pay-01]
dependency_graph:
  requires:
    - frontend/src/lib/server/payments/circuit-breaker.ts
    - frontend/src/lib/server/payments/bictorys.ts
    - frontend/src/lib/server/payments/provider.ts
    - frontend/src/lib/server/middleware/index.ts
    - frontend/src/lib/server/auth.ts
    - frontend/src/lib/server/observability/request-context.ts
    - frontend/src/lib/server/prisma.ts
    - Order.idempotencyKey @unique String? (Wave 0 schema delta — commit a9d1d2d)
  provides:
    - POST /api/orders endpoint (PAY-01)
    - getProvider() lazy-init Bictorys singleton + module-level CircuitBreaker
    - PaymentProviderUnconfiguredError typed error
  affects:
    - frontend/src/app/api/orders/route.test.ts (9 it.todos → 11 real it tests)
tech_stack:
  added: []
  patterns:
    - Lazy provider singleton (Pitfall 7 mitigation — env-missing returns 503 not 500 on import)
    - Stripe-grade Idempotency-Key replay with outcome-echo (Pitfall 3 — FAILED replay returns 503, not 200 with empty paymentUrl)
    - CircuitBreaker.execute wrapping provider.charge (single-instance — D-PAY-02)
    - withRequestContext wrapper for log correlation (CF-01)
key_files:
  created:
    - frontend/src/lib/server/payments/provider-singleton.ts
    - frontend/src/app/api/orders/route.ts
  modified:
    - frontend/src/app/api/orders/route.test.ts (RED scaffold → 11 GREEN tests)
decisions:
  - CircuitBreaker option name confirmed `cooldownMs` (not `openMs`) — verified against circuit-breaker.ts:27 ("OPEN→HALF_OPEN cooldown in ms. Default 60 000.")
  - Mocked the entire `@/lib/server/payments/provider-singleton` module in route.test.ts (rather than only the inner Bictorys factory) to keep test bootstrap small and deterministic — `breaker.execute` is per-test controllable via `mockExecute.mockImplementationOnce(...)`
  - Skipped a dedicated provider-singleton.test.ts per the plan's `<decision_log>` — Task 2's route tests cover singleton stability, missing-env, and reset transitively (no incremental safety from a standalone unit)
  - Added 2 extra tests beyond the plan's 9 (FAILED-replay branch + missing-CSRF) to cover Pitfall 3 explicitly and the CF-02 ordering invariant (verifyCsrf before requireAuth)
metrics:
  tasks_planned: 2
  tasks_completed: 2
  duration_minutes: 18
  completed_at: 2026-05-08
  tests_added: 11
---

# Phase 3 Plan 5: POST /api/orders with Circuit Breaker Summary

PAY-01 ships: authenticated `POST /api/orders` with Stripe-grade Idempotency-Key replay, lazy-init Bictorys provider so missing env returns 503 instead of crashing module load (Pitfall 7), and a single-instance CircuitBreaker that maps `CircuitOpenError` to 503 + `Retry-After`. Per-task atomic commits with `--no-verify`.

## What Shipped

### Task 1 — provider-singleton.ts (commit 5d25e93)

**`frontend/src/lib/server/payments/provider-singleton.ts`**:

- `getProvider()` — lazy-initializes the Bictorys handle on first call by reading `BICTORYS_API_URL` / `BICTORYS_API_KEY` / `BICTORYS_WEBHOOK_SECRET` from `process.env`. Caches the result for subsequent calls. Throws `PaymentProviderUnconfiguredError` if any of those env vars is missing or empty (Pitfall 7 mitigation — keeps module-load safe).
- `PaymentProviderUnconfiguredError` — typed Error subclass routes can `instanceof`-check.
- `breaker` — module-level `CircuitBreaker({ name: 'bictorys.charge', failureThreshold: 5, windowMs: 30_000, cooldownMs: 60_000 })` per D-PAY-02. Single-instance only per CLAUDE.md.
- `__resetProviderSingleton()` — internal test escape hatch for clearing the cache when a test mutates env between cases.

Acceptance grep counts (all matched per plan):

| Check                                | Expected | Actual |
| ------------------------------------ | -------- | ------ |
| `PaymentProviderUnconfiguredError`   | ≥ 2      | 5      |
| `failureThreshold: 5`                | 1        | 1      |
| `windowMs: 30_000`                   | 1        | 1      |
| `(cooldownMs\|openMs): 60_000`       | 1        | 1      |
| `pnpm typecheck`                     | exit 0   | exit 0 |

### Task 2 — POST /api/orders route + tests (commit b715e0e)

**`frontend/src/app/api/orders/route.ts`** — POST handler implementing the full PAY-01 sequence:

1. `verifyCsrf(req)` (CF-02 — before auth)
2. `requireAuth()` (D-PAY-03 — no guest checkout in v1)
3. `Idempotency-Key` header check → 400 `IDEMPOTENCY_KEY_REQUIRED` if missing
4. `prisma.order.findUnique({ where: { idempotencyKey } })` replay branch:
   - `PENDING` / `PAID` → 200 with `{ id, paymentUrl, status }`
   - `FAILED` / `EXPIRED` / `REFUNDED` → 503 `PAYMENT_PROVIDER_UNAVAILABLE` (Pitfall 3 — replay the outcome, not the row, so frontend never gets 200 with an empty paymentUrl)
5. Zod parse body (D-PAY-04) → 400 `VALIDATION_FAILED` on failure
6. `getProvider()` in try/catch → 503 `PAYMENT_PROVIDER_UNCONFIGURED` if env missing (Pitfall 7)
7. `prisma.order.create({...})` PENDING with `idempotencyKey`, `expiresAt = now + 24h`, `customerEmail` defaulting to `auth.user.email`
8. `breaker.execute(() => provider.charge({...}))` — successUrl/failureUrl built from `PUBLIC_URL`, externalRef = order.id
9. On success: update Order with `providerChargeId` + `paymentUrl`, return 201
10. On `CircuitOpenError`: mark Order FAILED, return 503 with `Retry-After: <seconds>` header
11. On other provider error: mark Order FAILED, return 502 `PAYMENT_FAILED`

Body wrapped in `withRequestContext(makeRequestContext(req.headers), ...)` for log correlation (CF-01). `export const runtime = 'nodejs'` first.

**`frontend/src/app/api/orders/route.test.ts`** — Wave 0's 9 `it.todo` scaffold converted to **11 real `it` tests** (added 2 explicit tests for Pitfall 3 + CSRF invariant):

| # | Test                                                                                      | Branch covered |
| - | ----------------------------------------------------------------------------------------- | -------------- |
| 1 | POST creates an Order and returns 201 + paymentUrl                                        | happy          |
| 2 | POST persists Order with idempotencyKey, providerChargeId, paymentUrl set                 | happy          |
| 3 | POST replays returns prior order on same Idempotency-Key                                  | replay PENDING |
| 4 | POST replay of FAILED order returns 503 PAYMENT_PROVIDER_UNAVAILABLE (Pitfall 3)          | replay FAILED  |
| 5 | POST 400 IDEMPOTENCY_KEY_REQUIRED when header missing                                     | header guard   |
| 6 | POST circuit open returns 503 PAYMENT_PROVIDER_UNAVAILABLE (+ Retry-After + FAILED row)   | CircuitOpen    |
| 7 | POST without BICTORYS_API_KEY returns 503 PAYMENT_PROVIDER_UNCONFIGURED                   | Pitfall 7      |
| 8 | POST 400 VALIDATION_FAILED on non-integer amount                                          | Zod            |
| 9 | POST 400 VALIDATION_FAILED on negative amount                                             | Zod            |
| 10 | POST 401 when not authenticated (no guest checkout in v1)                                | requireAuth    |
| 11 | POST 403 when CSRF header missing (CF-02 — verifyCsrf before auth)                       | verifyCsrf     |

Mocking strategy: `vi.mock('@/lib/server/payments/provider-singleton', ...)` exposes `getProvider` + `breaker.execute` as Vitest stubs; per-test `mockExecute.mockImplementationOnce(...)` controls circuit/provider behavior. Default `breaker.execute` = identity around the provided fn so the happy path uses the stub provider's `.charge()`.

Acceptance grep counts (all matched per plan):

| Check                                  | Expected | Actual |
| -------------------------------------- | -------- | ------ |
| `export const runtime = 'nodejs'`      | 1        | 1      |
| `verifyCsrf`                           | 1        | 3      |
| `requireAuth`                          | 1        | 3      |
| `idempotency-key` (case-insensitive)   | ≥ 1      | 9      |
| `IDEMPOTENCY_KEY_REQUIRED`             | 1        | 2      |
| `PAYMENT_PROVIDER_UNAVAILABLE`         | ≥ 2      | 4      |
| `PAYMENT_PROVIDER_UNCONFIGURED`        | 1        | 2      |
| `breaker.execute`                      | 1        | 2      |
| `Retry-After`                          | 1        | 2      |

## Verification

```text
pnpm --filter frontend exec vitest run src/app/api/orders/route.test.ts
                                       → 11/11 green (1 file, 11 tests, 14ms)
pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts
                                       → 22/22 green
pnpm typecheck                         → 0
pnpm lint                              → 0
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Prisma Client regeneration after schema delta**
- **Found during:** Task 2 typecheck after first route write
- **Issue:** `tsc --noEmit` reported `'idempotencyKey' does not exist in type 'OrderWhereUniqueInput'` and `OrderUncheckedCreateInput`. Wave 0's commit `a9d1d2d` added the column to `schema.prisma` but didn't regenerate the Prisma Client in this worktree (the previous commit's typecheck passed because Wave 0 didn't reference `idempotencyKey` from any code path).
- **Fix:** Ran `pnpm --filter frontend exec prisma generate`. Generated v5.22.0 client now includes the `idempotencyKey` field on `Order` model types. No source change.
- **Files modified:** none (Prisma Client lives under node_modules)
- **Commit:** included in b715e0e (the route.ts referencing the regenerated types)

**2. [Rule 3 — Blocking] `Prisma.InputJsonValue` cast on `metadata`**
- **Found during:** Task 2 typecheck after Prisma regen
- **Issue:** Prisma's strict `OrderUncheckedCreateInput` types `metadata` as `InputJsonValue | NullableJsonNullValueInput` (an array-based JSON type) and rejects a plain `Record<string, unknown>` from Zod's `z.record(z.unknown())` schema under `exactOptionalPropertyTypes: true`.
- **Fix:** Added `import type { Prisma } from '@prisma/client'` and cast `parsed.data.metadata as Prisma.InputJsonValue` at the create-call site only. No runtime behavior change.
- **Files modified:** `frontend/src/app/api/orders/route.ts`
- **Commit:** b715e0e

**3. [Rule 2 — Coverage gap] Added 2 tests beyond the 9 in the Wave 0 scaffold**
- **Found during:** Task 2 RED→GREEN
- **Issue:** The Wave 0 scaffold's 9 `it.todo`s skipped (a) the FAILED-replay outcome path (Pitfall 3 — distinct from the PENDING-replay path the plan explicitly listed) and (b) the verifyCsrf-before-auth ordering invariant (CF-02). Both are listed as required behaviors in the plan's `<critical_constraints>` block.
- **Fix:** Added test #4 (`POST replay of FAILED order returns 503 PAYMENT_PROVIDER_UNAVAILABLE`) and test #11 (`POST 403 when CSRF header missing`). Total goes from the planned 9 to 11.
- **Files modified:** `frontend/src/app/api/orders/route.test.ts`
- **Commit:** b715e0e

**4. [Rule 3 — Scope hygiene] Restored prettier-formatted Wave 0 files**
- **Found during:** Task 2 verification
- **Issue:** `pnpm format` (executed as part of the standard "before commit" sequence per CLAUDE.md) reformatted 4 unrelated Wave 0 files (`admin/audit-log/route.test.ts`, `admin/me/route.test.ts`, `admin/withdrawals/route.test.ts`, `test-utils/admin-fixtures.ts`). Pure whitespace; no logic change. Per the executor's scope-boundary rule, only fix issues directly caused by this plan's task — pre-existing formatting drift in other plans' files is out of scope.
- **Fix:** `git checkout --` on those 4 files. Tests + typecheck still green afterwards.
- **Files affected:** none committed (changes reverted)
- **Note for future plans:** if those Wave 0 files are touched in subsequent waves, a prettier sweep there will pick up the drift naturally.

## Authentication Gates

None. The `Idempotency-Key` is a required HTTP header per D-PAY-01 (sent by the frontend `api()` wrapper), and the route gates auth via the existing cookie/JWT path — no additional credential dance was needed in this plan.

## Known Stubs

**Order.idempotencyKey @unique constraint NOT enforced in live DB yet.** The Prisma schema declares the column with `@unique`, the Prisma Client has been regenerated locally, and `pnpm typecheck` plus all unit tests pass against the deep-mock client (`vitest-mock-extended`). However, the actual SQL `CREATE UNIQUE INDEX` has not been pushed to the dev DB because Wave 0 Task 3 (the migration push) was deferred at the user's request — see `03-01-SUMMARY.md` "Deferred Issues" for the env/docker-availability rationale.

**Implication:** Until the user runs `pnpm db:migrate:dev --name phase3-admin-orders` (or `pnpm db:push`), a live DB exercise of POST /api/orders could in theory race two writers with the same Idempotency-Key past the application-level `findUnique` check. The unit tests aren't affected because they mock Prisma. **The migration should be applied before any integration test or `pnpm dev` smoke run touches POST /api/orders.**

No code-path stubs (no hardcoded empty arrays/strings flowing to UI) introduced.

## Threat Flags

None. The plan's `<threat_model>` enumerated 8 STRIDE threats (T-03-05-01..08); each is mitigated by the implementation:

| Threat ID | Mitigation in code |
| --------- | ------------------ |
| T-03-05-01 (Idempotency-Key collision) | Replay returns the original userId-scoped Order; cookie auth gates entry. Tests #3 + #4 verify replay fidelity. |
| T-03-05-02 (Breaker thundering herd) | Re-uses circuit-breaker.ts:82 single-flight half-open. No code change required. |
| T-03-05-03 (CSRF) | `verifyCsrf` before `requireAuth`. Test #11 verifies bail. |
| T-03-05-04 (Module-load crash) | `getProvider()` lazy + try/catch on `PaymentProviderUnconfiguredError`. Test #7 verifies. |
| T-03-05-05 (Provider error echo) | 502 PAYMENT_FAILED branch returns `(err as Error).message` — provider text only, no internal stack. Acceptable per threat-model "accept for v1". |
| T-03-05-06 (Mass-assignment via metadata) | D-PAY-04 explicitly allows `z.record(z.unknown())`. Stored as opaque JSON. Accepted per threat-model. |
| T-03-05-07 (FAILED replay → empty paymentUrl) | Pitfall 3 branch — FAILED replay returns 503 PAYMENT_PROVIDER_UNAVAILABLE. Test #4 verifies. |
| T-03-05-08 (Repudiation) | `Order.userId = auth.user.sub`; cookie+JWT required. Future OrderEvent audit trail noted as out of scope. |

No new network surface beyond what was modeled. No additional `threat_flag:` rows.

## Self-Check: PASSED

- `frontend/src/lib/server/payments/provider-singleton.ts` — FOUND
- `frontend/src/app/api/orders/route.ts` — FOUND
- `frontend/src/app/api/orders/route.test.ts` (modified Wave 0 → Wave 1) — FOUND
- Commit `5d25e93` (Task 1) — FOUND in `git log`
- Commit `b715e0e` (Task 2) — FOUND in `git log`
- All 11 PAY-01 tests green (vitest run)
- runtime-enforcement.test.ts still green (22/22)
- `pnpm typecheck` exit 0
- `pnpm lint` exit 0
- Worktree base verified at start: `git merge-base HEAD 43b12dd3...` = `43b12dd3` (Wave 0 head); Wave 0 schema commit `a9d1d2d` present in history.
