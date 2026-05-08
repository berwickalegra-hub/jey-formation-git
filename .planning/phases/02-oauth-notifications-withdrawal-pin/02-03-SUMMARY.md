---
phase: 02-oauth-notifications-withdrawal-pin
plan: 03
subsystem: auth-withdrawal-pin
tags: [auth, withdrawal-pin, bcrypt, lockout, csrf]
requires:
  - frontend/src/lib/server/auth/pin.ts (Wave 0 Plan 02-00 — hashPin, verifyPin, alwaysCompareDummy)
  - frontend/src/lib/server/auth/lockout.ts (DO NOT MODIFY — isLockedOut, recordFailure, recordSuccess)
  - frontend/src/lib/server/middleware/index.ts (DO NOT MODIFY — requireAuth)
  - frontend/src/lib/server/auth.ts (DO NOT MODIFY — verifyCsrf)
  - frontend/prisma/schema.prisma (User.withdrawalPinHash column — already present)
provides:
  - frontend/src/app/api/auth/withdrawal-pin/route.ts (POST/DELETE — PIN-01)
affects:
  - none (no upstream module modified; Phase 4 withdrawal flow will read withdrawalPinHash)
tech-stack:
  added: []
  patterns:
    - bcrypt cost 12 for PIN hashing (CD-01) — matches password hash floor
    - isolated lockout namespace `pin:${userId}` — never the email (Pitfall 7)
    - alwaysCompareDummy timing-equalisation on wrong-shape change path (CD-03)
    - branch on `userRow.withdrawalPinHash` to choose SET vs CHANGE path
    - POST/DELETE both wrapped in withRequestContext for requestId propagation
key-files:
  created:
    - frontend/src/app/api/auth/withdrawal-pin/route.ts
    - frontend/src/app/api/auth/withdrawal-pin/route.test.ts
  modified: []
decisions:
  - "Lockout key namespace literal `pin:${userId}` (Pitfall 7) — coupling with login lockout via shared email key would let either side DoS the other. Verified by suite-level assertion that every lockout primitive call uses the `pin:` prefix."
  - "alwaysCompareDummy is invoked on the wrong-shape change path (no currentPin in body when hash exists) AND on the inverse oracle (currentPin smuggled in when no hash exists). Wire response is identical to wrong-PIN so attacker cannot probe `withdrawalPinHash IS NULL` via timing."
  - "PIN_REQUIRED returns 400 (not 423) — the wrong-shape path does not increment recordFailure since it is a malformed request, not a credential failure. recordFailure only runs after Zod accepts the body and bcrypt rejects it."
  - "DELETE has no Zod schema — it takes no body. Only verifyCsrf + requireAuth gate the delete; the User.update with where.id = auth.user.sub means a missing or wrong-id JWT cannot delete another user's PIN (T-02-PIN-CROSS-TENANT)."
metrics:
  duration: 5min
  tasks: 1
  files: 2
completed: 2026-05-08
---

# Phase 02 Plan 03: Withdrawal-PIN Credential Endpoints Summary

POST and DELETE on `/api/auth/withdrawal-pin` with bcrypt-cost-12 hashing, isolated `pin:${userId}` lockout namespace, and timing-equalised wrong-shape branch — unblocks Phase 4 withdrawal flow which gates on `User.withdrawalPinHash`.

## Endpoints Shipped

| Method | Path | Body | Behaviour |
|---|---|---|---|
| `POST` | `/api/auth/withdrawal-pin` | `{ newPin }` (when hash null) | SET — hashPin + user.update |
| `POST` | `/api/auth/withdrawal-pin` | `{ currentPin, newPin }` (when hash exists) | CHANGE — verifyPin → recordSuccess + hashPin + update |
| `DELETE` | `/api/auth/withdrawal-pin` | — | clears `withdrawalPinHash` to null |

Both methods require `verifyCsrf` (header `x-csrf-token` + matching `app-csrf` cookie) and `requireAuth` (valid `app-token` JWT). The route exports `runtime = 'nodejs'`.

## Error Code Matrix

| Status | `error` code | When |
|---|---|---|
| 200 | — (`{ ok: true }`) | success |
| 400 | `VALIDATION_FAILED` | SET path — Zod rejects body (e.g. `newPin: '12'` or `'abcd'`) |
| 400 | `PIN_REQUIRED` | CHANGE path — body missing `currentPin` (Zod fails ChangeBody); preceded by `alwaysCompareDummy` |
| 400 | `PIN_INVALID` | CHANGE path — `currentPin` does not match stored hash; `recordFailure` increments |
| 401 | (`Missing token` / `Invalid or expired token`) | from `requireAuth` short-circuit |
| 403 | (`Invalid CSRF token`) | from `verifyCsrf` short-circuit |
| 423 | `LOCKED_OUT` | `isLockedOut('pin:${userId}')` true OR `recordFailure` returned `{ locked: true }` |

