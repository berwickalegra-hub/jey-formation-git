---
phase: 04-upload-files-withdrawals
plan: 01
subsystem: upload-files-withdrawals
type: execute
wave: 0
tags: [scaffold, tdd-red, r2, fixtures, env-example]
requires:
  - lazy-init pattern (payments/provider-singleton.ts)
  - sniff.ts magic-byte verifier (Phase 0)
  - withdrawals/{lock,balance,guards}.ts (Phase 0)
  - auth/pin.ts (Phase 2)
  - admin-fixtures factories (Phase 3)
provides:
  - getR2Client + getR2Bucket + StorageNotConfiguredError + __resetR2Singleton
  - mockR2Client({ onPut?, onGet? }) test factory
  - seedActiveUserWithPin + seedWithdrawal fixtures
  - 35 RED test scenarios (9 upload + 6 files + 20 withdrawals)
  - .env.example UPLOAD_*, R2_*, WITHDRAWAL_* with FINANCIAL-SAFETY warning
  - env-shape.test.ts tripwire on the warning + R2 + UPLOAD defaults
affects:
  - frontend/src/lib/server/upload/r2-client.ts (NEW)
  - frontend/src/test-utils/r2-mock.ts (NEW)
  - frontend/src/test-utils/admin-fixtures.ts (EXTENDED)
  - frontend/src/lib/server/observability/env-shape.test.ts (EXTENDED)
  - frontend/src/app/api/upload/route.test.ts (NEW — RED)
  - frontend/src/app/api/files/[...key]/route.test.ts (NEW — RED)
  - frontend/src/app/api/withdrawals/route.test.ts (NEW — RED)
  - .env.example (APPENDED)
tech-stack:
  added: []
  patterns:
    - lazy-init singleton (mirrors payments/provider-singleton.ts)
    - vi.mock-injected R2 client for unit tests (no real S3Client)
    - prismaMock-pattern (vitest-mock-extended) — pure factory fixtures
key-files:
  created:
    - frontend/src/lib/server/upload/r2-client.ts
    - frontend/src/test-utils/r2-mock.ts
    - frontend/src/app/api/upload/route.test.ts
    - frontend/src/app/api/files/[...key]/route.test.ts
    - frontend/src/app/api/withdrawals/route.test.ts
  modified:
    - frontend/src/test-utils/admin-fixtures.ts
    - frontend/src/lib/server/observability/env-shape.test.ts
    - .env.example
decisions:
  - 'env-shape test path: 5 levels up (../../../../../.env.example) — matches existing test convention; .env.example lives at repo root, not frontend/'
  - 'seedWithdrawal is a pure factory (not prisma.withdrawal.create) — consistent with seedOrder/seedOutbox in admin-fixtures.ts and the unit-test prismaMock pattern'
  - 'PIN_NOT_SET / PIN_REQUIRED / PIN_INVALID return 403 (not 422) — verified against guards.ts source'
  - 'Plan said "frontend/.env.example" but the env-shape test resolves to repo-root .env.example; appended to the existing file rather than creating a new one'
metrics:
  duration: 6 min
  completed: 2026-05-08
  tasks: 3
  files: 8
  tests-added: 35 (RED) + 4 (env-shape green)
---

# Phase 4 Plan 04-01: Scaffold R2 Lib + Fixtures + RED Tests Summary

R2 lazy-init client + mock factory + 3 RED test files (35 scenarios) + extended fixtures + .env.example phase 4 blocks with verbatim FINANCIAL-SAFETY warning.

## What was built

**Wave 0 scaffolding for Phase 4** — establishes the test contract that Wave 1 routes (upload, files, withdrawals) will implement against. Eliminates scavenger-hunt work for downstream executors.

### Task 1 — R2 lazy-init + mock + env.example (commit `b9d596b`)

