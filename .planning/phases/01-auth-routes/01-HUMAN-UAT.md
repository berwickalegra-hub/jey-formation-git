---
status: partial
phase: 01-auth-routes
source: [01-VERIFICATION.md, 01-REVIEW-FIX.md]
started: 2026-05-07T23:05:00Z
updated: 2026-05-07T23:25:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. CR-01 — forgot-password timing parity (D-23)
expected: No-user branch and user-exists branch take indistinguishable wall-clock time over 1000+ runs (within bcrypt jitter, ±~50ms).
result: resolved (code fix 9d82636 — dummy bcrypt now runs on BOTH branches + AUTH_FORGOT_TARGET_LATENCY_MS=350ms wall-clock floor)

### 2. WR-05 — verify-email + reset-password code single-use under concurrency (TOCTOU)
expected: Two simultaneous requests for the same valid VerificationCode result in exactly one cookie issuance / password reset; the second returns VERIFICATION_CODE_INVALID.
result: resolved (code fix 3e45982 — switched to updateMany(where: id + usedAt: null) + count===0 race-loss path; explicit race-path tests added)

### 3. End-to-end auth happy path against a running Next dev server
expected: signup → outbox event drained → verify-email → cookies set → me returns user → logout clears cookies → login again → refresh rotates → change-password succeeds and current browser stays logged in. Vitest mocks the full stack; no integration test runs the live HTTP path.
result: [pending]

### 4. Login lockout under real Redis with TTL clearing
expected: 5 wrong-password POSTs to /api/auth/login lock the account; subsequent attempt returns 423 LOCKED_OUT; lockout clears after AUTH_LOCKOUT_DURATION_MIN minutes. Unit tests use vi.mock for Redis; the real sliding-window-counter + lockout-flag interaction was not exercised end-to-end.
result: [pending]

### 5. Refresh single-flight under real concurrency
expected: Two simultaneous /api/auth/refresh calls with the same refresh cookie — exactly one returns 200 with new cookies, the other returns 409 CONFLICT. Critical for AUTH-04 production correctness.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0
resolved_by_code: 2

## Gaps