## Lockout Key Namespace Verification

Test 13 (`lockout key namespace (Pitfall 7)`) drives three POST flows that exercise all three lockout primitives, then asserts every captured key matches `/^pin:/` and contains no `@` (defense-in-depth against an accidental email leak). All 7 captured keys (across `isLockedOut`, `recordFailure`, `recordSuccess`) start with the literal `pin:` prefix.

## Timing-Equalisation Strategy

CD-03 requires that the four CHANGE-path responses (right shape + right PIN, right shape + wrong PIN, right shape + locked out, wrong shape) take roughly the same wall-clock time so an attacker cannot oracle "does this user have a PIN set yet?" via response latency:

- **Right shape + right PIN** → `bcrypt.compare(plain, real)` (~250ms cost-12)
- **Right shape + wrong PIN** → `bcrypt.compare(plain, real)` (~250ms cost-12)
- **Wrong shape (missing currentPin)** → `alwaysCompareDummy(probe)` (~250ms cost-12 against pre-minted DUMMY_HASH)
- **Locked out** → fast-path 423 BEFORE any bcrypt call (acceptable: lockout is a separate signal already exposed by the 423 status)

The SET-path inverse (`currentPin` smuggled in when no hash exists) also calls `alwaysCompareDummy` for symmetry — closes the inverse oracle.

## Test Coverage (13 tests, all green)

1. SET — null hash + `{ newPin: '1234' }` → hash stored
2. CHANGE happy path — `verifyPin` true → `recordSuccess` + update
3. CHANGE wrong currentPin — `verifyPin` false → `recordFailure` → 400 PIN_INVALID
4. LOCKED OUT — `isLockedOut` true → 423, no bcrypt
5. Wrong shape — missing currentPin → `alwaysCompareDummy` + 400 PIN_REQUIRED
6. Threshold breach — `recordFailure { locked: true }` → 423 LOCKED_OUT
7. POST without CSRF → 403 (requireAuth not even reached)
8. requireAuth bails → 401 (findUnique not called)
9. SET Zod fail (too short) → 400 VALIDATION_FAILED
10. SET Zod fail (non-digits) → 400 VALIDATION_FAILED
11. DELETE happy path — hash cleared to null
12. DELETE without CSRF → 403
13. Lockout key namespace — every captured key matches `/^pin:/`

## Deviations from Plan

None — plan executed exactly as written. The `<action>` block code mapped to the route 1:1; the test file mirrored the bootstrap suggestion in the plan's `<action>` block. One micro-cleanup: removed an unused `eslint-disable` directive in the auth-gate test (the `@typescript-eslint/no-explicit-any` rule never fired on that line, so the disable was a no-op flagged by ESLint's `--report-unused-disable-directives`).

## Verification Outputs

- `pnpm --filter frontend exec vitest run src/app/api/auth/withdrawal-pin/route.test.ts` — 13/13 pass
- `pnpm --filter frontend exec vitest run src/lib/server/observability/runtime-enforcement.test.ts` — 14/14 pass (new route picked up `runtime='nodejs'`)
- `pnpm typecheck` — exits 0 (no `any` casts in production code)
- `pnpm lint` — exits 0 (no warnings after disable-directive cleanup)
- `! grep -E "log\.(info|warn|error).*(newPin|currentPin|withdrawalPinHash)" frontend/src/app/api/auth/withdrawal-pin/route.ts` — passes (no PIN/hash references in log calls)

## Note for Phase 4

`User.withdrawalPinHash` is now writable end-to-end. Phase 4's withdrawal POST will:
1. `findUnique` for the user and read `withdrawalPinHash`
2. If null → 400 `PIN_NOT_SET` (or whatever the WD-01 plan dictates)
3. If non-null and `body.pin` missing → 400 `PIN_REQUIRED`
4. If non-null and `verifyPin(body.pin, hash)` false → use the **same** lockout key (`pin:${userId}`) via `recordFailure` so withdrawal-attempt failures and PIN-change failures share a single attacker budget. This is the intended coupling — both paths are credential checks against the same secret.

The lockout primitive's email-key normalization (trim + lowercase) is irrelevant for `pin:${userId}` since cuids are already lowercase and have no whitespace.

## Self-Check: PASSED

- `frontend/src/app/api/auth/withdrawal-pin/route.ts` — FOUND
- `frontend/src/app/api/auth/withdrawal-pin/route.test.ts` — FOUND
- Commit `62127bc` (test RED) — FOUND
- Commit `7d51866` (feat GREEN) — FOUND
