# Phase 1: Auth Routes - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers **9 authenticated HTTP route handlers** under `frontend/src/app/api/auth/**` plus per-email rate limiting and failed-login lockout. The lib layer (auth, crypto, redis, rate-limit-store, middleware HOFs) is already ported from `amadou-template` per the M1–M2 scaffold and is in the do-not-modify list — Phase 1 is **route-handler translation from the template's Express handlers to App Router route handlers**, consuming the locked lib helpers.

By end of Phase 1:
1. A user can `POST /api/auth/signup` and receive an enumeration-resistant 201 (no cookies, dummy bcrypt work for non-existent emails)
2. A user can `POST /api/auth/verify-email` with an 8-char Crockford code and receive all three httpOnly cookies (`<prefix>-token`, `<prefix>-refresh` path-scoped to `/api/auth`, `<prefix>-csrf`)
3. A user can `POST /api/auth/login` and receive cookies; failed login attempts trigger lockout after threshold
4. `POST /api/auth/refresh` rotates the access token via the refresh cookie with single-flight semantics
5. `POST /api/auth/logout` clears all auth cookies
6. `GET /api/auth/me` returns the current user under `requireAuth`
7. `POST /api/auth/forgot-password` always returns 200 (no enumeration leak)
8. `POST /api/auth/reset-password` accepts code + new password
9. `PUT /api/auth/change-password` requires CSRF, bumps `tokenVersion`, invalidates other sessions
10. Per-email rate limiting protects login (10/15m), signup (5/h), password reset, and verification flows on top of the global IP limiter; failed-login lockout after 5 failures within 15 min

This phase does NOT add OAuth (Phase 2), withdrawal-PIN (Phase 2), or any other route. It does NOT modify `lib/server/auth.ts`, `lib/server/crypto.ts`, or `lib/server/middleware/**` (battle-tested per CLAUDE.md).

</domain>

<decisions>
## Implementation Decisions

### Route shape (cross-cutting for all 9 handlers)

- **D-01:** Every route file's first three lines: `export const runtime = 'nodejs';` (CI guard from Phase 0 enforces), then `import 'server-only'` somewhere near the top (via lib helpers if they already include it), and the handler's first action: `const ctx = makeRequestContext(req.headers); return withRequestContext(ctx, async () => { ... });`. Wraps every handler so the `log` wrapper picks up `requestId` automatically.
- **D-02:** Mutating routes (POST/PUT/PATCH/DELETE) call `verifyCsrf(req)` from `lib/server/middleware/index.ts` BEFORE auth/business logic. CSRF check returns `NextResponse | null`; if non-null, return early.
- **D-03:** Authenticated routes (`me`, `change-password`) call `requireAuth(req.headers.get('authorization'))` (or the cookie-based variant if the existing helper supports it — read `lib/server/middleware/index.ts` to confirm). Return 401 NextResponse on failure.
- **D-04:** Body validation via Zod schemas defined per-route at the top of each route file. Use `lib/server/zod-helpers.ts` for shared error formatting. On validation failure, return `400 { error: 'VALIDATION_FAILED', issues: [...] }` with the formatter's output — never raw Zod issues (security: don't leak internal field names beyond what's intentional).
- **D-05:** Response shape: success → `NextResponse.json({ ... })`; failure → `NextResponse.json({ error: '<STABLE_CODE>', message: '<user-facing>' }, { status: <code> })`. Stable codes (per CONVENTIONS.md): `TOO_MANY_LOGIN_ATTEMPTS`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `LOCKED_OUT`, `VERIFICATION_CODE_INVALID`, `VERIFICATION_CODE_EXPIRED`, `PASSWORD_TOO_SHORT`, `PASSWORD_BANNED`, `PASSWORD_PWNED`, `CSRF_INVALID`, `VALIDATION_FAILED`. Frontend switches on `error`, never on `message`.

### Tuning defaults (baked into `.env.example`, env-overridable per fork)

