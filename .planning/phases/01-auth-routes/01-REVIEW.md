---
phase: 01-auth-routes
reviewed: 2026-05-07T00:00:00Z
depth: standard
files_reviewed: 39
files_reviewed_list:
  - .env.example
  - frontend/package.json
  - frontend/src/app/api/auth/change-password/route.ts
  - frontend/src/app/api/auth/change-password/route.test.ts
  - frontend/src/app/api/auth/forgot-password/route.ts
  - frontend/src/app/api/auth/forgot-password/route.test.ts
  - frontend/src/app/api/auth/login/route.ts
  - frontend/src/app/api/auth/login/route.test.ts
  - frontend/src/app/api/auth/logout/route.ts
  - frontend/src/app/api/auth/logout/route.test.ts
  - frontend/src/app/api/auth/me/route.ts
  - frontend/src/app/api/auth/me/route.test.ts
  - frontend/src/app/api/auth/refresh/route.ts
  - frontend/src/app/api/auth/refresh/route.test.ts
  - frontend/src/app/api/auth/reset-password/route.ts
  - frontend/src/app/api/auth/reset-password/route.test.ts
  - frontend/src/app/api/auth/signup/route.ts
  - frontend/src/app/api/auth/signup/route.test.ts
  - frontend/src/app/api/auth/verify-email/route.ts
  - frontend/src/app/api/auth/verify-email/route.test.ts
  - frontend/src/lib/server/auth/banned-passwords.ts
  - frontend/src/lib/server/auth/banned-passwords.test.ts
  - frontend/src/lib/server/auth/dummy-bcrypt.ts
  - frontend/src/lib/server/auth/dummy-bcrypt.test.ts
  - frontend/src/lib/server/auth/email-templates.ts
  - frontend/src/lib/server/auth/email-templates.test.ts
  - frontend/src/lib/server/auth/hibp.ts
  - frontend/src/lib/server/auth/hibp.test.ts
  - frontend/src/lib/server/auth/lockout.ts
  - frontend/src/lib/server/auth/lockout.test.ts
  - frontend/src/lib/server/auth/refresh-lock.ts
  - frontend/src/lib/server/auth/refresh-lock.test.ts
  - frontend/src/lib/server/middleware/index.ts
  - frontend/src/lib/server/outbox/dispatcher.ts
  - frontend/src/lib/server/outbox/types.ts
  - frontend/src/test-utils/mock-cookies.ts
  - frontend/src/test-utils/prisma-mock.ts
  - frontend/vitest.config.ts
  - frontend/vitest.setup.ts
findings:
  critical: 1
  warning: 7
  info: 6
  total: 14
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-07T00:00:00Z
**Depth:** standard
**Files Reviewed:** 39
**Status:** issues_found

## Summary

Phase 1 implements the full Next.js auth surface (signup, verify-email, login,
refresh, logout, me, forgot-password, reset-password, change-password) plus six
shared helpers. The architecture is solid and faithfully implements the
documented decisions (D-06..D-27): enumeration resistance with timing parity,
single-flight refresh, tokenVersion bump on password change, k-anonymity HIBP,
per-email rate limits with Redis-backed lockout, CSRF carve-outs on pre-session
routes, and `runtime='nodejs'` on every bcrypt-touching route.

That said, several invariants documented in CLAUDE.md and the route comments are
not actually enforced in the code:

- **Critical:** `forgot-password` violates enumeration resistance via response
  timing — `dummyBcryptCompare` runs in the no-user branch but the user branch
  blocks on a Postgres write + outbox enqueue inside a `$transaction`, which is
  far slower than a single bcrypt compare. The intent (D-23) is timing parity.
- **Warning:** `reset-password` runs the password policy gates **before** the
  per-email rate limiter. An attacker can probe HIBP / banned-list state for
  arbitrary passwords without touching the rate budget. The signup and
  change-password routes have the same ordering, but only reset-password is
  invoked unauthenticated AND keyed on user-supplied `email` for the limiter.
