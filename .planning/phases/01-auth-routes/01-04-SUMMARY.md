---
phase: 01-auth-routes
plan: 04
subsystem: auth
tags: [next-app-router, csrf, jwt, bcrypt, zod, hibp, banned-passwords, token-version, session-invalidation]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: makeRequestContext + withRequestContext + log; runtime='nodejs' enforcement; vitest config (passWithNoTests + server-only alias)
  - phase: 01-auth-routes (Wave 0)
    provides: lib/server/auth/banned-passwords.ts (isBanned), lib/server/auth/hibp.ts (isPwned), vitest.setup.ts with JWT_SECRET fixture, test-utils/prisma-mock.ts (DeepMockProxy<PrismaClient>)
provides:
  - PUT /api/auth/change-password route handler (AUTH-09)
  - Reusable inline next/headers cookies() mock pattern for sibling Wave 1 plans
affects: 01-02 signup (shared password policy ordering), 01-03 login (shared cookie semantics), 01-05 reset-password (shared verifyPassword + hashPassword path), Phase 2 (forward-compatibility — relies on tokenVersion bump for OAuth account-linking session invalidation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level inline `vi.mock('next/headers', ...)` with a Map-backed mock store — replaces the mockNextCookies() factory pattern when the test needs auto-hoisting (Pitfall 11)"
    - "`requireAuth` cookie-path testing: seed mock cookieStore directly (not via NextRequest cookie header) — the route reads from next/headers cookies(), not req.cookies"
    - "verifyCsrf cookie path testing: stays on the request `cookie` HTTP header — that's NextRequest.cookies territory"
    - "Single Prisma user.update is atomic for password+tokenVersion bump — no $transaction wrapper needed for a one-row write"
    - "Pitfall 9 fresh-cookie issuance pattern: createAccessToken + createRefreshToken + setAuthCookies + setCsrfCookie with the BUMPED tokenVersion immediately after the user.update"

key-files:
  created:
    - "frontend/src/app/api/auth/change-password/route.ts"
    - "frontend/src/app/api/auth/change-password/route.test.ts"
  modified:
    - "frontend/vitest.setup.ts"

key-decisions:
  - "JWT_SECRET fixture in vitest.setup.ts updated: previous literal 'test-secret-must-be-at-least-32-chars-long-for-zod-validation' starts with 'test' which auth.ts:21 rejects as a placeholder. New literal still ≥32 chars but doesn't match the /^(change-me|secret|password|test|dev|todo|placeholder)/i guard."
  - "Inlined the next/headers cookie mock at module level rather than calling mockNextCookies(). vi.mock auto-hoisting only fires when the call is at module scope (Pitfall 11); the factory wraps it inside a function body, breaking hoist. Future Wave 1 plans should follow the same inline pattern OR mock-cookies.ts can be refactored to be self-installing as a side-effect import — leaving that decision to those plans."
  - "Order of operations: CSRF → requireAuth → Zod → password-policy → DB lookup → verifyPassword → hashPassword → atomic user.update → fresh cookies. Putting password-policy gates BEFORE the DB read means weak-password probing can't be used as a timing oracle for user existence."
  - "Single user.update (no $transaction wrapper) is atomic by Postgres semantics for a one-row write touching two columns — confirmed by plan's <verification> note. Tx wrapper would add overhead without changing semantics."
  - "OAuth-only users (passwordHash=null) returned INVALID_CREDENTIALS rather than a distinct error — avoids leaking OAuth-only state to attackers; future PATCH /me or OAuth-link route can offer a 'set initial password' flow if needed."

patterns-established:
  - "Module-level vi.mock('next/headers', ...) inline pattern with __cookieStore Map for assertions"
  - "seedAccessCookie() helper: synchronous, sets COOKIE_NAME directly on the mock store; tests that want '401 missing access cookie' just don't call it"
  - "JWT-secret-fixture rule: any value containing 'test|secret|password|change-me|todo|dev|placeholder' as a leading word triggers auth.ts:21 — Wave 1 tests must avoid those prefixes"

requirements-completed: [AUTH-09]

# Metrics
duration: ~7min
completed: 2026-05-07
---

# Phase 1 Plan 04: Change-Password Route Summary

**PUT /api/auth/change-password — the only authenticated mutation in Phase 1. CSRF + requireAuth gated; current-password verified via bcrypt; password policy (length/banned/opt-in HIBP) enforced BEFORE the DB read; passwordHash + tokenVersion updated atomically in a single Prisma write; NEW access + refresh + csrf cookies issued with the bumped tokenVersion so the current browser stays logged in while OTHER sessions fail on their next requireAuth call (Pitfall 9 mitigation).**

## Performance

- **Duration:** ~7 min (single TDD cycle: RED → GREEN; no REFACTOR needed)
- **Tasks:** 1 (`type=auto tdd=true`)
- **Files created:** 2 (route + test)
- **Files modified:** 1 (vitest.setup.ts JWT_SECRET fixture)
- **Test count:** 71 → 81 (10 new tests; +9 from this plan, +1 baseline test from a different counter)
- **Lint + typecheck:** clean (exit 0)

## Accomplishments

- AUTH-09 route landed end-to-end. The 9 acceptance criteria from the plan's `<verification>` block are all satisfied:
  - `runtime = 'nodejs'` exported (CI guard from Phase 0 auto-validates)
  - `export async function PUT` (matches ROADMAP success criterion 5)
  - `verifyCsrf(req)` is the FIRST gate
  - `requireAuth(...)` is the SECOND gate (auth identity needed before parsing the body)
  - `verifyPassword(...)` against the loaded passwordHash
  - `tokenVersion: { increment: 1 }` in the same `user.update` write
  - `setAuthCookies(...)` + `setCsrfCookie()` AFTER the bump (Pitfall 9)
  - `isBanned(...)` + `PASSWORD_BANNED` stable error code
  - `PASSWORD_HIBP_CHECK` env-gated `isPwned(...)` call
  - `INVALID_CREDENTIALS` returned on both wrong currentPassword AND missing passwordHash (OAuth-only users)
- Threat-register mitigations all in place per plan `<threat_model>`:
  - **T-1-02 CSRF (Tampering)** — verifyCsrf MANDATORY; 403 on missing header AND on header≠cookie
  - **T-1-02 EoP (session takeover)** — `tokenVersion: { increment: 1 }` invalidates ALL other sessions; same DB write as the password update
  - **T-1-02 (current-password bypass)** — verifyPassword BEFORE update; bcrypt cost 12 (inherited from `auth.ts:137`)
  - **T-1-02 (weak password)** — length/banned/HIBP gates BEFORE prisma.user.findUnique; weak-password probing can't time-attack user existence
  - **T-1-02 (Pitfall 9 self-logout)** — fresh cookies issued with bumped tokenVersion; current browser stays logged in
  - **T-1-04 (info disclosure in logs)** — log.info logs userId only; no password/email plaintext
  - **T-1-05 (repudiation)** — requestId injected via Phase 0 ALS + x-request-id response header on every response (success AND error)
  - **T-1-08 (env misconfiguration)** — defaults baked: AUTH_PASSWORD_MIN_LENGTH defaults to 10; PASSWORD_HIBP_CHECK defaults off
- Test pattern bootstrapped for Wave 1 sibling plans. The inline `vi.mock('next/headers', ...)` shape + `seedAccessCookie()` helper + `__cookieStore` Map are reusable verbatim for `me`, `login`, `verify-email`, etc. once those routes consume `requireAuth`.

## Task Commits

Each commit was atomic (parallel-execution mode, --no-verify):

1. **RED** `23f7b78` — `test(01-04): add failing test for change-password route (AUTH-09)` (+ vitest.setup.ts JWT_SECRET fix)
2. **GREEN** `49fbc07` — `feat(01-04): implement change-password route (AUTH-09)` + finalized test wiring (NextRequest constructor, inline cookie mock)

_Plan does not require a separate metadata commit — orchestrator owns STATE.md / ROADMAP.md writes after wave completion._

## Files Created/Modified

### Created

- `frontend/src/app/api/auth/change-password/route.ts` (170 LOC) — PUT handler. First line is `runtime='nodejs'`; whole handler body wrapped in `withRequestContext(ctx, async () => { ... })`. Stable error codes: `VALIDATION_FAILED`, `PASSWORD_TOO_SHORT`, `PASSWORD_BANNED`, `PASSWORD_PWNED`, `INVALID_CREDENTIALS`. Helper `jsonError(code, status, requestId, message?)` keeps every error path consistent (sets `x-request-id` header).
- `frontend/src/app/api/auth/change-password/route.test.ts` (~300 LOC) — 9 cases. Mocks `@/lib/server/auth/banned-passwords` + `@/lib/server/auth/hibp` at module level via `vi.mock`. Inlines `vi.mock('next/headers', ...)` with a Map-backed store (`__cookieStore`). Uses `prismaMock` from the shared test-util.

### Modified

- `frontend/vitest.setup.ts` — JWT_SECRET fixture string updated. Previous literal `'test-secret-must-be-at-least-32-chars-long-for-zod-validation'` starts with `test` which auth.ts:21 rejects as a placeholder. New literal `'fixture-jwt-vitest-2026-must-be-32-chars-or-more-xx'` is ≥32 chars and doesn't match the guard. This unblocks any test file (this plan + future Wave 1 tests) that imports `@/lib/server/auth` at module level.

## Decisions Made

- **Inline `vi.mock('next/headers', ...)` instead of calling `mockNextCookies()`.** The Wave 0 SUMMARY noted the factory was opt-in per Pattern 20. In practice, `vi.mock` auto-hoisting only fires when the call sits at module scope; wrapping it inside a function body (as `mockNextCookies()` does) breaks the hoist and the mock doesn't take effect before the route imports `next/headers` transitively. Inlining at module level is the only reliable way. Future Wave 1 plans should either (a) follow the same inline shape or (b) refactor `mock-cookies.ts` to be a self-installing side-effect import — leaving that call to whoever picks up the next plan.
- **Sync `seedAccessCookie(token)`.** The mock store's `set` is synchronous; no `await` needed. The plan example showed an `async` shape but synchronous is cleaner and avoids the `await Promise<void>` ceremony.
- **NextRequest, not Request, in test helper.** The plain `Request` class doesn't expose `.cookies` (that's a NextRequest enrichment for `verifyCsrf`'s `req.cookies.get(...)`). Discovered the hard way (Test 1 failed with `Cannot read properties of undefined (reading 'get')`).
- **Fixed `vitest.setup.ts` placeholder regex collision.** auth.ts:21 has `/^(change[-_ ]?me|secret|password|test|dev|todo|placeholder)/i.test(rawSecret)` — the previous fixture started with "test" so any test file that touches auth.ts at module load would throw `JWT_SECRET looks like a default placeholder`. New literal still meets the ≥32 char rule but doesn't match the guard.
- **Single `prisma.user.update` write (no `$transaction` wrapper).** A one-row UPDATE is atomic in Postgres even without an explicit tx — `passwordHash` and `tokenVersion` change in the same statement and become visible together. Plan's `<verification>` confirms this. Wrapping in `prisma.$transaction([...])` would add round-trip overhead with no semantic gain.
- **OAuth-only users (passwordHash=null) → INVALID_CREDENTIALS.** Same error code as wrong-password rather than `OAUTH_ONLY_NO_PASSWORD` or similar. Reasoning: revealing OAuth-only state would help an attacker target the OAuth provider; the user can still recover via the OAuth provider's password reset path.
- **`force-dynamic` export added.** This route returns user-specific cookies and reads request cookies — it's inherently dynamic. Without the export, Next.js may try to statically optimize and surprise with stale behavior. Mirrors `health/route.ts` pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Worktree had no `node_modules`**
- **Found during:** Task 1 RED phase (initial test run)
- **Issue:** `pnpm --filter frontend exec vitest` failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "vitest" not found`. Fresh worktree wasn't initialized.
- **Fix:** `pnpm install` from worktree root. Postinstall hook auto-ran `prisma generate`. 671 packages reused from store, 5.3s wall-clock.
- **Files modified:** none (lockfile unchanged)
- **Verification:** baseline test suite (excluding the in-progress new file) ran and reported 13 passing files / 71 tests, matching Wave 0 SUMMARY's claim.

**2. [Rule 3 — Blocking] vitest.setup.ts JWT_SECRET fixture rejected by auth.ts placeholder guard**
- **Found during:** Task 1 RED phase (after install)
- **Issue:** The fixture string from Wave 0 (`'test-secret-must-be-at-least-32-chars-long-for-zod-validation'`) starts with "test". `auth.ts:21` runs `/^(change[-_ ]?me|secret|password|test|dev|todo|placeholder)/i.test(rawSecret)` and throws `JWT_SECRET looks like a default placeholder` at module load. Existing Wave 0 tests don't import `@/lib/server/auth` directly (only the lib helpers in lib/server/auth/*), so the bug never surfaced; this plan's test file imports auth.ts (for `createAccessToken`, `hashPassword`, `COOKIE_NAME`, …), surfacing the latent issue.
- **Fix:** Replaced the literal in `vitest.setup.ts` with `'fixture-jwt-vitest-2026-must-be-32-chars-or-more-xx'`. Still ≥32 chars; doesn't match the placeholder regex. Comment added explaining the constraint so future updates don't regress.
- **Files modified:** `frontend/vitest.setup.ts`
- **Verification:** baseline test suite (71 → 81 tests including new file) all green; `auth.ts` module-level import doesn't throw.
- **Committed in:** `23f7b78` (RED commit, alongside the failing test)

**3. [Rule 1 — Bug] mockNextCookies() factory doesn't hoist vi.mock — `next/headers` returns the real module**
- **Found during:** Task 1 GREEN phase (first GREEN run after route.ts was implemented)
- **Issue:** Wave 0 shipped `frontend/src/test-utils/mock-cookies.ts` exporting `mockNextCookies()` which calls `vi.mock('next/headers', ...)` from inside its function body. Vitest auto-hoists `vi.mock` ONLY when it's a top-level statement; calling it inside a function leaves the mock un-hoisted and the route's transitive import of `next/headers` resolves to the REAL module. Tests then fail with `cookies was called outside a request scope` from Next.js internals.
- **Fix:** Inlined `vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(mockStore) }))` at module level in the test file. Local `__cookieStore: Map<string, MockEntry>` provides the assertion surface (the same shape Wave 0 exposed but local to the file).
- **Why not modify mock-cookies.ts:** Not in the do-not-modify list per CLAUDE.md, but Wave 0 already shipped + committed it; modifying it after the fact is in scope of a Wave 1 plan only if the bug blocks multiple plans. This plan only blocks one (its own); siblings will land at the same time and can pick the same inline pattern. If the count of tests using cookies grows enough, a Wave 1 plan can refactor mock-cookies.ts to be a self-installing side-effect import (`import '@/test-utils/mock-cookies'` triggers the mock).
- **Files modified:** `frontend/src/app/api/auth/change-password/route.test.ts` (inline mock added)
- **Verification:** all 9 tests passed after the inline mock landed.
- **Committed in:** `49fbc07` (GREEN commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 1 bug — all addressed without scope expansion)
**Impact on plan:** Mechanical unblocks only. AUTH-09 ships exactly as specified. The mock-cookies.ts API contract issue is documented for sibling plans; no required modification beyond inline-pattern adoption.

## Threat Flags

None. All security-relevant surface introduced by this route is enumerated in the plan's `<threat_model>` (T-1-02 in five forms, T-1-04, T-1-05, T-1-08).

## Issues Encountered

- Several iterations needed to settle the cookie-mock pattern. First attempt cast a plain `Request` to `NextRequest` — broke `verifyCsrf`'s `req.cookies.get(...)` (NextRequest enrichment). Switched to `new NextRequest(...)`. Second issue: `mockNextCookies()` factory didn't hoist vi.mock — fixed by inlining. Lesson logged to SUMMARY's "Patterns Established" so Wave 1 siblings don't re-walk this path.
- `prismaMock.user.findUnique.mockResolvedValue` typed strictly — needed `as unknown as never` cast because `vitest-mock-extended@2.0.2`'s `DeepMockProxy` types are narrower than the helper signatures. Single ts-expect-error-equivalent suppression at the test boundary; route code stays cast-free.

## User Setup Required

None. The route handler runs with the existing env surface. New env vars surfaced (only `AUTH_PASSWORD_MIN_LENGTH` and `PASSWORD_HIBP_CHECK`) both have safe defaults; `.env.example` updates land in Phase 1 Plan 05 per the plan's `<threat_model>` T-1-08 mitigation note.

## Next Phase Readiness

- **Wave 2 sibling plans** can adopt the inline `vi.mock('next/headers', ...)` + `seedAccessCookie()` pattern verbatim — pattern documented in `patterns-established` above.
- **`me` route (different Wave 1 plan)** consumes the same `requireAuth` path; its tests can use the same cookie-seeding helper.
- **`refresh` / `logout` routes** consume different cookies (refresh + csrf clear) but the same Map-backed mock store works.
- **Phase 2 (OAuth account-link)** can rely on `change-password` to invalidate existing sessions before linking a new provider — the `tokenVersion` bump is the canonical "kick all sessions" primitive now wired.

## Self-Check: PASSED

Verified files and commits exist on disk:

- FOUND: frontend/src/app/api/auth/change-password/route.ts
- FOUND: frontend/src/app/api/auth/change-password/route.test.ts
- FOUND: frontend/vitest.setup.ts (modified)
- FOUND commit: 23f7b78 (RED — test + setup fixture fix)
- FOUND commit: 49fbc07 (GREEN — route implementation + test refinement)

Test, typecheck, lint:
- `pnpm --filter frontend test` → 81/81 passing (was 71)
- `pnpm --filter frontend typecheck` → exit 0
- `pnpm --filter frontend lint` → exit 0

---
*Phase: 01-auth-routes*
*Plan: 04*
*Completed: 2026-05-07*
