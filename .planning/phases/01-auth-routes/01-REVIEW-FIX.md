---
phase: 01-auth-routes
fixed_at: 2026-05-07T23:22:00Z
review_path: .planning/phases/01-auth-routes/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-05-07T23:22:00Z
**Source review:** .planning/phases/01-auth-routes/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (1 Critical + 7 Warnings; Info skipped per fix_scope=critical_warning)
- Fixed: 8
- Skipped: 0

All in-scope findings were fixed. The full frontend test suite (140 tests across
22 files) passes after each fix.

## Fixed Issues

### CR-01: forgot-password timing parity is broken — leaks email existence under network observation

**Files modified:** `frontend/src/app/api/auth/forgot-password/route.ts`, `frontend/src/app/api/auth/forgot-password/route.test.ts`
**Commit:** 9d82636
**Applied fix:** Run `dummyBcryptCompare(email)` on BOTH branches (user-exists AND no-user) so bcrypt cost (~150-300ms at cost 12) is the dominant cost regardless of branch, dwarfing the user-exists path's `$transaction` (~20-80ms). Also added a wall-clock floor `TARGET_LATENCY_MS` (default 350ms, env-overridable via `AUTH_FORGOT_TARGET_LATENCY_MS`) to smooth out residual jitter. Test sets `AUTH_FORGOT_TARGET_LATENCY_MS=0` so the suite doesn't pad each call. Updated the route header to document the strategy.

### WR-01: reset-password runs HIBP / banned-list checks before rate-limit

**Files modified:** `frontend/src/app/api/auth/reset-password/route.ts`, `frontend/src/app/api/auth/reset-password/route.test.ts`
**Commit:** 5666213
**Applied fix:** Moved `limiter.check(req, email)` BEFORE the `isBanned` / length / `isPwned` gates so an unauthenticated attacker must spend per-email rate budget before learning any HIBP/banned state. Reordered tests to use unique emails per case (since the limiter now hits first, sharing `a@b.com` across 6+ tests would burn the 5/15m budget mid-suite).

### WR-02: change-password + reset-password do not call recordSuccess() on success

**Files modified:** `frontend/src/app/api/auth/change-password/route.ts`, `frontend/src/app/api/auth/reset-password/route.ts`
**Commit:** 84eefb8
**Applied fix:** Imported `recordSuccess` from `@/lib/server/auth/lockout` and called it on the email after a successful `prisma.user.update` (change-password) and after the reset `$transaction` (reset-password). This clears the failure counter so a user who was at 4/5 lockout doesn't get locked out by the first typo on the new password.

### WR-03: email-templates.ts embeds `code` into HTML without escaping

**Files modified:** `frontend/src/lib/server/auth/email-templates.ts`
**Commit:** b7f8a15
**Applied fix:** Added a private `htmlEscape()` helper covering the OWASP five-character set (`& < > " '`) and applied it to `args.code` in both `verificationEmail` and `resetPasswordEmail` HTML bodies. Updated the file header to document that ALL future template interpolations MUST flow through `htmlEscape()`. Plain-text body retains `args.code` unchanged (no HTML interpretation).

### WR-04: lockout in-memory fallback drops the threshold flag silently

**Files modified:** `frontend/src/lib/server/auth/lockout.ts`
**Commit:** b94b2e0
**Applied fix:** Added an optional `lockedUntil?: number` field to `MemEntry`. On the threshold-breach attempt (count >= limit), `recordFailure` now sets `lockedUntil = now + ttlMs`, mirroring the Redis path's separate `auth:lockout:<email>` key with independent TTL. `isLockedOut` checks `lockedUntil` first so the lockout horizon is honored even if the counter's `resetAt` expires mid-window.

### WR-05: signup and verify-email use findUnique then findFirst outside a transaction — TOCTOU window

**Files modified:** `frontend/src/app/api/auth/verify-email/route.ts`, `frontend/src/app/api/auth/verify-email/route.test.ts`, `frontend/src/app/api/auth/reset-password/route.ts`, `frontend/src/app/api/auth/reset-password/route.test.ts`
**Commit:** 3e45982
**Applied fix:** Replaced `tx.verificationCode.update({ where: { id }, ... })` with `tx.verificationCode.updateMany({ where: { id, usedAt: null }, ... })` inside the existing `$transaction` for both verify-email and reset-password. If `consumed.count === 0` (race lost), throw `VERIFICATION_CODE_RACE` and catch in the outer scope to surface `VERIFICATION_CODE_INVALID`. Added explicit race-path tests for both routes (mock `updateMany` returning `{ count: 0 }`).

Note on signup: REVIEW.md WR-05 references signup's `findUnique → $transaction` pattern, but signup uses `prisma.user.create` (which surfaces `P2002` on email uniqueness violation), not a verification code consume. The findUnique → create race is already protected by the unique constraint on `User.email`. So the fix only applies to verify-email and reset-password as described in the Fix section.

### WR-06: refresh route does not invalidate the prior refresh token

**Files modified:** `frontend/src/app/api/auth/refresh/route.ts`
**Commit:** 02fe511
**Applied fix:** Per the REVIEW.md Fix recommendation ("Recommend the comment-only fix unless threat model changed"), added an explicit header comment documenting the stateless-refresh tradeoff: old refresh tokens remain valid until JWT exp (7d), mitigated by 7-day TTL + tokenVersion bump on password change + HttpOnly/Secure/SameSite=Strict cookies. Stolen-refresh-token replay (within 7-day window, before password change) is OUT OF SCOPE for Phase 1.

### WR-07: forgot-password ignores rate limiter when redis is undefined — silent dev/prod divergence

**Files modified:** `frontend/src/lib/server/middleware/rate-limit-by-email.ts`
**Commit:** cac03e5
**Applied fix:** (1) Added a module-load `log.warn` in `createEmailLimiter` that fires when `deps.redis` is absent, including the bucket name and fail-closed flag state. (2) Added `AUTH_RATE_LIMIT_FAIL_CLOSED=1` env mode: when set AND redis is absent, `check()` returns a 503 `RATE_LIMIT_UNAVAILABLE` instead of using the per-instance memory fallback. This prevents accidental deploy of a binary without UPSTASH configured. Default is OFF (preserves current dev-friendly behavior).

---

_Fixed: 2026-05-07T23:22:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
