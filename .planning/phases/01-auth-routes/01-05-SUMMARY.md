---
phase: 01-auth-routes
plan: 05
subsystem: env-docs / phase-gate
tags: [env-example, phase-gate, prettier, decision-traceability]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: .env.example shape (DATABASE_URL pooler + DIRECT_URL + CRON_SECRET + JWT_SECRET / ENCRYPTION_KEY / COOKIE_PREFIX baseline)
  - phase: 01-auth-routes
    plan: 01
    provides: 6 lib helpers reading env (AUTH_LOCKOUT_*, PASSWORD_HIBP_CHECK)
  - phase: 01-auth-routes
    plan: 02
    provides: signup/verify-email/forgot/reset routes reading AUTH_PASSWORD_MIN_LENGTH, AUTH_VERIFICATION_TTL_MIN, AUTH_*_RATE_LIMIT_MAX
  - phase: 01-auth-routes
    plan: 03
    provides: login/refresh/logout/me routes (AUTH_LOGIN_RATE_LIMIT_MAX, AUTH_LOCKOUT_*)
  - phase: 01-auth-routes
    plan: 04
    provides: change-password route (AUTH_PASSWORD_MIN_LENGTH, PASSWORD_HIBP_CHECK)
provides:
  - Documented .env.example for all 11 Phase-1 tunables
  - Phase 1 final gate (format + lint + typecheck + test) green-stamp
affects: Phase 6 DOC-01 (CLAUDE.md / README.md updates), Phase 5 email-queue cron (no env changes), every fork operator copying .env.example to .env

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decision-ID-traceable env documentation: every var carries inline reference to its CONTEXT.md decision (D-06, D-07, D-08, D-10, D-13) or REQ-ID (AUTH-10)"
    - "Section-header convention with box-drawing characters preserves visual separation from Phase 0 / payment / withdrawal blocks"
    - "Per-email rate-limit comment style with end-of-line annotation (e.g. `# 10 / 15 min per email`) gives fork operator the window without parsing the lib code"

key-files:
  created: []
  modified:
    - ".env.example (39 lines appended at end — Phase 1 — Auth tunables block)"
    - "30 frontend source files (whitespace-only prettier reformat — Rule 3 deviation)"

key-decisions:
  - ".env.example lives at repo root, NOT at frontend/.env.example. The plan referenced `frontend/.env.example` but this monolith project (post-template-fork) uses a single repo-root .env.example per Phase 0 (00-02-SUMMARY.md). Documented vars at the canonical location; this is doc-drift in the plan, not a structural change."
  - "Prettier reformat applied to 30 frontend source files alongside the env-doc change. Required to make `pnpm format:check` exit 0 for the Phase 1 final gate. Pure whitespace/line-wrapping (Prettier's printWidth collapsed multi-line imports/calls). Committed as a separate `chore(01-05)` commit so the env-doc commit stays semantically clean."
  - "AUTH_RESEND_VERIFY_RATE_LIMIT_MAX documented even though no resend-verify route exists in Phase 1. Plan-provided rationale: keeps .env.example complete for the future endpoint — operators see the placeholder value and rationale at fork time rather than discovering it later when the route ships."
  - "PASSWORD_HIBP_CHECK= (empty default) is the canonical 'opt-in' shape per D-13. Lib code (lib/server/auth/hibp.ts) treats unset OR empty-string as off; only literal '1' enables the check. Comment block in .env.example explicitly states 'Default OFF' so a fork operator does NOT need to read the lib to know."

patterns-established:
  - "Phase-N — <topic> tunables block in .env.example as a closing section after existing entries; preserves Phase 0 layout"
  - "Inline comment carries: (1) decision-ID, (2) what the var tunes in plain English, (3) backing implementation hint (e.g. 'Backed by Redis sliding-window counter (memory fallback in dev).'); fork operator never has to grep lib code"

requirements-completed: [AUTH-10]

