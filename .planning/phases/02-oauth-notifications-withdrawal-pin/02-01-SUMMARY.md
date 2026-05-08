---
phase: 02-oauth-notifications-withdrawal-pin
plan: 01
subsystem: auth/oauth
tags: [oauth, google, auth, route-handler, notif-05]
requirements_completed: [OAUTH-01, OAUTH-02, OAUTH-03, NOTIF-05]
dependency_graph:
  requires:
    - frontend/src/lib/server/oauth/google.ts (Wave 0 — tryCreateGoogleProvider, decodeIdToken)
    - frontend/src/lib/server/oauth/error-redirect.ts (Wave 0 — redirectToAuthError, isSameOriginNext)
    - frontend/src/lib/server/auth.ts (setAuthCookies, setCsrfCookie, createAccessToken, createRefreshToken)
    - frontend/src/lib/server/notifications/index.ts (createNotification — NOTIF-05 wrapper)
    - frontend/src/lib/server/notifications/templates.ts (welcomeNotification)
    - frontend/src/lib/server/observability/request-context.ts (withRequestContext, makeRequestContext)
  provides:
    - GET /api/auth/oauth/google/start (issues state + PKCE cookies; 302 to Google)
    - GET /api/auth/oauth/google/callback (state-validate, code-exchange, find-or-create, 3 cookies)
  affects:
    - frontend Phase 2/3 plans that consume OAuth-authenticated sessions (downstream same as email/password)
tech_stack:
  added: []
  patterns:
    - arctic 3.7.0 OAuth 2.0 + PKCE flow
    - ephemeral cookies path-scoped to /api/auth/oauth (5 min) — state, code_verifier, next
    - redirectToAuthError + isSameOriginNext for D-06 error mapping and Pitfall 10 open-redirect defense
key_files:
  created:
    - frontend/src/app/api/auth/oauth/google/start/route.ts
    - frontend/src/app/api/auth/oauth/google/start/route.test.ts
    - frontend/src/app/api/auth/oauth/google/callback/route.ts
    - frontend/src/app/api/auth/oauth/google/callback/route.test.ts
  modified: []
decisions:
  - D-01 honored — link path leaves User.name/avatarUrl untouched on existing email/password users (T-02-OAUTH-NAME-OVERWRITE mitigation)
  - D-02 honored — brand-new users created inside a single $transaction with User + OAuthAccount; passwordHash=null, emailVerifiedAt=now
  - D-03 honored — welcome notification dispatched only on D-02 (isNewUser) path via createNotification (NOTIF-05 wrapper)
  - D-05 honored — claims.email_verified !== true short-circuits BEFORE any DB write
  - D-06 honored — all five OAuthErrorCodes (OAUTH_PROVIDER_DISABLED, OAUTH_STATE_MISMATCH, OAUTH_CODE_EXCHANGE_FAILED, GOOGLE_EMAIL_NOT_VERIFIED, OAUTH_GENERIC) reachable from named exit branches
metrics:
  duration_minutes: 10
  completed: 2026-05-08
  tasks: 2
  files: 4
  tests_added: 19
---

# Phase 02 Plan 01: Google OAuth Route Handlers Summary

Shipped the two Google OAuth Route Handlers — `/api/auth/oauth/google/start` (kicks off the OAuth dance) and `/api/auth/oauth/google/callback` (validates state, exchanges code, find-or-creates user with email-based account linking, issues the standard 3 auth cookies, dispatches a welcome notification on first creation). Same downstream session as email/password — every consumer of `requireAuth` is now provider-agnostic.

## Routes shipped

### `GET /api/auth/oauth/google/start`

Inert (404 silent JSON) when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` is missing — same env-gating pattern as Bictorys/R2/Resend. When configured:

1. Calls `generateState()` and `generateCodeVerifier()` from `arctic`.
2. Computes the authorization URL via `provider.client.createAuthorizationURL(state, codeVerifier, [...provider.scopes])`.
3. Sets two `httpOnly`+`SameSite=Lax`+`secure-in-prod` cookies — `app-oauth-state`, `app-oauth-pkce` — both path-scoped to `/api/auth/oauth`, `maxAge=300`s. Path scoping is the OAUTH-COOKIE-LEAK mitigation (state cookie is NOT sent to other routes).
4. Optionally echoes `?next=` through `app-oauth-next` if `isSameOriginNext` validates it. Pitfall 10 (`//evil.com` open-redirect) is rejected — both protocol-relative and scheme-prefixed values are silently dropped with a `log.warn`.
5. 302 redirects to Google.

### `GET /api/auth/oauth/google/callback`

Three guard layers run BEFORE any DB write:

