---
status: partial
phase: 02-oauth-notifications-withdrawal-pin
source: [02-VERIFICATION.md]
started: 2026-05-08T02:36:00Z
updated: 2026-05-08T02:36:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Google OAuth full round-trip with real credentials
expected: GET /api/auth/oauth/google/start 302s to accounts.google.com; after consent, callback issues 3 cookies (`app-token`, `app-refresh`, `app-csrf`) and lands at APP_URL
result: [pending]

### 2. GOOGLE_EMAIL_NOT_VERIFIED branch with unverified-email Google account
expected: Callback redirects to /auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED; no User row created
result: [pending]

### 3. D-01 silent linking — email/password user signs in with same Gmail via Google
expected: DB shows ONE User row, ONE OAuthAccount row, original passwordHash preserved, name/avatarUrl untouched
result: [pending]

### 4. Welcome notification dedup on browser back-button OAuth callback replay
expected: First OAuth signup creates one Notification row with type='WELCOME' and dedupeKey='welcome:<userId>'; back-button replay creates no second row (P2002 dedup)
result: [pending]

### 5. PIN lockout threshold breach after 5 wrong attempts within 15 min
expected: 5th wrong currentPin → recordFailure returns { locked: true } → 423 LOCKED_OUT; subsequent calls within window return 423 immediately
result: [pending]

### 6. PIN timing-equalisation visible to attacker
expected: Wrong-shape (missing currentPin) and wrong-PIN both take ~250ms ± noise; SET path with no body fails fast
result: [pending]

### 7. Cursor pagination correctness across populated DB with 25+ notifications
expected: First page returns 10 items + nextCursor; second page returns next 10 items with strictly older createdAt or smaller id
result: [pending]

### 8. OAuth ?next= param round-trip with same-origin path like /dashboard
expected: /start sets app-oauth-next cookie containing https://APP_URL/dashboard; after Google consent, callback redirects to /dashboard (not APP_URL root)
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
