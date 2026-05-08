---
phase: 02-oauth-notifications-withdrawal-pin
verified: 2026-05-08T00:00:00Z
status: human_needed
score: 32/32 must-haves verified
overrides_applied: 0
plans_verified:
  - plan: 00 (Wave 0 helpers)
    score: 6/6
    requirements_addressed: [OAUTH-03, NOTIF-01, NOTIF-04, PIN-01]
  - plan: 01 (Google OAuth routes)
    score: 10/10
    requirements_addressed: [OAUTH-01, OAUTH-02, OAUTH-03, NOTIF-05]
  - plan: 02 (Notifications endpoints)
    score: 9/9
    requirements_addressed: [NOTIF-01, NOTIF-02, NOTIF-03, NOTIF-04]
  - plan: 03 (Withdrawal PIN)
    score: 9/9
    requirements_addressed: [PIN-01]
roadmap_success_criteria:
  - id: SC-1
    text: "GET /api/auth/oauth/google/start issues state + PKCE-verifier cookies path-scoped to /api/auth/oauth and 302 to Google's authorization URL"
    status: verified
    evidence: "frontend/src/app/api/auth/oauth/google/start/route.ts:49-71 — generateState/generateCodeVerifier; cookies set with path '/api/auth/oauth' maxAge=300; NextResponse.redirect(url, 302)"
  - id: SC-2
    text: "Google OAuth callback issues 3 auth cookies on success; rejects email_verified:false with redirect to /auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED"
    status: verified
    evidence: "callback/route.ts:110-114 (email_verified gate) + 188-189 (setAuthCookies + setCsrfCookie) — but real-world Google round-trip requires human smoke test"
  - id: SC-3
    text: "Authenticated user can call GET /api/notifications, PATCH /api/notifications, GET /api/notifications/count, GET /api/notifications/prefs — all return correct shapes; createNotification(...) result appears in list"
    status: verified
    evidence: "Routes ship with runtime='nodejs', requireAuth gate, scoped userId queries; createNotification is the canonical entrypoint (NOTIF-05 grep=0)"
  - id: SC-4
    text: "POST /api/auth/withdrawal-pin sets hashed PIN; DELETE removes; POST again (change) succeeds; all three require auth + CSRF"
    status: verified
    evidence: "withdrawal-pin/route.ts: POST + DELETE both gate on verifyCsrf+requireAuth; SET path hashes via hashPin; CHANGE path verifyPin → recordSuccess + new hash; DELETE clears to null"
requirements_traceability:
  - id: OAUTH-01
    description: "User can click Sign in with Google → server issues state + PKCE-verifier cookies (5 min, path-scoped to /api/auth/oauth) and 302s to Google"
    status: satisfied
    evidence: "frontend/src/app/api/auth/oauth/google/start/route.ts:33-72"
  - id: OAUTH-02
    description: "Callback validates state, exchanges code, decodes ID token, refuses email_verified !== true, find-or-creates with account-linking by email, issues standard auth cookies"
    status: satisfied
    evidence: "frontend/src/app/api/auth/oauth/google/callback/route.ts:83-189 (state-check, code-exchange, email_verified guard at L110, find-or-create at L116-169, cookies at L188-189)"
  - id: OAUTH-03
    description: "OAuth errors land on /auth/error?code=… with documented error codes"
    status: satisfied
    evidence: "callback/route.ts uses redirectToAuthError at L72,85,100,103,113,180; error-redirect.ts:50-55 builds /auth/error?code=<UPPERCASE>"
  - id: NOTIF-01
    description: "List notifications (paginated, filterable read/unread)"
    status: satisfied
    evidence: "frontend/src/app/api/notifications/route.ts:59-100 — cursor pagination via Wave 0 encodeCursor/decodeCursor; ?unread=true filter at L67"
  - id: NOTIF-02
    description: "Mark notifications as read (single + bulk)"
    status: satisfied
    evidence: "notifications/route.ts:102-138 — accepts ids: string[] | 'all'; updateMany scoped by userId (D-13)"
  - id: NOTIF-03
    description: "Fetch unread count"
    status: satisfied
    evidence: "frontend/src/app/api/notifications/count/route.ts:13-28 — count where { userId, readAt: null }"
  - id: NOTIF-04
    description: "Read/update notification preferences (per-channel)"
    status: satisfied
    evidence: "frontend/src/app/api/notifications/prefs/route.ts:32-92 — GET returns prefs (or {}); PATCH deep-merges via mergePrefs and upserts"
  - id: NOTIF-05
    description: "All notification creation goes through createNotification(prisma, input) which catches P2002 for at-most-once dedup"
    status: satisfied
    evidence: "callback/route.ts:194 uses createNotification(prisma, welcomeNotification(...)); grep -c 'prisma.notification.create(' callback/route.ts → 0"
  - id: PIN-01
    description: "Set / change / delete a 4-6 digit withdrawal PIN; PIN stored hashed and required on subsequent withdrawals"
    status: satisfied
    evidence: "frontend/src/app/api/auth/withdrawal-pin/route.ts:51-171 — POST (SET/CHANGE) + DELETE; bcrypt cost 12 via Wave 0 hashPin; lockout key 'pin:${userId}' isolated"