# Metrics
duration: ~6min
completed: 2026-05-07
---

# Phase 1 Plan 05: .env.example Documentation + Final Phase Gate Summary

**Phase 1 closeout: 11 new auth env vars (`AUTH_*` + `PASSWORD_HIBP_CHECK`) appended to `.env.example` with decision-ID-traceable inline comments, and the full Phase 1 final gate (format + lint + typecheck + test) passes — 138/138 tests green across 22 test files, all 9 new auth route files exporting `runtime='nodejs'` per the Phase 0 guard. All 10 phase REQ-IDs (AUTH-01 through AUTH-10) are now covered across plans 01–05.**

## Performance

- **Duration:** ~6 min
- **Tasks:** 1 (`type=auto`)
- **Files created:** 1 (SUMMARY.md)
- **Files modified:** 31 (1 .env.example + 30 prettier reformats)
- **Test count:** 138 / 138 passing (no new tests added; this plan is doc-only)
- **Lint + typecheck:** clean (exit 0)
- **Format:** clean after one reformat pass

## Accomplishments

- 11 Phase-1 auth tunables documented in canonical `.env.example` location:
  - `AUTH_PASSWORD_MIN_LENGTH=10` (D-10, NIST 800-63B aligned)
  - `AUTH_VERIFICATION_TTL_MIN=15` (D-06, Crockford 8-char single-use codes)
  - `AUTH_LOCKOUT_THRESHOLD=5` + `AUTH_LOCKOUT_DURATION_MIN=15` (D-07, AUTH-10)
  - 6x per-email rate limits (D-08, AUTH-10): login (10/15min), signup (5/1h), forgot (3/1h), reset (5/15min), resend-verify (3/1h, reserved for future), verify (5/15min)
  - `PASSWORD_HIBP_CHECK=` (D-13, opt-in, k-anonymity, fail-open)
- Phase 1 final gate green-stamped:
  - `pnpm format:check` → exit 0 (clean, all matched files Prettier-styled)
  - `pnpm --filter frontend lint` → exit 0
  - `pnpm --filter frontend typecheck` → exit 0
  - `pnpm --filter frontend test` → 138/138 passed (22 test files)
  - `pnpm --filter frontend exec vitest run -t "runtime"` → 13/13 (Phase 0 guard sees all 9 new route files exporting `runtime='nodejs'`)
- All 10 phase REQ-IDs covered:
  - AUTH-01 → Plan 02 (signup)
  - AUTH-02 → Plan 03 (login)
  - AUTH-03 → Plan 02 (verify-email)
  - AUTH-04 → Plan 03 (refresh single-flight)
  - AUTH-05 → Plan 03 (logout)
  - AUTH-06 → Plan 03 (me)
  - AUTH-07 → Plan 02 (forgot-password)
  - AUTH-08 → Plan 02 (reset-password)
  - AUTH-09 → Plan 04 (change-password)
  - AUTH-10 → Plans 01, 03, 05 (lockout + per-email rate limit + env-doc layer)

## Task Commits

Each commit is atomic (parallel-execution mode, --no-verify):

1. **chore: prettier formatting pass** — `5559997` (30 frontend source files, whitespace-only Rule 3 deviation)
2. **docs: document Phase 1 auth env vars** — `d5555e7` (.env.example +39 lines, AUTH-10)

_Plan does not require a separate metadata commit — orchestrator owns STATE.md / ROADMAP.md / REQUIREMENTS.md writes after Wave 3 completion._

## Files Created/Modified

### Created

- `.planning/phases/01-auth-routes/01-05-SUMMARY.md` — this file.

### Modified

