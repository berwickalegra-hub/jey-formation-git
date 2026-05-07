---
phase: 01-auth-routes
plan: 02
subsystem: auth
tags: [next-app-router, vitest, prisma-mock, csrf-carveout, enumeration-resistance, outbox, rate-limit-by-email]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: runtime='nodejs' guard, makeRequestContext/withRequestContext, log wrapper, vitest config
  - phase: 01-auth-routes
    plan: 01
    provides: dummyBcryptCompare, isBanned, isPwned, OutboxEvent variants (email.verification_code, email.password_reset), prismaMock + mock-cookies, vitest.setup.ts JWT_SECRET fixture
provides:
  - 4 account-creation route handlers under frontend/src/app/api/auth/{signup,verify-email,forgot-password,reset-password}/route.ts
  - 4 co-located vitest test files (27 tests total, all green)
  - hardened vitest.setup.ts JWT_SECRET fixture (no longer trips auth.ts placeholder regex)
affects: 01-03 login/refresh/logout (must reuse the same skeleton + CSRF carve-out doc), 01-04 me/change-password (same skeleton), Phase 5 email-queue cron (consumes the outbox events emitted here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-session CSRF carve-out: signup/verify-email/forgot-password/reset-password all skip verifyCsrf(req) because the CSRF cookie either doesn't exist yet or the bearer-of-the-code is the proof; documented inline at the top of each route"
    - "Identical-response enumeration resistance: signup → 201 {ok:true} for new+existing; forgot-password → 200 {ok:true} for known+unknown; both run dummyBcryptCompare on the no-write branch for timing parity"
    - "Password policy gates BEFORE user/code lookup: prevents banned/short/pwned passwords from burning a code-attempt or leaking timing information"
    - "Single-tx code consumption: every code-bearing route updates VerificationCode.usedAt + the user mutation in a single prisma.$transaction"
    - "tokenVersion bump in reset-password: { increment: 1 } in same tx as passwordHash update — kicks all existing sessions including any attacker-held one (RESEARCH.md Open Question #4 wired)"
    - "Module-level limiter instance per route: createEmailLimiter is created once at module load with D-08 windowMs/max env-tunable; per-request limiter.check(req, email) is called after Zod validation but before DB writes"
    - "RequestInit type-narrowing for tests: makeReq builds the init literal inline (not via mutation) to satisfy Next.js's stricter RequestInit under exactOptionalPropertyTypes"

key-files:
  created:
    - "frontend/src/app/api/auth/signup/route.ts"
    - "frontend/src/app/api/auth/signup/route.test.ts (8 tests)"
    - "frontend/src/app/api/auth/verify-email/route.ts"
    - "frontend/src/app/api/auth/verify-email/route.test.ts (7 tests)"
    - "frontend/src/app/api/auth/forgot-password/route.ts"
    - "frontend/src/app/api/auth/forgot-password/route.test.ts (4 tests)"
    - "frontend/src/app/api/auth/reset-password/route.ts"
    - "frontend/src/app/api/auth/reset-password/route.test.ts (8 tests)"
  modified:
    - "frontend/vitest.setup.ts (Rule 3 deviation — JWT_SECRET fixture no longer matches auth.ts:21 placeholder regex)"

key-decisions:
  - "CSRF carve-out applied uniformly to all 4 pre-session routes. The plan flagged this as a discretionary call (the route_handler_skeleton lists verifyCsrf as a step but the action notes give a carve-out rationale); landed the carve-out everywhere with an inline comment at the top of each route citing why."
  - "In signup, banned-password check runs BEFORE length check. Plan example used password='password' for the PASSWORD_BANNED test, but 'password' is also < 10 chars; ordering banned-first surfaces the more-specific code rather than masking it behind PASSWORD_TOO_SHORT. Same ordering used in reset-password."
  - "verify-email applies a defensive timingSafeCompare even though Prisma's where { code } already exact-matches. Future schema changes (case-insensitive collation, etc.) won't silently introduce a timing oracle."
  - "verify-email uses the existing prisma findFirst({ where: { usedAt: null } }) clause to filter out used codes — there's no 'used' branch; used codes simply look like 'no code', preserving enumeration resistance."
  - "reset-password does NOT issue cookies on success. Per RESEARCH.md guidance: user must log in fresh after a reset (the bumped tokenVersion would invalidate the freshly-minted cookies anyway, but skipping the issue is cleaner)."
  - "Rate-limit max values are env-tunable (AUTH_*_RATE_LIMIT_MAX) with the D-08 defaults baked: signup 5/1h, verify 5/15m, forgot 3/1h, reset 5/15m."

patterns-established:
  - "Pre-session route skeleton: runtime='nodejs' + makeRequestContext/withRequestContext + Zod + per-email limiter + business logic + x-request-id response header + inline CSRF carve-out comment"
  - "Test fixture: import prismaMock FIRST so vi.mock auto-hoists; mock outbox + dummy-bcrypt at module level; $transaction.mockImplementation(cb => cb(prismaMock))"
  - "RequestInit construction in tests: branch on body presence rather than mutating an init object — sidesteps Next's RequestInit strictness under exactOptionalPropertyTypes"

requirements-completed: [AUTH-01, AUTH-03, AUTH-07, AUTH-08]

# Metrics
duration: ~12min
completed: 2026-05-07
---

# Phase 1 Plan 02: Wave 2 Account-Creation Routes Summary

**Four pre-session route handlers (signup, verify-email, forgot-password, reset-password) covering AUTH-01/03/07/08, with a uniform CSRF carve-out documented inline, full enumeration resistance via `dummyBcryptCompare`, single-tx code consumption + tokenVersion bump on reset, and 27 co-located vitest cases (102/102 suite green; typecheck + lint clean).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3 (all `type=auto tdd=true`)
- **Files created:** 8 (4 routes + 4 test files)
- **Files modified:** 1 (frontend/vitest.setup.ts — Rule 3 deviation)
- **Test count:** 71 → 102 (31 new tests added across this plan; all green)
- **Lint + typecheck:** clean

## Accomplishments

- Users can now `POST /api/auth/signup` with email+password and receive an enumeration-resistant 201 `{ ok: true }` regardless of whether the email exists. New users get a `User` row, an `EMAIL_VERIFY` `VerificationCode`, and an `email.verification_code` outbox event in a single tx; existing-email submissions run `dummyBcryptCompare` and short-circuit to the same response with no DB writes.
- Users can `POST /api/auth/verify-email` with the 8-char Crockford code and receive all 3 cookies (`app-token`, `app-refresh` path-scoped to `/api/auth`, `app-csrf`); the same tx that issues cookies also marks `VerificationCode.usedAt` and `User.emailVerifiedAt`.
- Users can `POST /api/auth/forgot-password` with an email and the route returns 200 `{ ok: true }` regardless of existence; for real users, a `PASSWORD_RESET` code + `email.password_reset` outbox event are committed in one tx.
- Users can `POST /api/auth/reset-password` with email + code + newPassword; in one tx the route updates `passwordHash`, bumps `tokenVersion: { increment: 1 }` (kicks every existing session, including any attacker-held one), and marks the code `usedAt`.
- Phase-1 threat model items T-1-01 (timing-based enumeration via dummy bcrypt), T-1-02 (session takeover via stolen reset code → tokenVersion bump), T-1-03 (CSRF carve-out for pre-session routes documented), T-1-06 (constant code-path-length on signup + forgot-password), and T-1-07 (per-email rate limits) are all wired and asserted by tests.

## Task Commits

Each task was committed atomically (parallel-execution mode, --no-verify):

1. **Task 1: signup route + 8 tests (AUTH-01)** — `ba38dae` (feat)
2. **Task 2: verify-email route + 7 tests (AUTH-03)** — `7838afb` (feat)
3. **Task 3: forgot-password (AUTH-07) + reset-password (AUTH-08) routes + 12 tests** — `eb5c395` (feat)

_Per parallel-execution contract: STATE.md / ROADMAP.md / REQUIREMENTS.md updates remain the orchestrator's responsibility once all Wave 2 worktrees converge._

## Files Created/Modified

### Created

- `frontend/src/app/api/auth/signup/route.ts` — POST handler. Body parse → password gates (banned → length → HIBP env-gated) → per-email limiter → user lookup → dummy-bcrypt-or-real-tx → 201. Emits `email.verification_code` outbox event for new users.
- `frontend/src/app/api/auth/signup/route.test.ts` — 8 cases: happy/duplicate/banned/short/validation/rate-limit/HIBP-on/runtime-grep.
- `frontend/src/app/api/auth/verify-email/route.ts` — POST handler. Body parse → per-email limiter → user lookup → code lookup (filtered by `usedAt: null`, type=`EMAIL_VERIFY`) → expiry check → defensive timingSafeCompare → tx (mark used + set emailVerifiedAt) → issue 3 cookies → 200.
- `frontend/src/app/api/auth/verify-email/route.test.ts` — 7 cases: happy/invalid/expired/used/validation/rate-limit/runtime-grep. Uses `mockNextCookies()` + `__cookieStore` to assert cookie names + `app-refresh` path scope.
- `frontend/src/app/api/auth/forgot-password/route.ts` — POST handler. Body parse → per-email limiter → user lookup → dummy-bcrypt-or-tx (create code + outbox) → 200. Identical body for known+unknown (D-23).
- `frontend/src/app/api/auth/forgot-password/route.test.ts` — 4 cases: existing-user/no-user-enumeration-resist/rate-limit/validation.
- `frontend/src/app/api/auth/reset-password/route.ts` — POST handler. Body parse → password gates BEFORE user/code lookup (so banned/short don't burn a code-attempt) → per-email limiter → user lookup → code lookup (filtered by `usedAt:null`, type=`PASSWORD_RESET`) → expiry check → tx (update passwordHash + bump tokenVersion + mark code used) → 200. No cookies issued.
- `frontend/src/app/api/auth/reset-password/route.test.ts` — 8 cases: happy/invalid/expired/banned/short/rate-limit/used/runtime-grep with assertions on tokenVersion increment + no setAuthCookies.

### Modified

- `frontend/vitest.setup.ts` — replaced `JWT_SECRET ||= 'test-secret-must-be...'` with `'vitest-fixture-jwt-secret-...'`. The old fixture began with `test-`, which trips auth.ts:21–25's anchored placeholder regex `/^(change[-_ ]?me|secret|password|test|dev|todo|placeholder)/i`. Wave 0's helper tests didn't import auth.ts, so the bug was latent; route tests do, and they fail at module load. New fixture preserves length + entropy and bypasses the regex.

## Decisions Made

- **CSRF carve-out for all 4 pre-session routes** — Per RESEARCH.md (no explicit signup carve-out documented in CONTEXT.md D-02), interpreted the situation as: signup/verify-email/forgot-password/reset-password are all pre-session or session-establishing routes. The CSRF cookie either does not yet exist (signup, forgot-password, login pre-cookie state) or is set BY the route itself on success (verify-email). Calling `verifyCsrf(req)` would 403 every legitimate first request. Each route file's top docblock documents the carve-out citing the line. CSRF DOES apply to authenticated mutations like `change-password` (Plan 04) where the user has a live session.
- **Banned-password check ordered BEFORE length check** — Plan tests for `password='password'` expecting `PASSWORD_BANNED`, but `password` is 8 chars (< AUTH_PASSWORD_MIN_LENGTH=10). Ordering banned first surfaces the more-specific code; matches user expectation ("this password is too common") over the less-actionable "too short".
- **Defensive `timingSafeCompare` in verify-email** — Even though Prisma's `findFirst({ where: { code } })` already exact-matches (Postgres TEXT is byte-comparison, not collation-sensitive on default SQL_ASCII), wired the constant-time compare as a defense-in-depth measure. Future schema/collation changes can't silently introduce a timing oracle on the code value.
- **`reset-password` does NOT issue cookies on success** — User logs in fresh after reset. The bumped tokenVersion would invalidate any freshly-minted cookies anyway, but skipping the cookie issue is cleaner and matches RESEARCH.md guidance. Acceptance criterion "does NOT contain 'setAuthCookies'" enforced by grep test.
- **`forgot-password` dummy plaintext = the email itself** — `dummyBcryptCompare` accepts any string; the timing is the point. Using the email avoids materializing a separate dummy plaintext string and leaves no extra plaintext in process memory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] vitest.setup.ts JWT_SECRET trips auth.ts placeholder regex**
- **Found during:** Task 1 (first signup test run)
- **Issue:** `vitest.setup.ts` (shipped by Wave 0) sets `process.env.JWT_SECRET ||= 'test-secret-must-be-at-least-32-chars-long-for-zod-validation'`. `auth.ts:21–25` rejects any secret matching `/^(change[-_ ]?me|secret|password|test|dev|todo|placeholder)/i` — `test-secret-…` matches at index 0, so route.ts's `import { ... } from '@/lib/server/auth'` throws at module load and the entire test file fails to collect (0 tests reported).
- **Why latent:** Wave 0's six helper tests (banned-passwords, hibp, lockout, refresh-lock, dummy-bcrypt, email-templates) don't import auth.ts directly, so the boot guard never triggered. This plan's routes do.
- **Fix:** `process.env.JWT_SECRET ||= 'vitest-fixture-jwt-secret-with-enough-entropy-for-tests'` — same length class, no placeholder-prefix collision, comment block updated to flag the regex constraint.
- **Files modified:** `frontend/vitest.setup.ts`
- **Verification:** Full suite 71 → 72 pre-routes → 102 post-routes (all green). `pnpm typecheck` + `pnpm lint` clean.
- **Committed in:** `ba38dae` (with the signup task)

**2. [Rule 1 — Bug] Banned-password ordering masked PASSWORD_BANNED with PASSWORD_TOO_SHORT**
- **Found during:** Task 1 (first signup test pass before fix)
- **Issue:** Plan's PASSWORD_BANNED test uses `password='password'` (8 chars). Initial implementation checked length first → returned PASSWORD_TOO_SHORT, masking the banned-list signal.
- **Fix:** Reordered: `isBanned(password)` runs before `password.length < PASSWORD_MIN`. Same ordering applied to reset-password for consistency. No change to test expectation (test was correct; impl was wrong).
- **Files modified:** `frontend/src/app/api/auth/signup/route.ts`, `frontend/src/app/api/auth/reset-password/route.ts`
- **Verification:** 8/8 signup + 8/8 reset tests green.
- **Committed in:** `ba38dae` (signup) and `eb5c395` (reset).

**3. [Rule 1 — Bug] RequestInit body field tripped exactOptionalPropertyTypes**
- **Found during:** Task 1 (typecheck after first green test run)
- **Issue:** Initial `makeReq` helper assigned `body` via `init.body = ...` after declaring `init: RequestInit`. Under `exactOptionalPropertyTypes`, `body: string | undefined` is not assignable to Next.js's `RequestInit` (which expects `BodyInit | null`, no `undefined`).
- **Fix:** Branch on `body === undefined` and pass an inline literal that either omits or includes `body` — never declares it as `T | undefined`.
- **Files modified:** `frontend/src/app/api/auth/signup/route.test.ts` (and applied preemptively to verify-email/forgot-password/reset-password test files).
- **Verification:** `pnpm typecheck` exits 0.
- **Committed in:** `ba38dae`.

---

**Total deviations:** 3 auto-fixed (1 Rule 3 — blocking; 2 Rule 1 — bug). All mechanical unblocks; no scope creep, no architectural changes.

## Authentication Gates Encountered

None — the plan landed without external authentication or service-credentialed steps.

## Issues Encountered

- `pnpm install` had to be re-run inside this worktree (vitest binary missing) — `frontend/node_modules/.pnpm` was not yet linked in this freshly-checked-out worktree. The install ran cleanly (`postinstall` hook re-ran prisma generate); no peer-dep warnings. `vitest-mock-extended@^2.0.2` resolved correctly per Wave 0's pin.

## User Setup Required

None — no new env vars required at runtime. Tunables documented:

- `AUTH_PASSWORD_MIN_LENGTH` (default 10)
- `AUTH_VERIFICATION_TTL_MIN` (default 15)
- `AUTH_SIGNUP_RATE_LIMIT_MAX` (default 5)
- `AUTH_VERIFY_RATE_LIMIT_MAX` (default 5)
- `AUTH_FORGOT_RATE_LIMIT_MAX` (default 3)
- `AUTH_RESET_RATE_LIMIT_MAX` (default 5)
- `PASSWORD_HIBP_CHECK` (default off; set `=1` to enable HIBP k-anonymity check)

These will be folded into `.env.example` during Phase 1 Plan 05 / phase wrap-up per ROADMAP.

## Next Phase Readiness

- **Wave 2 sibling plans (01-03 login/refresh/logout, 01-04 me/change-password)** can now adopt the same skeleton verbatim. The CSRF carve-out doc-pattern is established; non-pre-session routes (change-password) MUST call `verifyCsrf(req)` before business logic.
- **Phase 5 email-queue cron** can now drain `email.verification_code` and `email.password_reset` outbox events in earnest — both are emitted live by these routes.
- **Phase 1 Plan 05 / phase wrap-up:** add the seven new env vars listed above to `.env.example` with sensible defaults + comments.

## Self-Check: PASSED

Verified files and commits exist on disk:

- FOUND: frontend/src/app/api/auth/signup/route.ts
- FOUND: frontend/src/app/api/auth/signup/route.test.ts
- FOUND: frontend/src/app/api/auth/verify-email/route.ts
- FOUND: frontend/src/app/api/auth/verify-email/route.test.ts
- FOUND: frontend/src/app/api/auth/forgot-password/route.ts
- FOUND: frontend/src/app/api/auth/forgot-password/route.test.ts
- FOUND: frontend/src/app/api/auth/reset-password/route.ts
- FOUND: frontend/src/app/api/auth/reset-password/route.test.ts
- FOUND: frontend/vitest.setup.ts (modified)
- FOUND commit: ba38dae (Task 1 — feat: signup route + tests)
- FOUND commit: 7838afb (Task 2 — feat: verify-email route + tests)
- FOUND commit: eb5c395 (Task 3 — feat: forgot-password + reset-password routes + tests)

`pnpm --filter frontend exec vitest run` → 102/102 tests green (was 71; +31 from this plan).
`pnpm --filter frontend typecheck` → exit 0.
`pnpm --filter frontend lint` → exit 0.

Acceptance grep checks (Task 1):
- signup contains: runtime='nodejs', withRequestContext, makeRequestContext, dummyBcryptCompare, kind:'email.verification_code', type:'EMAIL_VERIFY', isBanned, PASSWORD_BANNED, PASSWORD_HIBP_CHECK ✓
- signup does NOT contain: setAuthCookies ✓

Acceptance grep checks (Task 2):
- verify-email contains: runtime='nodejs', VERIFICATION_CODE_REGEX, type:'EMAIL_VERIFY', setAuthCookies, setCsrfCookie, data:{ usedAt:..., emailVerifiedAt, TOO_MANY_VERIFY_ATTEMPTS ✓

Acceptance grep checks (Task 3):
- forgot-password contains: runtime='nodejs', dummyBcryptCompare, kind:'email.password_reset', type:'PASSWORD_RESET', TOO_MANY_FORGOT_ATTEMPTS ✓
- reset-password contains: runtime='nodejs', tokenVersion:{ increment:1 }, isBanned, PASSWORD_BANNED, data:{ usedAt:..., TOO_MANY_RESET_ATTEMPTS ✓
- reset-password does NOT contain: setAuthCookies ✓

---
*Phase: 01-auth-routes*
*Completed: 2026-05-07*
