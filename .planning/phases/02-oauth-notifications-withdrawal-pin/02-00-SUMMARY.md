---
phase: 02-oauth-notifications-withdrawal-pin
plan: 00
subsystem: helpers
tags: [oauth, notifications, withdrawal-pin, bcrypt, cursor-pagination]
requires:
  - frontend/src/lib/server/auth.ts (bcrypt cost-12 reference)
  - frontend/vitest.config.ts (server-only alias for tests)
provides:
  - frontend/src/lib/server/oauth/error-redirect.ts (Wave 1 Plan 02-01 imports)
  - frontend/src/lib/server/notifications/cursor.ts (Wave 1 Plan 02-02 imports)
  - frontend/src/lib/server/notifications/prefs-merge.ts (Wave 1 Plan 02-02 imports)
  - frontend/src/lib/server/auth/pin.ts (Wave 1 Plan 02-03 imports)
affects:
  - none (no production route handlers added; Wave 1 wires them in)
tech-stack:
  added: []
  patterns:
    - Pure helper modules co-located with Vitest .test.ts files
    - Cost-12 bcrypt timing-equalisation via pre-minted DUMMY_HASH (CD-03)
    - Opaque base64(JSON) cursor for keyset pagination (D-07)
    - Opt-out deep-merge with default-enabled semantics (D-10)
key-files:
  created:
    - frontend/src/lib/server/oauth/error-redirect.ts
    - frontend/src/lib/server/oauth/error-redirect.test.ts
    - frontend/src/lib/server/notifications/cursor.ts
    - frontend/src/lib/server/notifications/cursor.test.ts
    - frontend/src/lib/server/notifications/prefs-merge.ts
    - frontend/src/lib/server/notifications/prefs-merge.test.ts
    - frontend/src/lib/server/auth/pin.ts
    - frontend/src/lib/server/auth/pin.test.ts
  modified: []
decisions:
  - "redirectToAuthError requires an absolute URL — Next's NextResponse.redirect rejects relative paths, so the helper reads process.env.APP_URL when opts.appUrl is absent (deviation from plan body which suggested a bare relative path)"
  - "alwaysCompareDummy uses a freshly-minted cost-12 hash (plaintext 'amadou-pin-dummy') rather than the placeholder shown in the plan, since the placeholder failed runtime validation"
metrics:
  duration: 4min
  tasks: 4
  files: 8
  tests: 49
  completed: 2026-05-08
---

# Phase 02 Plan 00: Wave 0 Pure Helpers Summary

Shipped the four pure helpers that Wave 1 (OAuth, Notifications, Withdrawal-PIN) imports — eliminating the cross-plan scavenger hunt for cursor format, error-code casing, prefs-merge semantics, and PIN bcrypt cost.

## What was built

### 1. OAuth error-redirect (`frontend/src/lib/server/oauth/error-redirect.ts`)

- `redirectToAuthError(code: OAuthErrorCode, opts?)` returns a 302 `NextResponse` with `Location: /auth/error?code=<UPPERCASE>`.
- `isSameOriginNext(next, appUrl)` validates the OAuth `?next=` param — rejects `//evil.com` (Pitfall 10), explicit schemes (`http://`, `https://`, `javascript:`, `data:`), bare paths without leading slash, and any post-resolve cross-origin URL.
- Exports `OAuthErrorCode` type and `OAUTH_ERROR_CODES` readonly array (5 codes: `GOOGLE_EMAIL_NOT_VERIFIED`, `OAUTH_STATE_MISMATCH`, `OAUTH_CODE_EXCHANGE_FAILED`, `OAUTH_PROVIDER_DISABLED`, `OAUTH_GENERIC`).
- Mitigates **T-02-OAUTH-OPEN-REDIRECT**.

### 2. Notifications cursor (`frontend/src/lib/server/notifications/cursor.ts`)

- `encodeCursor({createdAt: Date, id: string})` → base64(JSON.stringify(...)).
- `decodeCursor(raw)` → `Cursor | null`. Returns null on null/undefined/empty/malformed-base64/malformed-JSON/missing-fields/invalid-date so the caller falls back to "first page".
- Composite (createdAt, id) cursor disambiguates same-millisecond ties and matches Prisma `@@index([userId, createdAt])`.
- **T-02-NOTIF-CURSOR-INJECTION** accepted: typed decode feeds Prisma's parameterised `where` clause — no raw SQL path.

### 3. Notifications prefs-merge (`frontend/src/lib/server/notifications/prefs-merge.ts`)

