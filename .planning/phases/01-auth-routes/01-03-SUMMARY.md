---
phase: 01-auth-routes
plan: 03
subsystem: auth
tags: [next-app-router, jwt, bcrypt, csrf, cookies, lockout, single-flight, runtime-nodejs]

# Dependency graph
requires:
  - phase: 00-foundation
    provides: makeRequestContext + withRequestContext + log; runtime='nodejs' enforcement; vitest config; rate-limit fixed-window helper
  - phase: 01-auth-routes (Wave 0)
    provides: lockout.ts (recordFailure/recordSuccess/isLocked), refresh-lock.ts (single-flight), dummy-bcrypt.ts (timing equalization), test-utils/prisma-mock.ts, test-utils/mock-cookies.ts, vitest.setup.ts JWT_SECRET fixture
provides:
  - POST /api/auth/login (AUTH-02) — email/password authentication, sets 3 cookies, lockout on AUTH-10 threshold
  - POST /api/auth/refresh (AUTH-04) — single-flight refresh token rotation
  - POST /api/auth/logout (AUTH-05) — clears session cookies
  - GET /api/auth/me (AUTH-06) — returns current authenticated user
affects: Wave 2 sibling plans share JWT_SECRET fixture pattern; Phase 2 (OAuth) consumes login cookie semantics; Phase 3 (orders) requires GET /me for session probe

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Login bcrypt path uses dummy-bcrypt on no-user branch to equalize timing (enumeration resistance)"
    - "Refresh single-flight via Redis SETEX lock (refresh-lock.ts) — prevents concurrent refresh storms"
    - "Lockout: increment on each failed login; AUTH-10 threshold returns 429 ACCOUNT_LOCKED; reset on successful login"
    - "All session routes set runtime='nodejs' (bcrypt cannot run on Edge)"

key-files:
  created:
    - "frontend/src/app/api/auth/login/route.ts"
    - "frontend/src/app/api/auth/login/route.test.ts"
    - "frontend/src/app/api/auth/refresh/route.ts"
    - "frontend/src/app/api/auth/refresh/route.test.ts"
    - "frontend/src/app/api/auth/logout/route.ts"
    - "frontend/src/app/api/auth/logout/route.test.ts"
    - "frontend/src/app/api/auth/me/route.ts"
    - "frontend/src/app/api/auth/me/route.test.ts"
  modified:
    - "frontend/vitest.setup.ts"

requirements:
  - AUTH-02
  - AUTH-04
  - AUTH-05
  - AUTH-06
  - AUTH-10

verification:
  tests: "22/22 plan tests pass; 119/119 full frontend suite at end of agent run"
  typecheck: pass
  lint: pass

commits:
  - "409118d feat(01-03): port login route + tests (AUTH-02 + AUTH-10 lockout)"
  - "b478770 feat(01-03): port refresh route + tests (AUTH-04 single-flight)"
  - "4e5e536 feat(01-03): port logout + me routes + tests (AUTH-05, AUTH-06)"
---

# Plan 01-03: Session-lifecycle route handlers

## What was built

The 4 session-lifecycle Next.js Route Handlers:

- **POST /api/auth/login** (AUTH-02 + AUTH-10): bcrypt-compares password (or dummy-bcrypts on no-user to equalize timing), increments lockout counter on failure, returns 429 ACCOUNT_LOCKED when threshold hit, sets 3 cookies (access JWT 15min, refresh JWT 7d scoped to /api/auth, CSRF 7d) on success.
- **POST /api/auth/refresh** (AUTH-04): Redis-backed single-flight lock prevents concurrent refresh storms; rotates the refresh JWT and reissues access + CSRF cookies.
- **POST /api/auth/logout** (AUTH-05): clears all 3 cookies (access, refresh, CSRF) by setting expired Max-Age=0.
- **GET /api/auth/me** (AUTH-06): reads access JWT from cookie via `requireAuth`, returns the user identity payload.

All four routes set `runtime='nodejs'` because bcrypt cannot run on Edge.

## Verification

- `pnpm --filter frontend test` — 22 plan tests + 97 prior tests = 119/119 green
- `pnpm --filter frontend typecheck` — exit 0
- `pnpm --filter frontend lint` — exit 0

## Notes

SUMMARY.md was not committed inside the worktree by the executor agent (left for the orchestrator per the parallel-execution contract). Reconstructed from the agent's completion report after worktree teardown.