1. **Provider env check** → `redirectToAuthError('OAUTH_PROVIDER_DISABLED')` — the callback path uses the redirect (vs. `/start`'s 404) so that real users hitting an old bookmark land on `/auth/error` instead of a confusing 404.
2. **State validation** — strict equality between `?state=` query and `app-oauth-state` cookie. Any failure (missing query, missing cookie, missing pkce, mismatch) → `OAUTH_STATE_MISMATCH`. Ephemeral cookies are wiped (T-02-OAUTH-STATE-REPLAY mitigation).
3. **Code exchange + email_verified gate** — `provider.client.validateAuthorizationCode(code, pkceCookie)` with two error branches:
   - `OAuth2RequestError` from arctic → `OAUTH_CODE_EXCHANGE_FAILED`
   - any other thrown error → `OAUTH_GENERIC` + `log.error`
   - `claims.email_verified !== true` → `GOOGLE_EMAIL_NOT_VERIFIED` (D-05 critical invariant — without this, an attacker with an unverified Google account matching a victim's email could take over via auto-linking).

After all guards pass, find-or-create runs in three branches:

| Branch | Trigger | Behavior |
| --- | --- | --- |
| Returning OAuth user | `OAuthAccount.findUnique({ provider_providerAccountId: { provider:'google', providerAccountId: claims.sub } })` hits | Just re-issue the 3 session cookies. No User update, no welcome notif. |
| **D-01 link path** | Provider lookup misses; `User.findUnique({ email })` hits | Create OAuthAccount row only. **`User.name` / `User.avatarUrl` are NOT overwritten** (T-02-OAUTH-NAME-OVERWRITE mitigation; research Open Question 2). No welcome notif. |
| **D-02 create path** | Both lookups miss | `prisma.$transaction` creates User (`emailVerifiedAt=now`, `name=claims.name??null`, `avatarUrl=claims.picture??null`, `passwordHash=null`) and OAuthAccount atomically. `isNewUser=true` → welcome notif dispatched. |

Session cookies are then issued exactly like `verify-email/route.ts:162-169`: `createAccessToken` + `createRefreshToken` + `setAuthCookies` + `setCsrfCookie`.

The `app-oauth-next` cookie is consumed last, with defense-in-depth: the cookie value (an absolute URL set by `/start`) is split into pathname+search, then re-fed through `isSameOriginNext` against `APP_URL`. Cross-origin, fall back to `APP_URL`. All three ephemeral cookies are cleared (`maxAge: 0`) on every exit branch.

## D-06 redirect-code mapping (locked)

| OAuthErrorCode | Triggering branch in callback |
| --- | --- |
| `OAUTH_PROVIDER_DISABLED` | `tryCreateGoogleProvider()` returned undefined |
| `OAUTH_STATE_MISMATCH` | code/state missing OR state cookie missing OR pkce cookie missing OR `state !== stateCookie` |
| `OAUTH_CODE_EXCHANGE_FAILED` | `validateAuthorizationCode` threw `OAuth2RequestError` |
| `OAUTH_GENERIC` | `validateAuthorizationCode` threw any other Error (after `log.error`) OR defensive "user disappeared after create" |
| `GOOGLE_EMAIL_NOT_VERIFIED` | `claims.email_verified !== true` |

`/start` returns 404 silently when env is missing (same env-gating pattern as Bictorys/R2). The callback uses the redirect path because users may already be mid-flow and need an error page.

## NOTIF-05 invariant kept

Welcome notification dispatch in the callback goes through `createNotification(prisma, welcomeNotification(u.id, u.email))` exactly once per first-creation. Direct `prisma.notification.create` calls would skip the dedupe `P2002` catch — confirmed absent via:

- `grep -c "prisma\.notification\.create(" frontend/src/app/api/auth/oauth/google/callback/route.ts` → `0`
- A static-source assertion in `route.test.ts` (NOTIF-05 source check) regexes `/prisma\.notification\.create\(/` and asserts `not.toMatch`.

The `welcomeNotification` factory's `dedupeKey: welcome:${userId}` ensures at-most-once delivery even if the user replays the callback URL via browser back-button (T-02-OAUTH-WELCOME-DUP mitigation).

## Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | `de91616` | `feat(02-01): add GET /api/auth/oauth/google/start handler` (route + 6 tests) |
| 2 | `c84647c` | `feat(02-01): add GET /api/auth/oauth/google/callback handler` (route + 13 tests) |

## Verification

- Both `route.test.ts` files pass (6 tests for `/start`, 13 tests for `/callback`).
- `frontend/src/lib/server/observability/runtime-enforcement.test.ts` still passes — both new routes export `runtime = 'nodejs'`.
- `pnpm --filter frontend run typecheck` → exit 0 (no `any` casts; strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` clean).
- `pnpm --filter frontend run lint` → exit 0.
- Static NOTIF-05 invariant check (`grep -c "prisma\.notification\.create("`) → 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Fixed test type-narrowing on `tryCreateGoogleProvider` return type**

- **Found during:** Task 1+2 typecheck after writing tests.
- **Issue:** `tryCreateGoogleProvider()` returns `GoogleProviderHandle | undefined`, so the plan's suggested cast `as unknown as ReturnType<typeof tryCreateGoogleProvider>['client']` triggered TS2339 (`Property 'client' does not exist on type 'GoogleProviderHandle | undefined'`). The plan's `<action>` block warned this might need adjustment ("if `__cookieStore` exposes a different shape than `Map<string, { value, options }>`, adapt the assertions to its actual shape"). I encountered the analogous shape-mismatch on the provider type.
- **Fix:** Added `import { type GoogleProviderHandle }` and a local alias `type ProviderClient = GoogleProviderHandle['client']` in both test files; replaced 4 occurrences of the broken cast.
- **Files modified:** `frontend/src/app/api/auth/oauth/google/start/route.test.ts`, `frontend/src/app/api/auth/oauth/google/callback/route.test.ts`
- **Commit:** Rolled into the same task commits (no separate commit needed since tests don't pass without the fix).

**2. [Rule 3 — Blocker] Removed unused helper `setupCookies` and renamed `_prismaArg` to fix lint**

- **Found during:** Task 2 lint.
- **Issue:** I drafted a `setupCookies` helper inside the test file then realized each test seeds cookies inline via `seedCookie`, making the wrapper dead code. ESLint flagged `@typescript-eslint/no-unused-vars`. Separately, the destructured `_prismaArg` in the welcome-notification assertion was unused.
- **Fix:** Deleted `setupCookies` + the unused `CallbackOpts` super-set; switched the destructure to `mockCreateNotification.mock.calls[0]?.[1]` (single read, no unused var).
- **Files modified:** `frontend/src/app/api/auth/oauth/google/callback/route.test.ts`
- **Commit:** Rolled into Task 2 commit.

No production-route changes were required — both fixes were test-side only and don't affect runtime behavior.

## Manual Smoke Checklist (for OAUTH-01/02 with real Google credentials)

When a user runs the app locally with real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`:

1. `pnpm dev` and visit `http://localhost:3000/api/auth/oauth/google/start` — should 302 to `accounts.google.com`. Check DevTools cookies tab for `app-oauth-state` + `app-oauth-pkce`, both with `Path=/api/auth/oauth` and `Max-Age=300`.
2. Complete consent at Google — should land on the callback, then redirect to `APP_URL` with `app-token`, `app-refresh`, `app-csrf` cookies set. `app-refresh` must have `Path=/api/auth`.
3. Repeat — same Google account → no duplicate User row in Prisma Studio.
4. Sign up via email/password with `you@example.com`, then "Sign in with Google" using the same Gmail address — DB shows ONE User row with TWO OAuthAccount? rows... actually with one OAuthAccount row, original passwordHash preserved, name/avatarUrl untouched (D-01 silent linking).
5. Hit `/api/auth/oauth/google/callback` directly with no query — should 302 to `/auth/error?code=OAUTH_STATE_MISMATCH`.
6. Without `GOOGLE_*` env: `/start` returns 404 JSON; `/callback` 302s to `/auth/error?code=OAUTH_PROVIDER_DISABLED`.
7. Welcome notification: query `Notification` table after first OAuth signup — should see one row with `type='WELCOME'` and `dedupeKey='welcome:<userId>'`. Replay the callback (browser back) — still ONE row (P2002 dedup).

## Self-Check: PASSED

Created files (verified):

- `/Users/amadoufall/Desktop/K-gnote/amadou-monolith/frontend/src/app/api/auth/oauth/google/start/route.ts` — FOUND
- `/Users/amadoufall/Desktop/K-gnote/amadou-monolith/frontend/src/app/api/auth/oauth/google/start/route.test.ts` — FOUND
- `/Users/amadoufall/Desktop/K-gnote/amadou-monolith/frontend/src/app/api/auth/oauth/google/callback/route.ts` — FOUND
- `/Users/amadoufall/Desktop/K-gnote/amadou-monolith/frontend/src/app/api/auth/oauth/google/callback/route.test.ts` — FOUND

Commits (verified via local `git log`):

- `de91616` — Task 1 — FOUND
- `c84647c` — Task 2 — FOUND