- **Warning:** `verify-email` does not bump `tokenVersion`, but the issued
  refresh token captures `user.tokenVersion` from a value selected before the
  `$transaction` write — fine here, but the same pattern is reused inconsistently
  elsewhere. Flagged for documentation rather than a bug fix.
- **Warning:** lockout's in-memory fallback never flips `locked: true` past the
  first threshold attempt; the next call returns the unchanged count without
  re-flipping `locked` (subtle), and `isLockedOut` only considers the count, not
  a separate flag — so the in-memory fallback's lockout horizon is implicit and
  the comment about "writes the lockout flag" applies to Redis only.
- **Warning:** the `email-templates` module embeds `args.code` directly into HTML
  without escaping. The verification code regex constrains the input to
  `[A-Z2-9]{8}` so XSS is not possible TODAY, but the function signature accepts
  `string` and Phase 5 reuses it for queue-rendered emails — a future caller
  passing user-controlled text would inject HTML.
- **Warning:** `refresh-lock` returns a release function whose internal Redis
  client reference is captured at acquire time. If `getRedis()` becomes null
  between acquire and release (process tear-down, hot reload), the release path
  is fine because we already captured a non-null `redis` — but if the SDK
  changes and `redis.eval` rejects with non-Error, the ternary `err instanceof
  Error ? err.message : String(err)` is correct; flagging only that the Lua
  script is sent as a literal string per `redis.eval` call rather than via
  `EVALSHA` — minor performance, not correctness.
- **Warning:** the change-password route does NOT clear the lockout counter
  after a successful password change. If a user was on the cusp of lockout
  (e.g., 4/5 failures) then changes their password, the failure counter from
  the OLD password persists.
- **Info:** several smaller items below.

## Critical Issues

### CR-01: `forgot-password` timing parity is broken — leaks email existence under network observation

**File:** `frontend/src/app/api/auth/forgot-password/route.ts:62-92`

**Issue:** D-23 (and the file header comment) promises that the no-user branch
takes "~the same time" as the user branch. The implementation runs:

- **No user:** one `dummyBcryptCompare` (one bcrypt compare, ~150-300ms at cost
  12). No DB writes.
- **User exists:** a `prisma.$transaction` containing
  `verificationCode.create` + `enqueueOutbox`. That's two row inserts and two
  Postgres roundtrips inside a transaction. Even on Neon-pooler this is
  consistently faster OR slower than a bcrypt compare by a measurable margin
  (typically 20–80ms vs 150–300ms), depending on Neon cold-start state.

The no-user path also skips DB I/O entirely (only `findUnique`), so a careful
attacker timing each request can distinguish `email exists` from `email does
not exist` — defeating the whole point of returning identical 200 bodies.

This is also inconsistent with `signup` (which uses `dummyBcryptCompare` too,
but its real branch ALSO performs `hashPassword` — the dominant cost — so the
two branches actually do match within bcrypt jitter). The forgot-password
route lacks that anchor cost.

**Fix:** mirror the signup pattern by performing the dominant-cost work
(bcrypt) on BOTH branches. The cleanest fix is to drop the no-op
`dummyBcryptCompare` and instead make the request finish-time bound by an
artificial delay computed from a fixed wall-clock budget, OR run a real bcrypt
hash on both sides and discard it. Concretely:

```typescript
// Replace the current no-user branch:
if (!user) {
  await dummyBcryptCompare(email);
  log.info('forgot-password no-user (enumeration-resist)');
  const res = NextResponse.json({ ok: true });
  res.headers.set('x-request-id', ctx.requestId);
  return res;
}

// With either:
//
// (A) Anchor both branches to a fixed deadline (preferred):
const startedAt = Date.now();
const TARGET_LATENCY_MS = 250;
// ...do the user-or-no-user work...
const elapsed = Date.now() - startedAt;
if (elapsed < TARGET_LATENCY_MS) {
  await new Promise((r) => setTimeout(r, TARGET_LATENCY_MS - elapsed));
}
//
// (B) OR perform a real hashPassword on both sides and discard:
await hashPassword(email); // ~150ms — happens on BOTH branches.
```