- `.env.example` — appended Phase 1 tunables block (39 lines, after existing `NEXT_PUBLIC_*` frontend section). Phase 0 entries (`DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET`, `JWT_SECRET`, `ENCRYPTION_KEY`, `COOKIE_PREFIX`, etc.) preserved unchanged.
- 30 frontend source files reformatted by Prettier (whitespace-only, no semantic changes):
  - 9 auth route handlers under `frontend/src/app/api/auth/{change-password,forgot-password,login,logout,me,refresh,reset-password,signup,verify-email}/route.ts`
  - 8 auth route test files under the same paths
  - 6 lib helpers under `frontend/src/lib/server/auth/{email-templates,hibp,lockout,refresh-lock}.{ts,test.ts}`
  - 4 observability files: `env-shape.test.ts`, `instrumentation-shape.test.ts`, `log.ts`, `request-context.ts`, `runtime-enforcement.test.ts`
  - `frontend/src/lib/server/middleware/index.ts`
  - `frontend/src/test-utils/mock-cookies.ts`

## Decisions Made

- **`.env.example` at repo root, not `frontend/.env.example`.** The plan's `<files_modified>` field referenced `frontend/.env.example`. There is no such file in this monolith fork — Phase 0 (00-02-SUMMARY.md) explicitly placed env documentation at the repo root, and the existing single-app pnpm workspace pattern (`packages: ['frontend']` in `pnpm-workspace.yaml`) means a single root `.env.example` is the canonical location. This is doc-drift in the plan; the structural intent ("document the 11 vars in the repo's `.env.example`") is honored at the only correct path.
- **Prettier reformat as Rule 3 unblock.** `pnpm format` is part of Step 3 of the plan's action sequence ("format: writes any pending Prettier reformatting (idempotent on subsequent runs)"). Running it first time on this worktree reformatted 30 files. Without the reformat, `pnpm format:check` would fail and the gate would not pass. Reformat is whitespace-only — verified via `git diff` on a sample file (signup/route.ts: only multi-line→single-line collapses).
- **AUTH_RESEND_VERIFY_RATE_LIMIT_MAX documented despite no current consumer.** Plan explicitly directs documenting it ("reserved for future endpoint; documented now to keep .env.example complete"). Future plans that ship a resend-verification endpoint will read this var; documenting upfront avoids `.env.example` drift later.
- **PASSWORD_HIBP_CHECK shipped as empty (`PASSWORD_HIBP_CHECK=`).** Matches the lib helper's contract (only literal `'1'` enables the check). Empty string and unset both evaluate as off. The empty literal in `.env.example` makes the var visible to fork operators — they see it exists, see it's empty, see the comment saying "Default OFF" — without needing to grep lib code to know the var name.
- **Verbatim plan text used.** The plan provided exact section header + comment text for the `.env.example` block. Fork operators read this verbatim, so I did not paraphrase — landed character-for-character per the plan's `<action>` step 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Plan path `frontend/.env.example` does not exist; canonical location is `.env.example` at repo root**
- **Found during:** Task 1 (initial Read of `frontend/.env.example`)
- **Issue:** Plan frontmatter lists `files_modified: [frontend/.env.example]` but no such file exists in this monolith fork. Phase 0 (00-02-SUMMARY.md) explicitly placed env documentation at repo root. The plan reference is doc-drift — frontend was the package name in the original `amadou-template` monorepo, but this monolith fork uses a single root .env.example.
- **Fix:** Documented the 11 env vars in `.env.example` at repo root, the only correct location. All acceptance grep checks (e.g. "frontend/.env.example contains 'AUTH_PASSWORD_MIN_LENGTH=10'") satisfied at the actual path.
- **Files modified:** `.env.example` (appended 39 lines)
- **Verification:** All 14 acceptance grep tokens present (11 new + DATABASE_URL + DIRECT_URL + JWT_SECRET preserved).
- **Committed in:** `d5555e7`
- **Notes:** Phase 6 DOC-01 (rewrite CLAUDE.md / README.md) should also note the single-root .env.example pattern so future plans don't repeat the doc-drift.