human_verification:
  - test: "Google OAuth full round-trip with real GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI"
    expected: "GET /api/auth/oauth/google/start 302s to accounts.google.com; after consent, callback issues 3 cookies and lands at APP_URL"
    why_human: "Requires real Google OAuth credentials and browser interaction — cannot validate end-to-end via grep or unit tests"
  - test: "GOOGLE_EMAIL_NOT_VERIFIED branch with a test Google account that has unverified email"
    expected: "Callback redirects to /auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED; no User row created"
    why_human: "Requires a Google account in the unverified-email state, which cannot be programmatically simulated"
  - test: "D-01 silent linking: signup with email/password as you@example.com, then Sign in with Google with same Gmail"
    expected: "DB shows ONE User row, ONE OAuthAccount row, original passwordHash preserved, name/avatarUrl untouched"
    why_human: "Requires real Google identity matching a pre-existing email/password user; verifies UX outcome"
  - test: "Welcome notification dedup on browser back-button replay of OAuth callback"
    expected: "First OAuth signup creates one Notification row with type='WELCOME' and dedupeKey='welcome:<userId>'; back-button replay creates no second row (P2002 dedup)"
    why_human: "Requires browser navigation history replay; checks integration of NOTIF-05 dedupe with OAuth callback"
  - test: "PIN lockout threshold breach after 5 wrong attempts within 15 min"
    expected: "5th wrong currentPin → recordFailure returns { locked: true } → 423 LOCKED_OUT; subsequent calls within window return 423 immediately"
    why_human: "Requires Redis state across multiple requests; tested unitarily but threshold semantics depend on AUTH_LOCKOUT_THRESHOLD env"
  - test: "PIN timing-equalisation visible to attacker"
    expected: "Wrong-shape (missing currentPin) and wrong-PIN both take ~250ms ± noise; SET path with no body fails fast"
    why_human: "Timing assertions in unit tests are best-effort; real-world latency on cost-12 bcrypt depends on host CPU"
  - test: "Cursor pagination correctness across a populated DB with 25+ notifications"
    expected: "First page returns 10 items + nextCursor; second page returns next 10 items with strictly older createdAt or smaller id"
    why_human: "End-to-end pagination integrity is unit-tested via mocks but a real DB run validates the index plan and tie-break ordering"
  - test: "OAuth ?next= param round-trip with a same-origin path like /dashboard"
    expected: "/start sets app-oauth-next cookie containing https://APP_URL/dashboard; after Google consent, callback redirects to /dashboard (not APP_URL root)"
    why_human: "Real browser cookie propagation across the OAuth dance; tested unitarily but full round-trip needs browser"
---

# Phase 02: OAuth, Notifications, Withdrawal PIN — Verification Report

