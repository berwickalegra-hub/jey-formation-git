---
phase: 1
slug: auth-routes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.1.8 (Phase 0 wired) |
| **Config file** | `frontend/vitest.config.ts` (Phase 0) — Phase 1 adds `setupFiles` entry |
| **Setup file** | `frontend/vitest.setup.ts` (NEW — Phase 1, D-27) — sets `JWT_SECRET`, `ENCRYPTION_KEY`, and other test-env fixtures |
| **Mocking utilities** | `frontend/src/test-utils/prisma-mock.ts` (NEW), `frontend/src/test-utils/mock-cookies.ts` (NEW) — shared opt-in helpers |
| **Quick run command** | `pnpm --filter frontend exec vitest run <path>` |
| **Full suite command** | `pnpm test` (runs `vitest run` in frontend) |
| **Estimated runtime** | ~10–15 seconds (≈40+ tests across 9 routes + lib helpers) |

---

## Sampling Rate

- **After every task commit:** Run the test file changed
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green; `pnpm typecheck` and `pnpm lint` must also be green
- **Max feedback latency:** ≤ 15 seconds

---

## Per-Task Verification Map

> Filled by the planner once tasks are numbered. Each REQ-ID must map to at least one test or grep-verifiable acceptance criterion.

| REQ-ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| AUTH-01 | `POST /api/auth/signup` returns 201 with identical body for new + existing email; no cookies issued; `VerificationCode` row created for new users only | unit | `pnpm exec vitest run src/app/api/auth/signup/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-01 | Banned-password / HIBP-pwned signup is rejected with stable error code | unit | `pnpm exec vitest run src/lib/server/auth/banned-passwords.test.ts` + `src/lib/server/auth/hibp.test.ts` | ❌ W0 | ⬜ |
| AUTH-02 | `POST /api/auth/login` issues all three cookies; lockout triggers after threshold; CSRF cookie matches double-submit pattern | unit | `pnpm exec vitest run src/app/api/auth/login/route.test.ts` + `src/lib/server/auth/lockout.test.ts` | ❌ W0 | ⬜ |
| AUTH-03 | `POST /api/auth/verify-email` consumes `VerificationCode` (sets `usedAt`), bumps relevant flags, issues cookies | unit | `pnpm exec vitest run src/app/api/auth/verify-email/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-04 | `POST /api/auth/refresh` rotates access cookie via Redis SETNX single-flight lock; concurrent calls serialize | unit | `pnpm exec vitest run src/app/api/auth/refresh/route.test.ts` + `src/lib/server/auth/refresh-lock.test.ts` | ❌ W0 | ⬜ |
| AUTH-05 | `POST /api/auth/logout` clears all 3 auth cookies | unit | `pnpm exec vitest run src/app/api/auth/logout/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-06 | `GET /api/auth/me` returns `{ user: { sub, email } }` under `requireAuth`; 401 without auth | unit | `pnpm exec vitest run src/app/api/auth/me/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-07 | `POST /api/auth/forgot-password` returns 200 regardless of email existence; sends email only when user exists | unit | `pnpm exec vitest run src/app/api/auth/forgot-password/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-08 | `POST /api/auth/reset-password` accepts code+password; consumes code; bumps `tokenVersion`; rejects banned/pwned passwords | unit | `pnpm exec vitest run src/app/api/auth/reset-password/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-09 | `PUT /api/auth/change-password` requires CSRF + auth; bumps `tokenVersion`; old sessions fail next request | unit | `pnpm exec vitest run src/app/api/auth/change-password/route.test.ts` | ❌ W0 | ⬜ |
| AUTH-10 | Per-email rate limits return 429 after threshold for login (10/15m), signup (5/h), forgot (3/h), reset (5/15m), resend-verify (3/h), verify-email (5/15m) | unit | `pnpm exec vitest run src/app/api/auth/*/route.test.ts -t "rate limit"` | ❌ W0 | ⬜ |
| AUTH-10 | Failed-login lockout: 5 fails / 15 min lockout per email via Redis sliding-window counter | unit | `pnpm exec vitest run src/lib/server/auth/lockout.test.ts` | ❌ W0 | ⬜ |
| AUTH-09 | Banned-passwords helper rejects ~100 entries with `PASSWORD_BANNED`; allows safe passwords | unit | `pnpm exec vitest run src/lib/server/auth/banned-passwords.test.ts` | ❌ W0 | ⬜ |
| AUTH-09 | HIBP wrapper sends correct k-anonymity prefix; opts out when `PASSWORD_HIBP_CHECK !== '1'`; gracefully handles 5xx (allows password through with warning log) | unit | `pnpm exec vitest run src/lib/server/auth/hibp.test.ts` | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Threat refs:**
- T-1-01 (V2 Authentication) — credential validation timing-safe (dummy bcrypt on no-user)
- T-1-02 (V3 Session Management) — refresh single-flight + tokenVersion bump
- T-1-03 (V5 Input Validation) — Zod schemas + banned-password / HIBP gates
- T-1-04 (V8 Data Protection) — log redaction (no passwords/tokens leak via the new logger wrapper)
- T-1-05 (V14 Configuration) — env defaults baked into `.env.example`

