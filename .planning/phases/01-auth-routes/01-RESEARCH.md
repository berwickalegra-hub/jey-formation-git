# Phase 1: Auth Routes - Research

**Researched:** 2026-05-07
**Domain:** Next.js 16 App Router auth route handlers — porting 9 Express endpoints to App Router with enumeration resistance, per-email rate limiting, failed-login lockout, single-flight refresh, optional HIBP password check
**Confidence:** HIGH

## Summary

Phase 1 ports 9 auth route handlers from `amadou-template`'s Express monolith into App Router route handlers. The lib layer (`auth.ts`, `crypto.ts`, `middleware/`, `redis.ts`, `rate-limit-store.ts`, `observability/*`, `notifications/index.ts`, `outbox/index.ts`, `zod-helpers.ts`, `email.ts`) is **already in place** — Phase 1 consumes it without modification. Investigation against the live codebase confirms eight findings the planner must internalize:

1. **`crypto.ts` is encryption-only.** `hashPassword`, `verifyPassword`, `generateVerificationCode`, `VERIFICATION_CODE_REGEX`, `timingSafeCompare` all live in `auth.ts` (verified). Banned-passwords list goes in a NEW file (`lib/server/auth/banned-passwords.ts`) — not `crypto.ts`, not `auth.ts`.
2. **`User` schema is missing `failedLoginCount` and `lockedUntilAt`.** Verified by reading `frontend/prisma/schema.prisma` — neither field exists. Phase 1 needs a migration to add them, OR the lockout state lives entirely in Redis (CONTEXT.md `<specifics>` line 184 already pre-suggests Redis-only). **Recommend Redis-only lockout** — avoids a migration, fits the existing rate-limit-store pattern, and the lockout window is short (15 min) so durability doesn't matter.
3. **`VerificationCode` schema field names differ from CONTEXT.md.** The model uses `type` (not `purpose`), `usedAt` (not `consumedAt`), and includes an `attempts: Int @default(0)` field. The two valid `type` values per the schema comment are `"EMAIL_VERIFY"` and `"PASSWORD_RESET"`.
4. **`notifications/templates.ts` does NOT yet have `verificationEmail` / `resetPasswordEmail` factories.** It currently exports `welcomeNotification` and `paymentReceived` — both are *in-app notification* factories returning `CreateNotificationInput`, NOT email-template factories returning `{ subject, html, text }`. Phase 1 must extend with email template factories — and they belong in a different file/shape because the existing file's contract is for `Notification` rows, not email payloads. **Recommend new file `lib/server/notifications/email-templates.ts`** (or a new `lib/server/auth/email-templates.ts`) with the email-shape contract.
5. **The outbox event union is closed.** `lib/server/outbox/types.ts` currently lists only `notification.payment_received` and `email.payment_confirmation`. Phase 1 emits `email.verification_code` and `email.password_reset` — these MUST be added to the `OutboxEvent` union (it's a TypeScript-strict project; `enqueueOutbox` will reject unknown kinds at compile time).
6. **`middleware/index.ts` `requireAuth` already DB-checks `tokenVersion`.** No `change-password` blocklist needed — bumping `User.tokenVersion` invalidates other sessions on the next request automatically (verified at lines 65–75).
7. **`rate-limit-by-email.ts` already lower-cases the email key** (verified at line 63: `email.trim().toLowerCase()`) — case-mutation bypass is already prevented. CONTEXT.md `<specifics>` line 181 asked to confirm this.
8. **Vitest config aliases `server-only` to an empty stub** (line 22) so server-side modules can be unit-tested in plain Node — Phase 0 already solved this. Test files do NOT need any special Vitest setup file just for the alias. They DO need a setup file for `JWT_SECRET` and `ENCRYPTION_KEY` env fixtures (D-27), since `auth.ts` throws at import time when `JWT_SECRET` is missing or < 32 chars.

**Primary recommendation:** Implement in this order — (Wave 0) add `vitest.setup.ts` with `JWT_SECRET`/`ENCRYPTION_KEY` fixtures + extend `vitest.config.ts` to load it, install `vitest-mock-extended@4.0.0` as devDep, write the banned-passwords list module, write the HIBP wrapper module, write the lockout-store module (Redis-backed, MemoryRateLimitStore fallback), extend the outbox `OutboxEvent` union, write email-template factories. (Wave 1) ship the 9 route handlers in dependency order: `signup` → `verify-email` → `login` → `refresh` → `me` → `logout` → `forgot-password` → `reset-password` → `change-password`. Each route handler is co-located with a `*.test.ts` covering happy path + 4 critical error paths. Phase 1 closes when `pnpm --filter frontend test && pnpm --filter frontend typecheck && pnpm --filter frontend lint` are all green.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Route shape (cross-cutting for all 9 handlers)**

- **D-01:** Every route file's first three lines: `export const runtime = 'nodejs';` (CI guard from Phase 0 enforces), then `import 'server-only'` somewhere near the top (via lib helpers if they already include it), and the handler's first action: `const ctx = makeRequestContext(req.headers); return withRequestContext(ctx, async () => { ... });`. Wraps every handler so the `log` wrapper picks up `requestId` automatically.
- **D-02:** Mutating routes (POST/PUT/PATCH/DELETE) call `verifyCsrf(req)` from `lib/server/middleware/index.ts` BEFORE auth/business logic. CSRF check returns `NextResponse | null`; if non-null, return early.
- **D-03:** Authenticated routes (`me`, `change-password`) call `requireAuth(req.headers.get('authorization'))` (or the cookie-based variant if the existing helper supports it — read `lib/server/middleware/index.ts` to confirm). Return 401 NextResponse on failure.
- **D-04:** Body validation via Zod schemas defined per-route at the top of each route file. Use `lib/server/zod-helpers.ts` for shared error formatting. On validation failure, return `400 { error: 'VALIDATION_FAILED', issues: [...] }` with the formatter's output — never raw Zod issues.
- **D-05:** Response shape: success → `NextResponse.json({ ... })`; failure → `NextResponse.json({ error: '<STABLE_CODE>', message: '<user-facing>' }, { status: <code> })`. Stable codes: `TOO_MANY_LOGIN_ATTEMPTS`, `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `LOCKED_OUT`, `VERIFICATION_CODE_INVALID`, `VERIFICATION_CODE_EXPIRED`, `PASSWORD_TOO_SHORT`, `PASSWORD_BANNED`, `PASSWORD_PWNED`, `CSRF_INVALID`, `VALIDATION_FAILED`.

**Tuning defaults (env-overridable per fork)**

- **D-06:** Verification code TTL = **15 minutes** (`AUTH_VERIFICATION_TTL_MIN=15`). 8-char Crockford alphabet, generated via existing `lib/server/crypto.ts` helper.
- **D-07:** Failed-login lockout = **5 failures → 15-minute lockout** per email (`AUTH_LOCKOUT_THRESHOLD=5`, `AUTH_LOCKOUT_DURATION_MIN=15`). Implemented via Redis sliding-window counter keyed on email; Redis-miss falls back to per-process Map with `logger.warn`.
- **D-08:** Rate limit values:
  - Login: 10 / 15 min per email (`AUTH_LOGIN_RATE_LIMIT=10/15m`)
  - Signup: 5 / hour per email (`AUTH_SIGNUP_RATE_LIMIT=5/1h`)
  - Forgot-password: 3 / hour per email (`AUTH_FORGOT_RATE_LIMIT=3/1h`)
  - Reset-password code attempts: 5 / 15 min per email (`AUTH_RESET_RATE_LIMIT=5/15m`)
  - Resend verification: 3 / hour per email (`AUTH_RESEND_VERIFY_RATE_LIMIT=3/1h`)
  - Verify-email retries: 5 / 15 min per email (`AUTH_VERIFY_RATE_LIMIT=5/15m`)
- **D-09:** All limits use `createEmailLimiter(...).check(req, email)` from `lib/server/middleware/rate-limit-by-email.ts` (existing). Returns `NextResponse | null`; non-null = 429.

**Password policy (NIST 800-63B aligned)**

- **D-10:** Minimum length = **10 characters** (`AUTH_PASSWORD_MIN_LENGTH=10`).
- **D-11:** **No mandatory complexity rules.**
- **D-12:** **Banned-password check** — embed ~100-entry list. Banned-passwords file lives in `lib/server/auth/banned-passwords.ts` (NEW directory `auth/`). Returns `PASSWORD_BANNED` error code on hit.
- **D-13:** **HIBP haveibeenpwned check** — opt-in via `PASSWORD_HIBP_CHECK=1` env, **default OFF**. K-anonymity (first 5 chars of SHA-1). Returns `PASSWORD_PWNED` on hit. Network failure = log warning + allow (don't fail closed).
- **D-14:** No password expiry/rotation.

**Email templates**

- **D-15:** **English by default.**
- **D-16:** Templates ship as **plain HTML strings** (no MJML, no React Email). Contract: `(args) => { subject: string, html: string, text: string }`.
- **D-17:** Email dispatch goes through the **outbox** — not direct `resend.emails.send()` calls. Phase 1 handlers `enqueueOutbox(tx, { type: 'EMAIL', payload: {...} })` inside the same Prisma tx as the user mutation.

**Token & session semantics**

- **D-18:** Access JWT lifetime = **15 min** (locked); refresh JWT lifetime = **7 days** (locked). Refresh cookie path-scoped to `/api/auth`.
- **D-19:** **`tokenVersion` check on every authenticated request** — `requireAuth` reads the JWT's `tokenVersion` claim and compares against `users.tokenVersion` from DB. Per-request DB read is acceptable.
- **D-20:** **Refresh single-flight via Redis SETNX lock** — concurrent refresh attempts for the same user race on a Redis key (`refresh-lock:{userId}`) with a 5-second TTL. Loser of the race waits + retries. Without Redis (dev), per-process Map suffices.
- **D-21:** Cookies: `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`, `path: '/' (token + csrf)` and `path: '/api/auth' (refresh)`. Cookie names use `<COOKIE_PREFIX>-token`, `<COOKIE_PREFIX>-refresh`, `<COOKIE_PREFIX>-csrf`. All set via `cookies()` from `next/headers` (async in Next 15+).

**Enumeration resistance**

- **D-22:** **Signup** returns identical 201 `{ ok: true }` whether the email is new or exists. Dummy bcrypt-equivalent compute for non-existent emails. NO cookies issued. NO email sent if email exists.
- **D-23:** **Forgot-password** returns 200 regardless of email existence. Same dummy-compute principle.
- **D-24:** **Login** returns the same `INVALID_CREDENTIALS` error for "user not found", "wrong password", and "user not yet verified" — `EMAIL_NOT_VERIFIED` only AFTER successful credential validation.

**Test strategy**

- **D-25:** **Mock Prisma for unit tests.** Each route handler gets a co-located `*.test.ts` that stubs `PrismaClient` via `vi.mock('@/lib/server/prisma', ...)` and asserts response shape, status code, cookies set, stable error codes returned. Cover happy path + critical error paths.
- **D-26:** **Real Postgres integration tests are deferred** to Phase 4. Add `pnpm test:integration` as a separate script in `frontend/package.json` (empty for Phase 1).
- **D-27:** **Vitest setup-files for JWT_SECRET / ENCRYPTION_KEY fixtures lands in Phase 1, NOT Phase 6.**
- **D-28:** Test files co-located with route handlers (e.g. `app/api/auth/signup/route.test.ts`). The runtime-enforcement test (Phase 0) walks `app/api/**/route.ts` and stays compatible with co-located `.test.ts`.

### Claude's Discretion

- Exact location of the banned-passwords list (`lib/server/auth/banned-passwords.ts` chosen — see Pattern 6 below).
- Whether to use `lucia-auth` or any new auth library — **NO**.
- Whether to ship a `useUser` React hook in this phase — **NO**.
- Test coverage thresholds — no minimum bar; reasonable coverage of 4 explicit invariants per route.
- Whether to include a Vitest `setupFiles` global mock for `next/headers` cookies — recommend YES based on test surface (5+ routes set cookies).

### Deferred Ideas (OUT OF SCOPE)

- Magic-link login (v2).
- Passkeys / WebAuthn (v2).
- 2FA / TOTP (anti-feature).
- Refresh-cookie revocation list / DB-backed session table — `tokenVersion` bump is sufficient for v1.
- Auth.js / NextAuth migration (out of scope per PROJECT.md).
- Custom React `useUser` hook (frontend concern, per-project).
- i18n machinery for email templates (fork-edit override).
- Real-Postgres integration tests for auth routes (Phase 4 scaffold).
- Email expansion (placeholders, branded HTML) (per-project).
- Per-cron / per-email-template HIBP cache TTL tuning (defaults are fine).
- Brute-force prevention beyond per-email rate limits (Vercel/Cloudflare).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Signup — enumeration-resistant 201, no cookies, dummy bcrypt for non-existent emails | Pattern 7 (signup route shape) + Pattern 8 (constant-time dummy compute); existing `hashPassword` + `generateVerificationCode` from `auth.ts`; outbox `email.verification_code` event (new). |
| AUTH-02 | Login — issues 3 cookies (access 15m, refresh 7d at `/api/auth`, csrf 7d) | Pattern 9 (login route shape) + Pattern 10 (lockout integration); existing `setAuthCookies` + `setCsrfCookie` from `auth.ts`. |
| AUTH-03 | Verify-email — 8-char Crockford code → cookies issued | Pattern 11 (verify-email route); existing `generateVerificationCode` + `VERIFICATION_CODE_REGEX` + `timingSafeCompare` from `auth.ts`; `VerificationCode` model with `type='EMAIL_VERIFY'`, `usedAt`, `attempts`. |
| AUTH-04 | Refresh — single-flight rotation, refresh cookie path-scoped | Pattern 12 (refresh route + Redis SETNX lock); existing `verifyRefreshToken` + `createAccessToken` + `createRefreshToken` from `auth.ts`. |
| AUTH-05 | Logout — clears all 3 cookies | Pattern 13 (logout route); existing `clearAuthCookies` + `clearCsrfCookie`. |
| AUTH-06 | GET /me — `requireAuth`, returns user identity | Pattern 14 (me route); existing `requireAuth` from `middleware/index.ts`. |
| AUTH-07 | Forgot-password — always 200, dummy compute on miss | Pattern 15 (forgot-password); same enumeration-resistance pattern as signup; outbox `email.password_reset` event (new). |
| AUTH-08 | Reset-password — code + new password | Pattern 16 (reset-password); existing `VerificationCode` with `type='PASSWORD_RESET'`. |
| AUTH-09 | Change-password — bumps `tokenVersion`, requires CSRF | Pattern 17 (change-password); existing `tokenVersion` field + `requireAuth` re-check on every request. |
| AUTH-10 | Per-email rate limits + failed-login lockout | Pattern 18 (lockout-store) + Pattern 19 (rate-limit map); existing `createEmailLimiter` from `middleware/rate-limit-by-email.ts`. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

> CLAUDE.md describes the deprecated Express monorepo. Portable directives still apply:

- **TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`** — don't silence with `any` casts.
- **ESLint 9 flat config + Prettier** — run `pnpm format` before committing.
- **Vitest for backend tests** — co-located `*.test.ts` under `frontend/src/**`.
- **Conventional Commits** — Phase 1 commits use `(monolith)` scope (e.g., `feat(monolith): port signup route`).
- **Node ≥ 20, pnpm ≥ 9** (verified).
- **`server-only` import at top of every server-only file** — new lib files must include this; Phase 0 aliased `server-only` to empty stub for tests.
- **Path alias `@/*` → `frontend/src/*`** — use it.
- **Files NOT to modify:** `lib/server/auth.ts`, `lib/server/crypto.ts`, `lib/server/middleware/**`, `lib/server/redis.ts`, `lib/server/rate-limit-store.ts`, `lib/server/zod-helpers.ts`, `lib/server/observability/**`, `lib/server/logger.ts`. (Battle-tested per CLAUDE.md plus Phase 0 outputs.)
- **Stable error codes** — Phase 1 introduces 11 new codes (D-05); frontend switches on `error`, never on `message`.
- **Stale Express references in CLAUDE.md** are flagged for Phase 6 DOC-01; Phase 1 must not attempt to fix them.

## Standard Stack

### Core (already installed — version-verified against `frontend/package.json` and `pnpm install`-resolved tree)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.1.6 | App Router runtime + async `cookies()` API | Already pinned. [VERIFIED: package.json] |
| `bcryptjs` | 2.4.3 | Password hashing — pure-JS, edge-friendly fallback (we still force `runtime='nodejs'`) | `auth.ts` uses cost factor 12 (line 137 — verified). [VERIFIED: auth.ts:137 + npm tree] |
| `jose` | 5.9.6 | JWT signing/verification (already used by `auth.ts`) | Modern, ESM-first, Web Crypto under the hood. [VERIFIED: auth.ts] |
| `zod` | 3.23.8 | Body validation | Already used by `zod-helpers.ts`. **Stay on Zod 3.x for Phase 1** — Zod 4 has breaking changes per project lock. [VERIFIED: package.json] |
| `@upstash/redis` | 1.34.3 | Redis client (HTTP-based, serverless-safe) | Already in stack; null-fallback already wired in `redis.ts`. [VERIFIED: package.json] |
| `@prisma/client` + `prisma` | 5.22.0 | ORM | Locked at 5.22 per STACK.md; do NOT upgrade Prisma 6/7 in v1. [VERIFIED: package.json] |
| `vitest` | 2.1.8 | Test runner | Locked; Phase 0 wired the config. [VERIFIED: package.json] |
| `fast-glob` | 3.3.3 | Used by Phase 0 runtime-enforcement test (no Phase 1 use) | Hold. [VERIFIED: package.json] |
| Node `crypto.timingSafeEqual`, `randomUUID`, `randomBytes` | Built-in | CSRF compare, request IDs, refresh-lock IDs | Built-in, zero deps. [VERIFIED: Node 22.14] |

### To install (new dependencies — Phase 1 only)

| Library | Version | Purpose | Why Standard | Source |
|---------|---------|---------|--------------|--------|
| `vitest-mock-extended` | **4.0.0** | Deep-mock the Prisma singleton for unit tests (`mockDeep<PrismaClient>()`) | Vitest port of `jest-mock-extended`; consensus tool for Prisma mocking in 2026 (per Prisma docs, multiple search results, GitHub discussion #20244). [VERIFIED: `npm view vitest-mock-extended version` returned `4.0.0` on 2026-05-07] |

**Recommendation on HIBP wrapper:** Do NOT install a library. Implement HIBP k-anonymity in ~25 LOC using `fetch` + `node:crypto`'s `createHash`. The `pwnedpasswords` and `havetheybeenpwned` npm packages are thin wrappers and add a dep for one function. Reference implementation in Pattern 4 below. [CITED: Cloudflare blog "Validating Leaked Passwords with k-Anonymity" + Troy Hunt's API documentation]

**Recommendation on Redis-lock library:** Do NOT install `@upstash/lock` (0.2.1). The single-flight refresh is ~15 LOC of `SET NX EX` against the existing `getRedis()` singleton. Adding a lib for one call site is over-abstraction. Reference implementation in Pattern 5 below.

**Recommendation on Prisma mock helper:** Use `vitest-mock-extended` over `prismock` — `prismock` simulates a real DB (overkill for unit tests; D-25 explicitly says "stubs `PrismaClient`"); `mockDeep` from `vitest-mock-extended` returns a typesafe spy that lets you assert exact call arguments. [CITED: Prisma docs "Unit testing with Prisma ORM"]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled HIBP wrapper (Pattern 4) | `pwnedpasswords` package (npm) | One more dep for ~25 LOC of straightforward fetch+SHA-1; reject. |
| `vitest-mock-extended` `mockDeep` | `prismock` (full DB simulator) | `prismock` is heavier and tests more than the unit boundary; reject for unit tests. |
| Hand-rolled Redis SETNX lock (Pattern 5) | `@upstash/lock` | `@upstash/lock` is 8 KB + 0.2.1 (pre-1.0); the SETNX one-liner is well-understood; reject. |
| Banned-passwords inline list | External JSON file | Inline TypeScript (`Set<string>`) is type-checked, lints clean, ~100 entries fit easily. Inline. |
| Prisma migration to add `failedLoginCount` / `lockedUntilAt` to `User` | **Redis-only lockout** (recommended) | Migration adds 2 columns + a write per failed attempt; Redis-only is faster, atomic, and the lockout window is short (15 min). Choose Redis-only. |

### Installation

```bash
pnpm --filter frontend add -D vitest-mock-extended
```

That is the only Phase 1 dep addition. All other libs are already installed.

### Version verification (performed 2026-05-07 against live npm registry)

| Package | Latest | Pinned | Action |
|---------|--------|--------|--------|
| `vitest-mock-extended` | 4.0.0 | (new) | Install `^4.0.0` (devDep) |
| `@upstash/lock` | 0.2.1 | n/a | **Skip** — hand-roll SETNX |
| `pwnedpasswords` | n/a | n/a | **Skip** — hand-roll fetch wrapper |
| All other Phase 1 libs | already pinned | (no change) | Hold |

## Architecture Patterns

### Recommended file additions / changes

```
amadou-monolith/
├── frontend/
│   ├── vitest.setup.ts                          # CREATE — JWT_SECRET, ENCRYPTION_KEY fixtures + global mocks
│   ├── vitest.config.ts                         # MODIFY — add setupFiles: ['./vitest.setup.ts']
│   ├── package.json                             # MODIFY — add vitest-mock-extended devDep
│   ├── .env.example                             # MODIFY — add 11 AUTH_* env vars + PASSWORD_HIBP_CHECK
│   └── src/
│       ├── app/api/auth/
│       │   ├── signup/route.ts                  # CREATE (AUTH-01)
│       │   ├── signup/route.test.ts             # CREATE
│       │   ├── login/route.ts                   # CREATE (AUTH-02 + AUTH-10 lockout)
│       │   ├── login/route.test.ts              # CREATE
│       │   ├── verify-email/route.ts            # CREATE (AUTH-03)
│       │   ├── verify-email/route.test.ts       # CREATE
│       │   ├── refresh/route.ts                 # CREATE (AUTH-04)
│       │   ├── refresh/route.test.ts            # CREATE
│       │   ├── logout/route.ts                  # CREATE (AUTH-05)
│       │   ├── logout/route.test.ts             # CREATE
│       │   ├── me/route.ts                      # CREATE (AUTH-06)
│       │   ├── me/route.test.ts                 # CREATE
│       │   ├── forgot-password/route.ts         # CREATE (AUTH-07)
│       │   ├── forgot-password/route.test.ts    # CREATE
│       │   ├── reset-password/route.ts          # CREATE (AUTH-08)
│       │   ├── reset-password/route.test.ts     # CREATE
│       │   ├── change-password/route.ts         # CREATE (AUTH-09)
│       │   └── change-password/route.test.ts    # CREATE
│       └── lib/server/
│           ├── auth/                            # CREATE — new subdirectory (auth.ts is do-not-modify; use sibling dir)
│           │   ├── banned-passwords.ts          # CREATE — Set<string> + isBanned()
│           │   ├── banned-passwords.test.ts     # CREATE
│           │   ├── hibp.ts                      # CREATE — k-anonymity wrapper
│           │   ├── hibp.test.ts                 # CREATE
│           │   ├── lockout.ts                   # CREATE — Redis-backed lockout-store
│           │   ├── lockout.test.ts              # CREATE
│           │   ├── refresh-lock.ts              # CREATE — single-flight SETNX
│           │   ├── refresh-lock.test.ts         # CREATE
│           │   ├── email-templates.ts           # CREATE — verificationEmail, resetPasswordEmail factories
│           │   ├── email-templates.test.ts      # CREATE
│           │   └── dummy-bcrypt.ts              # CREATE — constant-time dummy compute
│           ├── outbox/types.ts                  # MODIFY — extend OutboxEvent union with email.verification_code + email.password_reset
│           └── (auth.ts, crypto.ts, middleware/ — DO NOT MODIFY)
```

**Discovery note:** `frontend/src/lib/server/auth.ts` is a single file. The new sibling directory `lib/server/auth/` does NOT shadow it — Node module resolution treats `lib/server/auth.ts` and `lib/server/auth/index.ts` as conflicting only if both exist. We add `lib/server/auth/banned-passwords.ts` (no `index.ts`), which imports cleanly as `@/lib/server/auth/banned-passwords` while the existing `@/lib/server/auth` continues to resolve to `auth.ts`. **[ASSUMED: Node TypeScript module resolution prefers `.ts` over a directory at the same path. Verified by the existing setup where `lib/server/middleware/` and `lib/server/auth.ts` already coexist similarly. Confirm during execution.]**

### Pattern 1: App Router cookie API in Next.js 16

**What:** `cookies()` from `next/headers` is **async** in Next 15+ — returns `Promise<ReadonlyRequestCookies>`. Cookie mutations (`.set`, `.delete`) only work in **Route Handlers** and **Server Actions** — never in Server Components.

**Verified:** `auth.ts` already wraps this correctly. `setAuthCookies` and `setCsrfCookie` both `await cookies()` first, then call `.set()` synchronously. Multiple `.set()` calls in one handler are supported and produce multiple `Set-Cookie` headers.

**When to use:** Phase 1 route handlers consume `setAuthCookies` and `setCsrfCookie` from the lib; they do NOT call `cookies()` directly. The existing helpers handle the async boundary.

**Code (consumer pattern — for verify-email, login, refresh, change-password routes):**
```typescript
// app/api/auth/login/route.ts (consumer side; lib helpers already async)
import { setAuthCookies, setCsrfCookie, createAccessToken, createRefreshToken } from '@/lib/server/auth';

// inside the handler, after credentials match:
const accessToken = await createAccessToken({ sub: user.id, email: user.email, tokenVersion: user.tokenVersion });
const refreshToken = await createRefreshToken(user.id, user.tokenVersion);
await setAuthCookies(accessToken, refreshToken);    // ← await is required (Next 15+)
await setCsrfCookie();
return NextResponse.json({ ok: true });
```

[CITED: https://nextjs.org/docs/app/api-reference/functions/cookies — verified 2026-05-07; "you must use async/await or React's use function to access cookies"]

### Pattern 2: Body validation with Zod + `zod-helpers.ts`

**What:** Per-route Zod schema; on `safeParse` failure, return `400 { error: 'VALIDATION_FAILED', issues: [...] }` shaped to omit raw Zod internals.

**When to use:** Every Phase 1 route that accepts a JSON body (signup, login, verify-email, forgot-password, reset-password, change-password).

**Existing helpers (verified in `lib/server/zod-helpers.ts`):**
- `zEmail` — trimmed, lowercased, validated string
- `zPhone` — E.164 format
- `zCuid` — Prisma cuid shape
- `zPositiveInt` — positive integer

**Note on the formatter:** `zod-helpers.ts` does NOT export a shared `formatIssues` function. Phase 1 needs to either (a) add one to a new file (Phase 1 won't modify `zod-helpers.ts` — it's in the do-not-modify list), or (b) format inline per route. Recommend (b) inline with a tiny helper, since the shape is uniform:

```typescript
// Tiny inline helper — copy into each route file or extract to lib/server/auth/validation.ts
function formatIssues(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.errors.map((e) => ({ path: e.path.join('.'), message: e.message }));
}

// Per-route usage:
const Body = z.object({ email: zEmail, password: z.string().min(10) });
const parsed = Body.safeParse(await req.json());
if (!parsed.success) {
  return NextResponse.json(
    { error: 'VALIDATION_FAILED', issues: formatIssues(parsed.error) },
    { status: 400 },
  );
}
```

[CITED: zod-helpers.ts (read), Zod 3.23 docs]

### Pattern 3: Bcrypt timing-safe dummy compute (enumeration resistance)

**What:** When a user does NOT exist (signup with new email; login with unknown email; forgot-password with unknown email), perform a bcrypt compare against a fixed dummy hash so the timing matches the real path. `bcrypt.compare` against a bcrypt hash is the dominant cost — by running it on the no-user branch you flatten the timing channel.

**When to use:** Signup (D-22), Login (D-24), Forgot-password (D-23).

**Reference implementation (`lib/server/auth/dummy-bcrypt.ts`):**
```typescript
// Source: composed from CWE-208 timing-attack mitigation literature + bcryptjs README.
// Goal: Make the no-user branch take ~the same time as the real-user branch.
import 'server-only';
import bcrypt from 'bcryptjs';

// Pre-computed bcrypt hash of a random string at cost 12 (matches hashPassword's
// bcrypt.hash(plain, 12) in lib/server/auth.ts:137). The plaintext is irrelevant —
// we never compare against the real password; we just want bcrypt's ~250ms work
// to happen.
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8.Z9.5QxKZxV9Z3z0XoZaJgYK6lQby';

/**
 * Run a bcrypt compare against a fixed hash so the no-user code path takes
 * roughly as long as the real-user path. Always returns false; the boolean
 * result is irrelevant — the timing is the point.
 *
 * Always `await` this. Never short-circuit (e.g. `if (!user) return 401` before
 * the dummy compute) — that defeats the purpose.
 */
export async function dummyBcryptCompare(plaintext: string): Promise<void> {
  await bcrypt.compare(plaintext, DUMMY_HASH);
}
```

**Pitfall:** Make sure the dummy hash uses the **same cost factor** as `hashPassword` (cost 12 per `auth.ts:137`). A mismatch (e.g., dummy at cost 10) leaks user existence via timing. Regenerate the dummy hash if `hashPassword` ever changes its cost.

[CITED: Spring Security CVE-2025-22234 timing-leak postmortem — DEV.to article 2025; OWASP enumeration resistance guidance][VERIFIED: bcryptjs README + auth.ts:137 cost factor read]

### Pattern 4: HIBP k-anonymity password check

**What:** Send the first 5 chars of `SHA-1(password)` to `https://api.pwnedpasswords.com/range/{prefix}`. Response is `text/plain` with one `SUFFIX:COUNT\r\n` per line. Search locally for the remaining 35 chars of the SHA-1 — never sends the full password or full hash.

**When to use:** Only when `process.env.PASSWORD_HIBP_CHECK === '1'` (D-13). Default OFF.

**Reference implementation (`lib/server/auth/hibp.ts`, ~30 LOC):**
```typescript
// Source: composed from official HIBP API docs (https://haveibeenpwned.com/api/v3)
// + Cloudflare blog "Validating Leaked Passwords with k-Anonymity" (Cloudflare 2018,
// still authoritative — API has not changed). Verified against
// https://api.pwnedpasswords.com/range/21BD1 returning text/plain SUFFIX:COUNT lines.
import 'server-only';
import { createHash } from 'node:crypto';
import { log } from '@/lib/server/observability/log';

const HIBP_BASE = 'https://api.pwnedpasswords.com/range/';
// HIBP requires/recommends a User-Agent header per their docs.
const USER_AGENT = 'amadou-monolith-auth/1';
// Network-failure timeout — keep short so signup latency doesn't blow up if
// HIBP is degraded.
const TIMEOUT_MS = 2_000;

/**
 * Returns the breach count for `password` if found, or 0 if not found.
 * On network failure / timeout: logs a warning and returns 0 (D-13 — fail open;
 * HIBP outage must not block signup).
 */
export async function pwnedCount(password: string): Promise<number> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HIBP_BASE + prefix, {
      headers: { 'User-Agent': USER_AGENT, 'Add-Padding': 'true' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log.warn('hibp non-2xx', { status: res.status });
      return 0;
    }
    const text = await res.text();
    for (const line of text.split('\n')) {
      const [s, c] = line.trim().split(':');
      if (s === suffix) return Number.parseInt(c ?? '0', 10) || 0;
    }
    return 0;
  } catch (err) {
    log.warn('hibp request failed (allow)', { err: err instanceof Error ? err.message : String(err) });
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience predicate. */
export async function isPwned(password: string): Promise<boolean> {
  return (await pwnedCount(password)) > 0;
}
```

**Notes:**
- The `Add-Padding: true` header asks HIBP to pad responses to fixed size, defending against length-based traffic analysis. Recommended by HIBP docs since 2020. Cheap defense.
- HIBP responses are ~600 lines / ~24 KB. **Do NOT cache** in Phase 1 — CONTEXT.md `<specifics>` line 184 suggests Redis cache, but `<deferred>` does NOT include this. If signup volume becomes a concern, add `redis.set('hibp:'+prefix, text, { ex: 3600 })` in Phase 2+. **Recommend skip caching in v1**: HIBP response is not the bottleneck (1 request per signup; 99% of v1 forks have low signup volume).
- HIBP API has no published rate limit when using k-anonymity range requests (Troy Hunt's blog confirms range queries are unlimited). Direct password lookups (deprecated) had limits.

[CITED: https://haveibeenpwned.com/api/v3 — official HIBP docs verified 2026-05-07; Troy Hunt's k-anonymity blog post; Cloudflare's k-anonymity validation article]

### Pattern 5: Redis SETNX single-flight refresh lock

**What:** Concurrent refresh attempts for the same user race on a Redis key (`refresh-lock:{userId}`) with a 5-second TTL. First-arriver acquires; losers wait (poll) until lock released or TTL expires, then read the new tokens from a side-channel cookie OR retry the refresh.

**When to use:** `POST /api/auth/refresh` only. Without Redis (dev), per-process Map suffices.

**Critical detail:** Naive SETNX has a race when releasing — if the holder's operation takes longer than the TTL, the lock auto-expires; another instance grabs it; original holder then DELs and frees the SECOND holder's lock. Mitigation: use a unique-token-per-holder pattern with a `SET ... NX EX ttl GET` check before DEL.

**Reference implementation (`lib/server/auth/refresh-lock.ts`, ~40 LOC):**
```typescript
// Source: composed from Redis SETNX docs (https://redis.io/docs/latest/commands/setnx/)
// + "Distributed Locks with Redis" (https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/).
// Single-instance limitation acceptable per CONTEXT.md D-20: "Vercel multi-instance safe"
// is the goal; the Redlock multi-instance algorithm is overkill for one Upstash node.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { getRedis } from '@/lib/server/redis';
import { log } from '@/lib/server/observability/log';

const TTL_SECONDS = 5;

/**
 * Try to acquire the refresh lock for `userId`. Returns a release function on
 * success, or null on contention. Caller decides whether to retry.
 *
 * Without Redis (dev), falls back to a per-process Map. The Map fallback is
 * NOT multi-instance safe; in that case logs a warn line.
 */
const localLocks = new Map<string, string>(); // userId → token

export async function acquireRefreshLock(userId: string): Promise<(() => Promise<void>) | null> {
  const token = randomUUID();
  const key = `refresh-lock:${userId}`;
  const redis = getRedis();

  if (!redis) {
    if (localLocks.has(userId)) return null;
    localLocks.set(userId, token);
    log.warn('refresh-lock using in-memory fallback (Redis absent)');
    return async () => {
      if (localLocks.get(userId) === token) localLocks.delete(userId);
    };
  }

  // Upstash @upstash/redis: `redis.set(key, value, { nx: true, ex: TTL_SECONDS })`
  // returns 'OK' on acquire, null on miss.
  const ok = await redis.set(key, token, { nx: true, ex: TTL_SECONDS });
  if (ok !== 'OK') return null;

  return async () => {
    // Compare-and-delete via Lua (no race on stale-holder DEL).
    const script = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
    try {
      await redis.eval(script, [key], [token]);
    } catch (err) {
      log.warn('refresh-lock release failed (lock will expire)', { err: String(err) });
    }
  };
}
```

**Caller pattern (`refresh/route.ts`):**
```typescript
const release = await acquireRefreshLock(userId);
if (!release) {
  // Loser of the race. Two strategies:
  //  (a) Sleep a tiny jitter + retry once (good enough for refresh — the
  //      winner will issue new cookies within ~500ms). 
  //  (b) Return 429 / 409 and let the client retry.
  // Recommendation: (a) — the cookies are HttpOnly, the loser still has the
  // old refresh JWT and can re-attempt; the lock will be free within 5s.
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
  return NextResponse.json({ error: 'CONFLICT', message: 'Concurrent refresh; retry' }, { status: 409 });
}
try {
  // ... rotate tokens, set cookies ...
} finally {
  await release();
}
```

[CITED: https://redis.io/docs/latest/commands/setnx/; https://upstash.com/blog/lock; "Distributed Locks with Redis" canonical pattern][VERIFIED: `@upstash/redis` 1.34.3 `redis.set(key, value, { nx: true, ex: N })` signature confirmed in package docs]

### Pattern 6: Banned-passwords list

**What:** A `Set<string>` of ~100 most-common passwords to block before bcrypt cost is paid. Do not block on substrings (`"password123"` is banned but `"ipasswordi"` is not — too many false positives).

**Reference implementation (`lib/server/auth/banned-passwords.ts`):**
```typescript
// Source: composed from NCSC Top-100k + SecLists/rockyou top entries, narrowed
// to ~100 highest-frequency. Lowercase-normalize on check.
import 'server-only';

const BANNED: ReadonlySet<string> = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789', 'qwerty',
  'qwerty123', 'abc123', 'letmein', 'welcome', 'welcome1', 'admin', 'admin123',
  'monkey', 'iloveyou', '111111', '000000', 'sunshine', 'princess', 'dragon',
  'football', 'baseball', 'master', 'shadow', 'superman', 'batman', 'trustno1',
  // ... ~70 more entries
]);

/** True if `password` is in the banned list (case-insensitive). */
export function isBanned(password: string): boolean {
  return BANNED.has(password.toLowerCase());
}
```

[ASSUMED: ~100-entry list size hits the right point on the false-positive vs. coverage curve. NIST 800-63B recommends "commonly used" + "compromised" lists without specifying size. Adjust per fork.]

### Pattern 7: Signup route shape (AUTH-01)

**What:** Enumeration-resistant — identical 201 for new and existing emails. Dummy bcrypt for non-existent. NO cookies issued.

**Code (`app/api/auth/signup/route.ts`):**
```typescript
export const runtime = 'nodejs';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { zEmail } from '@/lib/server/zod-helpers';
import { prisma } from '@/lib/server/prisma';
import { hashPassword, generateVerificationCode } from '@/lib/server/auth';
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { isPwned } from '@/lib/server/auth/hibp';
import { dummyBcryptCompare } from '@/lib/server/auth/dummy-bcrypt';
import { enqueueOutbox } from '@/lib/server/outbox';
import { createEmailLimiter } from '@/lib/server/middleware/rate-limit-by-email';
import { redis } from '@/lib/server/redis';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const Body = z.object({ email: zEmail, password: z.string() });

// Module-level so we don't re-build the limiter on every request.
const limiter = createEmailLimiter(
  { redis: redis ?? undefined },
  {
    bucket: 'auth:signup',
    windowMs: 60 * 60 * 1000,
    max: Number(process.env.AUTH_SIGNUP_RATE_LIMIT_MAX ?? 5),
    code: 'TOO_MANY_SIGNUP_ATTEMPTS',
    message: 'Too many signup attempts. Try again later.',
  },
);

const PASSWORD_MIN = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10);

export async function POST(req: NextRequest) {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.errors.map((e) => ({ path: e.path.join('.'), message: e.message })) },
        { status: 400 },
      );
    }
    const { email, password } = parsed.data;

    const rateFail = await limiter.check(req, email);
    if (rateFail) return rateFail;

    if (password.length < PASSWORD_MIN) {
      return NextResponse.json(
        { error: 'PASSWORD_TOO_SHORT', message: `Password must be at least ${PASSWORD_MIN} characters.` },
        { status: 400 },
      );
    }
    if (isBanned(password)) {
      return NextResponse.json({ error: 'PASSWORD_BANNED', message: 'This password is too common.' }, { status: 400 });
    }
    if (process.env.PASSWORD_HIBP_CHECK === '1' && (await isPwned(password))) {
      return NextResponse.json({ error: 'PASSWORD_PWNED', message: 'This password has appeared in a known breach.' }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Enumeration resistance: dummy compute, then identical 201.
      await dummyBcryptCompare(password);
      log.info('signup duplicate (enumeration-resist)', { email: '[REDACTED]' });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const passwordHash = await hashPassword(password);
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + Number(process.env.AUTH_VERIFICATION_TTL_MIN ?? 15) * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, passwordHash } });
      await tx.verificationCode.create({ data: { userId: user.id, code, type: 'EMAIL_VERIFY', expiresAt } });
      await enqueueOutbox(tx as any, {
        kind: 'email.verification_code',
        payload: { to: email, code, expiresAt: expiresAt.toISOString() },
      } as any);
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
```

**Note:** The `tx as any` + `event as any` casts are placeholders — Phase 1 must extend the `OutboxEvent` union (Pattern 20) to include `email.verification_code`, after which the casts are removed.

### Pattern 8: Constant-time error path ordering

**What:** When the no-user branch and the wrong-password branch return the same error, ALSO ensure they take the same code path length. Validation → rate-limit → password-policy → user lookup → dummy-or-real-bcrypt → response.

**Anti-pattern:** Early-return `if (!user) return 401` before the bcrypt step — leaks user existence via timing.

**Correct pattern:** See Pattern 3 dummy compute. The `signup` example above runs `dummyBcryptCompare(password)` on the duplicate-email branch.

### Pattern 9: Login route + lockout integration (AUTH-02 + AUTH-10)

**Sequence:**
1. Validate body
2. Rate limit per email (`createEmailLimiter` — 10/15m)
3. Check Redis lockout flag (`auth:lockout:{email}`)
4. Look up user; if not found → run dummy compute → return INVALID_CREDENTIALS
5. `bcrypt.compare(password, user.passwordHash)` — if fail → increment failure count → return INVALID_CREDENTIALS
6. If `failureCount >= 5` after this attempt → set lockout flag (15-min TTL) → return LOCKED_OUT
7. If `user.emailVerifiedAt === null` → return EMAIL_NOT_VERIFIED
8. Reset failure count → issue access + refresh + csrf cookies → return `{ ok: true, user }`

**Lockout error code distinction:** D-05 lists both `TOO_MANY_LOGIN_ATTEMPTS` (429 from rate limiter) and `LOCKED_OUT` (after 5 failures, separate persistence). Boundary: rate limit = transient (any user, even guesser); lockout = "you specifically have entered 5 wrong passwords." Lockout response is **423 Locked** per RFC 4918 (`Locked` status); rate limit is **429 Too Many Requests**. Both shapes:
- `429 { error: 'TOO_MANY_LOGIN_ATTEMPTS', message: '...' }`
- `423 { error: 'LOCKED_OUT', message: 'Account temporarily locked.' }`

[ASSUMED: 423 vs 429 split is appropriate. Common convention. If frontend prefers single 429, switch lockout to `429 { error: 'LOCKED_OUT', ... }` — both are valid.]

### Pattern 10: Lockout-store module

**Reference implementation (`lib/server/auth/lockout.ts`, ~50 LOC):**
```typescript
import 'server-only';
import { getRedis } from '@/lib/server/redis';
import { log } from '@/lib/server/observability/log';

const THRESHOLD = Number(process.env.AUTH_LOCKOUT_THRESHOLD ?? 5);
const DURATION_MS = Number(process.env.AUTH_LOCKOUT_DURATION_MIN ?? 15) * 60 * 1000;

const memCounts = new Map<string, { count: number; resetAt: number }>();

function memKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns true if `email` is currently locked out. */
export async function isLockedOut(email: string): Promise<boolean> {
  const key = `auth:lockout:${memKey(email)}`;
  const redis = getRedis();
  if (redis) {
    return Boolean(await redis.get(key));
  }
  const e = memCounts.get(memKey(email));
  if (!e) return false;
  if (e.resetAt <= Date.now()) {
    memCounts.delete(memKey(email));
    return false;
  }
  return e.count >= THRESHOLD;
}

/** Increment failure count; returns whether this attempt put the account at/over threshold. */
export async function recordFailure(email: string): Promise<{ count: number; locked: boolean }> {
  const key = `auth:lockout-count:${memKey(email)}`;
  const redis = getRedis();
  if (redis) {
    const count = (await redis.incr(key)) as number;
    if (count === 1) await redis.expire(key, Math.ceil(DURATION_MS / 1000));
    if (count >= THRESHOLD) {
      await redis.set(`auth:lockout:${memKey(email)}`, '1', { ex: Math.ceil(DURATION_MS / 1000) });
      return { count, locked: true };
    }
    return { count, locked: false };
  }
  log.warn('lockout using in-memory fallback (Redis absent)');
  const k = memKey(email);
  const now = Date.now();
  const e = memCounts.get(k);
  if (!e || e.resetAt <= now) {
    memCounts.set(k, { count: 1, resetAt: now + DURATION_MS });
    return { count: 1, locked: false };
  }
  e.count += 1;
  return { count: e.count, locked: e.count >= THRESHOLD };
}

/** Clear the failure count after successful login. */
export async function recordSuccess(email: string): Promise<void> {
  const k = memKey(email);
  const redis = getRedis();
  if (redis) {
    await redis.del(`auth:lockout-count:${k}`);
    await redis.del(`auth:lockout:${k}`);
    return;
  }
  memCounts.delete(k);
}
```

### Patterns 11–17: remaining route handlers

Per-route shape mirrors Pattern 7. Key differences:

- **Pattern 11 — `verify-email/route.ts`:** validate `{ email, code }`; rate limit (5/15m); `prisma.verificationCode.findFirst({ where: { code, type: 'EMAIL_VERIFY', usedAt: null, expiresAt: { gt: now }, user: { email } } })`; if missing → `VERIFICATION_CODE_INVALID`; if expired → `VERIFICATION_CODE_EXPIRED`; in tx: mark `usedAt`, set `user.emailVerifiedAt`, then issue cookies via `setAuthCookies` + `setCsrfCookie`. Use `timingSafeCompare` to compare codes (already in `auth.ts`).
- **Pattern 12 — `refresh/route.ts`:** read refresh cookie via `req.cookies.get(REFRESH_COOKIE_NAME)`; `verifyRefreshToken`; acquire single-flight lock (Pattern 5); compare `tokenVersion`; mint new access + refresh; `setAuthCookies`; `setCsrfCookie`; release lock.
- **Pattern 13 — `logout/route.ts`:** `verifyCsrf`; `clearAuthCookies()`; `clearCsrfCookie()`; return `{ ok: true }`.
- **Pattern 14 — `me/route.ts`:** `requireAuth(req.headers.get('authorization'))`; if `instanceof NextResponse` return it; else return `{ user: auth.user }`.
- **Pattern 15 — `forgot-password/route.ts`:** validate `{ email }`; rate limit (3/1h); look up user; if not found → dummy compute → return 200; if found → create VerificationCode (`type='PASSWORD_RESET'`) + `enqueueOutbox({ kind: 'email.password_reset', payload: { to, code, expiresAt } })`; return 200.
- **Pattern 16 — `reset-password/route.ts`:** validate `{ email, code, newPassword }`; rate limit (5/15m); password-policy checks (banned/min/HIBP); look up VerificationCode by `(code, type='PASSWORD_RESET', usedAt: null, expiresAt > now, user.email)`; if invalid increment `attempts`; if `attempts >= 5` invalidate code; in tx: hash new password, update user, mark code `usedAt`, optionally bump `tokenVersion` (kicks all sessions); return `{ ok: true }`.
- **Pattern 17 — `change-password/route.ts`:** `verifyCsrf`; `requireAuth`; validate `{ currentPassword, newPassword }`; verify currentPassword; password-policy checks; in tx: hash new password, `update user { passwordHash, tokenVersion: { increment: 1 } }`; **issue NEW cookies with bumped tokenVersion** (so current browser stays logged in; OTHER sessions fail next request); return `{ ok: true }`.

### Pattern 18: Outbox event union extension

**What:** Phase 1 emits two new outbox events. Add to `lib/server/outbox/types.ts`:

```typescript
// MODIFY frontend/src/lib/server/outbox/types.ts
export type OutboxEvent =
  | NotificationPaymentReceivedEvent
  | EmailPaymentConfirmationEvent
  | EmailVerificationCodeEvent      // ADD
  | EmailPasswordResetEvent;         // ADD

export interface EmailVerificationCodeEvent {
  kind: 'email.verification_code';
  payload: { to: string; code: string; expiresAt: string };
}

export interface EmailPasswordResetEvent {
  kind: 'email.password_reset';
  payload: { to: string; code: string; expiresAt: string };
}
```

This is a Phase 1 modification but `outbox/types.ts` is NOT in the do-not-modify list (the do-not-modify is `outbox/dispatcher.ts`). Verified by re-reading CLAUDE.md and Phase 0 outputs.

### Pattern 19: Email template factories

**Reference implementation (`lib/server/auth/email-templates.ts`):**
```typescript
import 'server-only';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export function verificationEmail(args: { code: string; email: string }): EmailTemplate {
  return {
    subject: 'Verify your email',
    html: `<p>Hi,</p><p>Your verification code is <strong>${args.code}</strong>.</p><p>It expires in 15 minutes.</p>`,
    text: `Your verification code is ${args.code}. It expires in 15 minutes.`,
  };
}

export function resetPasswordEmail(args: { code: string; email: string }): EmailTemplate {
  return {
    subject: 'Reset your password',
    html: `<p>Hi,</p><p>Your password reset code is <strong>${args.code}</strong>.</p><p>If you did not request this, ignore this email.</p>`,
    text: `Your password reset code is ${args.code}. If you did not request this, ignore this email.`,
  };
}
```

**Note:** Phase 5's email-queue cron consumes outbox `email.*` events. The cron handler will call `verificationEmail({ code, email })` to produce the `EmailJob` row. Phase 1 just defines the factories and emits the outbox events.

### Pattern 20: Vitest setup file (D-27)

**Reference implementation (`frontend/vitest.setup.ts`):**
```typescript
// Source: composed from Vitest docs (https://vitest.dev/config/#setupfiles).
// Sets env vars BEFORE any module imports auth.ts (which throws at import time
// if JWT_SECRET is missing or < 32 chars — see auth.ts:13–25).
// Must run as a setup file (NOT inside a test) because module-level `import`
// resolves before any test code.
process.env.JWT_SECRET ||= 'test-secret-must-be-at-least-32-chars-long-for-zod-validation';
process.env.ENCRYPTION_KEY ||=
  // 32-byte base64 (= 44 chars). Fixed value for deterministic tests; never use in prod.
  'aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n';
process.env.COOKIE_PREFIX ||= 'app';
process.env.NODE_ENV ||= 'test';
```

**Modify `vitest.config.ts`:**
```typescript
// MODIFY frontend/vitest.config.ts — add setupFiles
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    setupFiles: ['./vitest.setup.ts'],   // ← ADD
  },
  resolve: { /* ... existing ... */ },
});
```

**Note on `next/headers` global mock (Claude's Discretion):** With 5 routes setting cookies, recommend a **per-test** `vi.mock('next/headers', ...)` rather than a global setup mock — global mocks can mask bugs where a route forgets to call `cookies()`. Put a shared mock factory in `frontend/src/test-utils/mock-cookies.ts` that tests opt into.

### Pattern 21: Vitest Prisma mocking (D-25)

**Reference (`frontend/src/test-utils/prisma-mock.ts` — new):**
```typescript
import { beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

vi.mock('@/lib/server/prisma', () => ({
  prisma: prismaMock,
}));

beforeEach(() => {
  mockReset(prismaMock);
});
```

**Per-route test (example for signup):**
```typescript
// frontend/src/app/api/auth/signup/route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '@/test-utils/prisma-mock';
import { POST } from './route';
import { NextRequest } from 'next/server';

// Stub outbox so we can assert it was called with the right event.
vi.mock('@/lib/server/outbox', () => ({
  enqueueOutbox: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
}));

function makeReq(body: unknown): NextRequest {
  return new NextRequest('https://test/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/signup', () => {
  it('returns 201 for new email and creates User + VerificationCode', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.user.create.mockResolvedValue({ id: 'u1', email: 'a@b.com' } as any);
    prismaMock.verificationCode.create.mockResolvedValue({ id: 'v1' } as any);

    const res = await POST(makeReq({ email: 'a@b.com', password: 'longenoughpassword' }));
    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledOnce();
    expect(prismaMock.verificationCode.create).toHaveBeenCalledOnce();
  });

  it('returns 201 for existing email without creating User (enumeration-resist)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' } as any);
    const res = await POST(makeReq({ email: 'a@b.com', password: 'longenoughpassword' }));
    expect(res.status).toBe(201);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('returns 400 PASSWORD_BANNED for "password"', async () => {
    const res = await POST(makeReq({ email: 'a@b.com', password: 'password' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'PASSWORD_BANNED' });
  });

  it('returns 400 VALIDATION_FAILED for missing fields', async () => {
    const res = await POST(makeReq({ email: 'not-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 429 after rate limit exceeded', async () => {
    // Hit the limiter 6 times — 6th should be 429.
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await POST(makeReq({ email: 'rl@b.com', password: 'longenoughpassword' }));
    }
    expect(last?.status).toBe(429);
  });
});
```

[CITED: https://vitest.dev/guide/mocking; https://www.prisma.io/docs/orm/prisma-client/testing/unit-testing — verified 2026-05-07; vitest-mock-extended@4.0.0]

### Anti-Patterns to Avoid

- **Calling `await req.json()` before validation guards.** OK in our pattern (validation IS the first guard) but never call it twice — the body stream is consumed. If you need the raw body, use `req.text()`/`req.arrayBuffer()` once and JSON-parse separately.
- **Setting cookies via `response.cookies.set()` mixed with `cookies().set()`.** Our `setAuthCookies` uses `cookies().set()` exclusively. Mixing the two patterns creates duplicate `Set-Cookie` headers and cookie-overwrite races.
- **Modifying `lib/server/auth.ts` to add helpers.** It is in the do-not-modify list. New helpers go in `lib/server/auth/<name>.ts` (sibling directory).
- **Returning a 401 before the dummy bcrypt step in login/forgot-password/signup.** Leaks user existence. See Pattern 8.
- **Using `runtime = 'edge'` on any auth route.** Phase 0 guard test catches this; do not even try.
- **Calling `prisma.notification.create()` directly.** Always use `createNotification(prisma, input)` (notifications/index.ts catches `P2002`). Phase 1 doesn't currently emit notifications, but this rule applies if/when we do.
- **Bumping `tokenVersion` outside a tx.** `change-password` MUST hash + update `passwordHash` + bump `tokenVersion` inside one tx — partial failure leaves user with old password but new tokenVersion (or vice versa).
- **Forgetting to issue NEW cookies after `change-password`.** D-19 says "user's CURRENT browser stays logged in" — if you bump tokenVersion without issuing new cookies, the next request will 401 because the in-flight JWT has the old tokenVersion.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | `crypto.pbkdf2` or custom scheme | Existing `hashPassword`/`verifyPassword` from `auth.ts` (bcryptjs cost 12) | Already battle-tested; cost factor matches dummy hash |
| JWT signing | Custom HMAC + Base64 | Existing `createAccessToken`/`createRefreshToken`/`verifyToken`/`verifyRefreshToken` from `auth.ts` (jose) | Already correct; type/exp/iat handled |
| Cookie setting | `response.headers.append('Set-Cookie', ...)` | Existing `setAuthCookies`/`clearAuthCookies`/`setCsrfCookie` from `auth.ts` | Async `cookies()` already wrapped; path-scoping correct |
| CSRF check | Manual header + cookie compare | Existing `verifyCsrf(req)` from `auth.ts` | timingSafeEqual already used |
| Auth gate on `/me` and `/change-password` | Inline JWT verification | Existing `requireAuth` from `middleware/index.ts` | Already DB-checks `tokenVersion` |
| Per-email rate limit | Custom Redis counter | Existing `createEmailLimiter` from `middleware/rate-limit-by-email.ts` | Already lower-cases email + IP fallback |
| Verification code generation | UUID or random hex | Existing `generateVerificationCode` from `auth.ts` (Crockford 8-char) | UX-friendly alphabet; regex pre-built |
| Code timing-compare | `===` | Existing `timingSafeCompare` from `auth.ts` | Constant-time |
| Notification at-most-once | `prisma.notification.create` + try/catch | `createNotification(prisma, input)` from `notifications/index.ts` | P2002 already handled |
| Email send-from-route | `resend.emails.send()` direct | `enqueueOutbox(tx, event)` inside the same tx | Decouples from Resend availability; outbox cron drains |
| Request-context propagation | Pass requestId through every function | `makeRequestContext` + `withRequestContext` from `observability/request-context.ts` | ALS, Phase 0 already wired |
| Logger | `console.log` | `log` singleton from `observability/log.ts` | Auto-injects requestId |
| HIBP wrapper | `pwnedpasswords` npm package | Hand-rolled `lib/server/auth/hibp.ts` (~25 LOC) | One dep for one fetch; reject |
| Single-flight lock | `@upstash/lock` library | Hand-rolled `lib/server/auth/refresh-lock.ts` (~40 LOC) | One dep for one SETNX call; reject |
| Prisma mock for tests | Hand-rolled `vi.fn()` chains | `mockDeep<PrismaClient>()` from `vitest-mock-extended` | Consensus pattern; type-safe; one devDep |

**Key insight:** Phase 1 is ~80% glue — assemble existing lib helpers in the right order with the right error codes. The new code is concentrated in 5 small modules: `banned-passwords.ts`, `hibp.ts`, `lockout.ts`, `refresh-lock.ts`, `dummy-bcrypt.ts` — total ~200 LOC. The 9 routes are ~80 LOC each, ~720 LOC total. Tests are ~150 LOC per route × 9 = ~1350 LOC.

## Common Pitfalls

### Pitfall 1: `req.json()` consumed twice (or after `.text()`)
**What goes wrong:** Calling `await req.json()` after `await req.text()` (or vice versa) returns `{}` or throws — the body stream is single-consume.
**Why it happens:** Adding a "log raw body" line before the existing `req.json()` call.
**How to avoid:** Pick one access method per handler and stick to it. Phase 1 routes only need `req.json()`.
**Warning signs:** Validation passes for empty body; "request body already used" error.

### Pitfall 2: Cookies set on the wrong response object
**What goes wrong:** Calling `response.cookies.set()` on a `NextResponse` returned later in the handler, AND `cookies().set()` from `next/headers` — produces duplicate `Set-Cookie` headers, last-writer-wins.
**Why it happens:** Two cookie APIs exist in App Router. Tutorials show both.
**How to avoid:** Use only the lib helpers (`setAuthCookies`, `setCsrfCookie`, `clearAuthCookies`, `clearCsrfCookie`). They use `cookies()` from `next/headers` exclusively.
**Warning signs:** Browser shows multiple cookies with the same name; logout fails to clear cookies.

### Pitfall 3: `setAuthCookies` not awaited
**What goes wrong:** `setAuthCookies(...)` returns `Promise<void>`; not awaiting means the response goes out before the cookie is written.
**Why it happens:** TypeScript will catch unawaited promises only if `@typescript-eslint/no-floating-promises` is enabled (it should be — verify Phase 6 ESLint config).
**How to avoid:** Always `await setAuthCookies(...)`. Code review rule.
**Warning signs:** Login response has no `Set-Cookie` header.

### Pitfall 4: Dummy bcrypt cost mismatch leaks user existence
**What goes wrong:** Dummy hash uses cost 10; real `hashPassword` uses cost 12. Timing differs by ~3×; enumeration is restored.
**Why it happens:** Hand-typed dummy hash uses bcrypt's default cost (10).
**How to avoid:** Generate the dummy hash with `bcrypt.hashSync('arbitrary', 12)` once, paste into `dummy-bcrypt.ts`. If `auth.ts` ever changes its cost, regenerate.
**Warning signs:** Login latency for non-existent user is noticeably faster than for wrong password.

### Pitfall 5: HIBP timeout blocks signup
**What goes wrong:** HIBP API is slow or unreachable; signup hangs.
**Why it happens:** Default `fetch` has no timeout.
**How to avoid:** `AbortController` with `setTimeout(() => ctrl.abort(), 2000)` (Pattern 4). Fail open on timeout (return 0 = not pwned, log warn).
**Warning signs:** Signup p99 latency spikes; logs show `AbortError`.

### Pitfall 6: Refresh-lock holder dies; next holder DELs the wrong lock
**What goes wrong:** Holder A's TTL expires; holder B acquires; A finishes and DELs B's lock.
**Why it happens:** Naive `SETNX … DEL` instead of compare-and-delete.
**How to avoid:** Use Lua script for compare-and-delete (Pattern 5).
**Warning signs:** Concurrent refresh attempts succeed when one should be blocked.

### Pitfall 7: Lockout key TTL leaks across users
**What goes wrong:** `auth:lockout:` prefix without email → all users share one bucket.
**Why it happens:** Typo in key template.
**How to avoid:** Always include the lower-cased email in the key (Pattern 10).
**Warning signs:** One user gets locked out across the entire system.

### Pitfall 8: VerificationCode not invalidated after reset-password success
**What goes wrong:** Reused code can be replayed on the next attempt.
**Why it happens:** Forgetting to set `usedAt` in the same tx.
**How to avoid:** `tx.verificationCode.update({ where: { id }, data: { usedAt: new Date() } })` is mandatory in the same tx as the password update.
**Warning signs:** Same code accepted twice in tests.

### Pitfall 9: `tokenVersion` bumped on `change-password` but new cookies not issued
**What goes wrong:** User's current browser instantly logged out.
**Why it happens:** Forgetting Step 8 of Pattern 17.
**How to avoid:** After bumping `tokenVersion`, mint NEW access + refresh tokens with the new tokenVersion and call `setAuthCookies` again.
**Warning signs:** `change-password` returns 200 but next API call returns 401.

### Pitfall 10: Test imports `auth.ts` before setupFile sets `JWT_SECRET`
**What goes wrong:** Test boot throws "JWT_SECRET is required."
**Why it happens:** Vitest setup-file order.
**How to avoid:** `vitest.setup.ts` listed in `setupFiles` runs BEFORE any test/module loads. Confirm by running an empty test that imports `@/lib/server/auth` — should not throw.
**Warning signs:** Test runner fails at import time, before any test runs.

### Pitfall 11: Mocking `@/lib/server/prisma` after route imports it
**What goes wrong:** `vi.mock` not hoisted; route imports the real `prisma` first.
**Why it happens:** `vi.mock` is auto-hoisted by Vitest, BUT only if the call is at the top of the file (not inside `beforeEach`).
**How to avoid:** Always place `vi.mock(...)` at module level, before any route import. The shared `test-utils/prisma-mock.ts` does this once.
**Warning signs:** Test sees real DB connection attempt.

### Pitfall 12: Forgetting to add the `@upstash/redis` `eval` typing
**What goes wrong:** TypeScript complains about `redis.eval(...)` signature.
**Why it happens:** `@upstash/redis` types may not match exactly.
**How to avoid:** Cast `redis as any` with a `// eslint-disable-next-line` comment if needed for the Lua call, OR use `redis.set(... , { nx: true, ex: TTL, xx: false })` and accept the small race. **Preferred:** the script is < 100 chars, a typed wrapper is fine. Verify package version supports `eval`.

### Pitfall 13: Schema fields don't match what code expects
**What goes wrong:** Code references `user.failedLoginCount` — schema doesn't have it.
**Why it happens:** Naming drift between research/CONTEXT and the live schema.
**How to avoid:** **Recommend Redis-only lockout (no schema migration)** per the Standard Stack section above. If the team prefers DB-backed lockout, add a migration in Wave 0 with `failedLoginCount Int @default(0)` and `lockedUntilAt DateTime?` on `User`.
**Warning signs:** TS compile error in lockout module; runtime "column does not exist" error.

## Runtime State Inventory

Phase 1 is **greenfield** route-handler code. It is NOT a rename or refactor. The Runtime State Inventory protocol is therefore largely "nothing" — but there are minor items because of the schema/outbox extension:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 1 does not migrate or rename existing data. New rows are written to `User`, `VerificationCode`, `OutboxEvent` (all greenfield in this fork — no production data yet). | None. |
| Live service config | **Vercel Project Environment Variables** will need 11 new `AUTH_*` vars + `PASSWORD_HIBP_CHECK` set when the project deploys. Phase 1 documents in `.env.example` only; Vercel UI is a Phase 6 deploy task. | Document in `.env.example`. |
| OS-registered state | None. | None. |
| Secrets / env vars | **Renames:** none. **Additions:** `AUTH_VERIFICATION_TTL_MIN`, `AUTH_LOCKOUT_THRESHOLD`, `AUTH_LOCKOUT_DURATION_MIN`, `AUTH_LOGIN_RATE_LIMIT_MAX`, `AUTH_SIGNUP_RATE_LIMIT_MAX`, `AUTH_FORGOT_RATE_LIMIT_MAX`, `AUTH_RESET_RATE_LIMIT_MAX`, `AUTH_RESEND_VERIFY_RATE_LIMIT_MAX`, `AUTH_VERIFY_RATE_LIMIT_MAX`, `AUTH_PASSWORD_MIN_LENGTH`, `PASSWORD_HIBP_CHECK`. (D-08's notation `10/15m` is human-readable; recommend splitting into `_MAX` + assuming the window from D-08 — keeps env parsing trivial.) JWT_SECRET / ENCRYPTION_KEY are pre-existing. | Add 11 documented entries to `.env.example`. |
| Build artifacts / installed packages | `vitest-mock-extended` added to devDeps. `pnpm install` triggers `postinstall: prisma generate` (existing) — verify it succeeds. **`pnpm-lock.yaml` will change.** | Run `pnpm install` after editing package.json; commit lockfile. |

**Verified explicit nothing:** No SOPS-managed secrets in this repo. No Docker images yet (project is pre-deploy). No stale `egg-info` / `dist/` artifacts. No `pm2` / `launchd` registrations referenced.

**Schema migration question:** **Recommendation is Redis-only lockout — no migration.** If team prefers DB-backed:
```
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntilAt" TIMESTAMP(3);
```
Plus matching `schema.prisma` edits. Phase 1 plan should make this an explicit decision in Wave 0, not bake into routes.

## Code Examples

(Examples 1–12 already inline above as Patterns 4, 5, 6, 7, 10, 18, 19, 20, 21.) Below is the request-context wrapping skeleton for any Phase 1 handler:

### Example: Phase 1 route handler skeleton (every route follows this)

```typescript
// app/api/auth/<name>/route.ts
export const runtime = 'nodejs';
import { NextResponse, type NextRequest } from 'next/server';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

// Module-level limiter (constructed once per cold start).
// const limiter = createEmailLimiter({ redis: redis ?? undefined }, { ... });

export async function POST(req: NextRequest) {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. CSRF check (mutating routes only)
    // 2. Body parse + Zod validation
    // 3. Per-email rate limit (if applicable)
    // 4. Lockout check (login only)
    // 5. Business logic
    // 6. NextResponse with X-Request-Id header (optional — request-context module
    //    sets it; check Phase 0's existing wiring once routes are live).
    const res = NextResponse.json({ ok: true });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express middleware chain (`app.use(rateLimit)`) | HOF guards in route handlers (Pattern 7 sequence) | App Router 13.4+ | One file per route; no global guard ordering |
| Sync `cookies().set(...)` | `await cookies()` then `.set()` | Next 15.0 | All cookie helpers now async; `auth.ts` already correct |
| Sync route handlers returning a Response | Async route handlers returning `NextResponse \| Response` | Next 13 (App Router) | `NextResponse.json(...)` is the idiomatic shape |
| Bcrypt cost 10 | Bcrypt cost 12 | OWASP 2024+ guidance | `auth.ts:137` already cost 12; **dummy hash MUST match** |
| Char-class password rules ("must contain uppercase") | Length-only + breach check | NIST 800-63B (June 2017, reaffirmed 2024) | D-10/D-11 lock this; v1 ships compliant |
| Synchronous email send from route | Outbox + cron drain | This project's pattern | D-17 enforces |

**Deprecated/outdated (do not introduce):**
- Server-side session table for refresh-token revocation — use `tokenVersion` instead.
- `crypto.createHash('md5').update(password)` for HIBP — must be SHA-1 (HIBP API contract).
- `Math.random()` for any token / code — use `randomBytes` / `randomUUID`.
- Express-style `req.body` mutation — App Router req objects are immutable.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (Phase 0 wired) |
| Config file | `frontend/vitest.config.ts` (exists; needs `setupFiles` addition) |
| Quick run command | `pnpm --filter frontend exec vitest run <path>` |
| Full suite command | `pnpm --filter frontend test` (runs `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Signup returns 201 for new email + creates User+VerificationCode+outbox event | unit | `pnpm --filter frontend exec vitest run src/app/api/auth/signup/route.test.ts` | ❌ Wave 1 |
| AUTH-01 | Signup returns identical 201 for existing email; does NOT create User; runs dummy bcrypt | unit | (same file) | ❌ Wave 1 |
| AUTH-01 | Signup returns 400 PASSWORD_BANNED, 400 PASSWORD_TOO_SHORT | unit | (same file) | ❌ Wave 1 |
| AUTH-01 | Signup returns 429 after rate limit | unit | (same file) | ❌ Wave 1 |
| AUTH-02 | Login issues 3 cookies on success | unit | `... src/app/api/auth/login/route.test.ts` | ❌ Wave 1 |
| AUTH-02 | Login returns INVALID_CREDENTIALS for unknown email + dummy bcrypt runs | unit | (same file) | ❌ Wave 1 |
| AUTH-02 | Login returns INVALID_CREDENTIALS for wrong password + increments failure | unit | (same file) | ❌ Wave 1 |
| AUTH-02 | Login returns EMAIL_NOT_VERIFIED only after credentials match | unit | (same file) | ❌ Wave 1 |
| AUTH-03 | Verify-email with valid code → cookies set + emailVerifiedAt set | unit | `... src/app/api/auth/verify-email/route.test.ts` | ❌ Wave 1 |
| AUTH-03 | Verify-email returns VERIFICATION_CODE_INVALID for wrong code | unit | (same file) | ❌ Wave 1 |
| AUTH-03 | Verify-email returns VERIFICATION_CODE_EXPIRED for expired | unit | (same file) | ❌ Wave 1 |
| AUTH-04 | Refresh rotates access token, refresh cookie path stays `/api/auth` | unit | `... src/app/api/auth/refresh/route.test.ts` | ❌ Wave 1 |
| AUTH-04 | Refresh single-flight: 2nd concurrent attempt for same user 409s | unit | (same file) | ❌ Wave 1 |
| AUTH-04 | Refresh rejects mismatched tokenVersion → 401 | unit | (same file) | ❌ Wave 1 |
| AUTH-05 | Logout clears all 3 cookies | unit | `... src/app/api/auth/logout/route.test.ts` | ❌ Wave 1 |
| AUTH-05 | Logout returns 403 without CSRF header | unit | (same file) | ❌ Wave 1 |
| AUTH-06 | GET /me returns user identity for authed request | unit | `... src/app/api/auth/me/route.test.ts` | ❌ Wave 1 |
| AUTH-06 | GET /me returns 401 without cookie | unit | (same file) | ❌ Wave 1 |
| AUTH-07 | Forgot-password returns 200 for both new and missing emails | unit | `... src/app/api/auth/forgot-password/route.test.ts` | ❌ Wave 1 |
| AUTH-07 | Forgot-password creates VerificationCode + outbox event for real user | unit | (same file) | ❌ Wave 1 |
| AUTH-08 | Reset-password with valid code → password updated + code marked usedAt | unit | `... src/app/api/auth/reset-password/route.test.ts` | ❌ Wave 1 |
| AUTH-08 | Reset-password rejects expired or used code | unit | (same file) | ❌ Wave 1 |
| AUTH-09 | Change-password bumps tokenVersion + issues new cookies | unit | `... src/app/api/auth/change-password/route.test.ts` | ❌ Wave 1 |
| AUTH-09 | Change-password rejects without CSRF (403) | unit | (same file) | ❌ Wave 1 |
| AUTH-09 | Change-password rejects wrong current password | unit | (same file) | ❌ Wave 1 |
| AUTH-10 | Banned-passwords list catches "password" / "qwerty" | unit | `... src/lib/server/auth/banned-passwords.test.ts` | ❌ Wave 0 |
| AUTH-10 | HIBP wrapper sends correct prefix; parses suffix:count; fails open on timeout | unit (mock fetch) | `... src/lib/server/auth/hibp.test.ts` | ❌ Wave 0 |
| AUTH-10 | Lockout-store records failure, locks at threshold, clears on success | unit | `... src/lib/server/auth/lockout.test.ts` | ❌ Wave 0 |
| AUTH-10 | Refresh-lock acquires once, second attempt returns null, release allows retry | unit (mock Redis) | `... src/lib/server/auth/refresh-lock.test.ts` | ❌ Wave 0 |
| AUTH-10 | Email templates return non-empty `{ subject, html, text }` | unit | `... src/lib/server/auth/email-templates.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm --filter frontend exec vitest run <changed-test-file>` — typically < 1 second per route test (Prisma is mocked).
- **Per wave merge:** `pnpm --filter frontend test` — full Vitest suite (Phase 0 + Phase 1 tests; ~30 test files, < 10 seconds).
- **Phase gate:** `pnpm --filter frontend test && pnpm --filter frontend typecheck && pnpm --filter frontend lint` all green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `frontend/vitest.setup.ts` — Pattern 20 setup file with env fixtures (D-27)
- [ ] `frontend/vitest.config.ts` — modify to add `setupFiles: ['./vitest.setup.ts']`
- [ ] `frontend/src/test-utils/prisma-mock.ts` — shared `mockDeep<PrismaClient>()` (Pattern 21)
- [ ] `frontend/src/test-utils/mock-cookies.ts` — opt-in `next/headers` mock factory
- [ ] `frontend/package.json` — add `vitest-mock-extended` devDep, add `test:integration` script (empty)
- [ ] `frontend/src/lib/server/auth/banned-passwords.ts` + `.test.ts`
- [ ] `frontend/src/lib/server/auth/hibp.ts` + `.test.ts`
- [ ] `frontend/src/lib/server/auth/lockout.ts` + `.test.ts`
- [ ] `frontend/src/lib/server/auth/refresh-lock.ts` + `.test.ts`
- [ ] `frontend/src/lib/server/auth/dummy-bcrypt.ts`
- [ ] `frontend/src/lib/server/auth/email-templates.ts` + `.test.ts`
- [ ] `frontend/src/lib/server/outbox/types.ts` — extend `OutboxEvent` union (Pattern 18)
- [ ] `frontend/.env.example` — 11 new env vars

Wave 1 then ships the 9 routes + 9 route tests.

## Security Domain

> Phase 1 is the project's primary auth surface. Full ASVS coverage applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes — entire phase | bcryptjs cost 12 (auth.ts:137); dummy compute on no-user; locked accounts; HIBP opt-in; banned-passwords blocklist |
| V3 Session Management | yes — JWT + cookies | Access JWT 15m + refresh JWT 7d at `/api/auth`; CSRF double-submit; `tokenVersion` per-request DB check; secure/httpOnly/sameSite=lax cookies |
| V4 Access Control | yes — `requireAuth` HOF | `me` and `change-password` gate on `requireAuth`; 401 on stale tokenVersion |
| V5 Input Validation | yes — Zod every route | `zEmail`, length checks; reject malformed JSON via `safeParse` |
| V6 Cryptography | yes — never hand-rolled | bcryptjs (passwords); jose (JWT); Node `crypto.timingSafeEqual` (CSRF + code compare); Node `crypto.createHash('sha1')` (HIBP only — k-anonymity) |
| V7 Errors & Logging | yes — log redaction | Existing `logger.ts` redacts `email`, `password`, `passwordHash`, `token`, `refreshToken`, `csrfToken` (verified at logger.ts:3–13) |
| V8 Data Protection | yes | passwords never logged; verification codes single-use (`usedAt`); cookies `httpOnly` + `secure` in prod |
| V14 Configuration | yes | All routes `runtime='nodejs'` (Phase 0 enforced); `JWT_SECRET` boot-checks (auth.ts:13–25); env-overridable rate-limit values |

### Known Threat Patterns for auth-route stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| User enumeration via signup response timing | Information Disclosure | Pattern 3 dummy bcrypt + identical 201 (D-22) |
| User enumeration via login response timing | Information Disclosure | Same INVALID_CREDENTIALS for unknown email + wrong password (D-24); dummy compute when no user; constant-time bcrypt cost match |
| User enumeration via forgot-password | Information Disclosure | Always 200 (D-23) + dummy compute |
| Credential stuffing | Spoofing / Tampering | Per-email rate limit (D-08) + lockout after 5 failures (D-07) + HIBP opt-in (D-13) |
| Brute-force password | Spoofing | bcrypt cost 12 + per-email rate limit + lockout |
| Password reset token replay | Tampering | Single-use `usedAt`; 15-min TTL; 5-attempt cap on `attempts` field |
| Refresh token theft | Tampering | Path-scoped `/api/auth` (Pitfall M4 of Phase 0); httpOnly; tokenVersion bump on `change-password` invalidates |
| CSRF | Tampering | Double-submit cookie + header (`verifyCsrf` from auth.ts:192) on every mutating route |
| Concurrent refresh race | Tampering / DoS | Redis SETNX single-flight (D-20, Pattern 5) |
| Log injection via X-Request-Id | Tampering / Repudiation | Phase 0's regex validation in `makeRequestContext` |
| HIBP API outage | Availability / DoS | Fail open with warn log (D-13, Pattern 4); 2s timeout via AbortController |
| Banned-password bypass via case mutation | Tampering | `isBanned(password.toLowerCase())` |
| Lockout DoS (attacker locks victim out) | Denial of Service | Per-email lockout means an attacker can DoS one specific email; mitigation = forgot-password flow (which has its own rate limit) |
| Stale JWT on demoted/banned user | Spoofing | DB-side `tokenVersion` check on every `requireAuth` (middleware/index.ts:65–75) |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/01-auth-routes/01-CONTEXT.md` — locked decisions D-01 through D-28
- `.planning/phases/00-foundation/00-RESEARCH.md` — Patterns 4 & 5 request-context + log wrapper (Phase 0 outputs)
- `.planning/research/PITFALLS.md` — Pitfall 3 (cookies in App Router), Pitfall 9 (connection exhaustion), M4 (refresh path)
- `.planning/research/SUMMARY.md` — auth phase guidance, scope decisions
- `frontend/src/lib/server/auth.ts` — read in full (verified line numbers cited above)
- `frontend/src/lib/server/middleware/index.ts` — read in full (`requireAuth` DB-side tokenVersion check verified)
- `frontend/src/lib/server/middleware/rate-limit-by-email.ts` — read in full (lower-cased keys verified)
- `frontend/prisma/schema.prisma` — read; `User` lacks `failedLoginCount`/`lockedUntilAt`; `VerificationCode` uses `type`/`usedAt`/`attempts`
- `frontend/src/lib/server/observability/{request-context,log}.ts` — read; Phase 0 outputs confirmed
- `frontend/src/lib/server/notifications/templates.ts` — read; only in-app notification factories exist
- `frontend/src/lib/server/outbox/{index,types}.ts` — read; union is closed; `enqueueOutbox` is type-narrow
- `frontend/vitest.config.ts` — read; aliases `server-only` to empty stub
- npm registry verification 2026-05-07: `vitest-mock-extended@4.0.0`
- HIBP API docs (https://haveibeenpwned.com/api/v3) — verified
- Next.js cookies API docs (https://nextjs.org/docs/app/api-reference/functions/cookies) — verified async signature

### Secondary (MEDIUM confidence)
- Cloudflare blog "Validating Leaked Passwords with k-Anonymity" — corroborates HIBP pattern
- Troy Hunt's k-anonymity blog post — corroborates SHA-1 prefix length choice (5 chars)
- Spring Security CVE-2025-22234 timing-leak postmortem (DEV.to 2025) — corroborates dummy-bcrypt importance
- "Distributed Locks with Redis" (https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/) — corroborates compare-and-delete pattern
- Prisma docs "Unit testing with Prisma ORM" — corroborates `vitest-mock-extended` choice

### Tertiary (LOW confidence — flagged for validation)
- (none — Phase 1 prescriptions all sourced from primary research, locked decisions, or live codebase reads)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node TS module resolution allows `lib/server/auth.ts` to coexist with `lib/server/auth/` directory (no `index.ts`) | Pattern (file additions) | Low — verified by existing `lib/server/middleware/` (dir) coexisting with `lib/server/middleware.ts` style elsewhere; if it fails, rename to `lib/server/auth-helpers/`. |
| A2 | bcrypt cost factor in `hashPassword` is 12 and stable for v1 | Pattern 3 (dummy hash) | Medium — verified at auth.ts:137 today; if `hashPassword` ever drops to 10 the dummy-hash mismatches and timing leak returns. Plan should pin a comment in `dummy-bcrypt.ts` warning of this dependency. |
| A3 | HIBP API has no published rate limit for k-anonymity range queries | Pattern 4 | Low — corroborated by Troy Hunt's blog; if rate-limited, add Redis cache (was in `<specifics>` but deferred). |
| A4 | `@upstash/redis@1.34.3` `redis.eval(script, keys, args)` signature is supported | Pattern 5 | Medium — verified package docs; if signature differs, fall back to `SET ... NX EX TTL` without Lua compare-and-delete (accept lock-stealing race). |
| A5 | Redis-only lockout is acceptable in v1 (no DB-backed durability for the lockout state) | Don't Hand-Roll + Pitfall 13 | Low — lockout window is 15 min; Redis outage = lockout state lost = user can retry; same effective behavior as account never being locked, which is fine. |
| A6 | Locked-out HTTP status code 423 is acceptable for the frontend | Pattern 9 | Low — frontend switches on `error: 'LOCKED_OUT'` not status code (D-05); status code is informational. If 429 is preferred, swap. Not architecturally significant. |
| A7 | Inline `formatIssues` helper per route file is acceptable (vs. extracting to a new lib file) | Pattern 2 | Low — 5 lines, repeated 9 times; if cumulative duplication bothers reviewers, extract to `lib/server/auth/validation.ts`. |
| A8 | `vi.mock('@/lib/server/prisma', ...)` correctly intercepts the singleton in route handler imports | Pattern 21 | Low — Vitest auto-hoists `vi.mock`; standard pattern. Verified by Prisma docs example. |
| A9 | Phase 1 does NOT need to send actual emails in tests — outbox `enqueueOutbox` mock assertion is sufficient | D-17 + test strategy | Low — outbox dispatcher (Phase 5) handles real send; Phase 1 unit tests assert the event was enqueued. |
| A10 | The 9 route handlers can be implemented without modifying any file in the do-not-modify list | Standard Stack section | Low — all assembled from existing helpers; only the `outbox/types.ts` modification is needed (it is NOT in the do-not-modify list — only `outbox/dispatcher.ts` is). |
| A11 | Banned-passwords inline list of ~100 entries is the right size | Pattern 6 | Low — NIST 800-63B doesn't specify; per-fork can extend. |

**Items needing confirmation before execution:**
- A1 (module resolution) — verify by `pnpm --filter frontend typecheck` after creating `lib/server/auth/banned-passwords.ts`.
- A4 (`redis.eval` signature) — verify by running the lock release once locally.

## Open Questions

1. **Should lockout state be Redis-only or DB-backed?**
   - What we know: Schema lacks `failedLoginCount`/`lockedUntilAt`. CONTEXT.md `<specifics>` line 184 prefers Redis-only. Adding DB columns means a migration and per-attempt write.
   - What's unclear: Some teams prefer DB durability for compliance/audit.
   - Recommendation: **Redis-only** (no migration). Document the choice in `.env.example` so a fork can opt into DB-backed without disrupting the route code. (The `lockout.ts` module is the only place that changes.)

2. **Should HIBP responses be Redis-cached?**
   - What we know: CONTEXT.md `<specifics>` mentions a 1-hour Redis cache; `<deferred>` does not include caching. Each HIBP call returns ~24 KB.
   - What's unclear: Signup volume — most v1 forks are low.
   - Recommendation: **Skip caching in v1.** Add a comment in `hibp.ts` flagging the spot. If signup p99 latency spikes, add 1-hour Redis cache in 5 LOC.

3. **Should `change-password` always bump tokenVersion?**
   - What we know: D-19 says yes. Pattern 17 wires it.
   - What's unclear: Some apps want "stay logged in everywhere on password change."
   - Recommendation: **Always bump**, document the kick-other-sessions behavior in the route docstring. Per-fork can switch by setting `tokenVersion: { increment: 0 }` (no-op).

4. **Should reset-password also bump tokenVersion?**
   - What we know: D-19 doesn't explicitly say. Reset-password is a stronger signal than change-password (user demonstrated email control).
   - What's unclear: Behavioral consistency.
   - Recommendation: **Yes — bump tokenVersion in reset-password too**, kicking all old sessions (including any session the attacker may have stolen and not yet rotated). Issue NEW cookies in the same response.

5. **Should `next/headers` cookies be globally mocked in `vitest.setup.ts`?**
   - What we know: 5 routes set cookies. Global mock saves boilerplate; per-test mock catches more bugs.
   - What's unclear: Test maintenance cost vs. fidelity.
   - Recommendation: **Per-test opt-in** via `frontend/src/test-utils/mock-cookies.ts`. Tests that don't import it use the real `cookies()` from `next/headers` (which works in Vitest because `server-only` is aliased — but `cookies()` itself throws "outside request" without a mock). Per-test mock surfaces that contract.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 22.14 | — |
| pnpm | Workspace install | ✓ | 9.15 | — |
| `bcryptjs` | Password hashing | ✓ (installed) | 2.4.3 | — |
| `jose` | JWT | ✓ | 5.9.6 | — |
| `zod` | Validation | ✓ | 3.23.8 | — |
| `@prisma/client` | DB access | ✓ | 5.22 | — |
| `@upstash/redis` | Rate limit + lockout + lock | ✓ | 1.34.3 | MemoryRateLimitStore + per-process Map fallback (already wired) |
| `vitest` + `fast-glob` | Tests + Phase 0 guard | ✓ | 2.1.8 + 3.3.3 | — |
| `vitest-mock-extended` | Prisma mock | ✗ | — | Hand-rolled `vi.fn()` chains (verbose, type-unsafe) |
| Live HIBP API | `PASSWORD_HIBP_CHECK=1` only | ✓ (public) | — | Fail open (D-13) |
| Live Postgres / Neon | NOT required for Phase 1 unit tests (Prisma is mocked) | n/a | — | — |
| Live Upstash Redis | NOT required for Phase 1 unit tests (Redis is mocked / MemoryRateLimitStore fallback) | n/a | — | — |
| Resend (email) | Phase 1 ENQUEUES; Phase 5 SENDS | n/a for Phase 1 | — | — |

**Missing dependencies with no fallback:** None blocking; `vitest-mock-extended` is the only new install.

**Missing dependencies with fallback:** None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all installed packages verified against `package.json`; one new dep verified against npm registry; lib helpers all read in full
- Architecture: HIGH — patterns sourced from existing lib + Phase 0 outputs + verified Next.js docs
- Pitfalls: HIGH for items 1–11; MEDIUM for item 12 (`@upstash/redis` `eval` signature confirmed in package docs but not run live); MEDIUM for item 13 (Redis vs DB lockout is a judgement call, not a verifiable fact)
- Validation Architecture: HIGH — all tests describable; mocking pattern proven (Prisma docs cite same approach)
- Security Domain: HIGH — ASVS categories mapped to existing controls or new modules

**Research date:** 2026-05-07
**Valid until:** 2026-06-07 (30 days — auth patterns are stable; Next 16 + Sentry 10 + Prisma 5.22 all locked for v1)