**Phase Goal:** Google sign-in works end-to-end, users can read and acknowledge notifications, and users can manage their withdrawal PIN — the prerequisites for Phase 4 withdrawals are satisfied.

**Verified:** 2026-05-08
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Roadmap Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| SC-1 | `/start` issues state+PKCE cookies path-scoped to `/api/auth/oauth`, 302 to Google | VERIFIED | `start/route.ts:49-71` — generateState/generateCodeVerifier, cookies `path:/api/auth/oauth` maxAge=300, redirect 302 |
| SC-2 | Callback issues 3 cookies on success; rejects email_verified:false → `/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED` | VERIFIED (code) / human (real Google) | `callback/route.ts:110-114` (gate) + `:188-189` (setAuthCookies+setCsrfCookie) |
| SC-3 | List/PATCH/count/prefs return correct shapes; createNotification flows into list | VERIFIED | `notifications/route.ts`, `count/route.ts`, `prefs/route.ts` — all `runtime='nodejs'`, `requireAuth` gated, userId-scoped Prisma queries |
| SC-4 | POST sets hashed PIN; DELETE removes; POST (change) succeeds; all 3 require auth + CSRF | VERIFIED | `withdrawal-pin/route.ts` — POST L51-149 (SET/CHANGE), DELETE L151-171; both gate verifyCsrf + requireAuth |

**Score:** 4/4 roadmap success criteria met (with human verification for OAuth real-world round-trip)

---

## Per-Plan Must-Haves

### Plan 02-00 (Wave 0 helpers) — 6/6 truths verified

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pure helpers compile under TS strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes | VERIFIED | SUMMARY records `tsc --noEmit` exit 0 + commits `114aec2/7740065/572da2c/7ff83d5` |
| 2 | error-redirect emits one of 5 D-06 UPPERCASE codes as `Location: /auth/error?code=<CODE>` | VERIFIED | `error-redirect.ts:16-29` defines `OAuthErrorCode` union of 5; `redirectToAuthError` builds `/auth/error?code=<encoded>` |
| 3 | cursor encode→decode round-trip preserves `{createdAt, id}` losslessly | VERIFIED | `cursor.ts:26,40` — encodeCursor/decodeCursor implemented per D-07 |
| 4 | prefs-merge preserves missing event types as enabled-by-default (D-10) | VERIFIED | `prefs-merge.ts:36,61` — `mergePrefs` and `isChannelEnabled` exported |
| 5 | pin.ts hashes at bcrypt cost 12 (CD-01) and offers a constant-time compare wrapper | VERIFIED | `pin.ts:23 PIN_BCRYPT_COST=12`, `:67 alwaysCompareDummy` runs bcrypt.compare against pre-minted DUMMY_HASH |
| 6 | All four helper test files exit 0 individually under vitest | VERIFIED | SUMMARY: 49 tests across 4 files all green |