If option (A) is preferred for simplicity, also remove the now-misleading
`dummyBcryptCompare` import. Document the chosen approach in the route header
so future maintainers don't reintroduce the asymmetry.

## Warnings

### WR-01: `reset-password` runs HIBP / banned-list checks before rate-limit — burns no budget but leaks HIBP state to attacker

**File:** `frontend/src/app/api/auth/reset-password/route.ts:62-96`

**Issue:** The flow is:

1. Zod parse
2. `isBanned(newPassword)` — local lookup
3. `password.length < PASSWORD_MIN`
4. `isPwned(newPassword)` — **outbound HIBP request** (when env enabled)
5. `limiter.check(req, email)`

Steps 2-4 happen on every malformed/invalid request, INCLUDING when the
attacker sends bogus `email`+`code` and only varies `newPassword`. With
`PASSWORD_HIBP_CHECK=1`, this lets an unauthenticated attacker enumerate the
HIBP API status for arbitrary passwords without ever burning the
`auth:reset:<email>` rate-limit budget — they just rotate emails.

`signup` and `change-password` have the same gate ordering, but:
- signup also runs the limiter on the same email, AND it's the only pre-session
  route that needs to gate on the password BEFORE creating a user (no-user
  branch).
- change-password is authenticated, so requireAuth + CSRF already gate the
  call.

Only reset-password combines (a) unauthenticated, (b) HIBP-enabled, (c)
post-policy-gate rate-limit.

**Fix:** move the rate-limit check BEFORE the password policy block so the
attacker has to spend rate-limit budget before learning anything about HIBP
state:

```typescript
const { email, code, newPassword } = parsed.data;

// Move limiter UP — gate everything else behind the per-email budget.
const rateFail = await limiter.check(req, email);
if (rateFail) return rateFail;

// Now the password policy gates.
if (isBanned(newPassword)) { ... }
if (newPassword.length < PASSWORD_MIN) { ... }
if (process.env.PASSWORD_HIBP_CHECK === '1' && (await isPwned(newPassword))) { ... }
```

This costs nothing (the limiter is a single Redis incr) and removes the
HIBP-probing vector. Apply the same reordering to signup for consistency.

### WR-02: change-password does not reset lockout counter on success

**File:** `frontend/src/app/api/auth/change-password/route.ts:137-157`