- **D-06:** Verification code TTL = **15 minutes** (`AUTH_VERIFICATION_TTL_MIN=15`). 8-char Crockford alphabet, generated via existing `lib/server/crypto.ts` helper.
- **D-07:** Failed-login lockout = **5 failures → 15-minute lockout** per email (`AUTH_LOCKOUT_THRESHOLD=5`, `AUTH_LOCKOUT_DURATION_MIN=15`). Implemented via Redis sliding-window counter keyed on email; on Redis miss falls back to a per-process Map that warns in logs (existing rate-limit-store pattern).
- **D-08:** Rate limit values:
  - Login: 10 / 15 min per email (locked from PROJECT.md, set via `AUTH_LOGIN_RATE_LIMIT=10/15m`)
  - Signup: 5 / hour per email (locked, `AUTH_SIGNUP_RATE_LIMIT=5/1h`)
  - Forgot-password: **3 / hour per email** (`AUTH_FORGOT_RATE_LIMIT=3/1h`) — prevents enumeration spam
  - Reset-password code attempts: **5 / 15 min per email** (`AUTH_RESET_RATE_LIMIT=5/15m`) — code becomes invalid after 5 fails
  - Resend verification: **3 / hour per email** (`AUTH_RESEND_VERIFY_RATE_LIMIT=3/1h`)
  - Verify-email retries: **5 / 15 min per email** (`AUTH_VERIFY_RATE_LIMIT=5/15m`) — same shape as reset
- **D-09:** All limits use `createEmailLimiter(...).check(req, email)` from `lib/server/middleware/rate-limit-by-email.ts` (existing). Returns `NextResponse | null`; non-null = 429.

### Password policy (NIST 800-63B aligned)

- **D-10:** Minimum length = **10 characters** (`AUTH_PASSWORD_MIN_LENGTH=10`). 8 is too short for 2026; 12 hurts UX. Configurable but defaults to 10.
- **D-11:** **No mandatory complexity rules** — NIST 800-63B explicitly recommends against char-class requirements (they reduce entropy in practice as users adopt predictable patterns).
- **D-12:** **Banned-password check** — embed ~100-entry list (e.g. "password", "qwerty123", "admin123", "letmein") in `lib/server/crypto.ts` or a new `lib/server/auth/banned-passwords.ts` (do NOT modify auth.ts). Check server-side on signup, reset-password, change-password. Return `PASSWORD_BANNED` error code on hit.
- **D-13:** **HIBP haveibeenpwned check** — opt-in via `PASSWORD_HIBP_CHECK=1` env, **default OFF**. When enabled, k-anonymity check (send first 5 chars of SHA-1 to `https://api.pwnedpasswords.com/range/{prefix}`, compare suffix locally — never sends full password or full hash). Return `PASSWORD_PWNED` on hit. Network failure = log warning + allow (don't fail closed; HIBP outage shouldn't block signup).
- **D-14:** No password expiry/rotation (NIST 800-63B explicitly recommends against — forces predictable patterns).

### Email templates

- **D-15:** **English by default** — broader reuse for a multi-target starter than FR-only. Per-project override = edit the strings in `lib/server/notifications/templates.ts` (already exists in lib). No i18n machinery in v1; the file is small enough for fork-edit to be the natural override.
- **D-16:** Templates ship as **plain HTML strings** (no MJML, no React Email) — keeps surface minimal. Per-project can swap to a fancier template engine if needed; the contract is just `(args) => { subject: string, html: string, text: string }`.
- **D-17:** Email dispatch goes through the **outbox** (see `lib/server/outbox/`) — not direct `resend.emails.send()` calls from route handlers. Outbox dispatcher will drain in Phase 5; for Phase 1, route handlers `enqueueOutbox(tx, { type: 'EMAIL', payload: {...} })` inside the same Prisma tx as the user mutation. This way Phase 1 handlers don't depend on Resend being live (env-gated graceful degradation).

### Token & session semantics

- **D-18:** Access JWT lifetime = **15 min** (locked); refresh JWT lifetime = **7 days** (locked). Refresh cookie path-scoped to `/api/auth` (locked from CONTEXT-Phase-0 inheritance + PROJECT.md constraint).
- **D-19:** **`tokenVersion` check on every authenticated request** — `requireAuth` reads the JWT's `tokenVersion` claim and compares against `users.tokenVersion` from DB. Per-request DB read is acceptable (Phase 1 has no perf SLO; cache later if needed). When `change-password` bumps `tokenVersion` (D-09 in PROJECT.md), all other sessions become invalid on next request — no need for a session blocklist.
- **D-20:** **Refresh single-flight via Redis SETNX lock** — concurrent refresh attempts for the same user race on a Redis key (`refresh-lock:{userId}`) with a 5-second TTL. Loser of the race waits + retries. Vercel multi-instance safe. Without Redis (dev fallback), a per-process Map suffices since Vercel always has Redis in prod.
- **D-21:** Cookies: `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`, `path: '/' (token + csrf)` and `path: '/api/auth' (refresh)`. Cookie names use `<COOKIE_PREFIX>-token`, `<COOKIE_PREFIX>-refresh`, `<COOKIE_PREFIX>-csrf` (existing convention). All set via `cookies()` from `next/headers` (async in Next 15+).