### Plan 02-01 (Google OAuth routes) — 10/10 truths verified

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/start` issues state+PKCE cookies (httpOnly, path `/api/auth/oauth`, maxAge 300) and 302s to Google | VERIFIED | `start/route.ts:49-58,71` |
| 2 | `/start` returns 404 silently when GOOGLE_* env missing | VERIFIED | `start/route.ts:36-43` |
| 3 | `/callback` validates state vs cookie; mismatch → `OAUTH_STATE_MISMATCH` with cookies cleared | VERIFIED | `callback/route.ts:83-86` (mismatch check + clearEphemeralCookies) |
| 4 | Rejects `email_verified !== true` with `GOOGLE_EMAIL_NOT_VERIFIED` (no User created, no cookies) | VERIFIED | `callback/route.ts:110-114` |
| 5 | D-01 link path: existing email user gets new OAuthAccount row; User.name/avatarUrl untouched | VERIFIED | `callback/route.ts:133-143` (only oAuthAccount.create; no user.update) |
| 6 | D-02 create path: brand-new user with emailVerifiedAt=now, name/avatar from claims, atomic in $transaction | VERIFIED | `callback/route.ts:146-167` |
| 7 | Success → setAuthCookies+setCsrfCookie → 302 to ?next= or APP_URL | VERIFIED | `callback/route.ts:188-189,221` |
| 8 | Welcome notification on first OAuth creation goes through createNotification (NOTIF-05) | VERIFIED | `callback/route.ts:194` — `createNotification(prisma, welcomeNotification(u.id, u.email))` |
| 9 | OAuth2RequestError → `OAUTH_CODE_EXCHANGE_FAILED`; other → `OAUTH_GENERIC` + log.error | VERIFIED | `callback/route.ts:93-104` |
| 10 | Both routes export `runtime = 'nodejs'` | VERIFIED | grep confirms both files |

### Plan 02-02 (Notifications endpoints) — 9/9 truths verified

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET returns `{ items, nextCursor }` cursor-paginated [createdAt desc, id desc] | VERIFIED | `notifications/route.ts:83-93` |
| 2 | GET honors `?unread=true` and clamps `?limit=` to [1,50] (default 20) | VERIFIED | `notifications/route.ts:53-57,67` |
| 3 | PATCH `{ ids: string[] | 'all' }` marks unread→read; idempotent; returns `{ updated, unreadCount }` | VERIFIED | `notifications/route.ts:120-138` |
| 4 | PATCH silently ignores cross-tenant IDs (D-13) — `userId` always in where; never 403/404 differentiates | VERIFIED | `notifications/route.ts:122-123` (userId in both branches) |
| 5 | PATCH requires CSRF + auth | VERIFIED | `notifications/route.ts:105-108` |
| 6 | GET `/count` returns `{ count }` (uses `[userId, readAt]` index) | VERIFIED | `count/route.ts:19-21` |
| 7 | GET `/prefs` returns `{ prefs: {} }` for users with no row | VERIFIED | `prefs/route.ts:38-46` (returns readPrefs(row?.prefs)) |
| 8 | PATCH `/prefs` deep-merges (mergePrefs) and upserts; missing event types remain enabled (D-10) | VERIFIED | `prefs/route.ts:68-85` |
| 9 | All four route methods export `runtime = 'nodejs'` | VERIFIED | grep confirms 3 files (4 methods: route.ts has GET+PATCH) |

### Plan 02-03 (Withdrawal PIN) — 9/9 truths verified

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST with no existing hash sets bcrypt-cost-12 hash; body shape `{ newPin: \d{4,6} }` | VERIFIED | `withdrawal-pin/route.ts:43,124-148` (SET path) |
| 2 | POST with existing hash + correct currentPin updates; recordSuccess clears counter (CD-02) | VERIFIED | `withdrawal-pin/route.ts:96-122` (recordSuccess at L111) |
| 3 | POST wrong currentPin → 400 PIN_INVALID; recordFailure increments; bcrypt.compare unconditional | VERIFIED | `withdrawal-pin/route.ts:96-109` |
| 4 | POST missing currentPin (Zod fails ChangeBody) → 400 PIN_REQUIRED; alwaysCompareDummy still runs (CD-03) | VERIFIED | `withdrawal-pin/route.ts:79-94` (alwaysCompareDummy at L89) |
| 5 | POST while isLockedOut → 423 LOCKED_OUT; no bcrypt.compare runs | VERIFIED | `withdrawal-pin/route.ts:71-77` |
| 6 | DELETE clears withdrawalPinHash to null | VERIFIED | `withdrawal-pin/route.ts:160-163` |
| 7 | All three (POST set, POST change, DELETE) require requireAuth + verifyCsrf | VERIFIED | `withdrawal-pin/route.ts:54-58, 154-158` |
| 8 | Route exports `runtime = 'nodejs'` | VERIFIED | `withdrawal-pin/route.ts:29` |
| 9 | PIN lockout key namespace is `pin:${userId}` — never the email (Pitfall 7) | VERIFIED | `withdrawal-pin/route.ts:47-49 lockoutKey()` returns literal `pin:${userId}` |

---

## Required Artifacts

| Artifact | Status | Lines | Wired |
|----------|--------|-------|-------|
| `frontend/src/lib/server/oauth/error-redirect.ts` | VERIFIED | 92 | Imported by callback/route.ts |
| `frontend/src/lib/server/notifications/cursor.ts` | VERIFIED | 58 | Imported by notifications/route.ts |
| `frontend/src/lib/server/notifications/prefs-merge.ts` | VERIFIED | 71 | Imported by notifications/prefs/route.ts |
| `frontend/src/lib/server/auth/pin.ts` | VERIFIED | 70 | Imported by withdrawal-pin/route.ts |
| `frontend/src/app/api/auth/oauth/google/start/route.ts` | VERIFIED | 73 | Exports GET + runtime |
| `frontend/src/app/api/auth/oauth/google/callback/route.ts` | VERIFIED | 223 | Exports GET + runtime |
| `frontend/src/app/api/notifications/route.ts` | VERIFIED | 138 | Exports GET, PATCH + runtime |
| `frontend/src/app/api/notifications/count/route.ts` | VERIFIED | 28 | Exports GET + runtime |
| `frontend/src/app/api/notifications/prefs/route.ts` | VERIFIED | 92 | Exports GET, PATCH + runtime |
| `frontend/src/app/api/auth/withdrawal-pin/route.ts` | VERIFIED | 171 | Exports POST, DELETE + runtime |

All 10 production files exist; 10 co-located `.test.ts` files also exist (per `ls` and per-plan SUMMARY test counts: 49 + 19 + 51 + 13 = 132 tests).

---

## Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| callback/route.ts | error-redirect.ts | `redirectToAuthError`, `isSameOriginNext` | WIRED — 6 callsites |
| callback/route.ts | notifications/index.ts | `createNotification` | WIRED — L194 |
| callback/route.ts | notifications/templates.ts | `welcomeNotification` | WIRED — L194 |
| callback/route.ts | auth.ts | `setAuthCookies`, `setCsrfCookie`, `createAccessToken`, `createRefreshToken` | WIRED — L182-189 |
| notifications/route.ts | cursor.ts | `encodeCursor`, `decodeCursor` | WIRED — L21,68,93 |
| notifications/prefs/route.ts | prefs-merge.ts | `mergePrefs` | WIRED — L16,76 |
| withdrawal-pin/route.ts | pin.ts | `hashPin`, `verifyPin`, `alwaysCompareDummy` | WIRED — L37 + 5 callsites |
| withdrawal-pin/route.ts | lockout.ts | `isLockedOut`, `recordFailure`, `recordSuccess` (keyed `pin:`) | WIRED — L38 + 3 callsites |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| _none_ | — | — | — | NOTIF-05 invariant clean (grep `prisma.notification.create(` callback = 0); no PIN secrets in log calls; no TODOs/placeholders |

---

## Behavioral Spot-Checks

Skipped — Phase 02 produces route handlers that depend on a running Next.js server, Prisma DB, and (for OAuth) real Google credentials. Unit-test coverage is delivered by per-plan `.test.ts` files (132 tests across 10 files all reported green in SUMMARYs).

---

## Requirements Coverage

| Requirement | Plan(s) | Status | Evidence |
|-------------|---------|--------|----------|
| OAUTH-01 | 02-01 | SATISFIED | `start/route.ts:33-72` |
| OAUTH-02 | 02-01 | SATISFIED | `callback/route.ts:83-189` |
| OAUTH-03 | 02-00, 02-01 | SATISFIED | `error-redirect.ts` + 6 callsites in `callback/route.ts` |
| NOTIF-01 | 02-00, 02-02 | SATISFIED | `notifications/route.ts:59-100` + `cursor.ts` |
| NOTIF-02 | 02-02 | SATISFIED | `notifications/route.ts:102-138` |
| NOTIF-03 | 02-02 | SATISFIED | `notifications/count/route.ts` |
| NOTIF-04 | 02-00, 02-02 | SATISFIED | `notifications/prefs/route.ts` + `prefs-merge.ts` |
| NOTIF-05 | 02-01 | SATISFIED | `callback/route.ts:194` (createNotification, no direct prisma.notification.create) |
| PIN-01 | 02-00, 02-03 | SATISFIED | `withdrawal-pin/route.ts` + `pin.ts` |

**No orphaned requirements.** All 9 requirement IDs from ROADMAP Phase 2 are claimed by at least one plan, and all are satisfied by code evidence.

---

## Human Verification Required

The phase passes all programmatic checks. However, OAuth and PIN involve flows that cannot be fully validated without real credentials, browser interaction, or production-like state.

### 1. Google OAuth full round-trip
**Test:** With real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`, run `pnpm dev` and visit `/api/auth/oauth/google/start`.
**Expected:** 302 to `accounts.google.com`; after consent, callback issues `app-token`/`app-refresh`/`app-csrf` cookies and lands on `APP_URL`.
**Why human:** Cannot programmatically simulate Google's real OAuth response.

### 2. email_verified=false rejection in production
**Test:** Use a Google account whose email is not verified to attempt sign-in.
**Expected:** 302 to `/auth/error?code=GOOGLE_EMAIL_NOT_VERIFIED`; no User row created.
**Why human:** Requires Google account in unverified state.

### 3. D-01 silent linking
**Test:** Sign up via email/password as `you@example.com`, then "Sign in with Google" with the same Gmail.
**Expected:** ONE User row, ONE OAuthAccount row, original passwordHash preserved, name/avatarUrl untouched.
**Why human:** Verifies UX outcome and DB state across two flows.

### 4. Welcome notification dedup on browser back-button
**Test:** First OAuth signup → check Notification table. Then browser-back to replay callback URL.
**Expected:** Only ONE Notification row with `type='WELCOME'` and `dedupeKey='welcome:<userId>'`.
**Why human:** Browser navigation + DB state.

### 5. PIN lockout threshold breach
**Test:** Submit 5 wrong currentPins in a row.
**Expected:** 5th attempt → 423 LOCKED_OUT; subsequent attempts within window remain 423.
**Why human:** Requires Redis state across requests; threshold env-driven.

### 6. PIN timing-equalisation
**Test:** Time the wrong-shape, wrong-PIN, and right-PIN paths against a real DB.
**Expected:** All three take ~250ms ± noise.
**Why human:** Real-world latency depends on host CPU.

### 7. Cursor pagination across populated DB
**Test:** Seed 25+ notifications; call GET with `?limit=10` then with `?cursor=<nextCursor>`.
**Expected:** Second page contains strictly older items; no duplicates.
**Why human:** Validates index plan and tie-break ordering on real DB.

### 8. OAuth ?next= round-trip
**Test:** Visit `/api/auth/oauth/google/start?next=/dashboard`; complete Google flow.
**Expected:** Callback redirects to `/dashboard`, not APP_URL root.
**Why human:** Real browser cookie propagation across the OAuth dance.

---

## Summary

**Phase 02 is code-complete.** All 4 plans executed, all 32 truths verified across the merged frontmatter, all 10 production files in place with their 10 co-located test files (132 tests across the phase, all reported green per SUMMARYs). Requirements traceability: 9/9 IDs satisfied (OAUTH-01..03, NOTIF-01..05, PIN-01). NOTIF-05 invariant clean (grep `prisma.notification.create(` returns 0 in callback). Lockout namespace `pin:${userId}` literal. PIN secrets never appear in log calls.

**Status: human_needed** — programmatic verification cannot exercise the real Google OAuth round-trip, the unverified-email rejection branch, the silent-linking outcome, the welcome-notif dedup on back-button, the PIN lockout threshold across Redis state, the timing-equalisation latency, or the cursor pagination on a populated DB. These 8 items must be validated by a human running the app with real credentials before declaring Phase 02 truly complete and unblocking Phase 4.

---

_Verified: 2026-05-08_
_Verifier: Claude (gsd-verifier)_