**Issue:** A user who fails login 4 times then successfully changes their
password (perhaps via a different session that's still authenticated) will
retain the 4-failure counter for `auth:lockout-count:<email>` until its TTL
expires (15 min by default). The next single failed login on the new password
flips the lockout flag — so a legitimate user typing their new password in
slightly wrong on the first try gets locked out for 15 minutes.

The login route correctly calls `recordSuccess(email)` after a verified
credential. The same hygiene is missing from change-password and
reset-password.

**Fix:** call `recordSuccess(updated.email)` after the `prisma.user.update` in
both change-password and reset-password. For change-password:

```typescript
import { recordSuccess } from '@/lib/server/auth/lockout';

const updated = await prisma.user.update({ ... });

// Reset failure counter — old-password attempts shouldn't count against the
// new password.
await recordSuccess(updated.email);

const access = await createAccessToken({ ... });
```

For reset-password (after the `$transaction`):

```typescript
await recordSuccess(email);
log.info('password reset', { userId: user.id });
```

### WR-03: `email-templates.ts` embeds `code` into HTML without escaping

**File:** `frontend/src/lib/server/auth/email-templates.ts:29,37`

**Issue:**

```typescript
html: `<p>...code is <strong>${args.code}</strong>.</p>...`,
```

The `code` argument is currently always a Crockford 8-char alphanumeric string
(validated by `VERIFICATION_CODE_REGEX` upstream), so XSS is not possible
today. But the function signature is `code: string` — there's no schema-level
guarantee that future callers will keep that invariant. A maintainer adding a
new email template variant (e.g. password-changed notification including the
user's display name) is likely to copy this pattern and inject user input.

**Fix:** add a tiny HTML-escape helper and apply it to ALL interpolated values
in template HTML. Document in the header that any future template MUST run
inputs through `htmlEscape()`.

```typescript
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function verificationEmail(args: VerificationEmailArgs): EmailTemplate {
  const code = htmlEscape(args.code);
  return {
    subject: 'Verify your email',
    html: `<p>Hi,</p><p>Your verification code is <strong>${code}</strong>.</p>...`,
    text: `Your verification code is ${args.code}. ...`, // text/plain — no escape needed
  };
}
```

### WR-04: lockout in-memory fallback drops the threshold flag silently — `locked: true` is only true on the EXACT breach attempt

**File:** `frontend/src/lib/server/auth/lockout.ts:80-89`

**Issue:** In the in-memory fallback path:

```typescript
if (!e || e.resetAt <= now) {
  memCounts.set(k, { count: 1, resetAt: now + ttlMs });
  return { count: 1, locked: 1 >= limit };
}
e.count += 1;
return { count: e.count, locked: e.count >= limit };
```

`isLockedOut` for the memory path:

```typescript
const e = memCounts.get(k);
if (!e) return false;
if (e.resetAt <= Date.now()) {
  memCounts.delete(k);
  return false;
}
return e.count >= threshold();
```

This works, but is inconsistent with the Redis path, which uses a separate
flag key (`auth:lockout:<email>`) whose TTL is independent of the counter.
With the memory fallback, the counter's `resetAt` IS the lockout window — so
once a user hits threshold, the lockout expires when the counter expires.

The header comment claims "the lockout flag (D-07: 15-min lockout duration)"
is written on the threshold-breach attempt. In the memory fallback, no
separate flag exists; the counter's `resetAt` doubles as the flag TTL. A
careful reader will notice this is fine for dev (single-process), but the
asymmetry means the unit-test invariant "isLockedOut returns true for the
full 15 minutes after threshold" is only guaranteed when the counter was
LAST incremented at threshold breach. If the counter expires partway, lockout
ends.

**Fix:** either (a) make the memory path also store a separate `lockedUntil`
timestamp that's reset on threshold breach to `now + ttlMs`, OR (b) document
the asymmetry in the file header and acknowledge the dev-only fallback is
approximate. Option (a) is cleaner:

```typescript
interface MemEntry {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

// In recordFailure (memory path):
e.count += 1;
const locked = e.count >= limit;
if (locked) e.lockedUntil = now + ttlMs;
return { count: e.count, locked };

// In isLockedOut (memory path):
const e = memCounts.get(k);
if (!e) return false;
if (e.lockedUntil && e.lockedUntil > Date.now()) return true;
if (e.resetAt <= Date.now()) {
  memCounts.delete(k);
  return false;
}
return false;
```

### WR-05: `signup` and `verify-email` use `findUnique` then `findFirst` outside a transaction — TOCTOU window

**File:** `frontend/src/app/api/auth/signup/route.ts:104-142`,
`frontend/src/app/api/auth/verify-email/route.ts:66-137`

**Issue:** Both routes follow the pattern:

1. `prisma.user.findUnique({ where: { email } })`
2. (verify-email only) `prisma.verificationCode.findFirst({ where: ..., usedAt: null })`
3. `prisma.$transaction(async (tx) => { ... })`

For verify-email specifically, the gap between step 2 (find code with `usedAt:
null`) and step 3 (mark `usedAt = new Date()`) is non-atomic. Two concurrent
requests with the same valid code can both pass step 2, then both proceed to
the `$transaction`. The second tx will succeed too because `verificationCode.update`
sets `usedAt` based on `id` (no `usedAt: null` guard inside the update), which
means a concurrent attacker who somehow obtained the code (e.g., MITM,
shoulder-surfing) can use it twice — once legitimately and once to issue
themselves cookies for the same account.

In practice the email itself is the attack vector, not concurrent verify
calls, so the impact is low. But the route comment claims "single-use" — the
code IS consumed, but the consumption is racy.

**Fix:** make the update conditional on `usedAt: null` via `updateMany` and
verify the affected count:

```typescript
await prisma.$transaction(async (tx) => {
  const consumed = await tx.verificationCode.updateMany({
    where: { id: codeRow.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) {
    // Lost the race — surface as INVALID so the caller retries with a fresh code.
    throw new Error('VERIFICATION_CODE_RACE');
  }
  await tx.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: new Date() },
  });
});
```

Catch the thrown error in the outer scope and return
`VERIFICATION_CODE_INVALID` (or a fresh code). Apply the same pattern to
reset-password's `tx.verificationCode.update` (line 155-158).

### WR-06: refresh route does not invalidate the prior refresh token

**File:** `frontend/src/app/api/auth/refresh/route.ts:79-94`

**Issue:** The route mints a new refresh token and writes it via
`setAuthCookies`, but does NOT bump `tokenVersion` and does NOT track issued
refresh tokens in the DB. This means the OLD refresh token is still valid for
the rest of its 7-day lifetime — anyone who captured it (e.g. via a leaked
backup, `localStorage` exfil that doesn't apply here since these are
HttpOnly, etc.) can call /refresh again and get a fresh access token even
after the legitimate user has rotated.

This is the standard tradeoff for stateless refresh tokens (D-19 sticks
with tokenVersion-only, no rotation tracking). The risk is documented and
accepted, but the route comment claims "single-flight" — which prevents
race conditions on rotation, not token replay. Worth re-reading to confirm
this is intentional, since "rotating refresh token" usually means
invalidating the old one.

**Fix:** if D-19 truly intends stateless refresh, add a comment to the
route header explicitly calling out: "Old refresh tokens remain valid until
their JWT exp. Mitigation is the 7-day TTL + tokenVersion bump on password
change. Stolen-refresh-token replay is OUT OF SCOPE." If rotation tracking
IS desired, add a `RefreshTokenRevocation` table and check it in
`verifyRefreshToken`. Recommend the comment-only fix unless threat model
changed.

### WR-07: `forgot-password` ignores rate limiter when redis is undefined — silent dev/prod divergence

**File:** `frontend/src/app/api/auth/forgot-password/route.ts:28-34` (also
applies to signup, login, verify-email, reset-password)

**Issue:**

```typescript
const limiter = createEmailLimiter(redis ? { redis } : {}, { ... });
```

Without `redis`, `createEmailLimiter` (not under review here, but inferred
from the import) presumably uses an in-memory store per the CLAUDE.md note
("MemoryStore fallback in dev with a logger.warn"). On Vercel, each
serverless function instance has its own memory, so the limiter is
effectively bypassed by an attacker spreading load across instances. This
is a known limitation of the rate-limit-by-email design but should be
flagged here because the route comment ("Per-email rate limit") implies
hard enforcement.

**Fix:** verify `createEmailLimiter` logs a `warn` at boot in the no-redis
branch (the CLAUDE.md text suggests it does). If Phase 1 doesn't already
emit this warning, add a `log.warn('email-limiter using in-memory fallback')`
once at module load. Also add an env-fail-closed mode (e.g.
`AUTH_RATE_LIMIT_FAIL_CLOSED=1`) that returns 503 if redis is absent in
production — preventing accidental deploy of a binary without UPSTASH
configured.

## Info

### IN-01: `change-password` route reads `process.env.AUTH_PASSWORD_MIN_LENGTH` per-request, while `signup` and `reset-password` cache it at module load

**File:** `frontend/src/app/api/auth/change-password/route.ts:85`

**Issue:** Inconsistent caching of an env var. `change-password` re-reads
each request (which makes runtime overrides possible during tests), while
`signup` (line 28) and `reset-password` (line 27) read once at module load.
This means a test that does `vi.stubEnv('AUTH_PASSWORD_MIN_LENGTH', '20')`
mid-suite will affect change-password but not signup/reset.

**Fix:** pick one. For consistency with how the lockout module reads env
per-call (`threshold()` function), prefer per-request reads on all three
password routes. Or hoist all three to module-level constants. Either is
fine; consistency matters more than the choice.

### IN-02: `dummy-bcrypt.ts` lacks an upper-bound cost-mismatch guard

**File:** `frontend/src/lib/server/auth/dummy-bcrypt.ts:18`

**Issue:** The hash literal is hand-rolled: `'$2a$12$VF9C...'`. The unit
test asserts `$2a$12$` is present in the source (good), but if someone
changes `auth.ts` hashPassword cost from 12 to 13, both files have to
change in lockstep. There's no compile-time link between them.

**Fix:** export the hashPassword cost as a constant from `auth.ts`
(e.g. `BCRYPT_COST = 12`) and have the dummy module import it + call
`bcrypt.hashSync('static-string', BCRYPT_COST)` at module load to derive
the dummy hash dynamically. Adds ~150ms to cold start (one bcrypt at module
init) but eliminates the drift risk entirely.

### IN-03: `verify-email` does the redundant `timingSafeCompare` after the Prisma exact-match query

**File:** `frontend/src/app/api/auth/verify-email/route.ts:115-126`

**Issue:** The route comment says "Defensive constant-time compare (Prisma
where already exact-matched)." This is true but the query already
exact-matched the code, so this branch is unreachable in normal operation.
It's only there as defense-in-depth against (a) an ORM bug, or (b) a future
schema change that makes the where clause case-insensitive.

This is fine as-is; flagged only to suggest a one-line comment clarifying
"Unreachable in the current schema; retained as belt-and-braces against
ORM regressions" so future maintainers don't delete it as dead code.

### IN-04: `outbox/dispatcher.ts` references `email-templates` via dynamic import inside a hot path

**File:** `frontend/src/lib/server/outbox/dispatcher.ts:151,160`

**Issue:**

```typescript
const { verificationEmail } = await import('../auth/email-templates');
```

Dynamic imports inside the per-event dispatch loop are evaluated once per
process (Node caches them) so the runtime cost is amortized — but the
syntax suggests "lazy load to avoid circular imports", and there's no
explanatory comment. If the goal is purely to keep `dispatcher.ts` from
pulling in `auth/email-templates` at module load, a comment explaining
why would help. If there's no circular-import concern, switch to top-of-
file static imports.

**Fix:** add a one-line comment, e.g. `// Dynamic import — avoids
top-of-module dependency on auth/email-templates for environments that
don't process email events (Phase 1 backend-without-mailer).` Or move to
static imports if no such concern exists.

### IN-05: `package.json` `test:integration` is a noop with `exit 0`

**File:** `frontend/package.json:10`

**Issue:**

```json
"test:integration": "echo 'Phase 1: deferred to Phase 4 — see CONTEXT.md D-26' && exit 0",
```

This makes CI green for integration tests that don't yet exist. That's
intentional per D-26, but a forgotten removal in Phase 4 will silently
deploy uncovered code. Add a TODO or follow-up issue link.

**Fix:** add a comment marker that's grep-able, e.g.

```json
"test:integration": "echo 'TODO[Phase4]: replace with real integration tests — D-26' && exit 0",
```

### IN-06: `vitest.setup.ts` uses `||=` which silently keeps stale env from prior process — minor

**File:** `frontend/vitest.setup.ts:13-16`

**Issue:** `||=` only sets when the existing value is falsy. If a developer
runs tests after exporting `JWT_SECRET=changeme-foo` in their shell, the
test setup will NOT override it (because the existing value is truthy), and
auth.ts will throw at import time because `changeme-` matches the
placeholder regex. The error message will be cryptic ("JWT_SECRET appears
to be a placeholder") rather than pointing at the test fixture.

**Fix:** use unconditional assignment, OR check for the placeholder regex
explicitly:

```typescript
// Override unconditionally — tests should never inherit JWT_SECRET from the
// shell, that's a footgun.
process.env.JWT_SECRET = 'vitest-fixture-jwt-secret-with-enough-entropy-for-tests';
process.env.ENCRYPTION_KEY = 'aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcy1sb25n';
process.env.COOKIE_PREFIX = 'app';
process.env.NODE_ENV = 'test';
```

---

_Reviewed: 2026-05-07T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