**2. [Rule 3 — Blocking] Worktree had no node_modules**
- **Found during:** Task 1 step 3 (first format-check attempt)
- **Issue:** `pnpm --filter frontend exec prettier --check .` failed with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL: Command "prettier" not found`. Fresh worktree wasn't initialized.
- **Fix:** `pnpm install` from worktree root (5.3s, 478 packages added; postinstall ran prisma generate cleanly).
- **Files modified:** none directly; pnpm-lock unchanged.
- **Verification:** prettier, eslint, vitest, tsc all available after install.

**3. [Rule 3 — Blocking] 30 frontend source files needed Prettier reformat to pass `pnpm format:check`**
- **Found during:** Task 1 step 3 (first `pnpm format` run)
- **Issue:** Earlier Phase 1 plans were committed without a final repo-wide `pnpm format` pass. `pnpm format:check` (the verifier-level gate) would have failed on 30 files: multi-line imports/calls that Prettier collapses to single line under printWidth.
- **Fix:** Ran `pnpm format` (root, which runs `prettier --write .`). All 30 files reformatted to whitespace-canonical shape. Pure cosmetic — no semantic changes. Verified by reading the diff on signup/route.ts: only multi-line→single-line collapses.
- **Files modified:** 30 frontend source files (full list above).
- **Verification:** `pnpm format:check` exits 0 after the pass; 138/138 tests still green; lint + typecheck still clean.
- **Committed in:** `5559997` (separate `chore` commit from the env-doc commit so each is semantically clean)
- **Notes on do-not-modify:** None of the touched files are in CLAUDE.md's do-not-modify list. The reformatted files include 6 lib helpers under `lib/server/auth/` — these are Wave 0 sibling-dir helpers (not the do-not-modify `lib/server/auth.ts`) and the change is whitespace-only.

---

**Total deviations:** 3 auto-fixed (all Rule 3 — blocking). Mechanical unblocks only — no scope expansion, no architectural changes, no business-logic changes.
**Impact on plan:** None on Phase 1 outcomes. Plan acceptance criteria all satisfied at the canonical location.

## Threat Flags

None. The .env.example documentation introduces no new security-relevant surface — Phase 0 already pinned the .env.example-committed-but-no-secrets pattern (T-1-04 disposition: accept). All Phase 1 vars documented are tunables, not secrets. T-1-08 (misconfiguration) explicitly mitigated: every var has a documented default + decision-ID rationale, and `PASSWORD_HIBP_CHECK` defaults OFF so no surprise external API calls on fresh forks.

## Authentication Gates Encountered

None — plan landed without external authentication or service-credentialed steps.

## Issues Encountered

- Initial confusion over `frontend/.env.example` vs `.env.example` resolved by reading Phase 0 SUMMARY (00-02). The monolith pattern is single-root .env.example.
- Prettier diff stat (e.g. `5 files changed, 10 insertions, 20 deletions` for login + signup) confirmed cosmetic-only; no business-logic risk.
- One config.json change crept in via `pnpm format` (added trailing newline). Reverted immediately to keep state-related files in the orchestrator's hands.

## User Setup Required

None. Fork operators copy `.env.example` to `.env`, fill secret values per existing comments, and the new Phase 1 tunables ship with safe defaults (no action required to start a fork).

## Phase 1 Closing Notes

### What landed across all 5 Phase 1 plans:

- **9 auth routes** under `frontend/src/app/api/auth/**/route.ts`:
  signup, verify-email, login, refresh, logout, me, forgot-password, reset-password, change-password
- **6 lib helpers** under `frontend/src/lib/server/auth/`:
  banned-passwords (~95 entries), hibp (k-anonymity), lockout (Redis sliding-window), refresh-lock (single-flight Lua), dummy-bcrypt (cost-12 timing parity), email-templates (verification + reset factories)
- **OutboxEvent union extended:** `email.verification_code` + `email.password_reset` variants (consumed by Phase 5 email-queue cron)
- **Vitest infra:** setup file with JWT_SECRET fixture, `prismaMock` factory, opt-in `mockNextCookies` factory, inline `vi.mock('next/headers', ...)` pattern documented for Wave 1 sibling tests
- **vitest-mock-extended@^2.0.2** added as devDep (peer-pinned to vitest 2.x)
- **138 tests** across 22 test files (was 31 at Phase 0 close)
- **All 9 new route files** export `runtime='nodejs'` (Phase 0 guard green)

### Open items for downstream phases:

- **Phase 5 outbox dispatcher** must drain the 2 new `email.*` event variants — already wired in `outbox/dispatcher.ts` switch (Plan 01 deviation #2); Phase 5 just needs the email-queue cron to call `enqueueOutbox(tx, event)` from its drain loop.
- **Phase 6 DOC-01** should:
  - Update CLAUDE.md to reference `lib/server/auth/` subdirectory pattern (sibling to do-not-modify `auth.ts`).
  - Note the single-root `.env.example` pattern (doc-drift fix from this plan's Rule 3 #1).

### Patterns established for downstream:

- **`lib/server/<feature>/<helper>.ts` sibling-dir pattern** when a namesake `.ts` is in the do-not-modify list.
- **Pre-session route CSRF carve-out:** signup / verify-email / login / refresh / forgot-password / reset-password skip `verifyCsrf`; logout / change-password require it. Each carve-out documented inline at the route's top.
- **Atomic mutation + tokenVersion bump + cookie re-issue** pattern (used by change-password to keep current browser logged in while invalidating other sessions). Reset-password uses the bump-without-re-issue variant.
- **Module-level `vi.mock('next/headers', ...)` inline pattern** with `__cookieStore: Map` for cookie-asserting route tests (preferred over the `mockNextCookies()` factory which doesn't auto-hoist).
- **Decision-ID traceability in env docs:** every `.env.example` entry references its CONTEXT.md decision (D-NN) or REQ-ID so a fork operator never has to grep the lib code to understand a var's purpose.

## Self-Check: PASSED

Verified files and commits exist on disk:

- FOUND: .env.example (modified — 14/14 acceptance grep tokens present)
  - 11 new tokens: AUTH_PASSWORD_MIN_LENGTH=10, AUTH_VERIFICATION_TTL_MIN=15, AUTH_LOCKOUT_THRESHOLD=5, AUTH_LOCKOUT_DURATION_MIN=15, AUTH_LOGIN_RATE_LIMIT_MAX=10, AUTH_SIGNUP_RATE_LIMIT_MAX=5, AUTH_FORGOT_RATE_LIMIT_MAX=3, AUTH_RESET_RATE_LIMIT_MAX=5, AUTH_RESEND_VERIFY_RATE_LIMIT_MAX=3, AUTH_VERIFY_RATE_LIMIT_MAX=5, PASSWORD_HIBP_CHECK=
  - 3 preserved Phase 0 tokens: DATABASE_URL, DIRECT_URL, JWT_SECRET
- FOUND commit: 5559997 (chore — prettier formatting pass, 30 files)
- FOUND commit: d5555e7 (docs — env vars documented, .env.example +39 lines)

Test, typecheck, lint, format:
- `pnpm format:check` → exit 0 (all matched files Prettier-styled)
- `pnpm --filter frontend lint` → exit 0
- `pnpm --filter frontend typecheck` → exit 0
- `pnpm --filter frontend test` → 138/138 passed (22 test files)
- `pnpm --filter frontend exec vitest run -t "runtime"` → exit 0 (13 runtime-enforcement tests green; sees all 9 new auth route files)

Requirements coverage:
- AUTH-01..AUTH-10 all present in at least one plan's `requirements:` frontmatter (verified via `grep -H "^requirements:" .planning/phases/01-auth-routes/01-0*-PLAN.md`).

---
*Phase: 01-auth-routes*
*Plan: 05*
*Completed: 2026-05-07*