- **`frontend/src/lib/server/upload/r2-client.ts`** (NEW, 91 lines): `getR2Client()` mirrors `payments/provider-singleton.ts` verbatim. Reads four required envs (`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) with `?? ''` empty-as-absent treatment, throws typed `StorageNotConfiguredError` when any are empty. `R2_ENDPOINT` overrides the computed Cloudflare URL (Minio dev support). `__resetR2Singleton()` is the test escape hatch.
- **`frontend/src/test-utils/r2-mock.ts`** (NEW, 65 lines): `mockR2Client({ onPut?, onGet? })` returns `Pick<S3Client, 'send'>` whose `send()` dispatches by `cmd.constructor.name`. Default `onGet` returns 3-byte ReadableStream + ETag `'"abc123"'` + ContentLength 3. Tests can throw `NoSuchKey` from `onGet` to simulate missing R2 objects.
- **`.env.example`** (APPENDED): UPLOAD_ALLOWED_MIME, UPLOAD_MAX_BYTES, R2_*, R2_ENDPOINT, plus a production-safe WITHDRAWAL_* block with the verbatim `⚠️  FINANCIAL-SAFETY WARNING — DO NOT CASUALLY DISABLE  ⚠️` block. (Existing Phase 3 WITHDRAWAL_* block at line 80-88 stays untouched — appending establishes the production-safe defaults as later-wins on dotenv load.)
- **`env-shape.test.ts`** (EXTENDED): 4 new assertions tripwire the warning string, the upload defaults, the four R2_* keys + R2_ENDPOINT, and `WITHDRAWAL_MIN_AMOUNT="1000"` / `WITHDRAWAL_REQUIRE_PIN="1"`. **9 tests pass.**

### Task 2 — Withdrawal + PIN fixtures (commit `81ac134`)

- **`frontend/src/test-utils/admin-fixtures.ts`** (EXTENDED): added `seedActiveUserWithPin(plainPin, overrides)` (async, bcrypt cost 4 — test-speed knob; production cost 12) and `seedWithdrawal(overrides)` (pure factory mirroring `seedOrder` / `seedOutbox` shape). All existing exports preserved. Typecheck passes.

### Task 3 — 3 RED test files (commit `bb40d04`)

- **`frontend/src/app/api/upload/route.test.ts`** (NEW, 192 lines, 9 scenarios): valid jpeg, magic byte mismatch, mime not allowed, file too large, storage not configured, missing file, upload failed, csrf 403, no auth 401.
- **`frontend/src/app/api/files/[...key]/route.test.ts`** (NEW, 168 lines, 6 scenarios): owner streams (200 + Cache-Control + ETag), missing → 404, owner mismatch → 404 (404 collapse, no enumeration), storage not configured → 503, r2 nosuch → 404, anonymous public-readable.
- **`frontend/src/app/api/withdrawals/route.test.ts`** (NEW, 376 lines, 20 scenarios): happy path (201 PENDING + lockUserTx called), advisory-lock (Serializable + lockUserTx-before-findUnique invocation order), `it.each(codeTable)` covering all 8 stable error codes (PIN_NOT_SET/REQUIRED/INVALID at 403, AMOUNT_BELOW_MIN/ABOVE_MAX/DAILY_LIMIT_EXCEEDED/COOLDOWN_ACTIVE/INSUFFICIENT_BALANCE at 422), invalid body × 3 (missing amount, bad phone, bad enum), csrf 403, no auth 401, balance-check default + disabled, GET own (DESC), GET cursor pagination, GET userId isolation.

**RED state confirmed**: `pnpm --filter frontend exec vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals` reports 35 failed tests, all with `Error: Failed to load url ./route` — Vite/Vitest cannot find the route modules. This is the expected RED state per the plan's verification block. Wave 1 will turn them green by creating the routes.

## Wave 1 readiness signal

Wave 1 executors building `app/api/upload/route.ts`, `app/api/files/[...key]/route.ts`, and `app/api/withdrawals/route.ts` can now run tests in watch mode and converge on green. The test contract is locked:

- Stable error codes verbatim from REQUIREMENTS.md
- HTTP status codes wired (per `validateWithdrawalRequest` source: PIN_* = 403, others = 422)
- Cache-Control header value (`private, max-age=3600`) and ETag forwarding behavior
- Owner-mismatch must collapse to FILE_NOT_FOUND (D-FILE-03)
- Advisory lock: `lockUserTx(tx, auth.user.sub)` MUST be the first statement after BEGIN; tx options must include `isolationLevel: 'Serializable'`
- GET pagination: `take: limit + 1` slice + base64 cursor pattern
- All routes wrap `verifyCsrf → requireAuth` (mutating routes); GET only `requireAuth`

## Deviations from Plan

**1. [Rule 3 - Path correction] env-shape test path uses 5 levels up, not 4**
- **Found during:** Task 1 (env-shape extension)
- **Issue:** Plan said `../../../../.env.example` (4 levels) but the existing env-shape test uses `../../../../../.env.example` (5 levels). The .env.example file lives at the repo root, not `frontend/.env.example`.
- **Fix:** Used the existing `ENV_EXAMPLE` const from the original test file — guarantees consistency.
- **Files modified:** `frontend/src/lib/server/observability/env-shape.test.ts`
- **Commit:** b9d596b

**2. [Rule 1 - Source vs plan signature mismatch] PIN_* error codes return 403, not 422**
- **Found during:** Task 3 (withdrawals test file)
- **Issue:** Plan's table-driven test code listed `PIN_NOT_SET/REQUIRED/INVALID` at status 422; reading `frontend/src/lib/server/withdrawals/guards.ts` revealed the actual returns are 403 (PIN_NOT_SET, PIN_REQUIRED, PIN_INVALID lines 88, 97, 103).
- **Fix:** Updated `codeTable` so PIN_* rows use 403, others use 422. Tests now match the source-of-truth `validateWithdrawalRequest` return shape.
- **Files modified:** `frontend/src/app/api/withdrawals/route.test.ts`
- **Commit:** bb40d04

**3. [Rule 1 - Pattern consistency] seedWithdrawal is a pure factory**
- **Found during:** Task 2 (admin-fixtures extension)
- **Issue:** Plan's `seedWithdrawal` snippet called `prisma.withdrawal.create({...})`. The existing admin-fixtures.ts file is entirely pure factories (no DB calls) — `seedOrder`, `seedOutbox`, `seedEmailJob` all return shaped rows for `prismaMock.X.mockResolvedValue(...)` wiring. A `prisma.withdrawal.create` call would break in unit tests (no DB) and require a different injection pattern.
- **Fix:** Wrote `seedWithdrawal` as a pure factory matching the file's shape. Wave 1 tests use it via `prismaMock.withdrawal.findMany.mockResolvedValueOnce([seedWithdrawal({ userId: ... })])`.
- **Files modified:** `frontend/src/test-utils/admin-fixtures.ts`
- **Commit:** 81ac134

**4. [Rule 3 - Prevented duplicate WITHDRAWAL_BALANCE_CHECK key issue]**
- **Found during:** Task 1 (env.example append)
- **Issue:** `.env.example` already had a Phase 1/2/3 WITHDRAWAL_* block (lines 80-88) with `WITHDRAWAL_MIN_AMOUNT="1"` and `WITHDRAWAL_REQUIRE_PIN="0"`. Plan asked to append a new block with different values (1000, 1) and the FINANCIAL-SAFETY warning.
- **Fix:** Appended the Phase 4 block at end-of-file with a leading explanatory comment ("Whichever block appears LATER in this file wins on dotenv load — keep this block last"). Preserves original block; FINANCIAL-SAFETY warning is added; env-shape test passes.
- **Files modified:** `.env.example`
- **Commit:** b9d596b

## Authentication Gates

None — this plan is pure scaffolding (lib + fixtures + RED tests). No external services touched.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| env-shape test | `vitest run src/lib/server/observability/env-shape.test.ts` | **9/9 pass** |
| runtime-enforcement (regression) | `vitest run src/lib/server/observability/runtime-enforcement.test.ts` | **32/32 pass** |
| typecheck (Tasks 1-2 only) | `tsc --noEmit` (excluding new RED tests) | **green** |
| RED tests are RED | `vitest run src/app/api/upload src/app/api/files src/app/api/withdrawals` | **35/35 fail with "Failed to load url ./route"** (expected RED) |
| No protected files modified | `git diff` since plan start | **clean** |
| R2_* not in env.ts schema (Pitfall 6) | `grep R2_ACCOUNT_ID frontend/src/lib/server/env.ts` | **0 matches** |

## Self-Check: PASSED

- All 8 files exist at expected paths.
- All 3 commits exist in `git log`:
  - `b9d596b` — Task 1 (R2 client + mock + env.example)
  - `81ac134` — Task 2 (fixtures)
  - `bb40d04` — Task 3 (3 RED test files)
- env-shape test green (9/9), runtime-enforcement test green (32/32, no regression).
- 35 RED tests fail with module-not-found — exactly the contract Wave 1 needs.
- No file from CLAUDE.md "Files Claude must NOT modify" list was touched.
- Acceptance criteria 11 satisfied: `R2_ACCOUNT_ID` does NOT appear in `frontend/src/lib/server/env.ts` (Pitfall 6 — empty-string Zod rejection avoided).