### Enumeration resistance

- **D-22:** **Signup** returns identical 201 `{ ok: true }` whether the email is new or exists. For non-existent emails, perform a dummy bcrypt-equivalent compute (constant-time) so timing analysis can't differentiate. Do NOT issue cookies. Do NOT send email if email exists (fail silently — security tradeoff: real new users get email, but adversaries can't enumerate via email-arrived signal).
- **D-23:** **Forgot-password** returns 200 regardless of email existence. Send email only if user exists. Same dummy-compute principle.
- **D-24:** **Login** returns the same `INVALID_CREDENTIALS` error for "user not found", "wrong password", and "user not yet verified" (use `EMAIL_NOT_VERIFIED` only when reaching the verified gate after credentials match — and only AFTER successful credential validation). After credentials match: if `EMAIL_NOT_VERIFIED`, the response is intentionally distinct because we WANT the verified user to know to check their email.

### Test strategy

- **D-25:** **Mock Prisma for unit tests** (fast, run on every commit). Each route handler gets a co-located `*.test.ts` that stubs `PrismaClient` (use `vi.mock('@/lib/server/prisma', ...)`) and asserts response shape, status code, cookies set, stable error codes returned. Cover happy path + critical error paths per route.
- **D-26:** **Real Postgres integration tests are deferred** — Phase 1's invariants (rate limits, lockout) can be exercised via Redis-backed unit tests; advisory-lock tests live in Phase 4. Add `pnpm test:integration` as a separate script in `frontend/package.json` (empty for Phase 1; Phase 4+ populates).
- **D-27:** **Vitest setup-files for JWT_SECRET / ENCRYPTION_KEY fixtures lands in Phase 1, NOT Phase 6.** Auth route tests cannot run without these env fixtures. Move the relevant TEST-01 surface into Phase 1; Phase 6 TEST-01 narrows to "test framework expansion + smoke E2E", not config.
- **D-28:** Test files co-located with route handlers (e.g. `app/api/auth/signup/route.test.ts`). The runtime-enforcement test (Phase 0) walks `app/api/**/route.ts` and stays compatible with co-located `.test.ts` (same glob doesn't match `.test.ts`).

### Claude's Discretion

- Exact location of the banned-passwords list (new file under `lib/server/auth/` vs inline in a helper) — planner picks based on size/cohesion.
- Whether to use `lucia-auth` or any new auth library — **NO**, custom JWT/CSRF stays per PROJECT.md Key Decisions.
- Whether to ship a `useUser` React hook in this phase — **NO**, frontend hooks land per-project; this phase is API-only.
- Test coverage thresholds — no minimum bar set; reasonable coverage of the 4 explicit invariants per route (happy path, validation fail, rate-limit hit, business-logic error).
- Whether to include a Vitest `setupFiles` global mock for `next/headers` cookies — only if test files repeatedly need to mock cookie reads; let the planner decide based on actual test count.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & roadmap

- `.planning/PROJECT.md` — Core Value, Constraints, Key Decisions, Validated section (now includes Phase 0 outputs)
- `.planning/REQUIREMENTS.md` — REQ-IDs AUTH-01 through AUTH-10 (Phase 1 scope)
- `.planning/ROADMAP.md` §"Phase 1: Auth Routes" — phase goal + 5 success criteria

### Phase 0 outputs (now in effect)

- `.planning/phases/00-foundation/00-CONTEXT.md` — D-12, D-13, D-14, D-15: request-context module shape (every route uses `makeRequestContext` + `withRequestContext`)
- `.planning/phases/00-foundation/00-RESEARCH.md` — Patterns 4 & 5: request-context module, logger wrapper. Don't re-derive.
- `.planning/phases/00-foundation/00-VERIFICATION.md` — confirms `lib/server/observability/{request-context,log}.ts` are live and `runtime='nodejs'` is enforced

### Existing lib (DO NOT MODIFY — battle-tested per CLAUDE.md)

- `frontend/src/lib/server/auth.ts` — JWT signing/verification, cookie helpers (`setAuthCookies`, `clearAuthCookies`), `verifyCsrf`. Read to understand the contract; never modify.
- `frontend/src/lib/server/crypto.ts` — bcrypt wrappers, Crockford code generator (used by AUTH-03), encryption helpers
- `frontend/src/lib/server/middleware/index.ts` — `requireAuth`, `requireAdmin`, `requireSuperadmin`, `requireOrgRole`, `optionalAuth`, `verifyCsrf`. Route handlers consume these.
- `frontend/src/lib/server/middleware/rate-limit-by-email.ts` — `createEmailLimiter(opts).check(req, email)` returning `NextResponse | null`
- `frontend/src/lib/server/redis.ts` — `getRedis()` singleton (returns null when env missing); `redis: Redis | null` named export
- `frontend/src/lib/server/rate-limit-store.ts` — `MemoryRateLimitStore` dev fallback when Redis is null
- `frontend/src/lib/server/zod-helpers.ts` — shared validation error formatter
- `frontend/src/lib/server/observability/request-context.ts` (Phase 0 output) — `makeRequestContext`, `withRequestContext`, `getRequestId`, `getRequestContext`
- `frontend/src/lib/server/observability/log.ts` (Phase 0 output) — `createRequestLogger(options)` and default `log` singleton

### Existing lib (project-side — extend per phase)

- `frontend/src/lib/server/notifications/templates.ts` — email template factory (Phase 1 adds verification + reset templates if not already there)
- `frontend/src/lib/server/notifications/index.ts` — `createNotification(prisma, input)` (P2002 dedup) — reused for in-app notifications IF Phase 1 emits any (probably not — that's Phase 2 NOTIF surface)
- `frontend/src/lib/server/outbox/index.ts` — `enqueueOutbox(tx, event)` for at-most-once email side-effects (D-17)

### Schema

- `frontend/prisma/schema.prisma` — `User`, `VerificationCode` models. Read for field names: `User.email`, `User.passwordHash`, `User.tokenVersion`, `User.emailVerifiedAt`, `User.failedLoginCount`, `User.lockedUntilAt` (verify exact field names — may be `failedLoginAt` etc.). The schema may need 1–2 minor field additions if `failedLoginCount`/`lockedUntilAt` aren't already there.

### Reference (read for shape, NOT to copy verbatim)

- `backend/src/routes/auth.ts` (in the source `amadou-template` repo, see [`../amadou-template/backend/src/routes/auth.ts`](../amadou-template/backend/src/routes/auth.ts) — 709 lines) — Express handlers being ported. Read for invariant capture, NOT for implementation patterns (Express middleware order ≠ App Router).
- `examples/frontend-pages/auth-error.tsx` — OAuth error page reference (Phase 2 concern but informs URL conventions)

### External docs

- NIST SP 800-63B "Digital Identity Guidelines" (password policy reference): https://pages.nist.gov/800-63-3/sp800-63b.html
- HIBP Pwned Passwords k-anonymity API: https://haveibeenpwned.com/API/v3#PwnedPasswords (only consulted if `PASSWORD_HIBP_CHECK=1`)
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `lib/server/auth.ts` already provides `setAuthCookies(accessToken, refreshToken)`, `clearAuthCookies()`, `getCsrfToken()`, `verifyCsrf(req)`. Phase 1 route handlers just call these.
- `lib/server/crypto.ts` already provides `hashPassword`, `verifyPassword`, `generateCrockfordCode`, `generateToken` (verify exact names by reading the file). Banned-passwords list lives in a NEW file, NOT in crypto.ts (do-not-modify).
- `lib/server/middleware/rate-limit-by-email.ts` ships `createEmailLimiter` — Phase 1 instantiates one limiter per route configuration with the D-08 values.
- `lib/server/observability/log.ts` (Phase 0) — every handler that logs uses `import { log } from '@/lib/server/observability/log'`.
- `lib/server/observability/request-context.ts` (Phase 0) — every handler's first call.
- `lib/server/notifications/templates.ts` — extend with `verificationEmail({ code, email })` and `resetPasswordEmail({ code, email })` factories if not already present.
- `lib/server/outbox/index.ts` — `enqueueOutbox(tx, { type: 'EMAIL', payload: { template, args, to } })` for sending mail without coupling to Resend availability.

### Established Patterns

- **`'server-only'` import** at top of every server-only file (CLAUDE.md). Route files don't always need this (App Router enforces server-only by default for `route.ts`) but lib files do.
- **Path alias** `@/*` → `frontend/src/*`. Use it.
- **Conventional Commits with `(monolith)` scope.** Phase 1 uses `feat(monolith): port signup route`, `feat(monolith): port login route + lockout`, etc.
- **Co-located tests** — `app/api/auth/signup/route.test.ts` for the signup route. Vitest config (Phase 0) picks up `src/**/*.test.ts`.
- **Stable error codes** — every business-logic failure returns `{ error: '<CODE>', message: '<user-text>' }` per the existing convention.
- **Async cookies** — `cookies()` from `next/headers` returns a Promise in Next 15+; `lib/server/auth.ts` helpers already wrap this. Never call `cookies()` directly from route handlers; use the lib helpers.

### Integration Points

- Every Phase 2+ route (OAuth callback, withdrawal-PIN, etc.) consumes the auth cookies set by Phase 1. Phase 1's cookie names + paths must match what `requireAuth` expects (locked by lib).
- The `notifications/templates.ts` extensions in Phase 1 will be exercised by Phase 2 NOTIF + Phase 5 cron. Phase 1 just lands the template factories.
- Phase 6 TEST-01 (Vitest setup-files) was originally scheduled there but D-27 moves the env-fixture work into Phase 1 (auth tests need it). Phase 6 then narrows to test-suite expansion + smoke E2E.

</code_context>

<specifics>
## Specific Ideas

- **Verification code format:** 8-char Crockford alphabet (no `I`, `L`, `O`, `U`) — already supported by existing `generateCrockfordCode` helper in `crypto.ts`. TTL stored on `VerificationCode.expiresAt`. Single-use: mark `consumedAt` after successful verify.
- **Rate-limit key shape:** `auth:login:{lower(email)}`, `auth:signup:{lower(email)}`, etc. Lowercased email prevents trivial bypass via case mutation. Existing `createEmailLimiter` may already do this — confirm.
- **Lockout key:** `auth:lockout:{lower(email)}` with a 15-min TTL containing the failure count. On 5th failure → set `User.lockedUntilAt = now + 15min` AND `auth:lockout` key for fast Redis check (avoids per-request DB read for lockout state).
- **Banned-passwords list location:** suggest `frontend/src/lib/server/auth/banned-passwords.ts` (new directory `auth/` under `server/` since `auth.ts` is do-not-modify and a sibling `auth/` directory is cleaner than polluting other namespaces). Export `isBanned(password: string): boolean`.
- **HIBP k-anonymity caveat:** The HIBP API returns ~600 hash suffixes per prefix range (~24 KB response). Cache responses for 1 hour in Redis to avoid hammering on signup spam. Cache key: `hibp:{prefix}`. TTL 1 hour.
- **Test fixture for JWT_SECRET:** `frontend/vitest.setup.ts` (new file referenced from `vitest.config.ts.test.setupFiles`) sets `process.env.JWT_SECRET = 'test-secret-must-be-at-least-32-chars-long-for-zod-validation'` and `process.env.ENCRYPTION_KEY = '...'` and any other lib-required envs. This is the cross-phase D-27 surface.
- **Outbox + email integration:** Phase 1 emits email events to the outbox; Phase 5 cron drains. For Phase 1 tests, mock the outbox (`vi.mock('@/lib/server/outbox', ...)`) and assert that `enqueueOutbox` is called with the expected payload — don't actually send mail in tests.
- **`change-password` and `tokenVersion`:** route handler increments `users.tokenVersion` inside the same tx as the password update. After success, issue NEW access + refresh + csrf cookies (with the bumped tokenVersion) so the user's CURRENT browser stays logged in; OTHER sessions fail on next `requireAuth` call.

</specifics>

<deferred>
## Deferred Ideas

- **Magic-link login** — deferred to v2 (PROJECT.md AUTH-V2-01).
- **Passkeys / WebAuthn** — deferred to v2 (AUTH-V2-02).
- **2FA / TOTP** — out of scope (PROJECT.md "Built-in TOTP / 2FA" anti-feature).
- **Refresh-cookie revocation list (DB-backed session table)** — not needed in v1 since `tokenVersion` bump invalidates all sessions on password change. Sliding-window session timeout / device management is per-project.
- **Auth.js / NextAuth migration** — explicitly out of scope per PROJECT.md Key Decisions.
- **Custom React `useUser` hook** — frontend concern, per-project, not in starter.
- **i18n machinery for email templates** — fork-edit is the override pattern; no i18n in v1.
- **Real-Postgres integration tests for auth routes** — D-26 defers; Phase 4 (withdrawals) is where the integration test scaffold actually earns its keep.
- **Email expansion (`{first_name}` placeholders, branded HTML)** — per-project; v1 ships plain HTML strings.
- **Per-cron / per-email-template HIBP cache TTL tuning** — defaults are fine for v1.
- **Brute-force prevention beyond per-email rate limits** (e.g. global IP-based bans, fail2ban) — relies on Vercel's built-in DDoS protection + the existing global IP rate limiter in lib; per-project add Cloudflare or similar if needed.

</deferred>

---

*Phase: 01-auth-routes*
*Context gathered: 2026-05-07*