Full threat model in PLAN.md `<threat_model>` blocks per plan.

---

## Wave 0 Requirements

- [ ] `frontend/vitest.setup.ts` — env fixtures (`JWT_SECRET`, `ENCRYPTION_KEY`, `COOKIE_PREFIX=app-test`, `UPSTASH_REDIS_REST_URL`/`TOKEN` to falsy values for memory fallback path)
- [ ] `frontend/vitest.config.ts` — add `test.setupFiles: ['./vitest.setup.ts']` (preserves Phase 0's `server-only` alias + `passWithNoTests`)
- [ ] `frontend/src/test-utils/prisma-mock.ts` — `mockDeep<PrismaClient>()` from `vitest-mock-extended` + `mockReset()` helper
- [ ] `frontend/src/test-utils/mock-cookies.ts` — `vi.mock('next/headers', ...)` factory exposing settable cookie store; opt-in per test
- [ ] `frontend/src/lib/server/auth/banned-passwords.ts` — `isBanned(password): boolean`, ~100-entry list (e.g. `password`, `qwerty`, `letmein`, `123456`, `admin123`, etc.)
- [ ] `frontend/src/lib/server/auth/banned-passwords.test.ts`
- [ ] `frontend/src/lib/server/auth/hibp.ts` — `isPwned(password): Promise<boolean>` with k-anonymity (env-gated; opt-in; safe-default-allow on network failure with warning log)
- [ ] `frontend/src/lib/server/auth/hibp.test.ts` — mock fetch, assert request shape, response parsing, env-gate behavior
- [ ] `frontend/src/lib/server/auth/lockout.ts` — `recordFailedLogin(email): Promise<{ locked: boolean, attemptsRemaining: number }>`, `clearFailedLogins(email)`, Redis-backed sliding-window counter with memory fallback (logger.warn on no-Redis)
- [ ] `frontend/src/lib/server/auth/lockout.test.ts`
- [ ] `frontend/src/lib/server/auth/refresh-lock.ts` — Redis SETNX-based single-flight; Lua compare-and-delete for safe release
- [ ] `frontend/src/lib/server/auth/refresh-lock.test.ts`
- [ ] `frontend/src/lib/server/auth/dummy-bcrypt.ts` — `runDummyVerify(password)` constant-time compute against fixed dummy hash for enumeration resistance
- [ ] `frontend/src/lib/server/auth/dummy-bcrypt.test.ts`
- [ ] `frontend/src/lib/server/auth/email-templates.ts` — `verificationEmail({ code, email })`, `resetPasswordEmail({ code, email })` factories returning `{ subject, html, text }` (English defaults per CONTEXT.md D-15)
- [ ] `frontend/src/lib/server/auth/email-templates.test.ts`
- [ ] `frontend/src/lib/server/outbox/types.ts` — extend union with `email.verification_code` and `email.password_reset` events
- [ ] Add devDep `vitest-mock-extended@^4.0.0`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end login → me → logout flow against running dev server | AUTH-02 + AUTH-06 + AUTH-05 | Hard to assert real cookies via Vitest unit tests; `fetch` smoke is the natural place | Run `pnpm --filter frontend dev`. POST `/api/auth/signup`, then `/api/auth/verify-email` with the dev-logged code, then `/api/auth/me` confirms 200, then `/api/auth/logout` clears cookies. |
| Real Sentry capture on auth-handler throw (uses Phase 0 wiring) | OPS-03 (Phase 0 dependency) | Requires SENTRY_DSN | Throw inside any auth handler temporarily, hit endpoint, confirm in Sentry UI. |
| HIBP API live call when `PASSWORD_HIBP_CHECK=1` | AUTH-09 | Network call to external service; unit test mocks fetch | Set env, run `curl -X POST http://localhost:3000/api/auth/signup -d '{"email":"x@y.com","password":"password123"}'` — should reject with `PASSWORD_PWNED`. |

---

## Validation Architecture compliance

This file maps every Phase 1 REQ-ID (AUTH-01 through AUTH-10) to at least one automated assertion. Manual verifications are limited to operational/network-dependent checks. No requirement is left without coverage.

When the planner numbers tasks, replace task IDs in the Per-Task Verification Map with the actual task IDs and update Wave/Plan columns. Set `nyquist_compliant: true` once all tests are written and `wave_0_complete: true` once Wave 0 lib helpers + scaffolding land.