- `mergePrefs(existing, patch)` shallow-merges at the event-type AND channel level. Inputs are never mutated.
- `isChannelEnabled(prefs, eventType, channel)` — D-10 opt-out semantics: missing event ⇒ enabled, missing channel ⇒ enabled, explicit `false` ⇒ disabled.
- Exports `NotificationPrefs` and `ChannelPrefs` types.
- Contract: prefs row stores ONLY user overrides; new event types never need a backfill.

### 4. Auth PIN (`frontend/src/lib/server/auth/pin.ts`)

- `hashPin(plain)` → cost-12 bcrypt hash (matches `auth.ts:137` hashPassword).
- `verifyPin(plain, hash)` → boolean.
- `alwaysCompareDummy(plain)` → always `false`, but spends ~250ms on cost-12 hardware (CD-03 timing equalisation for the "no current hash" branch in change-PIN).
- Exports `PIN_BCRYPT_COST = 12`.
- `hashPin` rejects empty/non-string input (defense-in-depth on top of route Zod schema).
- Mitigates **T-02-PIN-BRUTE** and **T-02-PIN-TIMING**.

## Test coverage

| File | Tests | Runtime |
|------|-------|---------|
| `oauth/error-redirect.test.ts` | 18 | 6ms |
| `notifications/cursor.test.ts` | 12 | 4ms |
| `notifications/prefs-merge.test.ts` | 11 | 3ms |
| `auth/pin.test.ts` | 8 | 2362ms (cost-12 bcrypt is the dominant cost) |
| **Total** | **49** | **~2.4s** |

Full repo test suite (`pnpm --filter frontend exec vitest run`): 189 tests, 26 files, all green — no regressions.

`pnpm --filter frontend exec tsc --noEmit` and `pnpm --filter frontend exec eslint src/lib/server/...` both exit 0 with no output.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] redirectToAuthError must build an absolute URL**

- **Found during:** Task 1 (RED→GREEN transition — implementation matched plan body verbatim, then tests 1/2 failed)
- **Issue:** The plan body suggested `target = opts.appUrl ? new URL(...).toString() : path` (relative path when `appUrl` is omitted). At runtime, `NextResponse.redirect` calls Next's `validateURL` which throws `ERR_INVALID_URL` on non-absolute strings.
- **Fix:** Resolve via `opts.appUrl ?? process.env.APP_URL ?? 'http://localhost'` before passing to `new URL(path, base)`. Tests still assert via `endsWith` on the path suffix and `?code=<CODE>` substring, so the contract is unchanged from the caller's perspective.
- **Files modified:** `frontend/src/lib/server/oauth/error-redirect.ts`
- **Commit:** `114aec2`

**2. [Rule 1 - Bug] DUMMY_HASH placeholder needed regeneration**

- **Found during:** Task 4 (planning step before writing the file)
- **Issue:** The plan's example `DUMMY_HASH` literal was a placeholder. The plan itself instructs: "If unsure, generate a fresh one with `await bcrypt.hash('dummy', 12)`."
- **Fix:** Generated a fresh cost-12 hash via `node -e "require('bcryptjs').hash('amadou-pin-dummy', 12).then(console.log)"` → `$2a$12$D/kxqEezQRyx1cld8ic6d.cNU4N4tsQPVsBpVXZBTGnA3pBA9bqcy`.
- **Files modified:** `frontend/src/lib/server/auth/pin.ts`
- **Commit:** `7ff83d5`

No other deviations. No architectural changes (Rule 4) needed; no auth gates encountered.

## Commits

| Hash | Task | Files |
|------|------|-------|
| `114aec2` | Task 1: error-redirect | `oauth/error-redirect.{ts,test.ts}` |
| `7740065` | Task 2: cursor | `notifications/cursor.{ts,test.ts}` |
| `572da2c` | Task 3: prefs-merge | `notifications/prefs-merge.{ts,test.ts}` |
| `7ff83d5` | Task 4: PIN | `auth/pin.{ts,test.ts}` |

## Self-Check: PASSED

- All 8 files exist on disk
- All 4 commits exist in `git log`
- 49/49 unit tests pass; 189/189 full-suite tests pass
- `tsc --noEmit` exits 0
- `eslint src/lib/server/...` exits 0
- No `any` casts, no `@ts-ignore` (per CLAUDE.md TS strictness invariant)
- No production route handlers added; `runtime-enforcement.test.ts` unaffected
- No CLAUDE.md "files Claude must NOT modify" were touched (`auth.ts`, `oauth/google.ts`, `middleware/index.ts`, etc. all untouched)
